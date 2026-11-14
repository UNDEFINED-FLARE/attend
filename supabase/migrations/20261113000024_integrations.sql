-- UniAttend 0024 — collecting students, lecturers, modules and enrolments automatically.
--
-- An institution connects its own systems once, and UniAttend keeps its register
-- in step with them:
--   moodle — reads courses and the people enrolled in them from the institution's
--            Moodle through its web-service API (a read-only token);
--   feed   — reads a roster file (CSV or JSON) from an https link the student
--            system publishes, on a schedule;
--   api    — the institution's system pushes the roster to UniAttend with an API key.
-- Plus import_roster(): the same roster uploaded by hand by an administrator.
--
-- Rules, enforced here rather than in the app:
-- * A connection belongs to one institution; only its admins see or change it.
-- * Tokens and keys are write-only: stored in integration_secrets, which nobody can
--   read (no policy). The token is handed only to the server worker that holds the
--   dispatch secret; API keys are stored as a SHA-256 hash and shown once.
-- * A sync adds and updates; it never deletes a student, lecturer or attendance
--   record. With "drop_missing" on, it marks as dropped only enrolments that the
--   same connection created, only after a complete run, and never more than half
--   of them at once (a broken or empty feed can't empty the register).
-- * People still get access only by signing up with their own confirmed email
--   (0021): a sync creates register entries, not accounts.
-- * Trials may import in bulk, so an institution can evaluate with real class lists.

alter table uniattend.module_enrolments add column if not exists source uuid;
alter table uniattend.lecturer_assignments add column if not exists source uuid;

create table if not exists uniattend.integrations (
  id                uuid primary key default gen_random_uuid(),
  institution_id    uuid not null references uniattend.institutions(id) on delete cascade,
  kind              text not null check (kind in ('moodle','feed','api')),
  name              text not null check (length(trim(name)) between 2 and 80),
  base_url          text check (base_url is null or (base_url ~ '^https://[^\s"''<>]+$' and length(base_url) between 12 and 500)),
  options           jsonb not null default '{}'::jsonb check (jsonb_typeof(options) = 'object' and pg_column_size(options) < 4096),
  schedule          text not null default 'daily' check (schedule in ('manual','hourly','daily')),
  status            text not null default 'active' check (status in ('active','paused')),
  key_hint          text,
  sync_requested_at timestamptz,
  claimed_at        timestamptz,
  run_id            uuid,
  step_no           int not null default 0,
  last_run_at       timestamptz,
  last_status       text,
  last_summary      jsonb,
  next_run_at       timestamptz not null default now(),
  created_by        uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check ((kind = 'api') = (base_url is null))
);
create index if not exists integrations_institution on uniattend.integrations(institution_id);
create index if not exists integrations_due on uniattend.integrations(next_run_at) where status = 'active';

create table if not exists uniattend.integration_secrets (
  integration_id uuid primary key references uniattend.integrations(id) on delete cascade,
  token          text,                                   -- moodle / feed: sent to the institution's own system
  key_sha256     text check (key_sha256 ~ '^[0-9a-f]{64}$')  -- api: hash of the key the institution's system sends us
);
create unique index if not exists integration_secrets_key on uniattend.integration_secrets(key_sha256) where key_sha256 is not null;

create table if not exists uniattend.integration_runs (
  id              uuid primary key default gen_random_uuid(),
  integration_id  uuid references uniattend.integrations(id) on delete cascade,
  institution_id  uuid not null references uniattend.institutions(id) on delete cascade,
  trigger         text not null default 'schedule' check (trigger in ('schedule','manual','api','upload')),
  status          text not null default 'running' check (status in ('running','ok','failed')),
  summary         jsonb not null default '{}'::jsonb,
  unknown_modules jsonb not null default '[]'::jsonb,
  errors          jsonb not null default '[]'::jsonb,
  error           text,
  started_at      timestamptz not null default now(),
  finished_at     timestamptz
);
create index if not exists integration_runs_recent on uniattend.integration_runs(institution_id, started_at desc);

create table if not exists uniattend.integration_seen (
  run_id uuid not null references uniattend.integration_runs(id) on delete cascade,
  module_id uuid not null, student_id uuid not null,
  primary key (run_id, module_id, student_id)
);
create table if not exists uniattend.integration_seen_modules (
  run_id uuid not null references uniattend.integration_runs(id) on delete cascade,
  module_id uuid not null,
  primary key (run_id, module_id)
);

alter table uniattend.integrations enable row level security;
alter table uniattend.integration_secrets enable row level security;       -- no policy: nobody reads it
alter table uniattend.integration_runs enable row level security;
alter table uniattend.integration_seen enable row level security;          -- no policy
alter table uniattend.integration_seen_modules enable row level security;  -- no policy
drop policy if exists integrations_select on uniattend.integrations;
create policy integrations_select on uniattend.integrations for select to authenticated
  using (uniattend.is_super_admin() or uniattend.is_inst_admin(institution_id));
drop policy if exists integration_runs_select on uniattend.integration_runs;
create policy integration_runs_select on uniattend.integration_runs for select to authenticated
  using (uniattend.is_super_admin() or uniattend.is_inst_admin(institution_id));
revoke insert, update, delete on uniattend.integrations, uniattend.integration_runs from anon, authenticated;
revoke all on uniattend.integration_secrets, uniattend.integration_seen, uniattend.integration_seen_modules from anon, authenticated;

-- Bulk loading: plans with the feature, and any institution still on its trial.
create or replace function uniattend.can_bulk_import(p_inst uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select uniattend.plan_feature(p_inst, 'bulk_import')
      or exists (select 1 from uniattend.live_plan(p_inst) lp where lp.sub_status = 'trialing' and lp.period_end > now());
$$;

-- import_students as in 0006, with the bulk rule above (trials included).
create or replace function uniattend.import_students(p_inst uuid, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  pattern text; n_rows int; ins int := 0; upd int := 0; enr int := 0; errors jsonb;
begin
  if not uniattend.is_inst_admin(p_inst) then raise exception 'institution admin only' using errcode = '42501'; end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'rows must be an array'; end if;
  n_rows := jsonb_array_length(p_rows);
  if n_rows > 10000 then raise exception 'import at most 10,000 rows at a time'; end if;
  if n_rows > 50 and not uniattend.can_bulk_import(p_inst) then
    raise exception 'bulk import of more than 50 students needs the Professional plan' using errcode = 'P0001';
  end if;
  select student_number_pattern into pattern from uniattend.institutions where id = p_inst;

  drop table if exists pg_temp._imp;
  create temp table _imp on commit drop as
  select n::int as row_no,
         upper(trim(r->>'student_number')) as sn,
         left(trim(r->>'full_name'), 200) as full_name,
         nullif(lower(trim(r->>'email')), '') as email,
         nullif(upper(trim(r->>'module_code')), '') as module_code,
         null::text as error
  from jsonb_array_elements(p_rows) with ordinality t(r, n);

  update pg_temp._imp set error = case
    when sn is null or sn = '' then 'student number is missing'
    when pattern is not null and sn !~ pattern then 'student number does not match the institution format'
    when full_name is null or full_name = '' then 'name is missing'
    when email is not null and email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then 'email is not valid'
    when module_code is not null and not exists (select 1 from uniattend.modules m
         where m.institution_id = p_inst and upper(m.code) = pg_temp._imp.module_code and m.deleted_at is null)
      then 'unknown module code ' || module_code
  end
  -- Every row starts with error null, so this matches all of them. The clause
  -- is required: Supabase's pg_safeupdate rejects UPDATE without WHERE.
  where error is null;
  -- a student number repeated with different names in one file is an error, not a merge
  update pg_temp._imp i set error = 'student number appears more than once with different details'
  where error is null and exists (select 1 from pg_temp._imp j where j.sn = i.sn and j.row_no <> i.row_no
                                  and (j.full_name is distinct from i.full_name or j.email is distinct from i.email));

  with up as (
    insert into uniattend.students as s (institution_id, student_number, full_name, email)
    select distinct on (sn) p_inst, sn, full_name, email from pg_temp._imp where error is null order by sn, row_no
    on conflict (institution_id, student_number) do update
      set full_name = excluded.full_name, email = coalesce(excluded.email, s.email)
      where s.deleted_at is null
    returning (xmax = 0) as inserted)
  select count(*) filter (where inserted), count(*) filter (where not inserted) into ins, upd from up;

  insert into uniattend.module_enrolments (institution_id, module_id, student_id)
  select distinct p_inst, m.id, s.id
  from pg_temp._imp i
  join uniattend.students s on s.institution_id = p_inst and s.student_number = i.sn
  join uniattend.modules m on m.institution_id = p_inst and upper(m.code) = i.module_code and m.deleted_at is null
  where i.error is null and i.module_code is not null
  on conflict (module_id, student_id) do nothing;
  get diagnostics enr = row_count;

  select coalesce(jsonb_agg(jsonb_build_object('row', row_no, 'student_number', sn, 'error', error) order by row_no), '[]')
    into errors from pg_temp._imp where error is not null;
  perform uniattend.write_audit(p_inst, 'import', 'students', null,
    jsonb_build_object('rows', n_rows, 'inserted', ins, 'updated', upd, 'enrolled', enr, 'errors', jsonb_array_length(errors)));
  return jsonb_build_object('inserted', ins, 'updated', upd, 'enrolled', enr, 'errors', errors);
end $$;

-- ------------------------------------------------------------ applying a roster
-- p_payload: { "modules": [{"code","title"}],
--              "people":  [{"role":"student"|"lecturer","number","full_name","email","module_codes":[...]}] }
create or replace function uniattend.roster_apply(p_inst uuid, p_integration uuid, p_run uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  opts jsonb := '{}'::jsonb; pattern text; n_people int; v_people jsonb; v_modules jsonb;
  c_mod int := 0; c_sins int := 0; c_supd int := 0; c_enr int := 0; c_lins int := 0; c_lupd int := 0; c_asg int := 0;
  errs jsonb; unknown jsonb; n_err int; res jsonb;
begin
  if jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'The roster must be a JSON object.' using errcode = 'P0001'; end if;
  v_people := case when jsonb_typeof(p_payload->'people') = 'array' then p_payload->'people' else '[]'::jsonb end;
  v_modules := case when jsonb_typeof(p_payload->'modules') = 'array' then p_payload->'modules' else '[]'::jsonb end;
  n_people := jsonb_array_length(v_people);
  if n_people > 20000 or jsonb_array_length(v_modules) > 20000 then
    raise exception 'Send at most 20,000 people and 20,000 modules at a time.' using errcode = 'P0001';
  end if;
  if n_people > 50 and not uniattend.can_bulk_import(p_inst) then
    raise exception 'Loading more than 50 people at once needs the Professional plan.' using errcode = 'P0001';
  end if;
  if p_integration is not null then
    select options into opts from uniattend.integrations where id = p_integration and institution_id = p_inst;
    if not found then raise exception 'unknown connection'; end if;
  end if;
  select student_number_pattern into pattern from uniattend.institutions where id = p_inst;

  drop table if exists pg_temp._rm;
  create temp table _rm on commit drop as
  select distinct on (code) code, title from (
    select upper(trim(m->>'code')) as code, left(trim(coalesce(nullif(trim(m->>'title'), ''), m->>'code')), 200) as title
    from jsonb_array_elements(v_modules) m) x
  where length(code) between 2 and 40 order by code;

  if coalesce((opts->>'create_modules')::boolean, false) then
    insert into uniattend.modules (institution_id, code, title)
    select p_inst, r.code, r.title from pg_temp._rm r
    where not exists (select 1 from uniattend.modules m where m.institution_id = p_inst and upper(m.code) = r.code)
    on conflict do nothing;
    get diagnostics c_mod = row_count;
  end if;

  drop table if exists pg_temp._rp;
  create temp table _rp on commit drop as
  select n::int as row_no,
         case when lower(trim(coalesce(r->>'role', 'student'))) in ('lecturer','teacher','staff') then 'lecturer' else 'student' end as role,
         upper(trim(coalesce(r->>'number', ''))) as num,
         left(trim(coalesce(r->>'full_name', '')), 200) as full_name,
         nullif(lower(trim(coalesce(r->>'email', ''))), '') as email,
         case when jsonb_typeof(r->'module_codes') = 'array' then r->'module_codes' else '[]'::jsonb end as codes,
         null::text as error
  from jsonb_array_elements(v_people) with ordinality t(r, n);

  update pg_temp._rp set error = case
    when full_name = '' then 'name is missing'
    when email is not null and email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then 'email is not valid'
    when role = 'student' and length(num) not between 3 and 32 then 'student number is missing'
    when role = 'student' and pattern is not null and num !~ pattern then 'student number does not match the institution format'
    when role = 'lecturer' and num = '' and email is null then 'a lecturer needs a staff number or an email'
    when role = 'lecturer' and length(num) > 32 then 'staff number is too long'
  end
  where error is null;

  -- Staff with no staff number are known by the part of their email before the @.
  update pg_temp._rp set num = upper(left(split_part(email, '@', 1), 32)) where role = 'lecturer' and num = '' and error is null;

  with up as (
    insert into uniattend.students as s (institution_id, student_number, full_name, email)
    select distinct on (num) p_inst, num, full_name, email from pg_temp._rp where role = 'student' and error is null order by num, row_no
    on conflict (institution_id, student_number) do update
      set full_name = excluded.full_name, email = coalesce(excluded.email, s.email)
      where s.deleted_at is null and (s.full_name is distinct from excluded.full_name or (excluded.email is not null and s.email is distinct from excluded.email))
    returning (xmax = 0) as inserted)
  select count(*) filter (where inserted), count(*) filter (where not inserted) into c_sins, c_supd from up;

  -- Lecturers: the same person is recognised by email first, then by staff number.
  update uniattend.lecturers l set full_name = x.full_name
    from (select distinct on (email) email, full_name from pg_temp._rp
          where role = 'lecturer' and error is null and email is not null order by email, row_no) x
   where l.institution_id = p_inst and lower(l.email) = x.email and l.deleted_at is null and l.full_name is distinct from x.full_name;
  get diagnostics c_lupd = row_count;
  with up as (
    insert into uniattend.lecturers as l (institution_id, staff_number, full_name, email)
    select distinct on (num) p_inst, num, full_name, email from pg_temp._rp p
    where role = 'lecturer' and error is null
      and not exists (select 1 from uniattend.lecturers l2 where l2.institution_id = p_inst and l2.deleted_at is null
                      and p.email is not null and lower(l2.email) = p.email)
    order by num, row_no
    on conflict (institution_id, staff_number) do update
      set full_name = excluded.full_name, email = coalesce(excluded.email, l.email)
      where l.deleted_at is null and (l.full_name is distinct from excluded.full_name or (excluded.email is not null and l.email is distinct from excluded.email))
    returning (xmax = 0) as inserted)
  select c_lins + count(*) filter (where inserted), c_lupd + count(*) filter (where not inserted) into c_lins, c_lupd from up;

  drop table if exists pg_temp._re;
  create temp table _re on commit drop as
  select distinct p.role, p.num, p.email, upper(trim(c.code)) as code
  from pg_temp._rp p, jsonb_array_elements_text(p.codes) c(code)
  where p.error is null and trim(c.code) <> '';

  drop table if exists pg_temp._pairs;
  create temp table _pairs on commit drop as
  select distinct m.id as module_id, s.id as student_id
  from pg_temp._re e
  join uniattend.students s on s.institution_id = p_inst and s.student_number = e.num and s.deleted_at is null
  join uniattend.modules m on m.institution_id = p_inst and upper(m.code) = e.code and m.deleted_at is null
  where e.role = 'student';

  with ins as (
    insert into uniattend.module_enrolments as me (institution_id, module_id, student_id, source)
    select p_inst, module_id, student_id, p_integration from pg_temp._pairs
    on conflict (module_id, student_id) do update set status = 'active'
      where me.status = 'dropped' and me.source is not null and me.source = excluded.source
    returning 1)
  select count(*) into c_enr from ins;

  insert into uniattend.lecturer_assignments (institution_id, module_id, lecturer_id, source)
  select distinct p_inst, m.id, l.id, p_integration
  from pg_temp._re e
  join uniattend.lecturers l on l.institution_id = p_inst and l.deleted_at is null
       and ((e.email is not null and lower(l.email) = e.email) or l.staff_number = e.num)
  join uniattend.modules m on m.institution_id = p_inst and upper(m.code) = e.code and m.deleted_at is null
  where e.role = 'lecturer'
  on conflict (module_id, lecturer_id) do nothing;
  get diagnostics c_asg = row_count;

  select coalesce(jsonb_agg(code), '[]'::jsonb) into unknown from (
    select distinct e.code from pg_temp._re e
    where not exists (select 1 from uniattend.modules m where m.institution_id = p_inst and upper(m.code) = e.code and m.deleted_at is null)
    order by e.code limit 40) u;
  select count(*) into n_err from pg_temp._rp where error is not null;
  select coalesce(jsonb_agg(jsonb_build_object('row', row_no, 'who', coalesce(nullif(num, ''), email, full_name), 'error', error) order by row_no), '[]'::jsonb)
    into errs from (select * from pg_temp._rp where error is not null order by row_no limit 50) e;

  res := jsonb_build_object('people', n_people, 'modules_created', c_mod, 'students_added', c_sins, 'students_updated', c_supd,
    'lecturers_added', c_lins, 'lecturers_updated', c_lupd, 'enrolments_added', c_enr, 'assignments_added', c_asg, 'skipped', n_err);

  if p_run is not null then
    insert into uniattend.integration_seen (run_id, module_id, student_id)
    select p_run, module_id, student_id from pg_temp._pairs on conflict do nothing;
    insert into uniattend.integration_seen_modules (run_id, module_id)
    select p_run, m.id from pg_temp._rm r join uniattend.modules m on m.institution_id = p_inst and upper(m.code) = r.code and m.deleted_at is null
    union select p_run, module_id from pg_temp._pairs
    on conflict do nothing;
    update uniattend.integration_runs r
       set summary = (select jsonb_object_agg(k, coalesce((r.summary->>k)::bigint, 0) + (res->>k)::bigint) from jsonb_object_keys(res) k),
           unknown_modules = (select coalesce(jsonb_agg(v), '[]'::jsonb) from (select distinct v from jsonb_array_elements_text(r.unknown_modules || unknown) v order by v limit 40) u),
           errors = (select coalesce(jsonb_agg(v), '[]'::jsonb) from (select v from jsonb_array_elements(r.errors || errs) v limit 50) e)
     where r.id = p_run;
  end if;
  return res || jsonb_build_object('unknown_modules', unknown, 'errors', errs);
end $$;

-- Closes a run: optional clean-up of enrolments that are gone at the source, bookkeeping, audit.
create or replace function uniattend.integration_finish(p_run uuid, p_status text, p_error text, p_complete boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r uniattend.integration_runs; it uniattend.integrations; n_mine int := 0; n_gone int := 0; n_seen int; held boolean := false; v_summary jsonb;
begin
  select * into r from uniattend.integration_runs where id = p_run for update;
  if r.id is null or r.status <> 'running' then return null; end if;
  if r.integration_id is not null then select * into it from uniattend.integrations where id = r.integration_id; end if;

  if p_status = 'ok' and coalesce(p_complete, false) and it.id is not null and coalesce((it.options->>'drop_missing')::boolean, false) then
    select count(*) into n_seen from uniattend.integration_seen where run_id = p_run;
    select count(*) into n_mine from uniattend.module_enrolments where source = it.id and status = 'active';
    select count(*) into n_gone from uniattend.module_enrolments me
     where me.source = it.id and me.status = 'active'
       and exists (select 1 from uniattend.integration_seen_modules sm where sm.run_id = p_run and sm.module_id = me.module_id)
       and not exists (select 1 from uniattend.integration_seen s where s.run_id = p_run and s.module_id = me.module_id and s.student_id = me.student_id);
    -- A source that suddenly lists nobody, or loses most of its students, is far more often broken than right.
    if n_gone > 0 and (n_seen = 0 or (n_gone > 20 and n_gone * 2 > n_mine)) then
      held := true;
    elsif n_gone > 0 then
      update uniattend.module_enrolments me set status = 'dropped'
       where me.source = it.id and me.status = 'active'
         and exists (select 1 from uniattend.integration_seen_modules sm where sm.run_id = p_run and sm.module_id = me.module_id)
         and not exists (select 1 from uniattend.integration_seen s where s.run_id = p_run and s.module_id = me.module_id and s.student_id = me.student_id);
    end if;
  end if;

  v_summary := r.summary || jsonb_build_object('enrolments_dropped', case when held then 0 else n_gone end)
    || case when held then jsonb_build_object('held_back', n_gone) else '{}'::jsonb end;
  update uniattend.integration_runs set status = p_status, error = left(p_error, 500), summary = v_summary, finished_at = now() where id = p_run;
  delete from uniattend.integration_seen where run_id = p_run;
  delete from uniattend.integration_seen_modules where run_id = p_run;

  if it.id is not null then
    update uniattend.integrations
       set last_run_at = now(), last_status = p_status, updated_at = now(),
           last_summary = v_summary || case when p_error is null then '{}'::jsonb else jsonb_build_object('error', left(p_error, 300)) end,
           run_id = null, step_no = 0, claimed_at = null, sync_requested_at = null,
           next_run_at = case when p_status = 'failed' then now() + interval '1 hour'
                              when schedule = 'hourly' then now() + interval '1 hour' else now() + interval '24 hours' end
     where id = it.id;
    if p_status = 'failed' or held then
      insert into uniattend.notifications (institution_id, user_id, kind, title, body, link, dedupe_key)
      select r.institution_id, x.user_id, 'integration',
             case when held then it.name || ': sync needs a look' else it.name || ': sync failed' end,
             case when held then n_gone || ' enrolments are missing at the source. They were left in place; check the source, then sync again.'
                  else coalesce(left(p_error, 300), 'The sync could not finish.') || ' UniAttend will try again in an hour.' end,
             '/admin/connections', 'integ:' || it.id || ':' || to_char(now(), 'YYYYMMDD') || ':' || x.user_id
      from uniattend.user_roles x where x.institution_id = r.institution_id and x.role = 'institution_admin' and x.status = 'active'
      on conflict (dedupe_key) where dedupe_key is not null do nothing;
    end if;
  end if;
  perform uniattend.write_audit(r.institution_id, 'roster_sync', 'integrations', coalesce(r.integration_id::text, 'upload'),
    v_summary || jsonb_build_object('status', p_status, 'trigger', r.trigger));
  return v_summary;
end $$;

-- ------------------------------------------------------------ administrators

create or replace function uniattend.save_integration(p_inst uuid, p_id uuid, p_kind text, p_name text, p_base_url text,
                                                     p_token text, p_options jsonb, p_schedule text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_key text; v_token text := nullif(trim(coalesce(p_token, '')), '');
begin
  if not uniattend.is_inst_admin(p_inst) then raise exception 'institution admin only' using errcode = '42501'; end if;
  if p_kind not in ('moodle','feed','api') then raise exception 'unknown connection type'; end if;
  if p_kind <> 'api' and coalesce(p_base_url, '') !~ '^https://' then raise exception 'The address must start with https://' using errcode = 'P0001'; end if;
  if length(coalesce(v_token, '')) > 2000 then raise exception 'That token is too long.' using errcode = 'P0001'; end if;
  if p_id is null then
    if (select count(*) from uniattend.integrations where institution_id = p_inst) >= 10 then
      raise exception 'An institution can have up to 10 connections.' using errcode = 'P0001';
    end if;
    if p_kind = 'moodle' and v_token is null then raise exception 'Paste the Moodle web-service token.' using errcode = 'P0001'; end if;
    insert into uniattend.integrations (institution_id, kind, name, base_url, options, schedule, key_hint, created_by)
    values (p_inst, p_kind, trim(p_name), case when p_kind = 'api' then null else trim(p_base_url) end, coalesce(p_options, '{}'::jsonb),
            case when p_kind = 'api' then 'manual' else coalesce(p_schedule, 'daily') end,
            case when v_token is not null then right(v_token, 4) end, auth.uid())
    returning id into v_id;
    if p_kind = 'api' then
      v_key := 'ua_' || encode(extensions.gen_random_bytes(24), 'hex');
      insert into uniattend.integration_secrets (integration_id, key_sha256) values (v_id, encode(extensions.digest(v_key, 'sha256'), 'hex'));
      update uniattend.integrations set key_hint = right(v_key, 4) where id = v_id;
    else
      insert into uniattend.integration_secrets (integration_id, token) values (v_id, v_token);
    end if;
  else
    update uniattend.integrations
       set name = trim(p_name), options = coalesce(p_options, options), updated_at = now(),
           base_url = case when kind = 'api' then null else trim(p_base_url) end,
           schedule = case when kind = 'api' then 'manual' else coalesce(p_schedule, schedule) end,
           key_hint = case when kind <> 'api' and v_token is not null then right(v_token, 4) else key_hint end
     where id = p_id and institution_id = p_inst and kind = p_kind
    returning id into v_id;
    if v_id is null then raise exception 'unknown connection'; end if;
    if p_kind <> 'api' and v_token is not null then
      update uniattend.integration_secrets set token = v_token where integration_id = v_id;
    end if;
  end if;
  perform uniattend.write_audit(p_inst, case when p_id is null then 'integration_added' else 'integration_changed' end, 'integrations', v_id::text,
    jsonb_build_object('kind', p_kind, 'name', trim(p_name)));
  return jsonb_build_object('id', v_id, 'api_key', v_key);
end $$;

-- p_action: 'sync' | 'pause' | 'resume' | 'delete' | 'new_key'
create or replace function uniattend.integration_action(p_id uuid, p_action text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare it uniattend.integrations; v_key text;
begin
  select * into it from uniattend.integrations where id = p_id;
  if it.id is null or not uniattend.is_inst_admin(it.institution_id) then raise exception 'institution admin only' using errcode = '42501'; end if;
  if p_action = 'sync' then
    if it.kind = 'api' then raise exception 'This connection is updated by your own system, when it sends a roster.' using errcode = 'P0001'; end if;
    if not exists (select 1 from uniattend.institutions where id = it.institution_id and status = 'active') then
      raise exception 'Your institution must be approved before it can sync.' using errcode = 'P0001';
    end if;
    update uniattend.integrations set sync_requested_at = now(), status = 'active' where id = p_id;
  elsif p_action = 'pause' then update uniattend.integrations set status = 'paused' where id = p_id;
  elsif p_action = 'resume' then update uniattend.integrations set status = 'active' where id = p_id;
  elsif p_action = 'delete' then delete from uniattend.integrations where id = p_id;
  elsif p_action = 'new_key' and it.kind = 'api' then
    v_key := 'ua_' || encode(extensions.gen_random_bytes(24), 'hex');
    update uniattend.integration_secrets set key_sha256 = encode(extensions.digest(v_key, 'sha256'), 'hex') where integration_id = p_id;
    update uniattend.integrations set key_hint = right(v_key, 4) where id = p_id;
  else raise exception 'unknown action';
  end if;
  perform uniattend.write_audit(it.institution_id, 'integration_' || p_action, 'integrations', p_id::text, jsonb_build_object('name', it.name));
  return jsonb_build_object('api_key', v_key);
end $$;

-- A roster file uploaded by an administrator (same shape as a sync).
create or replace function uniattend.import_roster(p_inst uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_run uuid; res jsonb;
begin
  if not uniattend.is_inst_admin(p_inst) then raise exception 'institution admin only' using errcode = '42501'; end if;
  insert into uniattend.integration_runs (institution_id, trigger) values (p_inst, 'upload') returning id into v_run;
  res := uniattend.roster_apply(p_inst, null, v_run, p_payload);
  perform uniattend.integration_finish(v_run, 'ok', null, false);
  return res;
end $$;

-- ------------------------------------------------------------ the institution's system pushes (API key)

create or replace function uniattend.roster_push(p_key text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare it uniattend.integrations; v_run uuid; res jsonb; fin jsonb;
begin
  select i.* into it from uniattend.integrations i join uniattend.integration_secrets s on s.integration_id = i.id
   where i.kind = 'api' and s.key_sha256 = encode(extensions.digest(coalesce(p_key, ''), 'sha256'), 'hex');
  if it.id is null then raise exception 'That API key is not valid.' using errcode = '42501'; end if;
  if it.status <> 'active' then raise exception 'This connection is paused.' using errcode = 'P0001'; end if;
  if not exists (select 1 from uniattend.institutions where id = it.institution_id and status = 'active' and deleted_at is null) then
    raise exception 'The institution is not active.' using errcode = 'P0001';
  end if;
  if (select count(*) from uniattend.integration_runs where integration_id = it.id and started_at > now() - interval '1 hour') >= 120 then
    raise exception 'Too many requests. Send at most 120 rosters an hour.' using errcode = 'P0001';
  end if;
  insert into uniattend.integration_runs (integration_id, institution_id, trigger) values (it.id, it.institution_id, 'api') returning id into v_run;
  res := uniattend.roster_apply(it.institution_id, it.id, v_run, p_payload);
  fin := uniattend.integration_finish(v_run, 'ok', null, coalesce((p_payload->>'complete')::boolean, false));
  return res || jsonb_build_object('enrolments_dropped', coalesce((fin->>'enrolments_dropped')::int, 0), 'held_back', coalesce((fin->>'held_back')::int, 0));
end $$;

-- ------------------------------------------------------------ the server worker (dispatch secret)

-- Hands one due connection, with its token, to the worker. Only one worker at a time per connection.
create or replace function uniattend.integration_claim(p_secret text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare it uniattend.integrations; v_run uuid; v_token text;
begin
  if not uniattend.push_secret_ok(p_secret) then raise exception 'not allowed' using errcode = '42501'; end if;
  select i.* into it from uniattend.integrations i
   join uniattend.institutions n on n.id = i.institution_id and n.status = 'active' and n.deleted_at is null
   where i.kind in ('moodle','feed') and i.status = 'active'
     and (i.sync_requested_at is not null or i.run_id is not null or (i.schedule <> 'manual' and i.next_run_at <= now()))
     and (i.claimed_at is null or i.claimed_at < now() - interval '5 minutes')
   order by i.sync_requested_at nulls last, i.next_run_at
   limit 1 for update of i skip locked;
  if it.id is null then return null; end if;
  v_run := it.run_id;
  if v_run is null or not exists (select 1 from uniattend.integration_runs where id = v_run and status = 'running') then
    insert into uniattend.integration_runs (integration_id, institution_id, trigger)
    values (it.id, it.institution_id, case when it.sync_requested_at is not null then 'manual' else 'schedule' end) returning id into v_run;
    update uniattend.integrations set run_id = v_run, step_no = 0, claimed_at = now() where id = it.id;
    it.step_no := 0;
  else
    update uniattend.integrations set claimed_at = now() where id = it.id;
  end if;
  select token into v_token from uniattend.integration_secrets where integration_id = it.id;
  return jsonb_build_object('id', it.id, 'institution_id', it.institution_id, 'kind', it.kind, 'base_url', it.base_url,
                            'options', it.options, 'token', v_token, 'run_id', v_run, 'cursor', it.step_no,
                            'module_codes', (select coalesce(jsonb_agg(distinct upper(m.code)), '[]'::jsonb) from uniattend.modules m
                                             where m.institution_id = it.institution_id and m.deleted_at is null));
end $$;

create or replace function uniattend.integration_apply(p_secret text, p_run uuid, p_payload jsonb, p_cursor int)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare it uniattend.integrations;
begin
  if not uniattend.push_secret_ok(p_secret) then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into it from uniattend.integrations where run_id = p_run;
  if it.id is null then raise exception 'that sync is no longer running'; end if;
  update uniattend.integrations set step_no = coalesce(p_cursor, step_no), claimed_at = now() where id = it.id;
  return uniattend.roster_apply(it.institution_id, it.id, p_run, p_payload);
end $$;

-- p_status: 'ok' | 'failed' | 'later' (out of time: keep the place and let the next worker continue)
create or replace function uniattend.integration_done(p_secret text, p_run uuid, p_status text, p_error text, p_complete boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not uniattend.push_secret_ok(p_secret) then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_status = 'later' then
    update uniattend.integrations set claimed_at = null where run_id = p_run;
    return null;
  end if;
  if p_status not in ('ok','failed') then raise exception 'bad status'; end if;
  return uniattend.integration_finish(p_run, p_status, p_error, p_complete);
end $$;

revoke all on function uniattend.can_bulk_import(uuid) from public, anon;
revoke all on function uniattend.roster_apply(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function uniattend.integration_finish(uuid, text, text, boolean) from public, anon, authenticated;
revoke all on function uniattend.save_integration(uuid, uuid, text, text, text, text, jsonb, text) from public, anon;
revoke all on function uniattend.integration_action(uuid, text) from public, anon;
revoke all on function uniattend.import_roster(uuid, jsonb) from public, anon;
grant execute on function uniattend.can_bulk_import(uuid) to authenticated;
grant execute on function uniattend.save_integration(uuid, uuid, text, text, text, text, jsonb, text) to authenticated;
grant execute on function uniattend.integration_action(uuid, text) to authenticated;
grant execute on function uniattend.import_roster(uuid, jsonb) to authenticated;
-- Checked by key or by the dispatch secret, so callable without a session:
revoke all on function uniattend.roster_push(text, jsonb) from public;
revoke all on function uniattend.integration_claim(text) from public;
revoke all on function uniattend.integration_apply(text, uuid, jsonb, int) from public;
revoke all on function uniattend.integration_done(text, uuid, text, text, boolean) from public;
grant execute on function uniattend.roster_push(text, jsonb) to anon, authenticated;
grant execute on function uniattend.integration_claim(text) to anon, authenticated;
grant execute on function uniattend.integration_apply(text, uuid, jsonb, int) to anon, authenticated;
grant execute on function uniattend.integration_done(text, uuid, text, text, boolean) to anon, authenticated;
