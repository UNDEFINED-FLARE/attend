-- UniAttend 0032 — onboarding a university to go-live, and letting it leave.
--
-- Onboarding (the same twelve steps for every institution, no code changes):
--   1 registration, 2 verification (platform), 3 approval (platform),
--   4 administrator, 5 academic structure, 6 data connection or import,
--   7 students and lecturers, 8 timetable, 9 attendance policy (institution),
--   10 pilot, 11 training, 12 go-live approval (platform).
--   Steps the data can show (structure, people, timetable, pilot…) are worked out
--   from the institution's own records, so they cannot be ticked without being
--   true. The rest are signed off by a named person and audited. Go-live is
--   refused until every earlier step is done.
-- Exit (a university must never feel trapped):
--   * request_exit(): an institution admin asks to leave; the platform is told.
--   * revoke_integration_credentials(): every stored token and API key is
--     deleted and every connection paused, at once.
--   * The full data export (all tables, CSV in a ZIP) is a download in the app,
--     audited as 'institution_export'.
--   * close_institution(): the platform administrator closes the account. The
--     institution is archived: no sign-ins to it, no check-ins, data kept. Nothing
--     is deleted here — deleting records is a separate, deliberate step under the
--     retention schedule and the operator agreement.

create table if not exists uniattend.institution_onboarding (
  institution_id      uuid primary key references uniattend.institutions(id) on delete cascade,
  verified_at         timestamptz, verified_by uuid references auth.users(id) on delete set null, verification_note text,
  policy_confirmed_at timestamptz, policy_confirmed_by uuid references auth.users(id) on delete set null,
  training_done_at    timestamptz, training_done_by uuid references auth.users(id) on delete set null, training_note text,
  go_live_at          timestamptz, go_live_by uuid references auth.users(id) on delete set null,
  updated_at          timestamptz not null default now()
);
alter table uniattend.institution_onboarding enable row level security;
drop policy if exists institution_onboarding_select on uniattend.institution_onboarding;
create policy institution_onboarding_select on uniattend.institution_onboarding for select to authenticated
  using (uniattend.is_inst_admin(institution_id));
grant select on uniattend.institution_onboarding to authenticated;

create table if not exists uniattend.institution_exit_requests (
  id                     uuid primary key default gen_random_uuid(),
  institution_id         uuid not null references uniattend.institutions(id) on delete cascade,
  requested_by           uuid references auth.users(id) on delete set null,
  reason                 text not null check (length(trim(reason)) between 5 and 2000),
  status                 text not null default 'requested' check (status in ('requested', 'closed', 'withdrawn')),
  credentials_revoked_at timestamptz,
  closed_at              timestamptz, closed_by uuid references auth.users(id) on delete set null, closing_note text,
  created_at             timestamptz not null default now()
);
create unique index if not exists institution_exit_open on uniattend.institution_exit_requests(institution_id) where status = 'requested';
alter table uniattend.institution_exit_requests enable row level security;
drop policy if exists institution_exit_select on uniattend.institution_exit_requests;
create policy institution_exit_select on uniattend.institution_exit_requests for select to authenticated
  using (uniattend.is_inst_admin(institution_id));
grant select on uniattend.institution_exit_requests to authenticated;

-- ---------------------------------------------------------------- onboarding
create or replace function uniattend.onboarding_status(p_inst uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare i uniattend.institutions; o uniattend.institution_onboarding; c jsonb; steps jsonb; v_ready boolean;
begin
  if not uniattend.is_inst_admin(p_inst) then raise exception 'Not allowed.' using errcode = '42501'; end if;
  select * into i from uniattend.institutions where id = p_inst;
  select * into o from uniattend.institution_onboarding where institution_id = p_inst;
  select jsonb_build_object(
    'admins', (select count(*) from uniattend.user_roles where institution_id = p_inst and role = 'institution_admin' and status = 'active'),
    'faculties', (select count(*) from uniattend.faculties where institution_id = p_inst and deleted_at is null),
    'departments', (select count(*) from uniattend.departments where institution_id = p_inst and deleted_at is null),
    'modules', (select count(*) from uniattend.modules where institution_id = p_inst and deleted_at is null),
    'venues', (select count(*) from uniattend.venues where institution_id = p_inst and deleted_at is null and (polygon is not null or lat is not null)),
    'integrations', (select count(*) from uniattend.integrations where institution_id = p_inst),
    'imports', (select count(*) from uniattend.integration_runs where institution_id = p_inst and status in ('ok', 'warnings')),
    'students', (select count(*) from uniattend.students where institution_id = p_inst and deleted_at is null),
    'lecturers', (select count(*) from uniattend.lecturers where institution_id = p_inst and deleted_at is null),
    'enrolments', (select count(*) from uniattend.module_enrolments where institution_id = p_inst and status = 'active'),
    'assignments', (select count(*) from uniattend.lecturer_assignments where institution_id = p_inst),
    'slots', (select count(*) from uniattend.timetables where institution_id = p_inst),
    'classes', (select count(*) from uniattend.timetable_events where institution_id = p_inst),
    'closed_sessions', (select count(*) from uniattend.class_sessions where institution_id = p_inst and status = 'closed'),
    'checkins', (select count(*) from uniattend.attendance_records where institution_id = p_inst and method in ('qr', 'code', 'offline'))
  ) into c;

  steps := jsonb_build_array(
    jsonb_build_object('key', 'registered', 'title', 'Registration', 'by', 'institution', 'done', true,
      'detail', 'Registered ' || to_char(i.created_at, 'DD Mon YYYY') || '.'),
    jsonb_build_object('key', 'verified', 'title', 'Verification', 'by', 'platform', 'done', o.verified_at is not null,
      'detail', coalesce('Verified ' || to_char(o.verified_at, 'DD Mon YYYY') || coalesce(': ' || o.verification_note, '.'),
                         'UniAttend confirms the institution and the person who registered it.')),
    jsonb_build_object('key', 'approved', 'title', 'Approval', 'by', 'platform', 'done', i.status = 'active',
      'detail', case when i.status = 'active' then 'Approved.' else 'UniAttend approves the institution (status: ' || i.status || ').' end),
    jsonb_build_object('key', 'admin', 'title', 'Administrator accounts', 'by', 'auto', 'done', (c->>'admins')::int >= 1,
      'detail', (c->>'admins') || ' administrator(s). A second one is recommended.', 'link', '/admin/people'),
    jsonb_build_object('key', 'structure', 'title', 'Academic structure', 'by', 'auto',
      'done', (c->>'faculties')::int > 0 and (c->>'departments')::int > 0 and (c->>'modules')::int > 0 and (c->>'venues')::int > 0,
      'detail', format('%s faculties, %s departments, %s modules, %s mapped venues.', c->>'faculties', c->>'departments', c->>'modules', c->>'venues'),
      'link', '/admin/structure'),
    jsonb_build_object('key', 'integration', 'title', 'Data connection or import', 'by', 'auto',
      'done', (c->>'integrations')::int > 0 or (c->>'imports')::int > 0,
      'detail', format('%s connection(s), %s completed import(s).', c->>'integrations', c->>'imports'), 'link', '/admin/integrations'),
    jsonb_build_object('key', 'people', 'title', 'Students and lecturers', 'by', 'auto',
      'done', (c->>'students')::int > 0 and (c->>'lecturers')::int > 0 and (c->>'enrolments')::int > 0 and (c->>'assignments')::int > 0,
      'detail', format('%s students, %s lecturers, %s enrolments, %s lecturer assignments.', c->>'students', c->>'lecturers', c->>'enrolments', c->>'assignments'),
      'link', '/admin/people'),
    jsonb_build_object('key', 'timetable', 'title', 'Timetable', 'by', 'auto', 'done', (c->>'slots')::int > 0 and (c->>'classes')::int > 0,
      'detail', format('%s weekly slots, %s dated classes.', c->>'slots', c->>'classes'), 'link', '/admin/timetable'),
    jsonb_build_object('key', 'policy', 'title', 'Attendance policy', 'by', 'institution', 'done', o.policy_confirmed_at is not null,
      'detail', coalesce('Confirmed ' || to_char(o.policy_confirmed_at, 'DD Mon YYYY') || '.',
                         'Review the required attendance, late grace period, location checks and retention, then confirm.'),
      'link', '/admin/settings'),
    jsonb_build_object('key', 'pilot', 'title', 'Pilot', 'by', 'auto', 'done', (c->>'closed_sessions')::int > 0 and (c->>'checkins')::int > 0,
      'detail', format('%s closed classes, %s student check-ins.', c->>'closed_sessions', c->>'checkins')),
    jsonb_build_object('key', 'training', 'title', 'Training', 'by', 'institution', 'done', o.training_done_at is not null,
      'detail', coalesce('Done ' || to_char(o.training_done_at, 'DD Mon YYYY') || coalesce(': ' || o.training_note, '.'),
                         'Administrators, lecturers and students have been shown how to use UniAttend.')),
    jsonb_build_object('key', 'go_live', 'title', 'Go-live approval', 'by', 'platform', 'done', o.go_live_at is not null,
      'detail', coalesce('Live since ' || to_char(o.go_live_at, 'DD Mon YYYY') || '.', 'UniAttend approves go-live once every step above is done.')));
  select bool_and((s->>'done')::boolean) into v_ready from jsonb_array_elements(steps) s where s->>'key' <> 'go_live';
  return jsonb_build_object('steps', steps, 'ready_for_go_live', v_ready, 'live', o.go_live_at is not null);
end $$;

-- Sign a step off (or undo it). Verification and go-live are the platform's; policy
-- and training are the institution's (the platform may record them too).
create or replace function uniattend.onboarding_sign_off(p_inst uuid, p_step text, p_note text default null, p_undo boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare v_missing text; v_note text := nullif(left(trim(coalesce(p_note, '')), 500), '');
begin
  if p_step in ('verified', 'go_live') then
    if not uniattend.is_super_admin() then raise exception 'Only UniAttend can sign this step off.' using errcode = '42501'; end if;
  elsif p_step in ('policy', 'training') then
    if not uniattend.is_inst_admin(p_inst) then raise exception 'Not allowed.' using errcode = '42501'; end if;
  else
    raise exception 'That step is worked out from your data, not signed off.' using errcode = '22023';
  end if;
  if not exists (select 1 from uniattend.institutions where id = p_inst) then raise exception 'No such institution.' using errcode = '22023'; end if;
  if p_step = 'go_live' and not p_undo then
    -- is_super_admin passes is_inst_admin, so the status can be read here.
    select string_agg(s->>'title', ', ') into v_missing
      from jsonb_array_elements(uniattend.onboarding_status(p_inst)->'steps') s
     where s->>'key' <> 'go_live' and not (s->>'done')::boolean;
    if v_missing is not null then raise exception 'Not ready to go live. Still to do: %.', v_missing using errcode = '22023'; end if;
  end if;
  insert into uniattend.institution_onboarding (institution_id) values (p_inst) on conflict (institution_id) do nothing;
  update uniattend.institution_onboarding set
    verified_at = case when p_step = 'verified' then case when p_undo then null else now() end else verified_at end,
    verified_by = case when p_step = 'verified' then case when p_undo then null else auth.uid() end else verified_by end,
    verification_note = case when p_step = 'verified' then case when p_undo then null else v_note end else verification_note end,
    policy_confirmed_at = case when p_step = 'policy' then case when p_undo then null else now() end else policy_confirmed_at end,
    policy_confirmed_by = case when p_step = 'policy' then case when p_undo then null else auth.uid() end else policy_confirmed_by end,
    training_done_at = case when p_step = 'training' then case when p_undo then null else now() end else training_done_at end,
    training_done_by = case when p_step = 'training' then case when p_undo then null else auth.uid() end else training_done_by end,
    training_note = case when p_step = 'training' then case when p_undo then null else v_note end else training_note end,
    go_live_at = case when p_step = 'go_live' then case when p_undo then null else now() end else go_live_at end,
    go_live_by = case when p_step = 'go_live' then case when p_undo then null else auth.uid() end else go_live_by end,
    updated_at = now()
  where institution_id = p_inst;
  perform uniattend.write_audit(p_inst, case when p_undo then 'onboarding_undo' else 'onboarding_sign_off' end,
                                'institution_onboarding', p_inst::text, jsonb_build_object('step', p_step, 'note', v_note));
end $$;

-- The platform's list: every institution and how far it is.
create or replace function uniattend.onboarding_overview()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not uniattend.is_super_admin() then raise exception 'Not allowed.' using errcode = '42501'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name, 'status', i.status,
            'done', (select count(*) from jsonb_array_elements(st->'steps') s where (s->>'done')::boolean),
            'total', jsonb_array_length(st->'steps'), 'live', (st->>'live')::boolean,
            'exit_requested', exists (select 1 from uniattend.institution_exit_requests x where x.institution_id = i.id and x.status = 'requested'))
          order by i.name), '[]'::jsonb)
          from uniattend.institutions i, lateral (select uniattend.onboarding_status(i.id) st) z
          where i.deleted_at is null);
end $$;

-- ---------------------------------------------------------------- exit
create or replace function uniattend.revoke_integration_credentials(p_inst uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if not uniattend.is_inst_admin(p_inst) then raise exception 'Not allowed.' using errcode = '42501'; end if;
  delete from uniattend.integration_secrets s using uniattend.integrations g
   where g.id = s.integration_id and g.institution_id = p_inst;
  get diagnostics n = row_count;
  update uniattend.integrations set status = 'paused', key_hint = null, updated_at = now() where institution_id = p_inst;
  update uniattend.institution_exit_requests set credentials_revoked_at = now()
   where institution_id = p_inst and status = 'requested';
  perform uniattend.write_audit(p_inst, 'revoke_credentials', 'integrations', null, jsonb_build_object('credentials_deleted', n));
  return n;
end $$;

create or replace function uniattend.request_exit(p_inst uuid, p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_name text;
begin
  if not uniattend.is_inst_admin(p_inst) or uniattend.is_super_admin() and not uniattend.has_role(p_inst, array['institution_admin']) then
    raise exception 'Only the institution''s own administrators can ask to leave.' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 5 then raise exception 'Say briefly why you are leaving.' using errcode = '22023'; end if;
  if exists (select 1 from uniattend.institution_exit_requests where institution_id = p_inst and status = 'requested') then
    raise exception 'Your institution has already asked to leave.' using errcode = '22023';
  end if;
  insert into uniattend.institution_exit_requests (institution_id, requested_by, reason)
  values (p_inst, auth.uid(), left(trim(p_reason), 2000)) returning id into v_id;
  select name into v_name from uniattend.institutions where id = p_inst;
  insert into uniattend.notifications (institution_id, user_id, kind, title, body, link)
  select null, r.user_id, 'exit_requested', v_name || ' asked to leave UniAttend', left(trim(p_reason), 300), '/super'
  from uniattend.user_roles r where r.role = 'super_admin' and r.status = 'active';
  perform uniattend.write_audit(p_inst, 'exit_requested', 'institution_exit_requests', v_id::text, jsonb_build_object('reason', left(trim(p_reason), 300)));
  return v_id;
end $$;

create or replace function uniattend.withdraw_exit(p_inst uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not uniattend.is_inst_admin(p_inst) then raise exception 'Not allowed.' using errcode = '42501'; end if;
  update uniattend.institution_exit_requests set status = 'withdrawn' where institution_id = p_inst and status = 'requested';
  if not found then raise exception 'There is no request to withdraw.' using errcode = '22023'; end if;
  perform uniattend.write_audit(p_inst, 'exit_withdrawn', 'institution_exit_requests', null, '{}'::jsonb);
end $$;

create or replace function uniattend.close_institution(p_inst uuid, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_req uuid;
begin
  if not uniattend.is_super_admin() then raise exception 'Only UniAttend can close an institution.' using errcode = '42501'; end if;
  if length(trim(coalesce(p_note, ''))) < 5 then raise exception 'Record how the closure was agreed (at least a few words).' using errcode = '22023'; end if;
  select id into v_req from uniattend.institution_exit_requests where institution_id = p_inst and status = 'requested';
  if v_req is null then raise exception 'The institution has not asked to leave.' using errcode = '22023'; end if;
  perform uniattend.revoke_integration_credentials(p_inst);
  update uniattend.institution_exit_requests set status = 'closed', closed_at = now(), closed_by = auth.uid(),
         closing_note = left(trim(p_note), 2000) where id = v_req;
  perform uniattend.set_institution_status(p_inst, 'archived');
  perform uniattend.write_audit(p_inst, 'institution_closed', 'institutions', p_inst::text, jsonb_build_object('note', left(trim(p_note), 300)));
end $$;

-- What a platform administrator needs to act on a request.
create or replace function uniattend.exit_requests()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not uniattend.is_super_admin() then raise exception 'Not allowed.' using errcode = '42501'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'institution_id', x.institution_id, 'institution', i.name,
            'reason', x.reason, 'status', x.status, 'created_at', x.created_at, 'credentials_revoked_at', x.credentials_revoked_at,
            'closed_at', x.closed_at, 'closing_note', x.closing_note,
            'last_export', (select max(a.created_at) from uniattend.audit_logs a where a.institution_id = x.institution_id
                            and a.action = 'export' and a.entity = 'institution_export'))
          order by x.created_at desc), '[]'::jsonb)
          from uniattend.institution_exit_requests x join uniattend.institutions i on i.id = x.institution_id);
end $$;

-- ---------------------------------------------------------------- the full export is audited
create or replace function uniattend._rewrite(p_fn text, p_from text, p_to text, p_times int default 1)
returns void language plpgsql set search_path = '' as $$
declare def text; n int;
begin
  select pg_get_functiondef(p.oid) into def from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'uniattend' and p.proname = p_fn;
  if def is null then raise exception '0032: function % not found', p_fn; end if;
  n := (length(def) - length(replace(def, p_from, ''))) / length(p_from);
  if n <> p_times then raise exception '0032: expected % of "%" in %, found %', p_times, p_from, p_fn, n; end if;
  execute replace(def, p_from, p_to);
end $$;
do $$
begin
  -- 'institution_export' is an admin-only kind, so the existing is_inst_admin branch covers it.
  perform uniattend._rewrite('log_export', '''personal_data'', ''institution_report'')',
                             '''personal_data'', ''institution_report'', ''institution_export'')');
end $$;
drop function uniattend._rewrite(text, text, text, int);

revoke execute on function uniattend.onboarding_status(uuid) from public, anon;
revoke execute on function uniattend.onboarding_sign_off(uuid, text, text, boolean) from public, anon;
revoke execute on function uniattend.onboarding_overview() from public, anon;
revoke execute on function uniattend.revoke_integration_credentials(uuid) from public, anon;
revoke execute on function uniattend.request_exit(uuid, text) from public, anon;
revoke execute on function uniattend.withdraw_exit(uuid) from public, anon;
revoke execute on function uniattend.close_institution(uuid, text) from public, anon;
revoke execute on function uniattend.exit_requests() from public, anon;
grant execute on function uniattend.onboarding_status(uuid), uniattend.onboarding_sign_off(uuid, text, text, boolean),
  uniattend.onboarding_overview(), uniattend.revoke_integration_credentials(uuid), uniattend.request_exit(uuid, text),
  uniattend.withdraw_exit(uuid), uniattend.close_institution(uuid, text), uniattend.exit_requests() to authenticated;

insert into uniattend.schema_versions (version, name) values ('20261115000032', 'onboarding_exit')
on conflict (version) do nothing;
