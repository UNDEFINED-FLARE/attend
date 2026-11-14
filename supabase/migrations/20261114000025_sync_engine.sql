-- UniAttend 0025 — the academic data synchronisation engine.
--
-- Every source (a file upload, a roster link, Moodle, a university's own API,
-- later ITS/CELCAT/Banner/PeopleSoft through configurable connectors) is turned
-- into rows of a common shape per dataset and goes through the same steps:
--
--   stage → validate → match → preview → commit → report
--
-- * integration_staging: rows waiting to be applied, per run. Admins of the
--   institution can read them (to preview); nobody writes them directly. Deleted
--   when the run ends, so source payloads are not kept.
-- * integration_external_ids: the source system's own id for each record, scoped
--   to institution + source + entity. Matching uses it first, then the natural key
--   (student number, staff number, module code…), so renumbering at the source
--   updates the same record instead of creating a new one.
-- * Preview runs the real commit inside a subtransaction and rolls it back, so the
--   preview and the import can never disagree.
-- * Commit applies one run atomically: either the whole run lands or none of it.
-- * Never deletes. Students and lecturers change status only from an explicit
--   status in the source. Enrolments are dropped only from an explicit status, or
--   by a complete reconciliation of the same source, guarded against mass removal.
-- * integration_errors: rejected rows with the reason (no payload). Kept with the run.
-- * integration_checkpoints: where an incremental sync got to, per dataset.
-- * Connection status: changed only by a real test made by the server (dispatch
--   secret), so an administrator can't mark a connection "connected" by hand.
--
-- Datasets: faculties, departments, programmes, academic_periods, venues, modules,
-- lecturers, students, enrolments, assignments. (Class sections and dated timetable
-- events follow in a later migration.)

-- ------------------------------------------------------------ connections: status

alter table uniattend.integrations
  add column if not exists connection_status text not null default 'not_configured',
  add column if not exists last_tested_at timestamptz,
  add column if not exists last_test_message text,
  add column if not exists last_success_at timestamptz;
alter table uniattend.integrations drop constraint if exists integrations_connection_status_check;
alter table uniattend.integrations add constraint integrations_connection_status_check
  check (connection_status in ('not_configured','incomplete','testing','connected','auth_failed','connection_failed',
                               'permission_denied','unavailable','suspended'));

-- ------------------------------------------------------------ runs: richer lifecycle

alter table uniattend.integration_runs
  add column if not exists source text,
  add column if not exists label text,
  add column if not exists mode text not null default 'full',
  add column if not exists complete boolean not null default false,
  add column if not exists checkpoints jsonb not null default '{}'::jsonb,
  add column if not exists created_by uuid references auth.users(id) on delete set null;
alter table uniattend.integration_runs drop constraint if exists integration_runs_status_check;
alter table uniattend.integration_runs add constraint integration_runs_status_check
  check (status in ('queued','staging','running','ok','warnings','failed','cancelled'));
alter table uniattend.integration_runs drop constraint if exists integration_runs_mode_check;
alter table uniattend.integration_runs add constraint integration_runs_mode_check check (mode in ('full','incremental'));
alter table uniattend.integration_runs drop constraint if exists integration_runs_trigger_check;
alter table uniattend.integration_runs add constraint integration_runs_trigger_check
  check (trigger in ('schedule','manual','api','upload','retry'));

-- ------------------------------------------------------------ tables

create table if not exists uniattend.integration_staging (
  id             bigint generated always as identity primary key,
  run_id         uuid not null references uniattend.integration_runs(id) on delete cascade,
  institution_id uuid not null references uniattend.institutions(id) on delete cascade,
  dataset        text not null check (dataset in ('faculties','departments','programmes','academic_periods','venues','modules',
                                                  'lecturers','students','enrolments','assignments')),
  row_no         int not null,
  payload        jsonb not null check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) < 8192),
  outcome        text check (outcome in ('insert','update','unchanged','duplicate','reject')),
  error          text,
  internal_id    uuid
);
create index if not exists integration_staging_run on uniattend.integration_staging(run_id, dataset, row_no);

create table if not exists uniattend.integration_external_ids (
  institution_id uuid not null references uniattend.institutions(id) on delete cascade,
  source         text not null check (length(source) between 1 and 80),
  entity         text not null,
  external_id    text not null check (length(external_id) between 1 and 200),
  internal_id    uuid not null,
  updated_at     timestamptz not null default now(),
  primary key (institution_id, source, entity, external_id)
);
create index if not exists integration_external_ids_internal on uniattend.integration_external_ids(institution_id, entity, internal_id);

create table if not exists uniattend.integration_errors (
  id             bigint generated always as identity primary key,
  run_id         uuid not null references uniattend.integration_runs(id) on delete cascade,
  institution_id uuid not null references uniattend.institutions(id) on delete cascade,
  dataset        text not null,
  row_no         int,
  ref            text,        -- external id / number / code: enough to find the row at the source, never the whole row
  message        text not null,
  created_at     timestamptz not null default now()
);
create index if not exists integration_errors_run on uniattend.integration_errors(run_id, dataset, row_no);

create table if not exists uniattend.integration_checkpoints (
  integration_id uuid not null references uniattend.integrations(id) on delete cascade,
  institution_id uuid not null references uniattend.institutions(id) on delete cascade,
  dataset        text not null,
  checkpoint     text not null check (length(checkpoint) <= 500),
  updated_at     timestamptz not null default now(),
  primary key (integration_id, dataset)
);

alter table uniattend.integration_staging enable row level security;
alter table uniattend.integration_external_ids enable row level security;
alter table uniattend.integration_errors enable row level security;
alter table uniattend.integration_checkpoints enable row level security;
drop policy if exists integration_staging_select on uniattend.integration_staging;
create policy integration_staging_select on uniattend.integration_staging for select to authenticated
  using (uniattend.is_inst_admin(institution_id));
drop policy if exists integration_external_ids_select on uniattend.integration_external_ids;
create policy integration_external_ids_select on uniattend.integration_external_ids for select to authenticated
  using (uniattend.is_inst_admin(institution_id));
drop policy if exists integration_errors_select on uniattend.integration_errors;
create policy integration_errors_select on uniattend.integration_errors for select to authenticated
  using (uniattend.is_inst_admin(institution_id) or uniattend.is_super_admin());
drop policy if exists integration_checkpoints_select on uniattend.integration_checkpoints;
create policy integration_checkpoints_select on uniattend.integration_checkpoints for select to authenticated
  using (uniattend.is_inst_admin(institution_id));
revoke insert, update, delete on uniattend.integration_staging, uniattend.integration_external_ids,
  uniattend.integration_errors, uniattend.integration_checkpoints from anon, authenticated;
revoke select on uniattend.integration_staging, uniattend.integration_external_ids, uniattend.integration_errors,
  uniattend.integration_checkpoints from anon;
grant select on uniattend.integration_staging, uniattend.integration_external_ids, uniattend.integration_errors,
  uniattend.integration_checkpoints to authenticated;

-- ------------------------------------------------------------ helpers

-- Free text from a source → one of our statuses, or null when it isn't recognisable.
create or replace function uniattend.sync_status(p_kind text, p_raw text)
returns text language sql immutable set search_path = '' as $$
  select case
    when p_raw is null or trim(p_raw) = '' then case p_kind when 'enrolment' then 'active' when 'assignment' then 'active' else 'active' end
    when p_kind = 'student' then case
      when lower(trim(p_raw)) in ('active','registered','current','enrolled','reg','a','1','true') then 'active'
      when lower(trim(p_raw)) in ('withdrawn','cancelled','canceled','deregistered','discontinued','inactive','w','0','false','left') then 'withdrawn'
      when lower(trim(p_raw)) in ('graduated','completed','alumni','g') then 'graduated'
      when lower(trim(p_raw)) in ('suspended','blocked','excluded','s') then 'suspended' end
    when p_kind = 'lecturer' then case
      when lower(trim(p_raw)) in ('active','current','employed','a','1','true') then 'active'
      when lower(trim(p_raw)) in ('left','terminated','resigned','retired','inactive','0','false') then 'left'
      when lower(trim(p_raw)) in ('suspended','blocked') then 'suspended' end
    when p_kind in ('enrolment','assignment') then case
      when lower(trim(p_raw)) in ('active','registered','enrolled','current','a','1','true') then 'active'
      when lower(trim(p_raw)) in ('dropped','withdrawn','cancelled','canceled','deregistered','removed','inactive','d','w','0','false') then 'dropped' end
  end;
$$;

-- Steps every dataset shares, on the dataset's rows in pg_temp._s:
-- external id → internal id; repeated rows in the same batch.
create or replace function uniattend._sync_match_ext(p_inst uuid, p_src text, p_entity text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update pg_temp._s s set iid = m.internal_id
    from uniattend.integration_external_ids m
   where s.error is null and s.ext is not null and m.institution_id = p_inst and m.source = p_src
     and m.entity = p_entity and m.external_id = s.ext;
end $$;

-- After the natural-key match: a key seen twice is a duplicate when identical, a conflict when not.
create or replace function uniattend._sync_dupes()
returns void language plpgsql security definer set search_path = '' as $$
begin
  update pg_temp._s s set outcome = case when s.p = f.p then 'duplicate' else 'reject' end,
                          error = case when s.p = f.p then null else 'appears more than once with different details (first at row ' || f.row_no || ')' end
    from (select distinct on (k) k, row_no, p from pg_temp._s where error is null and k is not null order by k, row_no) f
   where s.error is null and s.k = f.k and s.row_no <> f.row_no;
end $$;

-- Writes the outcome back to staging, remembers external ids, and returns the counts.
create or replace function uniattend._sync_finish(p_inst uuid, p_src text, p_entity text, p_commit boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c jsonb;
begin
  update pg_temp._s set outcome = 'reject' where error is not null;
  update uniattend.integration_staging st set outcome = s.outcome, error = s.error, internal_id = s.iid
    from pg_temp._s s where st.id = s.sid;
  if p_commit then
    insert into uniattend.integration_external_ids as m (institution_id, source, entity, external_id, internal_id)
    select distinct on (ext) p_inst, p_src, p_entity, ext, iid from pg_temp._s
     where ext is not null and iid is not null and outcome in ('insert','update','unchanged') order by ext, row_no
    on conflict (institution_id, source, entity, external_id) do update set internal_id = excluded.internal_id, updated_at = now()
      where m.internal_id is distinct from excluded.internal_id;
  end if;
  select jsonb_build_object('received', count(*),
           'inserted', count(*) filter (where outcome = 'insert'), 'updated', count(*) filter (where outcome = 'update'),
           'unchanged', count(*) filter (where outcome = 'unchanged'), 'duplicates', count(*) filter (where outcome = 'duplicate'),
           'rejected', count(*) filter (where outcome = 'reject'))
    into c from pg_temp._s;
  return c;
end $$;

-- ------------------------------------------------------------ applying one run

create or replace function uniattend._sync_apply(p_run uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r uniattend.integration_runs; v_inst uuid; v_src text; res jsonb := '{}'::jsonb; c jsonb; pattern text;
        n_mine int; n_gone int; n_seen int; v_dropped int := 0; v_held int := 0;
begin
  select * into r from uniattend.integration_runs where id = p_run;
  v_inst := r.institution_id;
  v_src := coalesce(r.source, case when r.integration_id is not null then 'conn:' || r.integration_id else 'upload' end);
  select student_number_pattern into pattern from uniattend.institutions where id = v_inst;

  -- ---------------------------------------------------- faculties
  drop table if exists pg_temp._s;
  create temp table _s on commit drop as
  select id sid, row_no, payload p, nullif(trim(payload->>'external_id'), '') ext,
         upper(trim(coalesce(payload->>'code', ''))) code, left(trim(coalesce(payload->>'name', '')), 200) name,
         null::uuid iid, null::text k, null::text outcome, null::text error
  from uniattend.integration_staging where run_id = p_run and dataset = 'faculties';
  update pg_temp._s set error = case when code = '' then 'code is missing' when name = '' then 'name is missing' end where error is null;
  perform uniattend._sync_match_ext(v_inst, v_src, 'faculty');
  update pg_temp._s s set iid = f.id from uniattend.faculties f
   where s.iid is null and s.error is null and f.institution_id = v_inst and upper(f.code) = s.code and f.deleted_at is null;
  update pg_temp._s set k = coalesce(ext, code) where error is null;
  perform uniattend._sync_dupes();
  update pg_temp._s s set outcome = case when s.iid is null then 'insert'
      when exists (select 1 from uniattend.faculties f where f.id = s.iid and (upper(f.code) <> s.code or f.name <> s.name)) then 'update' else 'unchanged' end
   where s.error is null and s.outcome is null;
  update uniattend.faculties f set code = s.code, name = s.name, updated_at = now() from pg_temp._s s where s.outcome = 'update' and f.id = s.iid;
  with ins as (insert into uniattend.faculties (institution_id, code, name)
               select v_inst, code, name from pg_temp._s where outcome = 'insert' returning id, code)
  update pg_temp._s s set iid = ins.id from ins where s.outcome = 'insert' and s.code = ins.code;
  res := res || jsonb_build_object('faculties', uniattend._sync_finish(v_inst, v_src, 'faculty', true));

  -- ---------------------------------------------------- departments
  drop table if exists pg_temp._s;
  create temp table _s on commit drop as
  select id sid, row_no, payload p, nullif(trim(payload->>'external_id'), '') ext,
         upper(trim(coalesce(payload->>'code', ''))) code, left(trim(coalesce(payload->>'name', '')), 200) name,
         upper(nullif(trim(payload->>'faculty_code'), '')) fcode, null::uuid fac,
         null::uuid iid, null::text k, null::text outcome, null::text error
  from uniattend.integration_staging where run_id = p_run and dataset = 'departments';
  update pg_temp._s s set fac = f.id from uniattend.faculties f
   where f.institution_id = v_inst and upper(f.code) = s.fcode and f.deleted_at is null;
  update pg_temp._s set error = case when code = '' then 'code is missing' when name = '' then 'name is missing'
      when fcode is null then 'faculty_code is missing' when fac is null then 'unknown faculty ' || fcode end where error is null;
  perform uniattend._sync_match_ext(v_inst, v_src, 'department');
  update pg_temp._s s set iid = d.id from uniattend.departments d
   where s.iid is null and s.error is null and d.institution_id = v_inst and upper(d.code) = s.code and d.deleted_at is null;
  update pg_temp._s set k = coalesce(ext, code) where error is null;
  perform uniattend._sync_dupes();
  update pg_temp._s s set outcome = case when s.iid is null then 'insert'
      when exists (select 1 from uniattend.departments d where d.id = s.iid and (upper(d.code) <> s.code or d.name <> s.name or d.faculty_id <> s.fac)) then 'update' else 'unchanged' end
   where s.error is null and s.outcome is null;
  update uniattend.departments d set code = s.code, name = s.name, faculty_id = s.fac, updated_at = now() from pg_temp._s s where s.outcome = 'update' and d.id = s.iid;
  with ins as (insert into uniattend.departments (institution_id, faculty_id, code, name)
               select v_inst, fac, code, name from pg_temp._s where outcome = 'insert' returning id, code)
  update pg_temp._s s set iid = ins.id from ins where s.outcome = 'insert' and s.code = ins.code;
  res := res || jsonb_build_object('departments', uniattend._sync_finish(v_inst, v_src, 'department', true));

  -- ---------------------------------------------------- programmes (qualifications)
  drop table if exists pg_temp._s;
  create temp table _s on commit drop as
  select id sid, row_no, payload p, nullif(trim(payload->>'external_id'), '') ext,
         upper(trim(coalesce(payload->>'code', ''))) code, left(trim(coalesce(payload->>'name', '')), 200) name,
         upper(nullif(trim(payload->>'department_code'), '')) dcode, null::uuid dep,
         null::uuid iid, null::text k, null::text outcome, null::text error
  from uniattend.integration_staging where run_id = p_run and dataset = 'programmes';
  update pg_temp._s s set dep = d.id from uniattend.departments d
   where d.institution_id = v_inst and upper(d.code) = s.dcode and d.deleted_at is null;
  update pg_temp._s set error = case when code = '' then 'code is missing' when name = '' then 'name is missing'
      when dcode is null then 'department_code is missing' when dep is null then 'unknown department ' || dcode end where error is null;
  perform uniattend._sync_match_ext(v_inst, v_src, 'programme');
  update pg_temp._s s set iid = x.id from uniattend.academic_programmes x
   where s.iid is null and s.error is null and x.institution_id = v_inst and upper(x.code) = s.code and x.deleted_at is null;
  update pg_temp._s set k = coalesce(ext, code) where error is null;
  perform uniattend._sync_dupes();
  update pg_temp._s s set outcome = case when s.iid is null then 'insert'
      when exists (select 1 from uniattend.academic_programmes x where x.id = s.iid and (upper(x.code) <> s.code or x.name <> s.name or x.department_id <> s.dep)) then 'update' else 'unchanged' end
   where s.error is null and s.outcome is null;
  update uniattend.academic_programmes x set code = s.code, name = s.name, department_id = s.dep, updated_at = now() from pg_temp._s s where s.outcome = 'update' and x.id = s.iid;
  with ins as (insert into uniattend.academic_programmes (institution_id, department_id, code, name)
               select v_inst, dep, code, name from pg_temp._s where outcome = 'insert' returning id, code)
  update pg_temp._s s set iid = ins.id from ins where s.outcome = 'insert' and s.code = ins.code;
  res := res || jsonb_build_object('programmes', uniattend._sync_finish(v_inst, v_src, 'programme', true));

  -- ---------------------------------------------------- academic periods
  drop table if exists pg_temp._s;
  create temp table _s on commit drop as
  select id sid, row_no, payload p, nullif(trim(payload->>'external_id'), '') ext,
         left(trim(coalesce(payload->>'name', '')), 120) name,
         lower(coalesce(nullif(trim(payload->>'kind'), ''), 'semester')) kind,
         case when payload->>'starts_on' ~ '^\d{4}-\d{2}-\d{2}' then left(payload->>'starts_on', 10) end s_on,
         case when payload->>'ends_on' ~ '^\d{4}-\d{2}-\d{2}' then left(payload->>'ends_on', 10) end e_on,
         coalesce(lower(payload->>'is_current') in ('true','1','yes'), false) cur,
         null::uuid iid, null::text k, null::text outcome, null::text error
  from uniattend.integration_staging where run_id = p_run and dataset = 'academic_periods';
  update pg_temp._s set error = case when name = '' then 'name is missing'
      when kind not in ('year','semester','term','block') then 'kind must be year, semester, term or block'
      when s_on is null or e_on is null then 'starts_on and ends_on must be dates (YYYY-MM-DD)'
      when e_on <= s_on then 'ends_on must be after starts_on' end where error is null;
  perform uniattend._sync_match_ext(v_inst, v_src, 'academic_period');
  update pg_temp._s s set iid = x.id from uniattend.academic_periods x
   where s.iid is null and s.error is null and x.institution_id = v_inst and lower(x.name) = lower(s.name);
  update pg_temp._s set k = coalesce(ext, lower(name)) where error is null;
  perform uniattend._sync_dupes();
  update pg_temp._s s set outcome = case when s.iid is null then 'insert'
      when exists (select 1 from uniattend.academic_periods x where x.id = s.iid and (x.name <> s.name or x.kind <> s.kind or x.starts_on <> s.s_on::date
                   or x.ends_on <> s.e_on::date or x.is_current <> s.cur)) then 'update' else 'unchanged' end
   where s.error is null and s.outcome is null;
  update uniattend.academic_periods x set name = s.name, kind = s.kind, starts_on = s.s_on::date, ends_on = s.e_on::date, is_current = s.cur, updated_at = now()
    from pg_temp._s s where s.outcome = 'update' and x.id = s.iid;
  with ins as (insert into uniattend.academic_periods (institution_id, name, kind, starts_on, ends_on, is_current)
               select v_inst, name, kind, s_on::date, e_on::date, cur from pg_temp._s where outcome = 'insert' returning id, name)
  update pg_temp._s s set iid = ins.id from ins where s.outcome = 'insert' and s.name = ins.name;
  res := res || jsonb_build_object('academic_periods', uniattend._sync_finish(v_inst, v_src, 'academic_period', true));

  -- ---------------------------------------------------- venues
  drop table if exists pg_temp._s;
  create temp table _s on commit drop as
  select id sid, row_no, payload p, nullif(trim(payload->>'external_id'), '') ext,
         nullif(upper(trim(coalesce(payload->>'code', ''))), '') code, left(trim(coalesce(payload->>'name', '')), 200) name,
         case when payload->>'capacity' ~ '^\d{1,6}$' and (payload->>'capacity')::int > 0 then (payload->>'capacity')::int end cap,
         nullif(left(trim(coalesce(payload->>'building', '')), 120), '') building,
         null::uuid iid, null::text k, null::text outcome, null::text error
  from uniattend.integration_staging where run_id = p_run and dataset = 'venues';
  update pg_temp._s set error = case when name = '' then 'name is missing' end where error is null;
  perform uniattend._sync_match_ext(v_inst, v_src, 'venue');
  update pg_temp._s s set iid = (select v.id from uniattend.venues v where v.institution_id = v_inst and v.deleted_at is null
                                   and ((s.code is not null and upper(v.code) = s.code) or (s.code is null and lower(v.name) = lower(s.name)))
                                 order by v.created_at limit 1)
   where s.iid is null and s.error is null;
  update pg_temp._s set k = coalesce(ext, code, lower(name)) where error is null;
  perform uniattend._sync_dupes();
  update pg_temp._s s set outcome = case when s.iid is null then 'insert'
      when exists (select 1 from uniattend.venues v where v.id = s.iid and (v.name <> s.name or v.code is distinct from coalesce(s.code, v.code)
                   or v.capacity is distinct from coalesce(s.cap, v.capacity) or v.building is distinct from coalesce(s.building, v.building))) then 'update' else 'unchanged' end
   where s.error is null and s.outcome is null;
  -- Map positions and outlines are set in UniAttend and never overwritten by a sync.
  update uniattend.venues v set name = s.name, code = coalesce(s.code, v.code), capacity = coalesce(s.cap, v.capacity),
         building = coalesce(s.building, v.building), updated_at = now()
    from pg_temp._s s where s.outcome = 'update' and v.id = s.iid;
  with ins as (insert into uniattend.venues (institution_id, name, code, capacity, building)
               select v_inst, name, code, cap, building from pg_temp._s where outcome = 'insert' returning id, name, code)
  update pg_temp._s s set iid = ins.id from ins where s.outcome = 'insert' and s.name = ins.name and s.code is not distinct from ins.code;
  res := res || jsonb_build_object('venues', uniattend._sync_finish(v_inst, v_src, 'venue', true));

  -- ---------------------------------------------------- modules
  drop table if exists pg_temp._s;
  create temp table _s on commit drop as
  select id sid, row_no, payload p, nullif(trim(payload->>'external_id'), '') ext,
         upper(trim(coalesce(payload->>'code', ''))) code, left(trim(coalesce(payload->>'title', payload->>'name', '')), 200) title,
         upper(nullif(trim(payload->>'department_code'), '')) dcode, nullif(trim(payload->>'period_name'), '') pname,
         case when payload->>'credits' ~ '^\d{1,3}$' then (payload->>'credits')::int end credits,
         null::uuid dep, null::uuid per, null::uuid iid, null::text k, null::text outcome, null::text error
  from uniattend.integration_staging where run_id = p_run and dataset = 'modules';
  update pg_temp._s s set dep = d.id from uniattend.departments d where d.institution_id = v_inst and upper(d.code) = s.dcode and d.deleted_at is null;
  update pg_temp._s s set per = x.id from uniattend.academic_periods x where x.institution_id = v_inst and lower(x.name) = lower(s.pname);
  update pg_temp._s set error = case when code = '' then 'code is missing' when length(code) > 40 then 'code is too long'
      when title = '' then 'title is missing'
      when dcode is not null and dep is null then 'unknown department ' || dcode
      when pname is not null and per is null then 'unknown academic period ' || pname end where error is null;
  perform uniattend._sync_match_ext(v_inst, v_src, 'module');
  update pg_temp._s s set iid = m.id from uniattend.modules m
   where s.iid is null and s.error is null and m.institution_id = v_inst and upper(m.code) = s.code
     and m.academic_period_id is not distinct from s.per and m.deleted_at is null;
  update pg_temp._s set k = coalesce(ext, code || '|' || coalesce(per::text, '')) where error is null;
  perform uniattend._sync_dupes();
  update pg_temp._s s set outcome = case when s.iid is null then 'insert'
      when exists (select 1 from uniattend.modules m where m.id = s.iid and (upper(m.code) <> s.code or m.title <> s.title
                   or m.department_id is distinct from coalesce(s.dep, m.department_id) or m.credits is distinct from coalesce(s.credits, m.credits))) then 'update' else 'unchanged' end
   where s.error is null and s.outcome is null;
  update uniattend.modules m set code = s.code, title = s.title, department_id = coalesce(s.dep, m.department_id),
         credits = coalesce(s.credits, m.credits), updated_at = now()
    from pg_temp._s s where s.outcome = 'update' and m.id = s.iid;
  with ins as (insert into uniattend.modules (institution_id, code, title, department_id, academic_period_id, credits)
               select v_inst, code, title, dep, per, credits from pg_temp._s where outcome = 'insert' returning id, code, academic_period_id)
  update pg_temp._s s set iid = ins.id from ins where s.outcome = 'insert' and s.code = ins.code and s.per is not distinct from ins.academic_period_id;
  res := res || jsonb_build_object('modules', uniattend._sync_finish(v_inst, v_src, 'module', true));

  -- ---------------------------------------------------- lecturers
  drop table if exists pg_temp._s;
  create temp table _s on commit drop as
  select id sid, row_no, payload p, nullif(trim(payload->>'external_id'), '') ext,
         upper(trim(coalesce(payload->>'staff_number', ''))) num,
         left(trim(coalesce(nullif(trim(payload->>'full_name'), ''), concat_ws(' ', nullif(trim(payload->>'first_name'), ''), nullif(trim(payload->>'last_name'), '')), '')), 200) name,
         nullif(lower(trim(coalesce(payload->>'email', ''))), '') email,
         upper(nullif(trim(payload->>'department_code'), '')) dcode, payload->>'status' raw_status,
         uniattend.sync_status('lecturer', payload->>'status') status,
         null::uuid dep, null::uuid iid, null::text k, null::text outcome, null::text error
  from uniattend.integration_staging where run_id = p_run and dataset = 'lecturers';
  update pg_temp._s s set dep = d.id from uniattend.departments d where d.institution_id = v_inst and upper(d.code) = s.dcode and d.deleted_at is null;
  update pg_temp._s set error = case when num = '' then 'staff_number is missing' when length(num) > 32 then 'staff_number is too long'
      when name = '' then 'name is missing'
      when email is not null and email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then 'email is not valid'
      when status is null then 'unknown status "' || left(raw_status, 30) || '"'
      when dcode is not null and dep is null then 'unknown department ' || dcode end where error is null;
  perform uniattend._sync_match_ext(v_inst, v_src, 'lecturer');
  update pg_temp._s s set iid = l.id from uniattend.lecturers l
   where s.iid is null and s.error is null and l.institution_id = v_inst and upper(l.staff_number) = s.num and l.deleted_at is null;
  -- A staff number that now belongs to someone else (renumbering at the source) is a conflict, not a merge.
  update pg_temp._s s set error = 'staff number ' || s.num || ' already belongs to another lecturer'
   where s.error is null and s.iid is not null and exists (select 1 from uniattend.lecturers l where l.institution_id = v_inst and upper(l.staff_number) = s.num
                                                             and l.id <> s.iid and l.deleted_at is null);
  update pg_temp._s set k = coalesce(ext, num) where error is null;
  perform uniattend._sync_dupes();
  update pg_temp._s s set outcome = case when s.iid is null then 'insert'
      when exists (select 1 from uniattend.lecturers l where l.id = s.iid and (upper(l.staff_number) <> s.num or l.full_name <> s.name
                   or l.email is distinct from coalesce(s.email, l.email) or l.status <> s.status
                   or l.department_id is distinct from coalesce(s.dep, l.department_id))) then 'update' else 'unchanged' end
   where s.error is null and s.outcome is null;
  update uniattend.lecturers l set staff_number = s.num, full_name = s.name, email = coalesce(s.email, l.email), status = s.status,
         department_id = coalesce(s.dep, l.department_id), updated_at = now()
    from pg_temp._s s where s.outcome = 'update' and l.id = s.iid;
  with ins as (insert into uniattend.lecturers (institution_id, staff_number, full_name, email, status, department_id)
               select v_inst, num, name, email, status, dep from pg_temp._s where outcome = 'insert' returning id, staff_number)
  update pg_temp._s s set iid = ins.id from ins where s.outcome = 'insert' and s.num = ins.staff_number;
  res := res || jsonb_build_object('lecturers', uniattend._sync_finish(v_inst, v_src, 'lecturer', true));

  -- ---------------------------------------------------- students
  drop table if exists pg_temp._s;
  create temp table _s on commit drop as
  select id sid, row_no, payload p, nullif(trim(payload->>'external_id'), '') ext,
         upper(trim(coalesce(payload->>'student_number', ''))) num,
         left(trim(coalesce(nullif(trim(payload->>'full_name'), ''), concat_ws(' ', nullif(trim(payload->>'first_name'), ''), nullif(trim(payload->>'last_name'), '')), '')), 200) name,
         nullif(lower(trim(coalesce(payload->>'email', ''))), '') email, payload->>'status' raw_status,
         uniattend.sync_status('student', payload->>'status') status,
         case when payload->>'year_of_study' ~ '^\d{1,2}$' and (payload->>'year_of_study')::int between 1 and 10 then (payload->>'year_of_study')::int end yos,
         upper(nullif(trim(payload->>'programme_code'), '')) pcode, null::uuid prog,
         null::uuid iid, null::text k, null::text outcome, null::text error
  from uniattend.integration_staging where run_id = p_run and dataset = 'students';
  update pg_temp._s s set prog = x.id from uniattend.academic_programmes x where x.institution_id = v_inst and upper(x.code) = s.pcode and x.deleted_at is null;
  update pg_temp._s set error = case when num = '' then 'student_number is missing'
      when length(num) not between 3 and 32 then 'student_number must be 3 to 32 characters'
      when pattern is not null and num !~ pattern then 'student number does not match the institution format'
      when name = '' then 'name is missing'
      when email is not null and email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then 'email is not valid'
      when status is null then 'unknown status "' || left(raw_status, 30) || '"'
      when pcode is not null and prog is null then 'unknown programme ' || pcode end where error is null;
  perform uniattend._sync_match_ext(v_inst, v_src, 'student');
  update pg_temp._s s set iid = x.id from uniattend.students x
   where s.iid is null and s.error is null and x.institution_id = v_inst and x.student_number = s.num and x.deleted_at is null;
  update pg_temp._s s set error = 'student number ' || s.num || ' already belongs to another student'
   where s.error is null and s.iid is not null and exists (select 1 from uniattend.students x where x.institution_id = v_inst and x.student_number = s.num
                                                             and x.id <> s.iid and x.deleted_at is null);
  update pg_temp._s set k = coalesce(ext, num) where error is null;
  perform uniattend._sync_dupes();
  update pg_temp._s s set outcome = case when s.iid is null then 'insert'
      when exists (select 1 from uniattend.students x where x.id = s.iid and (x.student_number <> s.num or x.full_name <> s.name
                   or x.email is distinct from coalesce(s.email, x.email) or x.status <> s.status
                   or x.year_of_study is distinct from coalesce(s.yos, x.year_of_study) or x.programme_id is distinct from coalesce(s.prog, x.programme_id))) then 'update' else 'unchanged' end
   where s.error is null and s.outcome is null;
  update uniattend.students x set student_number = s.num, full_name = s.name, email = coalesce(s.email, x.email), status = s.status,
         year_of_study = coalesce(s.yos, x.year_of_study), programme_id = coalesce(s.prog, x.programme_id), updated_at = now()
    from pg_temp._s s where s.outcome = 'update' and x.id = s.iid;
  with ins as (insert into uniattend.students (institution_id, student_number, full_name, email, status, year_of_study, programme_id)
               select v_inst, num, name, email, status, yos, prog from pg_temp._s where outcome = 'insert' returning id, student_number)
  update pg_temp._s s set iid = ins.id from ins where s.outcome = 'insert' and s.num = ins.student_number;
  res := res || jsonb_build_object('students', uniattend._sync_finish(v_inst, v_src, 'student', true));

  -- ---------------------------------------------------- enrolments
  drop table if exists pg_temp._s;
  create temp table _s on commit drop as
  select id sid, row_no, payload p, nullif(trim(payload->>'external_id'), '') ext,
         nullif(upper(trim(coalesce(payload->>'student_number', ''))), '') snum, nullif(trim(payload->>'student_external_id'), '') sext,
         nullif(upper(trim(coalesce(payload->>'module_code', ''))), '') mcode, nullif(trim(payload->>'module_external_id'), '') mext,
         nullif(trim(payload->>'period_name'), '') pname, payload->>'status' raw_status,
         uniattend.sync_status('enrolment', payload->>'status') status,
         null::uuid stu, null::text stu_status, null::uuid mod, null::uuid iid, null::text k, null::text outcome, null::text error
  from uniattend.integration_staging where run_id = p_run and dataset = 'enrolments';
  update pg_temp._s s set stu = m.internal_id from uniattend.integration_external_ids m
   where s.sext is not null and m.institution_id = v_inst and m.source = v_src and m.entity = 'student' and m.external_id = s.sext;
  update pg_temp._s s set stu = x.id from uniattend.students x
   where s.stu is null and s.snum is not null and x.institution_id = v_inst and x.student_number = s.snum and x.deleted_at is null;
  update pg_temp._s s set stu_status = x.status from uniattend.students x where x.id = s.stu;
  update pg_temp._s s set mod = m.internal_id from uniattend.integration_external_ids m
   where s.mext is not null and m.institution_id = v_inst and m.source = v_src and m.entity = 'module' and m.external_id = s.mext;
  update pg_temp._s s set mod = (select m.id from uniattend.modules m
                                  left join uniattend.academic_periods ap on ap.id = m.academic_period_id
                                 where m.institution_id = v_inst and upper(m.code) = s.mcode and m.deleted_at is null
                                   and (s.pname is null or lower(ap.name) = lower(s.pname))
                                 order by (m.academic_period_id is null) desc, m.created_at desc limit 1)
   where s.mod is null and s.mcode is not null;
  update pg_temp._s set error = case when snum is null and sext is null then 'student_number is missing'
      when mcode is null and mext is null then 'module_code is missing'
      when stu is null then 'unknown student ' || coalesce(snum, sext)
      when mod is null then 'unknown module ' || coalesce(mcode, mext)
      when status is null then 'unknown status "' || left(raw_status, 30) || '"' end where error is null;
  -- New enrolments only for students who are active at the institution.
  update pg_temp._s s set error = 'student ' || coalesce(s.snum, s.sext) || ' is ' || s.stu_status || ', so they can''t be enrolled'
   where s.error is null and s.status = 'active' and s.stu_status <> 'active'
     and not exists (select 1 from uniattend.module_enrolments e where e.module_id = s.mod and e.student_id = s.stu and e.status = 'active');
  update pg_temp._s s set iid = e.id from uniattend.module_enrolments e where s.error is null and e.module_id = s.mod and e.student_id = s.stu;
  update pg_temp._s set k = mod || '|' || stu where error is null;
  perform uniattend._sync_dupes();
  update pg_temp._s s set outcome = case
      when s.iid is null and s.status = 'dropped' then 'unchanged'
      when s.iid is null then 'insert'
      when exists (select 1 from uniattend.module_enrolments e where e.id = s.iid and e.status <> s.status) then 'update' else 'unchanged' end
   where s.error is null and s.outcome is null;
  -- The status changes; who created the enrolment does not (a hand-made one never becomes removable by a sync).
  update uniattend.module_enrolments e set status = s.status
    from pg_temp._s s where s.outcome = 'update' and e.id = s.iid;
  with ins as (insert into uniattend.module_enrolments (institution_id, module_id, student_id, source)
               select v_inst, mod, stu, r.integration_id from pg_temp._s where outcome = 'insert' returning id, module_id, student_id)
  update pg_temp._s s set iid = ins.id from ins where s.outcome = 'insert' and s.mod = ins.module_id and s.stu = ins.student_id;
  c := uniattend._sync_finish(v_inst, v_src, 'enrolment', true);

  -- A complete roster from a connection: drop that connection's own enrolments, in the modules it
  -- covered, that are no longer listed. Held back when it would remove most of them at once.
  if r.complete and r.integration_id is not null then
    select count(*) into n_seen from pg_temp._s where outcome in ('insert','update','unchanged','duplicate');
    select count(*) into n_mine from uniattend.module_enrolments where source = r.integration_id and status = 'active';
    select count(*) into n_gone from uniattend.module_enrolments e
     where e.source = r.integration_id and e.status = 'active'
       and exists (select 1 from pg_temp._s s where s.mod = e.module_id and s.error is null)
       and not exists (select 1 from pg_temp._s s where s.mod = e.module_id and s.stu = e.student_id and s.error is null);
    if n_gone > 0 and (n_seen = 0 or (n_gone > 20 and n_gone * 2 > n_mine)) then
      v_held := n_gone;
    elsif n_gone > 0 then
      update uniattend.module_enrolments e set status = 'dropped'
       where e.source = r.integration_id and e.status = 'active'
         and exists (select 1 from pg_temp._s s where s.mod = e.module_id and s.error is null)
         and not exists (select 1 from pg_temp._s s where s.mod = e.module_id and s.stu = e.student_id and s.error is null);
      v_dropped := n_gone;
    end if;
  end if;
  res := res || jsonb_build_object('enrolments', c || jsonb_build_object('dropped_missing', v_dropped, 'held_back', v_held));

  -- ---------------------------------------------------- teaching assignments
  drop table if exists pg_temp._s;
  create temp table _s on commit drop as
  select id sid, row_no, payload p, null::text ext,
         nullif(upper(trim(coalesce(payload->>'staff_number', ''))), '') lnum, nullif(trim(payload->>'lecturer_external_id'), '') lext,
         nullif(lower(trim(coalesce(payload->>'email', ''))), '') email,
         nullif(upper(trim(coalesce(payload->>'module_code', ''))), '') mcode, nullif(trim(payload->>'module_external_id'), '') mext,
         case when lower(coalesce(payload->>'role', '')) in ('assistant','tutor','ta') then 'assistant' else 'primary' end role,
         payload->>'status' raw_status, uniattend.sync_status('assignment', payload->>'status') status,
         null::uuid lec, null::uuid mod, null::uuid iid, null::text k, null::text outcome, null::text error
  from uniattend.integration_staging where run_id = p_run and dataset = 'assignments';
  update pg_temp._s s set lec = m.internal_id from uniattend.integration_external_ids m
   where s.lext is not null and m.institution_id = v_inst and m.source = v_src and m.entity = 'lecturer' and m.external_id = s.lext;
  update pg_temp._s s set lec = (select l.id from uniattend.lecturers l where l.institution_id = v_inst and l.deleted_at is null
                                  and ((s.lnum is not null and upper(l.staff_number) = s.lnum) or (s.lnum is null and s.email is not null and lower(l.email) = s.email))
                                 limit 1)
   where s.lec is null;
  update pg_temp._s s set mod = m.internal_id from uniattend.integration_external_ids m
   where s.mext is not null and m.institution_id = v_inst and m.source = v_src and m.entity = 'module' and m.external_id = s.mext;
  update pg_temp._s s set mod = (select m.id from uniattend.modules m where m.institution_id = v_inst and upper(m.code) = s.mcode and m.deleted_at is null
                                 order by (m.academic_period_id is null) desc, m.created_at desc limit 1)
   where s.mod is null and s.mcode is not null;
  update pg_temp._s set error = case when lnum is null and lext is null and email is null then 'staff_number or email is missing'
      when mcode is null and mext is null then 'module_code is missing'
      when lec is null then 'unknown lecturer ' || coalesce(lnum, lext, email)
      when mod is null then 'unknown module ' || coalesce(mcode, mext)
      when status is null then 'unknown status "' || left(raw_status, 30) || '"' end where error is null;
  update pg_temp._s s set iid = a.id from uniattend.lecturer_assignments a where s.error is null and a.module_id = s.mod and a.lecturer_id = s.lec;
  update pg_temp._s set k = mod || '|' || lec where error is null;
  perform uniattend._sync_dupes();
  update pg_temp._s s set outcome = case
      when s.status = 'dropped' and s.iid is null then 'unchanged'
      when s.status = 'dropped' then 'update'
      when s.iid is null then 'insert'
      when exists (select 1 from uniattend.lecturer_assignments a where a.id = s.iid and a.role <> s.role) then 'update' else 'unchanged' end
   where s.error is null and s.outcome is null;
  -- An assignment ending at the source removes the lecturer from the module; their past sessions stay.
  delete from uniattend.lecturer_assignments a using pg_temp._s s where s.outcome = 'update' and s.status = 'dropped' and a.id = s.iid;
  update uniattend.lecturer_assignments a set role = s.role from pg_temp._s s where s.outcome = 'update' and s.status = 'active' and a.id = s.iid;
  insert into uniattend.lecturer_assignments (institution_id, module_id, lecturer_id, role, source)
  select v_inst, mod, lec, role, r.integration_id from pg_temp._s where outcome = 'insert';
  res := res || jsonb_build_object('assignments', uniattend._sync_finish(v_inst, v_src, 'assignment', false));

  return res;
end $$;

-- Totals across datasets, for the run summary.
create or replace function uniattend._sync_totals(p_res jsonb)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'received', coalesce(sum((v->>'received')::int), 0), 'inserted', coalesce(sum((v->>'inserted')::int), 0),
    'updated', coalesce(sum((v->>'updated')::int), 0), 'unchanged', coalesce(sum((v->>'unchanged')::int), 0),
    'duplicates', coalesce(sum((v->>'duplicates')::int), 0), 'rejected', coalesce(sum((v->>'rejected')::int), 0))
  from jsonb_each(coalesce(p_res, '{}'::jsonb)) e(k, v);
$$;

-- Preview (p_commit false: everything is applied, counted, then rolled back) or commit.
create or replace function uniattend._sync_process(p_run uuid, p_commit boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r uniattend.integration_runs; res jsonb; outcomes jsonb; tot jsonb; v_status text;
begin
  select * into r from uniattend.integration_runs where id = p_run for update;
  if r.id is null then raise exception 'unknown import'; end if;
  if r.status not in ('staging','running') then raise exception 'This import has already finished (%).', r.status using errcode = 'P0001'; end if;
  if not exists (select 1 from uniattend.institutions where id = r.institution_id and status = 'active' and deleted_at is null) then
    raise exception 'Your institution must be approved before data can be imported.' using errcode = 'P0001';
  end if;

  if not p_commit then
    begin
      res := uniattend._sync_apply(p_run);
      select coalesce(jsonb_agg(jsonb_build_array(id, outcome, error, internal_id)), '[]'::jsonb) into outcomes
        from uniattend.integration_staging where run_id = p_run;
      raise exception using errcode = 'UA001', message = 'preview';
    exception when sqlstate 'UA001' then
      null;  -- everything above is undone; keep only what we learned
    end;
    update uniattend.integration_staging st set outcome = o->>1, error = o->>2, internal_id = (o->>3)::uuid
      from jsonb_array_elements(outcomes) o where st.id = (o->>0)::bigint and st.run_id = p_run;
    tot := uniattend._sync_totals(res);
    update uniattend.integration_runs set summary = jsonb_build_object('preview', true, 'datasets', res) || tot where id = p_run;
    return jsonb_build_object('preview', true, 'datasets', res) || tot;
  end if;

  res := uniattend._sync_apply(p_run);
  tot := uniattend._sync_totals(res);
  insert into uniattend.integration_errors (run_id, institution_id, dataset, row_no, ref, message)
  select p_run, r.institution_id, dataset, row_no,
         left(coalesce(payload->>'external_id', payload->>'student_number', payload->>'staff_number', payload->>'code', payload->>'module_code', payload->>'name'), 120),
         left(error, 300)
    from uniattend.integration_staging where run_id = p_run and outcome = 'reject';
  delete from uniattend.integration_staging where run_id = p_run;   -- source payloads are not kept
  v_status := case when (tot->>'rejected')::int > 0 or exists (select 1 from jsonb_each(res) e(k, v) where (v->>'held_back')::int > 0) then 'warnings' else 'ok' end;
  update uniattend.integration_runs set status = v_status, summary = jsonb_build_object('datasets', res) || tot, finished_at = now() where id = p_run;
  if r.integration_id is not null then
    update uniattend.integrations set last_run_at = now(), last_status = v_status, last_success_at = now(),
           last_summary = tot, updated_at = now(), sync_requested_at = null,
           next_run_at = case schedule when 'hourly' then now() + interval '1 hour' when 'daily' then now() + interval '24 hours' else next_run_at end
     where id = r.integration_id;
    insert into uniattend.integration_checkpoints (integration_id, institution_id, dataset, checkpoint)
    select r.integration_id, r.institution_id, k, left(v #>> '{}', 500) from jsonb_each(r.checkpoints) e(k, v)
    on conflict (integration_id, dataset) do update set checkpoint = excluded.checkpoint, updated_at = now();
  end if;
  perform uniattend.write_audit(r.institution_id, 'data_sync', 'integration_runs', p_run::text,
    tot || jsonb_build_object('status', v_status, 'trigger', r.trigger, 'source', r.source));
  return jsonb_build_object('preview', false, 'status', v_status, 'datasets', res) || tot;
end $$;

create or replace function uniattend._sync_stage(p_run uuid, p_dataset text, p_rows jsonb, p_first_row int)
returns int language plpgsql security definer set search_path = '' as $$
declare r uniattend.integration_runs; n int; base int;
begin
  select * into r from uniattend.integration_runs where id = p_run;
  if r.status not in ('staging','running') then raise exception 'This import has already finished (%).', r.status using errcode = 'P0001'; end if;
  if p_dataset not in ('faculties','departments','programmes','academic_periods','venues','modules','lecturers','students','enrolments','assignments') then
    raise exception 'unknown dataset %', p_dataset using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then raise exception 'rows must be a list' using errcode = 'P0001'; end if;
  n := jsonb_array_length(p_rows);
  if n > 20000 then raise exception 'Send at most 20,000 rows at a time.' using errcode = 'P0001'; end if;
  if n + (select count(*) from uniattend.integration_staging where run_id = p_run) > 200000 then
    raise exception 'An import can hold at most 200,000 rows.' using errcode = 'P0001';
  end if;
  if n > 50 and p_dataset in ('students','enrolments') and not uniattend.can_bulk_import(r.institution_id) then
    raise exception 'Loading more than 50 students at once needs the Professional plan.' using errcode = 'P0001';
  end if;
  base := coalesce(p_first_row, (select coalesce(max(row_no), 0) from uniattend.integration_staging where run_id = p_run and dataset = p_dataset) + 1);
  insert into uniattend.integration_staging (run_id, institution_id, dataset, row_no, payload)
  select p_run, r.institution_id, p_dataset, base + (o - 1)::int, case when jsonb_typeof(x) = 'object' then x else '{}'::jsonb end
    from jsonb_array_elements(p_rows) with ordinality t(x, o);
  return n;
end $$;

-- ------------------------------------------------------------ administrators: imports

create or replace function uniattend.import_start(p_inst uuid, p_source text, p_label text, p_complete boolean default false)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not uniattend.is_inst_admin(p_inst) then raise exception 'institution admin only' using errcode = '42501'; end if;
  -- Imports nobody finished are cleared after two days.
  update uniattend.integration_runs set status = 'cancelled', finished_at = now(), error = 'Not confirmed within two days.'
   where institution_id = p_inst and status = 'staging' and started_at < now() - interval '2 days';
  delete from uniattend.integration_staging st using uniattend.integration_runs r
   where st.run_id = r.id and r.institution_id = p_inst and r.status = 'cancelled';
  if (select count(*) from uniattend.integration_runs where institution_id = p_inst and status = 'staging') >= 5 then
    raise exception 'You have 5 imports waiting to be confirmed. Confirm or cancel one first.' using errcode = 'P0001';
  end if;
  insert into uniattend.integration_runs (institution_id, trigger, status, source, label, complete, created_by)
  values (p_inst, 'upload', 'staging', left(coalesce(nullif(trim(p_source), ''), 'upload'), 80), left(trim(coalesce(p_label, '')), 200), coalesce(p_complete, false), auth.uid())
  returning id into v_id;
  return v_id;
end $$;

create or replace function uniattend.import_add(p_run uuid, p_dataset text, p_rows jsonb)
returns int language plpgsql security definer set search_path = '' as $$
declare v_inst uuid;
begin
  select institution_id into v_inst from uniattend.integration_runs where id = p_run and trigger = 'upload';
  if v_inst is null or not uniattend.is_inst_admin(v_inst) then raise exception 'institution admin only' using errcode = '42501'; end if;
  return uniattend._sync_stage(p_run, p_dataset, p_rows, null);
end $$;

create or replace function uniattend.import_preview(p_run uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_inst uuid;
begin
  select institution_id into v_inst from uniattend.integration_runs where id = p_run;
  if v_inst is null or not uniattend.is_inst_admin(v_inst) then raise exception 'institution admin only' using errcode = '42501'; end if;
  return uniattend._sync_process(p_run, false);
end $$;

create or replace function uniattend.import_commit(p_run uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_inst uuid;
begin
  select institution_id into v_inst from uniattend.integration_runs where id = p_run;
  if v_inst is null or not uniattend.is_inst_admin(v_inst) then raise exception 'institution admin only' using errcode = '42501'; end if;
  return uniattend._sync_process(p_run, true);
end $$;

create or replace function uniattend.import_cancel(p_run uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_inst uuid;
begin
  select institution_id into v_inst from uniattend.integration_runs where id = p_run and status = 'staging';
  if v_inst is null or not uniattend.is_inst_admin(v_inst) then raise exception 'institution admin only' using errcode = '42501'; end if;
  delete from uniattend.integration_staging where run_id = p_run;
  update uniattend.integration_runs set status = 'cancelled', finished_at = now() where id = p_run;
end $$;

-- ------------------------------------------------------------ the server worker (dispatch secret)

-- Starts a run for a connection outside the roster path (configurable connectors), with its last checkpoints.
create or replace function uniattend.sync_begin(p_secret text, p_integration uuid, p_mode text, p_trigger text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare it uniattend.integrations; v_run uuid;
begin
  if not uniattend.push_secret_ok(p_secret) then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into it from uniattend.integrations where id = p_integration and status = 'active';
  if it.id is null then raise exception 'unknown or paused connection'; end if;
  insert into uniattend.integration_runs (integration_id, institution_id, trigger, status, source, mode)
  values (it.id, it.institution_id, coalesce(p_trigger, 'schedule'), 'running', 'conn:' || it.id, coalesce(p_mode, 'full'))
  returning id into v_run;
  return jsonb_build_object('run_id', v_run, 'checkpoints',
    (select coalesce(jsonb_object_agg(dataset, checkpoint), '{}'::jsonb) from uniattend.integration_checkpoints where integration_id = it.id));
end $$;

create or replace function uniattend.sync_stage(p_secret text, p_run uuid, p_dataset text, p_rows jsonb)
returns int language plpgsql security definer set search_path = '' as $$
begin
  if not uniattend.push_secret_ok(p_secret) then raise exception 'not allowed' using errcode = '42501'; end if;
  if not exists (select 1 from uniattend.integration_runs where id = p_run and integration_id is not null) then raise exception 'unknown run'; end if;
  return uniattend._sync_stage(p_run, p_dataset, p_rows, null);
end $$;

-- Commit what was staged. p_checkpoints: {dataset: checkpoint} saved only if the commit succeeds.
create or replace function uniattend.sync_commit(p_secret text, p_run uuid, p_complete boolean, p_checkpoints jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not uniattend.push_secret_ok(p_secret) then raise exception 'not allowed' using errcode = '42501'; end if;
  update uniattend.integration_runs set complete = coalesce(p_complete, false),
         checkpoints = case when jsonb_typeof(p_checkpoints) = 'object' then p_checkpoints else '{}'::jsonb end
   where id = p_run and integration_id is not null and status = 'running';
  if not found then raise exception 'unknown run'; end if;
  return uniattend._sync_process(p_run, true);
end $$;

create or replace function uniattend.sync_fail(p_secret text, p_run uuid, p_error text)
returns void language plpgsql security definer set search_path = '' as $$
declare r uniattend.integration_runs;
begin
  if not uniattend.push_secret_ok(p_secret) then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into r from uniattend.integration_runs where id = p_run and status in ('running','staging');
  if r.id is null then return; end if;
  delete from uniattend.integration_staging where run_id = p_run;
  update uniattend.integration_runs set status = 'failed', error = left(p_error, 500), finished_at = now() where id = p_run;
  update uniattend.integrations set last_run_at = now(), last_status = 'failed', updated_at = now(),
         last_summary = jsonb_build_object('error', left(p_error, 300)), next_run_at = now() + interval '1 hour'
   where id = r.integration_id;
end $$;

-- A real test, made by the server, sets the connection status. Nobody can set "connected" by hand.
create or replace function uniattend.integration_test_result(p_secret text, p_id uuid, p_status text, p_message text)
returns void language plpgsql security definer set search_path = '' as $$
declare it uniattend.integrations;
begin
  if not uniattend.push_secret_ok(p_secret) then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_status not in ('connected','auth_failed','connection_failed','permission_denied','unavailable','incomplete') then raise exception 'bad status'; end if;
  update uniattend.integrations set connection_status = case when status = 'paused' then 'suspended' else p_status end,
         last_tested_at = now(), last_test_message = left(p_message, 300), updated_at = now()
   where id = p_id returning * into it;
  if it.id is not null then
    perform uniattend.write_audit(it.institution_id, 'integration_tested', 'integrations', p_id::text, jsonb_build_object('status', p_status));
  end if;
end $$;

-- Retry a failed or cancelled connection run (queues the connection to run again now).
create or replace function uniattend.retry_run(p_run uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare r uniattend.integration_runs;
begin
  select * into r from uniattend.integration_runs where id = p_run;
  if r.id is null or not uniattend.is_inst_admin(r.institution_id) then raise exception 'institution admin only' using errcode = '42501'; end if;
  if r.integration_id is null then raise exception 'Upload the file again to retry an upload.' using errcode = 'P0001'; end if;
  if r.status not in ('failed','cancelled','warnings') then raise exception 'Only a failed run can be retried.' using errcode = 'P0001'; end if;
  update uniattend.integrations set sync_requested_at = now(), status = 'active' where id = r.integration_id and kind <> 'api';
  if not found then raise exception 'This connection is updated by your own system; send the roster again.' using errcode = 'P0001'; end if;
  perform uniattend.write_audit(r.institution_id, 'integration_retry', 'integration_runs', p_run::text, '{}'::jsonb);
end $$;

-- The roster path (0024) now also writes connection status and success time.
create or replace function uniattend._integration_mark_success()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.last_status in ('ok','warnings') and new.last_run_at is distinct from old.last_run_at then
    new.last_success_at := coalesce(new.last_run_at, now());
  end if;
  if new.status = 'paused' then new.connection_status := 'suspended';
  elsif old.status = 'paused' and new.status = 'active' and new.connection_status = 'suspended' then new.connection_status := 'not_configured';
  end if;
  return new;
end $$;
drop trigger if exists integrations_success on uniattend.integrations;
create trigger integrations_success before update on uniattend.integrations
  for each row execute function uniattend._integration_mark_success();

revoke all on function uniattend.sync_status(text, text) from public, anon;
revoke all on function uniattend._sync_match_ext(uuid, text, text) from public, anon, authenticated;
revoke all on function uniattend._sync_dupes() from public, anon, authenticated;
revoke all on function uniattend._sync_finish(uuid, text, text, boolean) from public, anon, authenticated;
revoke all on function uniattend._sync_apply(uuid) from public, anon, authenticated;
revoke all on function uniattend._sync_totals(jsonb) from public, anon, authenticated;
revoke all on function uniattend._sync_process(uuid, boolean) from public, anon, authenticated;
revoke all on function uniattend._sync_stage(uuid, text, jsonb, int) from public, anon, authenticated;
revoke all on function uniattend._integration_mark_success() from public, anon, authenticated;
revoke all on function uniattend.import_start(uuid, text, text, boolean) from public, anon;
revoke all on function uniattend.import_add(uuid, text, jsonb) from public, anon;
revoke all on function uniattend.import_preview(uuid) from public, anon;
revoke all on function uniattend.import_commit(uuid) from public, anon;
revoke all on function uniattend.import_cancel(uuid) from public, anon;
revoke all on function uniattend.retry_run(uuid) from public, anon;
grant execute on function uniattend.import_start(uuid, text, text, boolean) to authenticated;
grant execute on function uniattend.import_add(uuid, text, jsonb) to authenticated;
grant execute on function uniattend.import_preview(uuid) to authenticated;
grant execute on function uniattend.import_commit(uuid) to authenticated;
grant execute on function uniattend.import_cancel(uuid) to authenticated;
grant execute on function uniattend.retry_run(uuid) to authenticated;
-- Checked by the dispatch secret, so callable from the server without a session:
revoke all on function uniattend.sync_begin(text, uuid, text, text) from public;
revoke all on function uniattend.sync_stage(text, uuid, text, jsonb) from public;
revoke all on function uniattend.sync_commit(text, uuid, boolean, jsonb) from public;
revoke all on function uniattend.sync_fail(text, uuid, text) from public;
revoke all on function uniattend.integration_test_result(text, uuid, text, text) from public;
grant execute on function uniattend.sync_begin(text, uuid, text, text) to anon, authenticated;
grant execute on function uniattend.sync_stage(text, uuid, text, jsonb) to anon, authenticated;
grant execute on function uniattend.sync_commit(text, uuid, boolean, jsonb) to anon, authenticated;
grant execute on function uniattend.sync_fail(text, uuid, text) to anon, authenticated;
grant execute on function uniattend.integration_test_result(text, uuid, text, text) to anon, authenticated;

-- The stored (encrypted) credential, for a test the server makes on an administrator's behalf.
-- The server first confirms, as that administrator, that the connection is theirs.
create or replace function uniattend.integration_secret(p_secret text, p_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
begin
  if not uniattend.push_secret_ok(p_secret) then raise exception 'not allowed' using errcode = '42501'; end if;
  return (select token from uniattend.integration_secrets where integration_id = p_id);
end $$;
revoke all on function uniattend.integration_secret(text, uuid) from public;
grant execute on function uniattend.integration_secret(text, uuid) to anon, authenticated;
