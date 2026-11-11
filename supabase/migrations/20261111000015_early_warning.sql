-- UniAttend 0015 — early warning: automatic attendance alerts with case follow-up.
--
-- What attendance platforms such as SEAtS and Edusign sell as "early alerts":
-- * An alert opens when a student's attendance in a module falls below the
--   required percentage (worst case, the same rule as module_report().at_risk),
--   or when they miss several classes in a row. The student is notified, and the
--   module's lecturers and the institution's admins see it.
-- * Staff follow it up as a case: open → contacted → resolved / dismissed, with
--   notes, an assignee and a full history (student_alert_events).
-- * Alerts re-check by themselves when a class closes or a record is corrected,
--   and close by themselves when attendance recovers, the student attends again,
--   or the student is no longer enrolled.
-- * Students never see the case or its notes, only their own notification.
-- * Nobody writes the tables directly: only the functions below do.

-- ------------------------------------------------------------------ settings
alter table uniattend.institution_settings
  add column if not exists alerts_enabled boolean not null default true,
  add column if not exists alert_min_sessions int not null default 3 check (alert_min_sessions between 1 and 50),
  add column if not exists alert_consecutive_absences int not null default 3 check (alert_consecutive_absences between 2 and 20);

-- -------------------------------------------------------------------- tables
create table uniattend.student_alerts (
  id              uuid primary key default gen_random_uuid(),
  institution_id  uuid not null references uniattend.institutions(id) on delete cascade,
  student_id      uuid not null,
  module_id       uuid not null,
  kind            text not null check (kind in ('low_attendance', 'missed_in_a_row')),
  status          text not null default 'open' check (status in ('open', 'contacted', 'resolved', 'dismissed')),
  percent         numeric(5,1),   -- worst-case attendance % when last checked
  missed_in_a_row int,
  required_pct    int,
  assigned_to     uuid references auth.users(id) on delete set null,
  resolved_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (institution_id, id),
  foreign key (institution_id, student_id) references uniattend.students(institution_id, id) on delete cascade,
  foreign key (institution_id, module_id)  references uniattend.modules(institution_id, id) on delete cascade
);
-- At most one live (open or contacted) alert per student, module and kind.
create unique index student_alerts_live on uniattend.student_alerts(student_id, module_id, kind)
  where status in ('open', 'contacted');
create index student_alerts_inst on uniattend.student_alerts(institution_id, status, created_at desc);
create trigger student_alerts_touch before update on uniattend.student_alerts
  for each row execute function uniattend.touch_updated_at();

create table uniattend.student_alert_events (
  id             uuid primary key default gen_random_uuid(),
  institution_id uuid not null references uniattend.institutions(id) on delete cascade,
  alert_id       uuid not null,
  actor_id       uuid references auth.users(id) on delete set null,   -- null = automatic
  action         text not null check (action in
                   ('opened', 'contacted', 'resolved', 'dismissed', 'reopened', 'assigned', 'unassigned', 'note', 'auto_resolved')),
  note           text check (note is null or length(note) <= 2000),
  created_at     timestamptz not null default now(),
  foreign key (institution_id, alert_id) references uniattend.student_alerts(institution_id, id) on delete cascade
);
create index student_alert_events_alert on uniattend.student_alert_events(alert_id, created_at);

alter table uniattend.student_alerts enable row level security;
alter table uniattend.student_alert_events enable row level security;
create policy student_alerts_select on uniattend.student_alerts for select to authenticated
  using (uniattend.is_inst_admin(institution_id) or uniattend.teaches_module(module_id));
create policy student_alert_events_select on uniattend.student_alert_events for select to authenticated
  using (exists (select 1 from uniattend.student_alerts a where a.id = alert_id
                 and (uniattend.is_inst_admin(a.institution_id) or uniattend.teaches_module(a.module_id))));
revoke insert, update, delete, truncate on uniattend.student_alerts, uniattend.student_alert_events from anon, authenticated;
revoke select on uniattend.student_alerts, uniattend.student_alert_events from anon;

-- --------------------------------------------------------------- evaluation
-- Re-checks one module. Called by the triggers below and by recheck_alerts().
-- Counting matches module_report(): present/late = attended, absent = absent,
-- excused is left out, unresolved (pending_verification/disputed) counts against
-- the student in the worst case. "Missed in a row" counts the latest closed
-- classes marked absent, back to the last one attended; excused and unresolved
-- records neither add to nor break the run.
create or replace function uniattend.evaluate_module_alerts(p_module uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare
  m uniattend.modules; st uniattend.institution_settings; v_min int; n_new int := 0;
  r record; v_alert uuid; v_status text;
begin
  select * into m from uniattend.modules where id = p_module and deleted_at is null;
  if m is null then return 0; end if;
  select * into st from uniattend.institution_settings where institution_id = m.institution_id;
  if st is null or not st.alerts_enabled then return 0; end if;
  v_min := coalesce(m.min_attendance_pct, st.min_attendance_pct);

  -- live alerts for students no longer enrolled close by themselves
  for r in
    select a.id from uniattend.student_alerts a
    where a.module_id = p_module and a.status in ('open', 'contacted')
      and not exists (select 1 from uniattend.module_enrolments e
                      where e.module_id = p_module and e.student_id = a.student_id and e.status = 'active')
  loop
    update uniattend.student_alerts set status = 'resolved', resolved_at = now() where id = r.id;
    insert into uniattend.student_alert_events (institution_id, alert_id, action, note)
    values (m.institution_id, r.id, 'auto_resolved', 'The student is no longer enrolled in this module.');
  end loop;

  for r in
    with t as (
      select e.student_id,
        count(a.id) filter (where a.status in ('present', 'late')) as n_att,
        count(a.id) filter (where a.status = 'absent') as n_abs,
        count(a.id) filter (where a.status in ('pending_verification', 'disputed')) as n_unr
      from uniattend.module_enrolments e
      left join uniattend.class_sessions cs on cs.module_id = e.module_id and cs.status = 'closed'
      left join uniattend.attendance_records a on a.session_id = cs.id and a.student_id = e.student_id
      where e.module_id = p_module and e.status = 'active'
      group by e.student_id
    ), runs as (
      select x.student_id, count(*)::int as n
      from (
        select a.student_id, a.status,
               sum(case when a.status in ('present', 'late') then 1 else 0 end)
                 over (partition by a.student_id order by cs.opens_at desc rows unbounded preceding) as attended_since
        from uniattend.attendance_records a
        join uniattend.class_sessions cs on cs.id = a.session_id and cs.status = 'closed'
        where a.module_id = p_module and a.status in ('present', 'late', 'absent')
      ) x
      where x.attended_since = 0 and x.status = 'absent'
      group by x.student_id
    )
    select t.student_id, s.user_id, (t.n_att + t.n_abs + t.n_unr)::int as counted,
           case when t.n_att + t.n_abs + t.n_unr = 0 then null
                else round(100.0 * t.n_att / (t.n_att + t.n_abs + t.n_unr), 1) end as pct,
           coalesce(runs.n, 0) as missed
    from t
    join uniattend.students s on s.id = t.student_id
    left join runs on runs.student_id = t.student_id
  loop
    -- low attendance --------------------------------------------------------
    select id, status into v_alert, v_status from uniattend.student_alerts
     where student_id = r.student_id and module_id = p_module and kind = 'low_attendance' and status in ('open', 'contacted');
    if r.counted >= st.alert_min_sessions and r.pct < v_min then
      if v_alert is null then
        insert into uniattend.student_alerts (institution_id, student_id, module_id, kind, percent, required_pct)
        values (m.institution_id, r.student_id, p_module, 'low_attendance', r.pct, v_min)
        returning id into v_alert;
        insert into uniattend.student_alert_events (institution_id, alert_id, action, note)
        values (m.institution_id, v_alert, 'opened', format('Attendance %s%%, required %s%%.', trim_scale(r.pct), v_min));
        n_new := n_new + 1;
        if r.user_id is not null then
          insert into uniattend.notifications (institution_id, user_id, kind, title, body, link)
          values (m.institution_id, r.user_id, 'attendance_alert', m.code || ': your attendance is ' || trim_scale(r.pct) || '%',
                  format('You need %s%% to meet the requirement for %s. Speak to your lecturer if something is keeping you away.', v_min, m.title),
                  '/student/history');
        end if;
      elsif v_alert is not null then
        update uniattend.student_alerts set percent = r.pct, required_pct = v_min
         where id = v_alert and (percent is distinct from r.pct or required_pct is distinct from v_min);
      end if;
    elsif v_alert is not null and r.pct is not null and r.pct >= v_min then
      update uniattend.student_alerts set status = 'resolved', resolved_at = now(), percent = r.pct where id = v_alert;
      insert into uniattend.student_alert_events (institution_id, alert_id, action, note)
      values (m.institution_id, v_alert, 'auto_resolved', format('Attendance back to %s%% (required %s%%).', trim_scale(r.pct), v_min));
      if r.user_id is not null then
        insert into uniattend.notifications (institution_id, user_id, kind, title, body, link)
        values (m.institution_id, r.user_id, 'attendance_recovered', m.code || ': attendance back to ' || trim_scale(r.pct) || '%',
                'You meet the attendance requirement again. Keep it up.', '/student/history');
      end if;
    end if;

    -- missed classes in a row ----------------------------------------------
    v_alert := null;
    select id into v_alert from uniattend.student_alerts
     where student_id = r.student_id and module_id = p_module and kind = 'missed_in_a_row' and status in ('open', 'contacted');
    if r.missed >= st.alert_consecutive_absences then
      if v_alert is null then
        insert into uniattend.student_alerts (institution_id, student_id, module_id, kind, missed_in_a_row, percent, required_pct)
        values (m.institution_id, r.student_id, p_module, 'missed_in_a_row', r.missed, r.pct, v_min)
        returning id into v_alert;
        insert into uniattend.student_alert_events (institution_id, alert_id, action, note)
        values (m.institution_id, v_alert, 'opened', format('Missed the last %s classes.', r.missed));
        n_new := n_new + 1;
        if r.user_id is not null then
          insert into uniattend.notifications (institution_id, user_id, kind, title, body, link)
          values (m.institution_id, r.user_id, 'attendance_alert', m.code || ': you missed ' || r.missed || ' classes in a row',
                  'Is everything all right? Speak to your lecturer if something is keeping you away.', '/student/history');
        end if;
      else
        update uniattend.student_alerts set missed_in_a_row = r.missed, percent = r.pct
         where id = v_alert and (missed_in_a_row is distinct from r.missed or percent is distinct from r.pct);
      end if;
    elsif v_alert is not null and r.missed = 0 then
      update uniattend.student_alerts set status = 'resolved', resolved_at = now(), missed_in_a_row = 0 where id = v_alert;
      insert into uniattend.student_alert_events (institution_id, alert_id, action, note)
      values (m.institution_id, v_alert, 'auto_resolved', 'Attended again.');
    end if;
  end loop;

  -- one summary per check for the module's lecturers, not one per student
  if n_new > 0 then
    insert into uniattend.notifications (institution_id, user_id, kind, title, body, link)
    select m.institution_id, l.user_id, 'attendance_alert',
           m.code || ': ' || n_new || ' new early-warning alert' || case when n_new = 1 then '' else 's' end,
           'Students whose attendance needs follow-up. Open Early warning to contact them and record what happened.',
           '/lecturer/early-warning'
    from uniattend.lecturer_assignments la join uniattend.lecturers l on l.id = la.lecturer_id
    where la.module_id = p_module and l.user_id is not null and l.status = 'active';
  end if;
  return n_new;
end $$;

-- ----------------------------------------------------------------- triggers
-- On close: deferred to the end of the transaction, so the absences that
-- close_session() writes after changing the status are already there.
create or replace function uniattend.alerts_on_session_closed()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform uniattend.evaluate_module_alerts(new.module_id);
  return null;
end $$;
create constraint trigger class_sessions_alerts_on_close after update of status on uniattend.class_sessions
  deferrable initially deferred
  for each row when (old.status is distinct from 'closed' and new.status = 'closed')
  execute function uniattend.alerts_on_session_closed();

-- On corrections (register saves, overrides, resolved disputes, late decisions)
-- for classes that have closed. Check-ins during an open class exit at once.
create or replace function uniattend.alerts_on_records_changed()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_module uuid;
begin
  for v_module in
    select distinct c.module_id from changed c
    join uniattend.class_sessions cs on cs.id = c.session_id and cs.status = 'closed'
  loop
    perform uniattend.evaluate_module_alerts(v_module);
  end loop;
  return null;
end $$;
create trigger attendance_records_alerts after update on uniattend.attendance_records
  referencing new table as changed for each statement
  execute function uniattend.alerts_on_records_changed();

-- ------------------------------------------------------------- staff actions
-- Admin: re-check every module now (e.g. after changing the settings).
create or replace function uniattend.recheck_alerts(p_inst uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare v_module uuid; n int := 0;
begin
  if not uniattend.is_inst_admin(p_inst) then raise exception 'institution admin only' using errcode = '42501'; end if;
  for v_module in select id from uniattend.modules where institution_id = p_inst and deleted_at is null loop
    n := n + uniattend.evaluate_module_alerts(v_module);
  end loop;
  return n;
end $$;

-- The institution's alerts that the caller may see: admins all, lecturers their modules.
create or replace function uniattend.list_student_alerts(p_inst uuid, p_live_only boolean default true)
returns table (id uuid, kind text, status text, percent numeric, missed_in_a_row int, required_pct int,
               created_at timestamptz, updated_at timestamptz, student_id uuid, student_number text,
               student_name text, module_id uuid, module_code text, module_title text,
               assigned_to uuid, assignee_name text, last_note text)
language sql stable security definer set search_path = '' as $$
  select a.id, a.kind, a.status, a.percent, a.missed_in_a_row, a.required_pct, a.created_at, a.updated_at,
         s.id, s.student_number, s.full_name, m.id, m.code, m.title, a.assigned_to,
         coalesce(nullif(p.full_name, ''), p.email),
         (select e.note from uniattend.student_alert_events e
           where e.alert_id = a.id and e.note is not null and e.actor_id is not null
           order by e.created_at desc limit 1)
  from uniattend.student_alerts a
  join uniattend.students s on s.id = a.student_id
  join uniattend.modules m on m.id = a.module_id
  left join uniattend.profiles p on p.id = a.assigned_to
  where a.institution_id = p_inst
    and (uniattend.is_inst_admin(p_inst) or uniattend.teaches_module(a.module_id))
    and (not p_live_only or a.status in ('open', 'contacted'))
  order by case a.status when 'open' then 0 when 'contacted' then 1 else 2 end,
           a.percent nulls last, a.created_at desc
  limit 500;
$$;

-- Follow up an alert. p_action: contacted | resolved | dismissed | reopened | assign_me | unassign | note.
-- Dismissing needs a reason; adding a note needs the note.
create or replace function uniattend.update_student_alert(p_alert uuid, p_action text, p_note text default null)
returns uniattend.student_alerts language plpgsql security definer set search_path = '' as $$
declare a uniattend.student_alerts; uid uuid := auth.uid(); v_note text := nullif(trim(p_note), '');
begin
  select * into a from uniattend.student_alerts where id = p_alert for update;
  if a is null or uid is null or not (uniattend.is_inst_admin(a.institution_id) or uniattend.teaches_module(a.module_id)) then
    raise exception 'not your alert' using errcode = '42501';
  end if;
  if v_note is not null and length(v_note) > 2000 then raise exception 'note is too long (2000 characters at most)'; end if;

  if p_action = 'contacted' then
    if a.status <> 'open' then raise exception 'only an open alert can be marked contacted'; end if;
    update uniattend.student_alerts set status = 'contacted' where id = a.id returning * into a;
  elsif p_action in ('resolved', 'dismissed') then
    if a.status not in ('open', 'contacted') then raise exception 'this alert is already closed'; end if;
    if p_action = 'dismissed' and v_note is null then raise exception 'say why you are dismissing it'; end if;
    update uniattend.student_alerts set status = p_action, resolved_at = now() where id = a.id returning * into a;
  elsif p_action = 'reopened' then
    if a.status not in ('resolved', 'dismissed') then raise exception 'this alert is still open'; end if;
    if exists (select 1 from uniattend.student_alerts x where x.student_id = a.student_id and x.module_id = a.module_id
               and x.kind = a.kind and x.status in ('open', 'contacted')) then
      raise exception 'there is already an open alert like this for the student';
    end if;
    update uniattend.student_alerts set status = 'open', resolved_at = null where id = a.id returning * into a;
  elsif p_action = 'assign_me' then
    update uniattend.student_alerts set assigned_to = uid where id = a.id returning * into a;
    p_action := 'assigned';
  elsif p_action = 'unassign' then
    update uniattend.student_alerts set assigned_to = null where id = a.id returning * into a;
    p_action := 'unassigned';
  elsif p_action = 'note' then
    if v_note is null then raise exception 'write the note first'; end if;
  else
    raise exception 'unknown action %', p_action;
  end if;

  insert into uniattend.student_alert_events (institution_id, alert_id, actor_id, action, note)
  values (a.institution_id, a.id, uid, p_action, v_note);
  perform uniattend.write_audit(a.institution_id, p_action, 'student_alerts', a.id::text,
                                jsonb_build_object('kind', a.kind, 'status', a.status));
  return a;
end $$;

-- An alert's history with names, for the case view.
create or replace function uniattend.alert_history(p_alert uuid)
returns table (at timestamptz, action text, note text, actor_name text)
language plpgsql stable security definer set search_path = '' as $$
declare a uniattend.student_alerts;
begin
  select * into a from uniattend.student_alerts where id = p_alert;
  if a is null or not (uniattend.is_inst_admin(a.institution_id) or uniattend.teaches_module(a.module_id)) then
    raise exception 'not your alert' using errcode = '42501';
  end if;
  return query
  select e.created_at, e.action, e.note,
         case when e.actor_id is null then 'Automatic' else coalesce(nullif(p.full_name, ''), p.email, 'Staff') end
  from uniattend.student_alert_events e
  left join uniattend.profiles p on p.id = e.actor_id
  where e.alert_id = p_alert
  order by e.created_at, e.id;
end $$;

-- ------------------------------------------------------------------ grants
revoke all on function uniattend.evaluate_module_alerts(uuid) from public, anon, authenticated;
revoke all on function uniattend.alerts_on_session_closed() from public, anon, authenticated;
revoke all on function uniattend.alerts_on_records_changed() from public, anon, authenticated;
revoke all on function uniattend.recheck_alerts(uuid) from public, anon;
revoke all on function uniattend.list_student_alerts(uuid, boolean) from public, anon;
revoke all on function uniattend.update_student_alert(uuid, text, text) from public, anon;
revoke all on function uniattend.alert_history(uuid) from public, anon;
grant execute on function uniattend.recheck_alerts(uuid) to authenticated;
grant execute on function uniattend.list_student_alerts(uuid, boolean) to authenticated;
grant execute on function uniattend.update_student_alert(uuid, text, text) to authenticated;
grant execute on function uniattend.alert_history(uuid) to authenticated;
