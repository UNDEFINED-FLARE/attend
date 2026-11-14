-- UniAttend 0027 — classes from the timetable, and attendance sessions prepared from them.
--
-- * timetable_events: dated classes. Made from the weekly timetable for the next two
--   weeks (nightly, and on demand), or received from a timetable system (CELCAT…)
--   through the sync engine with that system's own event id. Repeating either never
--   creates a second copy of the same class.
-- * A class can be cancelled, moved to another venue or time, or taught by a
--   substitute. Students are told. A change made in UniAttend is never overwritten by
--   the nightly refresh; a timetable system's own update always applies.
-- * institution_settings.attendance_kinds: which kinds of class take attendance
--   (lectures, tutorials and practicals by default; tests and other events not).
--   A lecturer can still take attendance at any class.
-- * open_event_session(): the lecturer presses "Open attendance" on a class. The
--   session gets the class's module, venue, group and end time; only that group's
--   students are notified. Pressing it again returns the same session.
--   A timetable never creates attendance on its own.
-- * Lecture groups: module_enrolments.group_name places a student in a group
--   ("A", "Tut 3"); a class for one group notifies only that group.

alter table uniattend.institution_settings
  add column if not exists attendance_kinds text[] not null default array['lecture','tutorial','practical'];
alter table uniattend.module_enrolments add column if not exists group_name text check (group_name is null or length(group_name) <= 40);
alter table uniattend.class_sessions
  add column if not exists group_name text check (group_name is null or length(group_name) <= 40),
  add column if not exists event_id uuid;

create table if not exists uniattend.timetable_events (
  id             uuid primary key default gen_random_uuid(),
  institution_id uuid not null references uniattend.institutions(id) on delete cascade,
  module_id      uuid not null,
  timetable_id   uuid references uniattend.timetables(id) on delete set null,
  venue_id       uuid,
  lecturer_id    uuid,
  kind           text not null default 'lecture' check (kind in ('lecture','tutorial','practical','test','other')),
  group_name     text check (group_name is null or length(group_name) <= 40),
  starts_at      timestamptz not null,
  ends_at        timestamptz not null,
  status         text not null default 'scheduled' check (status in ('scheduled','cancelled')),
  requires_attendance boolean not null default true,
  session_id     uuid references uniattend.class_sessions(id) on delete set null,
  source         text not null default 'timetable' check (length(source) between 1 and 80),
  external_id    text check (external_id is null or length(external_id) <= 200),
  edited         boolean not null default false,
  note           text check (note is null or length(note) <= 300),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (institution_id, id),
  check (ends_at > starts_at),
  foreign key (institution_id, module_id) references uniattend.modules(institution_id, id) on delete cascade,
  foreign key (institution_id, venue_id) references uniattend.venues(institution_id, id),
  foreign key (institution_id, lecturer_id) references uniattend.lecturers(institution_id, id)
);
create unique index if not exists timetable_events_slot on uniattend.timetable_events(timetable_id, starts_at) where timetable_id is not null;
create unique index if not exists timetable_events_external on uniattend.timetable_events(institution_id, source, external_id) where external_id is not null;
create index if not exists timetable_events_day on uniattend.timetable_events(institution_id, starts_at);
create index if not exists timetable_events_module on uniattend.timetable_events(module_id, starts_at);
create index if not exists timetable_events_lecturer on uniattend.timetable_events(lecturer_id, starts_at) where lecturer_id is not null;

alter table uniattend.timetable_events enable row level security;
drop policy if exists timetable_events_select on uniattend.timetable_events;
-- Admins; the module's lecturers and the class's own (substitute) lecturer; enrolled students.
create policy timetable_events_select on uniattend.timetable_events for select to authenticated
  using (uniattend.is_inst_admin(institution_id) or uniattend.teaches_module(module_id) or uniattend.enrolled_in_module(module_id)
         or exists (select 1 from uniattend.lecturers l where l.id = timetable_events.lecturer_id and l.user_id = (select auth.uid())));
revoke insert, update, delete on uniattend.timetable_events from anon, authenticated;
revoke select on uniattend.timetable_events from anon;
grant select on uniattend.timetable_events to authenticated;

-- The local time of a class, in the institution's time zone.
create or replace function uniattend._event_local(p_inst uuid, p_at timestamptz)
returns text language sql stable security definer set search_path = '' as $$
  select to_char(p_at at time zone coalesce((select timezone from uniattend.institutions where id = p_inst), 'Africa/Johannesburg'), 'Dy DD Mon HH24:MI');
$$;

-- Tell the students of a class (its group only, when it has one).
create or replace function uniattend._notify_event(p_event uuid, p_title text, p_body text)
returns int language plpgsql security definer set search_path = '' as $$
declare e uniattend.timetable_events; n int;
begin
  select * into e from uniattend.timetable_events where id = p_event;
  insert into uniattend.notifications (institution_id, user_id, kind, title, body, link, dedupe_key)
  select e.institution_id, s.user_id, 'class_update', left(p_title, 200), left(p_body, 500), '/student/timetable',
         'ev:' || e.id || ':' || md5(p_title || p_body) || ':' || s.user_id
    from uniattend.module_enrolments me join uniattend.students s on s.id = me.student_id
   where me.module_id = e.module_id and me.status = 'active' and s.user_id is not null and s.status = 'active'
     and (e.group_name is null or me.group_name is null or lower(me.group_name) = lower(e.group_name))
  on conflict (dedupe_key) where dedupe_key is not null do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- ------------------------------------------------------------ from the weekly timetable

-- Makes the dated classes for the next p_days days (within the current academic period, if
-- one is set). Safe to repeat: existing classes are kept; ones nobody changed by hand follow
-- the weekly slot; future classes whose slot was removed are cancelled.
create or replace function uniattend._generate_events(p_inst uuid, p_days int)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare tz text; d0 date; d1 date; kinds text[]; per uniattend.academic_periods; n_new int; n_upd int; n_gone int;
begin
  select coalesce(timezone, 'Africa/Johannesburg') into tz from uniattend.institutions where id = p_inst;
  select coalesce(attendance_kinds, array['lecture','tutorial','practical']) into kinds from uniattend.institution_settings where institution_id = p_inst;
  kinds := coalesce(kinds, array['lecture','tutorial','practical']);
  d0 := (now() at time zone tz)::date;
  d1 := d0 + least(greatest(coalesce(p_days, 14), 1), 60) - 1;
  select * into per from uniattend.academic_periods where institution_id = p_inst and is_current order by starts_on desc limit 1;
  if per.id is not null then d0 := greatest(d0, per.starts_on); d1 := least(d1, per.ends_on); end if;

  -- A slot moved to another day: its untouched future classes on the old day are cancelled (new ones are made below).
  update uniattend.timetable_events e set status = 'cancelled', note = 'Moved in the timetable.', updated_at = now()
    from uniattend.timetables t
   where e.institution_id = p_inst and e.timetable_id = t.id and not e.edited and e.status = 'scheduled'
     and e.session_id is null and e.starts_at > now()
     and extract(isodow from (e.starts_at at time zone tz)) <> t.weekday;

  -- The slot changed (time, venue, lecturer, kind, group): its untouched future classes follow it.
  update uniattend.timetable_events e
     set starts_at = (((e.starts_at at time zone tz)::date) + t.starts_at) at time zone tz,
         ends_at = (((e.starts_at at time zone tz)::date) + t.ends_at) at time zone tz,
         venue_id = t.venue_id, lecturer_id = t.lecturer_id, kind = t.kind, group_name = t.group_name, updated_at = now()
    from uniattend.timetables t
   where e.institution_id = p_inst and e.timetable_id = t.id and not e.edited and e.status = 'scheduled'
     and e.session_id is null and e.starts_at > now()
     and extract(isodow from (e.starts_at at time zone tz)) = t.weekday
     and (e.starts_at <> (((e.starts_at at time zone tz)::date) + t.starts_at) at time zone tz
          or e.ends_at <> (((e.starts_at at time zone tz)::date) + t.ends_at) at time zone tz
          or e.venue_id is distinct from t.venue_id or e.lecturer_id is distinct from t.lecturer_id or e.kind <> t.kind
          or e.group_name is distinct from t.group_name);
  get diagnostics n_upd = row_count;

  insert into uniattend.timetable_events (institution_id, module_id, timetable_id, venue_id, lecturer_id, kind, group_name,
                                          starts_at, ends_at, requires_attendance, source)
  select p_inst, t.module_id, t.id, t.venue_id, t.lecturer_id, t.kind, t.group_name,
         (x.d + t.starts_at) at time zone tz, (x.d + t.ends_at) at time zone tz, t.kind = any(kinds), 'timetable'
    from uniattend.timetables t
    join uniattend.modules m on m.id = t.module_id and m.deleted_at is null
    cross join generate_series(d0, d1, interval '1 day') g(day)
    cross join lateral (select g.day::date as d) x
   where t.institution_id = p_inst and extract(isodow from x.d) = t.weekday
     and (x.d + t.starts_at) at time zone tz > now()
     -- One class per slot per day: a class changed or cancelled by hand keeps its day.
     and not exists (select 1 from uniattend.timetable_events e2
                      where e2.timetable_id = t.id and (e2.starts_at at time zone tz)::date = x.d)
  on conflict (timetable_id, starts_at) where timetable_id is not null do nothing;
  get diagnostics n_new = row_count;

  -- The slot was removed from the weekly timetable: its future, untouched classes are cancelled.
  update uniattend.timetable_events e set status = 'cancelled', note = 'Removed from the timetable.', updated_at = now()
   where e.institution_id = p_inst and e.source = 'timetable' and e.timetable_id is null and not e.edited
     and e.status = 'scheduled' and e.session_id is null and e.starts_at > now();
  get diagnostics n_gone = row_count;

  return jsonb_build_object('from', d0, 'to', d1, 'created', n_new, 'updated', n_upd, 'cancelled', n_gone);
end $$;

create or replace function uniattend.generate_timetable_events(p_inst uuid, p_days int default 14)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not uniattend.is_inst_admin(p_inst) then raise exception 'institution admin only' using errcode = '42501'; end if;
  return uniattend._generate_events(p_inst, p_days);
end $$;

-- Nightly, for every active institution. Not callable by users.
create or replace function uniattend.run_timetable_events()
returns int language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0;
begin
  for r in select id from uniattend.institutions where status = 'active' and deleted_at is null loop
    perform uniattend._generate_events(r.id, 14);
    n := n + 1;
  end loop;
  return n;
end $$;

-- ------------------------------------------------------------ lecturers and admins

create or replace function uniattend._may_run_event(e uniattend.timetable_events)
returns boolean language sql stable security definer set search_path = '' as $$
  select uniattend.teaches_module(e.module_id) or uniattend.is_inst_admin(e.institution_id)
      or exists (select 1 from uniattend.lecturers l where l.id = e.lecturer_id and l.user_id = auth.uid() and l.status = 'active');
$$;

-- "Open attendance" on a class: from 30 minutes before it starts until it ends.
create or replace function uniattend.open_event_session(p_event uuid, p_late_minutes int default null)
returns uniattend.class_sessions language plpgsql security definer set search_path = '' as $$
declare e uniattend.timetable_events; m uniattend.modules; v uniattend.venues; st uniattend.institution_settings;
        s uniattend.class_sessions; lect uuid; gps boolean;
begin
  select * into e from uniattend.timetable_events where id = p_event for update;
  if e.id is null or not uniattend._may_run_event(e) then raise exception 'not your class' using errcode = '42501'; end if;
  if e.status = 'cancelled' then raise exception 'This class is cancelled. Restore it first to take attendance.' using errcode = 'P0001'; end if;
  if e.session_id is not null then
    select * into s from uniattend.class_sessions where id = e.session_id;
    if s.id is not null then return s; end if;           -- already opened: the same session
  end if;
  if now() < e.starts_at - interval '30 minutes' then
    raise exception 'Attendance for this class opens 30 minutes before it starts (%).', uniattend._event_local(e.institution_id, e.starts_at) using errcode = 'P0001';
  end if;
  if now() > e.ends_at then raise exception 'This class has already ended.' using errcode = 'P0001'; end if;
  if not uniattend.institution_can_operate(e.institution_id) then
    raise exception 'institution is not active or its subscription has lapsed' using errcode = 'P0001';
  end if;
  select * into m from uniattend.modules where id = e.module_id;
  select * into st from uniattend.institution_settings where institution_id = e.institution_id;
  if e.venue_id is not null then select * into v from uniattend.venues where id = e.venue_id and deleted_at is null; end if;
  gps := st.require_gps and v.id is not null and (v.polygon is not null or (v.lat is not null and v.lng is not null));
  select id into lect from uniattend.lecturers where institution_id = e.institution_id and user_id = auth.uid();

  insert into uniattend.class_sessions (institution_id, module_id, venue_id, lecturer_id, title, opens_at, closes_at, late_after,
                                        join_code, require_qr, require_gps, created_by, group_name, event_id)
  values (e.institution_id, e.module_id, v.id, coalesce(lect, e.lecturer_id),
          m.code || ' ' || e.kind || coalesce(' · ' || e.group_name, ''),
          now(), greatest(e.ends_at, now() + interval '10 minutes'),
          greatest(now(), e.starts_at) + make_interval(mins => coalesce(p_late_minutes, st.late_after_minutes)),
          uniattend.generate_join_code(e.institution_id), st.require_qr, gps, auth.uid(), e.group_name, e.id)
  returning * into s;
  insert into uniattend.session_secrets (session_id, secret) values (s.id, extensions.gen_random_bytes(32));
  update uniattend.timetable_events set session_id = s.id, updated_at = now() where id = e.id;

  insert into uniattend.notifications (institution_id, user_id, kind, title, body, link)
  select e.institution_id, st2.user_id, 'session_open', m.code || ': attendance is open',
         s.title || coalesce(' in ' || v.name, '') || '. Scan the code on screen.', '/student/check-in'
    from uniattend.module_enrolments me join uniattend.students st2 on st2.id = me.student_id
   where me.module_id = m.id and me.status = 'active' and st2.user_id is not null
     and (e.group_name is null or me.group_name is null or lower(me.group_name) = lower(e.group_name));

  perform uniattend.write_audit(e.institution_id, 'open', 'class_sessions', s.id::text,
    jsonb_build_object('module', m.code, 'event', e.id, 'require_gps', gps));
  return s;
end $$;

-- p_action: cancel | restore | venue | time | substitute | attendance_on | attendance_off
create or replace function uniattend.change_event(p_event uuid, p_action text, p_venue uuid default null, p_lecturer uuid default null,
                                                 p_starts timestamptz default null, p_ends timestamptz default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare e uniattend.timetable_events; m uniattend.modules; v uniattend.venues; l uniattend.lecturers; n int := 0;
        v_note text := nullif(left(trim(coalesce(p_note, '')), 300), ''); when_txt text;
begin
  select * into e from uniattend.timetable_events where id = p_event for update;
  if e.id is null or not (uniattend.teaches_module(e.module_id) or uniattend.is_inst_admin(e.institution_id)) then
    raise exception 'only the module''s lecturers or an administrator can change this class' using errcode = '42501';
  end if;
  select * into m from uniattend.modules where id = e.module_id;
  when_txt := uniattend._event_local(e.institution_id, e.starts_at);
  if p_action in ('cancel','venue','time','substitute') and e.session_id is not null
     and exists (select 1 from uniattend.class_sessions where id = e.session_id and status in ('open','scheduled')) then
    raise exception 'Attendance is open for this class. Close the session before changing the class.' using errcode = 'P0001';
  end if;

  if p_action = 'cancel' then
    if e.status = 'cancelled' then return jsonb_build_object('notified', 0); end if;
    update uniattend.timetable_events set status = 'cancelled', edited = true, note = coalesce(v_note, 'Cancelled.'), updated_at = now() where id = e.id;
    n := uniattend._notify_event(e.id, 'Class cancelled: ' || m.code || ' ' || when_txt, coalesce(v_note, 'This class will not take place.'));
  elsif p_action = 'restore' then
    update uniattend.timetable_events set status = 'scheduled', edited = true, note = v_note, updated_at = now() where id = e.id and status = 'cancelled';
    if found then n := uniattend._notify_event(e.id, 'Class back on: ' || m.code || ' ' || when_txt, coalesce(v_note, 'This class will take place after all.')); end if;
  elsif p_action = 'venue' then
    select * into v from uniattend.venues where id = p_venue and institution_id = e.institution_id and deleted_at is null;
    if v.id is null then raise exception 'unknown venue' using errcode = 'P0001'; end if;
    update uniattend.timetable_events set venue_id = v.id, edited = true, note = coalesce(v_note, e.note), updated_at = now() where id = e.id;
    n := uniattend._notify_event(e.id, 'Venue change: ' || m.code || ' ' || when_txt, 'Now in ' || v.name || '.' || coalesce(' ' || v_note, ''));
  elsif p_action = 'time' then
    if p_starts is null or p_ends is null or p_ends <= p_starts then raise exception 'Choose a start and an end time.' using errcode = 'P0001'; end if;
    if p_ends - p_starts > interval '8 hours' then raise exception 'A class can be at most 8 hours long.' using errcode = 'P0001'; end if;
    update uniattend.timetable_events set starts_at = p_starts, ends_at = p_ends, edited = true, updated_at = now() where id = e.id;
    n := uniattend._notify_event(e.id, 'Time change: ' || m.code,
           'Moved from ' || when_txt || ' to ' || uniattend._event_local(e.institution_id, p_starts) || '.' || coalesce(' ' || v_note, ''));
  elsif p_action = 'substitute' then
    select * into l from uniattend.lecturers where id = p_lecturer and institution_id = e.institution_id and deleted_at is null and status = 'active';
    if l.id is null then raise exception 'unknown lecturer' using errcode = 'P0001'; end if;
    update uniattend.timetable_events set lecturer_id = l.id, edited = true, updated_at = now() where id = e.id;
    if l.user_id is not null then
      insert into uniattend.notifications (institution_id, user_id, kind, title, body, link)
      values (e.institution_id, l.user_id, 'class_update', 'You are teaching ' || m.code || ' ' || when_txt,
              'You have been asked to take this class.' || coalesce(' ' || v_note, ''), '/lecturer');
    end if;
  elsif p_action = 'attendance_on' then
    update uniattend.timetable_events set requires_attendance = true, edited = true, updated_at = now() where id = e.id;
  elsif p_action = 'attendance_off' then
    update uniattend.timetable_events set requires_attendance = false, edited = true, updated_at = now() where id = e.id;
  else
    raise exception 'unknown action' using errcode = 'P0001';
  end if;
  perform uniattend.write_audit(e.institution_id, 'class_' || p_action, 'timetable_events', e.id::text,
    jsonb_build_object('module', m.code, 'starts_at', e.starts_at, 'note', v_note));
  return jsonb_build_object('notified', n);
end $$;

create or replace function uniattend.set_attendance_kinds(p_inst uuid, p_kinds text[])
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not uniattend.is_inst_admin(p_inst) then raise exception 'institution admin only' using errcode = '42501'; end if;
  if exists (select 1 from unnest(coalesce(p_kinds, '{}')) k where k not in ('lecture','tutorial','practical','test','other')) then
    raise exception 'unknown kind of class' using errcode = 'P0001';
  end if;
  update uniattend.institution_settings set attendance_kinds = coalesce(p_kinds, '{}') where institution_id = p_inst;
  -- Future classes nobody changed by hand follow the new rule.
  update uniattend.timetable_events set requires_attendance = kind = any(coalesce(p_kinds, '{}')), updated_at = now()
   where institution_id = p_inst and not edited and starts_at > now() and session_id is null
     and requires_attendance is distinct from (kind = any(coalesce(p_kinds, '{}')));
  perform uniattend.write_audit(p_inst, 'attendance_kinds', 'institution_settings', p_inst::text, jsonb_build_object('kinds', p_kinds));
end $$;

-- ------------------------------------------------------------ from a timetable system (sync engine)

-- A date and time from a file, or null when it isn't one (so one bad row is rejected, not the whole run).
-- Without a zone it is the institution's local time.
create or replace function uniattend._try_ts(p text, tz text)
returns timestamptz language plpgsql stable set search_path = '' as $$
begin
  if p is null or p !~ '^\d{4}-\d{2}-\d{2}[ T]\d{1,2}:\d{2}' then return null; end if;
  if p ~ '(Z|[+-]\d{2}:?\d{2})$' then return p::timestamptz; end if;
  return p::timestamp at time zone tz;
exception when others then
  return null;
end $$;
-- Rows: external_id (required), module_code | module_external_id, starts_at, ends_at (or date + start_time + end_time),
-- venue_code | venue_name, staff_number | lecturer_email, kind, group, status (cancelled).
create or replace function uniattend._sync_apply_events(p_run uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r uniattend.integration_runs; v_inst uuid; v_src text; tz text; kinds text[]; c jsonb;
begin
  select * into r from uniattend.integration_runs where id = p_run;
  v_inst := r.institution_id;
  v_src := coalesce(r.source, case when r.integration_id is not null then 'conn:' || r.integration_id else 'upload' end);
  select coalesce(timezone, 'Africa/Johannesburg') into tz from uniattend.institutions where id = v_inst;
  select coalesce(attendance_kinds, array['lecture','tutorial','practical']) into kinds from uniattend.institution_settings where institution_id = v_inst;
  kinds := coalesce(kinds, array['lecture','tutorial','practical']);

  drop table if exists pg_temp._s;
  create temp table _s on commit drop as
  select id sid, row_no, payload p, nullif(trim(payload->>'external_id'), '') ext,
         nullif(upper(trim(coalesce(payload->>'module_code', ''))), '') mcode, nullif(trim(payload->>'module_external_id'), '') mext,
         coalesce(nullif(trim(payload->>'starts_at'), ''), nullif(trim(concat_ws(' ', payload->>'date', payload->>'start_time')), '')) s_raw,
         coalesce(nullif(trim(payload->>'ends_at'), ''), nullif(trim(concat_ws(' ', payload->>'date', payload->>'end_time')), '')) e_raw,
         nullif(upper(trim(coalesce(payload->>'venue_code', ''))), '') vcode, nullif(trim(payload->>'venue_name'), '') vname,
         nullif(upper(trim(coalesce(payload->>'staff_number', ''))), '') lnum, nullif(lower(trim(coalesce(payload->>'lecturer_email', ''))), '') lemail,
         lower(coalesce(nullif(trim(payload->>'kind'), ''), 'lecture')) kind, nullif(left(trim(coalesce(payload->>'group', payload->>'group_name', '')), 40), '') grp,
         lower(coalesce(nullif(trim(payload->>'status'), ''), 'scheduled')) status,
         null::timestamptz s_at, null::timestamptz e_at, null::uuid mod, null::uuid ven, null::uuid lec,
         null::uuid iid, null::text k, null::text outcome, null::text error
  from uniattend.integration_staging where run_id = p_run and dataset = 'timetable_events';

  -- Times without a zone are the institution's local time.
  update pg_temp._s set s_at = uniattend._try_ts(s_raw, tz), e_at = uniattend._try_ts(e_raw, tz) where error is null;
  update pg_temp._s s set mod = m.internal_id from uniattend.integration_external_ids m
   where s.mext is not null and m.institution_id = v_inst and m.source = v_src and m.entity = 'module' and m.external_id = s.mext;
  update pg_temp._s s set mod = (select m.id from uniattend.modules m where m.institution_id = v_inst and upper(m.code) = s.mcode and m.deleted_at is null
                                 order by (m.academic_period_id is null) desc, m.created_at desc limit 1)
   where s.mod is null and s.mcode is not null;
  update pg_temp._s s set ven = (select v.id from uniattend.venues v where v.institution_id = v_inst and v.deleted_at is null
                                  and ((s.vcode is not null and upper(v.code) = s.vcode) or (s.vcode is null and lower(v.name) = lower(s.vname)))
                                 order by v.created_at limit 1)
   where s.vcode is not null or s.vname is not null;
  update pg_temp._s s set lec = (select l.id from uniattend.lecturers l where l.institution_id = v_inst and l.deleted_at is null
                                  and ((s.lnum is not null and upper(l.staff_number) = s.lnum) or (s.lnum is null and lower(l.email) = s.lemail)) limit 1)
   where s.lnum is not null or s.lemail is not null;
  update pg_temp._s set error = case
      when ext is null then 'external_id is missing (the timetable system''s own event id)'
      when mcode is null and mext is null then 'module_code is missing'
      when mod is null then 'unknown module ' || coalesce(mcode, mext)
      when s_at is null then 'starts_at must be a date and time (YYYY-MM-DD HH:MM)'
      when e_at is null then 'ends_at must be a date and time (YYYY-MM-DD HH:MM)'
      when e_at <= s_at then 'ends_at must be after starts_at'
      when e_at - s_at > interval '8 hours' then 'a class can be at most 8 hours long'
      when kind not in ('lecture','tutorial','practical','test','other') then 'kind must be lecture, tutorial, practical, test or other'
      when status not in ('scheduled','active','confirmed','cancelled','canceled','deleted') then 'unknown status "' || left(status, 30) || '"'
      when (vcode is not null or vname is not null) and ven is null then 'unknown venue ' || coalesce(vcode, vname)
      when (lnum is not null or lemail is not null) and lec is null then 'unknown lecturer ' || coalesce(lnum, lemail) end
   where error is null;
  update pg_temp._s set status = case when status in ('cancelled','canceled','deleted') then 'cancelled' else 'scheduled' end where error is null;
  update pg_temp._s s set iid = e.id from uniattend.timetable_events e
   where s.error is null and e.institution_id = v_inst and e.source = v_src and e.external_id = s.ext;
  update pg_temp._s set k = ext where error is null;
  perform uniattend._sync_dupes();
  -- A class that already has attendance open can't be moved or cancelled from outside.
  update pg_temp._s s set error = 'attendance is open for this class, so it was left unchanged'
   where s.error is null and s.outcome is null and s.iid is not null and exists (
     select 1 from uniattend.timetable_events e join uniattend.class_sessions cs on cs.id = e.session_id
      where e.id = s.iid and cs.status in ('open','scheduled')
        and (e.status <> s.status or e.starts_at <> s.s_at or e.ends_at <> s.e_at or e.venue_id is distinct from coalesce(s.ven, e.venue_id)));
  update pg_temp._s s set outcome = case when s.iid is null then 'insert'
      when exists (select 1 from uniattend.timetable_events e where e.id = s.iid and (e.module_id <> s.mod or e.starts_at <> s.s_at or e.ends_at <> s.e_at
                   or e.venue_id is distinct from s.ven or e.lecturer_id is distinct from s.lec or e.kind <> s.kind
                   or e.group_name is distinct from s.grp or e.status <> s.status)) then 'update' else 'unchanged' end
   where s.error is null and s.outcome is null;
  update uniattend.timetable_events e set module_id = s.mod, starts_at = s.s_at, ends_at = s.e_at, venue_id = s.ven, lecturer_id = s.lec,
         kind = s.kind, group_name = s.grp, status = s.status, updated_at = now(),
         note = case when s.status = 'cancelled' and e.status <> 'cancelled' then 'Cancelled in the timetable system.' else e.note end
    from pg_temp._s s where s.outcome = 'update' and e.id = s.iid;
  with ins as (insert into uniattend.timetable_events (institution_id, module_id, venue_id, lecturer_id, kind, group_name, starts_at, ends_at,
                                                        status, requires_attendance, source, external_id)
               select v_inst, mod, ven, lec, kind, grp, s_at, e_at, status, kind = any(kinds), v_src, ext from pg_temp._s where outcome = 'insert'
               returning id, external_id)
  update pg_temp._s s set iid = ins.id from ins where s.outcome = 'insert' and s.ext = ins.external_id;
  c := uniattend._sync_finish(v_inst, v_src, 'timetable_event', true);
  return case when (c->>'received')::int > 0 then jsonb_build_object('timetable_events', c) else '{}'::jsonb end;
end $$;

-- The engine accepts timetable events too.
alter table uniattend.integration_staging drop constraint if exists integration_staging_dataset_check;
alter table uniattend.integration_staging add constraint integration_staging_dataset_check check (dataset in ('faculties','departments','programmes','academic_periods','venues','modules','lecturers','students','enrolments','assignments','timetable_events'));
alter table uniattend.integration_mappings drop constraint if exists integration_mappings_dataset_check;
alter table uniattend.integration_mappings add constraint integration_mappings_dataset_check check (dataset in ('faculties','departments','programmes','academic_periods','venues','modules','lecturers','students','enrolments','assignments','timetable_events'));

create or replace function uniattend._sync_stage(p_run uuid, p_dataset text, p_rows jsonb, p_first_row int)
returns int language plpgsql security definer set search_path = '' as $$
declare r uniattend.integration_runs; n int; base int;
begin
  select * into r from uniattend.integration_runs where id = p_run;
  if r.status not in ('staging','running') then raise exception 'This import has already finished (%).', r.status using errcode = 'P0001'; end if;
  if p_dataset not in ('faculties','departments','programmes','academic_periods','venues','modules','lecturers','students','enrolments','assignments','timetable_events') then
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
      res := uniattend._sync_apply(p_run) || uniattend._sync_apply_events(p_run);
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

  res := uniattend._sync_apply(p_run) || uniattend._sync_apply_events(p_run);
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

revoke all on function uniattend._event_local(uuid, timestamptz) from public, anon, authenticated;
revoke all on function uniattend._notify_event(uuid, text, text) from public, anon, authenticated;
revoke all on function uniattend._generate_events(uuid, int) from public, anon, authenticated;
revoke all on function uniattend.run_timetable_events() from public, anon, authenticated;
revoke all on function uniattend._may_run_event(uniattend.timetable_events) from public, anon, authenticated;
revoke all on function uniattend._try_ts(text, text) from public, anon, authenticated;
revoke all on function uniattend._sync_apply_events(uuid) from public, anon, authenticated;
revoke all on function uniattend.generate_timetable_events(uuid, int) from public, anon;
revoke all on function uniattend.open_event_session(uuid, int) from public, anon;
revoke all on function uniattend.change_event(uuid, text, uuid, uuid, timestamptz, timestamptz, text) from public, anon;
revoke all on function uniattend.set_attendance_kinds(uuid, text[]) from public, anon;
grant execute on function uniattend.generate_timetable_events(uuid, int) to authenticated;
grant execute on function uniattend.open_event_session(uuid, int) to authenticated;
grant execute on function uniattend.change_event(uuid, text, uuid, uuid, timestamptz, timestamptz, text) to authenticated;
grant execute on function uniattend.set_attendance_kinds(uuid, text[]) to authenticated;

-- Nightly at 01:00 South African time, where pg_cron is installed.
do $$
begin
  if to_regnamespace('cron') is null then return; end if;
  if exists (select 1 from cron.job where jobname = 'uniattend-classes') then perform cron.unschedule('uniattend-classes'); end if;
  perform cron.schedule('uniattend-classes', '0 23 * * *', 'select uniattend.run_timetable_events()');
end $$;
