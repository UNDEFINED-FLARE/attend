-- UniAttend 0023 — keeping personal information no longer than needed, and
-- letting people see and ask about what is held about them (POPIA ss 14, 23–25).
--
-- * Retention: each institution already sets retention_days (default 3 years).
--   retention_preview() shows what is older than that; apply_retention() deletes
--   it (institution admins, audited); with auto_retention on, run_retention()
--   does it every night. Off by default: the institution, as the responsible
--   party, decides when its records are deleted.
--   Deleted: closed/cancelled sessions older than the period (with their
--   attendance records, evidence, check-in events and disputes), stray check-in
--   events, notifications, announcements, resolved early-warning alerts, audit
--   entries, and student records removed from the register before the cut-off.
--   Lecturers removed before the cut-off are anonymised (their sessions stay).
-- * my_personal_data(): everything UniAttend holds about the signed-in person,
--   as one JSON document they can download.
-- * data_requests: a person asks for deletion, correction or objects; the
--   platform administrator and the person's institution admins see it and record
--   the outcome.

alter table uniattend.institution_settings
  add column if not exists auto_retention boolean not null default false,
  add column if not exists retention_last_run timestamptz;

-- What is past the institution's retention period, without deleting anything.
create or replace function uniattend.retention_counts(p_inst uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare cutoff timestamptz;
begin
  select now() - make_interval(days => retention_days) into cutoff from uniattend.institution_settings where institution_id = p_inst;
  if cutoff is null then return null; end if;
  return jsonb_build_object(
    'cutoff', cutoff,
    'sessions', (select count(*) from uniattend.class_sessions where institution_id = p_inst and status in ('closed','cancelled') and coalesce(closed_at, closes_at) < cutoff),
    'attendance_records', (select count(*) from uniattend.attendance_records r join uniattend.class_sessions s on s.id = r.session_id
                           where s.institution_id = p_inst and s.status in ('closed','cancelled') and coalesce(s.closed_at, s.closes_at) < cutoff),
    'notifications', (select count(*) from uniattend.notifications where institution_id = p_inst and created_at < cutoff),
    'announcements', (select count(*) from uniattend.announcements where institution_id = p_inst and created_at < cutoff),
    'alerts', (select count(*) from uniattend.student_alerts where institution_id = p_inst and resolved_at < cutoff),
    'audit_entries', (select count(*) from uniattend.audit_logs where institution_id = p_inst and created_at < cutoff),
    'removed_students', (select count(*) from uniattend.students where institution_id = p_inst and deleted_at < cutoff),
    'removed_lecturers', (select count(*) from uniattend.lecturers where institution_id = p_inst and deleted_at < cutoff and full_name <> 'Former lecturer'));
end $$;

create or replace function uniattend.retention_preview(p_inst uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not (uniattend.is_inst_admin(p_inst) or uniattend.is_super_admin()) then
    raise exception 'institution admin only' using errcode = '42501';
  end if;
  return uniattend.retention_counts(p_inst) || jsonb_build_object(
    'retention_days', (select retention_days from uniattend.institution_settings where institution_id = p_inst),
    'auto', (select auto_retention from uniattend.institution_settings where institution_id = p_inst),
    'last_run', (select retention_last_run from uniattend.institution_settings where institution_id = p_inst));
end $$;

-- The deletion itself. Internal: called by apply_retention (admins) and run_retention (nightly).
create or replace function uniattend.retention_delete(p_inst uuid, p_by text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare cutoff timestamptz; counts jsonb;
begin
  counts := uniattend.retention_counts(p_inst);
  if counts is null then return null; end if;
  cutoff := (counts->>'cutoff')::timestamptz;
  delete from uniattend.class_sessions where institution_id = p_inst and status in ('closed','cancelled') and coalesce(closed_at, closes_at) < cutoff;
  delete from uniattend.attendance_verification_events where institution_id = p_inst and created_at < cutoff;
  delete from uniattend.notifications where institution_id = p_inst and created_at < cutoff;
  delete from uniattend.announcements where institution_id = p_inst and created_at < cutoff;
  delete from uniattend.student_alert_events where institution_id = p_inst and created_at < cutoff;
  delete from uniattend.student_alerts where institution_id = p_inst and resolved_at < cutoff;
  delete from uniattend.audit_logs where institution_id = p_inst and created_at < cutoff;
  delete from uniattend.students where institution_id = p_inst and deleted_at < cutoff;
  update uniattend.lecturers set full_name = 'Former lecturer', email = null, user_id = null
   where institution_id = p_inst and deleted_at < cutoff and full_name <> 'Former lecturer';
  update uniattend.institution_settings set retention_last_run = now() where institution_id = p_inst;
  -- Recorded after the clean-up, so this entry itself is kept.
  perform uniattend.write_audit(p_inst, 'retention_applied', 'institution_settings', p_inst::text, counts || jsonb_build_object('by', p_by));
  return counts;
end $$;

create or replace function uniattend.apply_retention(p_inst uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not uniattend.is_inst_admin(p_inst) then raise exception 'institution admin only' using errcode = '42501'; end if;
  return uniattend.retention_delete(p_inst, 'admin');
end $$;

create or replace function uniattend.set_auto_retention(p_inst uuid, p_on boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not uniattend.is_inst_admin(p_inst) then raise exception 'institution admin only' using errcode = '42501'; end if;
  update uniattend.institution_settings set auto_retention = coalesce(p_on, false) where institution_id = p_inst;
  perform uniattend.write_audit(p_inst, 'auto_retention', 'institution_settings', p_inst::text, jsonb_build_object('on', p_on));
end $$;

-- Nightly, for institutions that switched it on. Not callable by users.
create or replace function uniattend.run_retention()
returns int language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0;
begin
  for r in select s.institution_id from uniattend.institution_settings s
           join uniattend.institutions i on i.id = s.institution_id
           where s.auto_retention and i.deleted_at is null loop
    perform uniattend.retention_delete(r.institution_id, 'schedule');
    n := n + 1;
  end loop;
  return n;
end $$;

-- ------------------------------------------------------------ access to one's own data

create or replace function uniattend.my_personal_data()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  return jsonb_build_object(
    'generated_at', now(),
    'about', 'Everything UniAttend holds about your account. Your institution is responsible for these records; ask its administrators to correct anything.',
    'account', (select jsonb_build_object('id', j->'id', 'email', j->'email', 'created_at', j->'created_at', 'last_sign_in_at', j->'last_sign_in_at')
                from (select to_jsonb(u) j from auth.users u where u.id = uid) x),
    'profile', (select to_jsonb(p) - 'avatar_path' from uniattend.profiles p where p.id = uid),
    'memberships', coalesce((select jsonb_agg(jsonb_build_object('institution', i.name, 'role', r.role, 'status', r.status, 'since', r.created_at, 'left_at', r.left_at))
                    from uniattend.user_roles r left join uniattend.institutions i on i.id = r.institution_id where r.user_id = uid), '[]'),
    'student_records', coalesce((select jsonb_agg(jsonb_build_object('institution', i.name, 'student_number', s.student_number, 'full_name', s.full_name,
                         'email', s.email, 'status', s.status,
                         'modules', (select jsonb_agg(m.code || ' ' || m.title) from uniattend.module_enrolments e join uniattend.modules m on m.id = e.module_id where e.student_id = s.id),
                         'attendance', (select jsonb_agg(jsonb_build_object('module', m.code, 'session', cs.title, 'date', cs.opens_at, 'status', ar.status,
                                          'method', ar.method, 'checked_in_at', ar.checked_in_at, 'minutes_late', ar.minutes_late, 'explanation', ar.explanation)
                                          order by cs.opens_at)
                                        from uniattend.attendance_records ar join uniattend.class_sessions cs on cs.id = ar.session_id
                                        join uniattend.modules m on m.id = ar.module_id where ar.student_id = s.id),
                         'disputes', (select jsonb_agg(jsonb_build_object('reason', d.reason, 'status', d.status, 'created_at', d.created_at, 'outcome', d.resolution_note))
                                      from uniattend.attendance_disputes d where d.student_id = s.id),
                         'early_warning_alerts', (select jsonb_agg(jsonb_build_object('module', m.code, 'kind', a.kind, 'status', a.status, 'percent', a.percent, 'created_at', a.created_at))
                                                  from uniattend.student_alerts a join uniattend.modules m on m.id = a.module_id where a.student_id = s.id)))
                       from uniattend.students s join uniattend.institutions i on i.id = s.institution_id where s.user_id = uid), '[]'),
    'lecturer_records', coalesce((select jsonb_agg(jsonb_build_object('institution', i.name, 'staff_number', l.staff_number, 'full_name', l.full_name, 'email', l.email, 'status', l.status))
                        from uniattend.lecturers l join uniattend.institutions i on i.id = l.institution_id where l.user_id = uid), '[]'),
    'notifications', coalesce((select jsonb_agg(jsonb_build_object('title', n.title, 'body', n.body, 'created_at', n.created_at) order by n.created_at desc)
                     from (select * from uniattend.notifications where user_id = uid order by created_at desc limit 500) n), '[]'),
    'notification_devices', coalesce((select jsonb_agg(jsonb_build_object('device', ps.user_agent, 'since', ps.created_at, 'settings', ps.prefs))
                            from uniattend.push_subscriptions ps where ps.user_id = uid), '[]'),
    'data_requests', coalesce((select jsonb_agg(jsonb_build_object('kind', d.kind, 'status', d.status, 'created_at', d.created_at, 'response', d.response))
                     from uniattend.data_requests d where d.user_id = uid), '[]'));
end $$;

-- ------------------------------------------------------------ requests about one's data

create table if not exists uniattend.data_requests (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  kind        text not null check (kind in ('deletion','correction','objection','other')),
  details     text not null check (length(trim(details)) between 5 and 2000),
  status      text not null default 'open' check (status in ('open','in_progress','done','declined')),
  response    text check (length(response) <= 2000),
  handled_by  uuid references auth.users(id) on delete set null,
  handled_at  timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists data_requests_user on uniattend.data_requests(user_id, created_at desc);
create index if not exists data_requests_open on uniattend.data_requests(status) where status in ('open','in_progress');
alter table uniattend.data_requests enable row level security;
drop policy if exists data_requests_select on uniattend.data_requests;
-- The person, the platform administrator, and admins of an institution the person belongs to.
create policy data_requests_select on uniattend.data_requests for select to authenticated
  using (user_id = (select auth.uid()) or uniattend.is_super_admin()
         or exists (select 1 from uniattend.user_roles r where r.user_id = data_requests.user_id and r.institution_id is not null
                    and uniattend.is_inst_admin(r.institution_id)));
grant select on uniattend.data_requests to authenticated;

create or replace function uniattend.request_data_action(p_kind text, p_details text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); v_id uuid;
begin
  if uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if p_kind not in ('deletion','correction','objection','other') then raise exception 'unknown request type'; end if;
  if (select count(*) from uniattend.data_requests where user_id = uid and status in ('open','in_progress')) >= 3 then
    raise exception 'You already have 3 open requests. We''ll answer those first.' using errcode = 'P0001';
  end if;
  insert into uniattend.data_requests (user_id, kind, details) values (uid, p_kind, trim(p_details)) returning id into v_id;
  -- Tell the institution admins and the platform administrator.
  insert into uniattend.notifications (institution_id, user_id, kind, title, body, link)
  select distinct on (a.user_id) a.institution_id, a.user_id, 'data_request', 'Personal information request',
         'Someone at your institution asked for ' || p_kind || ' of their information. Respond within 30 days.', '/admin/requests'
  from uniattend.user_roles mine join uniattend.user_roles a on a.institution_id = mine.institution_id and a.role = 'institution_admin' and a.status = 'active'
  where mine.user_id = uid and mine.institution_id is not null;
  insert into uniattend.notifications (institution_id, user_id, kind, title, body, link)
  select null, r.user_id, 'data_request', 'Personal information request', 'A new ' || p_kind || ' request is waiting.', '/super/requests'
  from uniattend.user_roles r where r.role = 'super_admin' and r.status = 'active';
  return v_id;
end $$;

create or replace function uniattend.answer_data_request(p_id uuid, p_status text, p_response text)
returns void language plpgsql security definer set search_path = '' as $$
declare d uniattend.data_requests;
begin
  select * into d from uniattend.data_requests where id = p_id;
  if d.id is null then raise exception 'no such request'; end if;
  if not (uniattend.is_super_admin() or exists (select 1 from uniattend.user_roles r where r.user_id = d.user_id and r.institution_id is not null
                                                and uniattend.is_inst_admin(r.institution_id))) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_status not in ('in_progress','done','declined') then raise exception 'bad status'; end if;
  if p_status in ('done','declined') and length(trim(coalesce(p_response, ''))) < 5 then
    raise exception 'Tell the person what was done (or why not).';
  end if;
  update uniattend.data_requests set status = p_status, response = nullif(trim(p_response), ''), handled_by = auth.uid(), handled_at = now() where id = p_id;
  insert into uniattend.notifications (institution_id, user_id, kind, title, body, link)
  values (null, d.user_id, 'data_request', 'Your request: ' || replace(p_status, '_', ' '), coalesce(nullif(trim(p_response), ''), 'We are working on it.'), '/settings');
end $$;

revoke all on function uniattend.retention_counts(uuid) from public, anon, authenticated;
revoke all on function uniattend.retention_delete(uuid, text) from public, anon, authenticated;
revoke all on function uniattend.run_retention() from public, anon, authenticated;
revoke all on function uniattend.retention_preview(uuid) from public, anon;
revoke all on function uniattend.apply_retention(uuid) from public, anon;
revoke all on function uniattend.set_auto_retention(uuid, boolean) from public, anon;
revoke all on function uniattend.my_personal_data() from public, anon;
revoke all on function uniattend.request_data_action(text, text) from public, anon;
revoke all on function uniattend.answer_data_request(uuid, text, text) from public, anon;
grant execute on function uniattend.retention_preview(uuid) to authenticated;
grant execute on function uniattend.apply_retention(uuid) to authenticated;
grant execute on function uniattend.set_auto_retention(uuid, boolean) to authenticated;
grant execute on function uniattend.my_personal_data() to authenticated;
grant execute on function uniattend.request_data_action(text, text) to authenticated;
grant execute on function uniattend.answer_data_request(uuid, text, text) to authenticated;

-- Nightly at 02:30 South African time, where pg_cron is installed (it is on Supabase).
do $$
begin
  if to_regnamespace('cron') is null then return; end if;
  if exists (select 1 from cron.job where jobname = 'uniattend-retention') then
    perform cron.unschedule('uniattend-retention');
  end if;
  perform cron.schedule('uniattend-retention', '30 0 * * *', 'select uniattend.run_retention()');
end $$;
