-- UniAttend 0018 — targeted announcements and lecturer messages to a class.
--
-- * Announcements can target everyone, one faculty, one department, one module,
--   one student or one lecturer, and carry a category (general, academic, system,
--   class cancelled, venue change, class reminder, timetable change).
-- * Lecturers message the students of a module they teach (send_class_message),
--   rate-limited; admins target anything in their institution.
-- * Recipients get a notification (and a push, following their device settings:
--   class updates follow "class reminders", others "announcements").
-- * Announcements aimed at a group or a person are no longer readable by every
--   member of the institution; only staff who manage them see the table.

alter table uniattend.announcements
  add column if not exists target_kind text not null default 'all'
    check (target_kind in ('all','faculty','department','module','student','lecturer')),
  add column if not exists target_id uuid,
  add column if not exists category text not null default 'announcement'
    check (category in ('announcement','academic','system','class_cancelled','venue_change','class_reminder','timetable_change')),
  add column if not exists sender_name text;
alter table uniattend.announcements drop constraint if exists announcements_target_check;
alter table uniattend.announcements add constraint announcements_target_check
  check ((target_kind = 'all') = (target_id is null));
create index if not exists announcements_target on uniattend.announcements(institution_id, target_kind, target_id);

-- Only general announcements to everyone are readable by all members; targeted ones
-- reach people through their own notifications.
drop policy if exists announcements_select on uniattend.announcements;
create policy announcements_select on uniattend.announcements for select to authenticated
  using (uniattend.is_super_admin()
         or (institution_id is not null and uniattend.is_inst_admin(institution_id))
         or (target_kind = 'all' and published_at <= now() and (expires_at is null or expires_at > now())
             and (institution_id is null or uniattend.is_member(institution_id))));

-- Who an announcement reaches.
create or replace function uniattend.announcement_recipients(a uniattend.announcements)
returns table (user_id uuid, institution_id uuid)
language sql stable security definer set search_path = '' as $$
  -- everyone (optionally by role)
  select r.user_id, coalesce(a.institution_id, r.institution_id)
  from uniattend.user_roles r
  where a.target_kind = 'all' and r.status = 'active'
    and (a.institution_id is null or r.institution_id = a.institution_id)
    and case a.audience when 'students' then r.role = 'student' when 'lecturers' then r.role = 'lecturer'
                        when 'admins' then r.role in ('institution_admin','super_admin') else true end
  union
  -- students of the targeted module / department / faculty
  select s.user_id, s.institution_id
  from uniattend.students s
  join uniattend.module_enrolments e on e.student_id = s.id and e.status = 'active'
  join uniattend.modules m on m.id = e.module_id and m.deleted_at is null
  left join uniattend.departments d on d.id = m.department_id
  where a.target_kind in ('module','department','faculty') and a.audience in ('all','students')
    and s.institution_id = a.institution_id and s.user_id is not null and s.status = 'active' and s.deleted_at is null
    and case a.target_kind when 'module' then m.id = a.target_id
                           when 'department' then m.department_id = a.target_id
                           else d.faculty_id = a.target_id end
  union
  -- lecturers teaching in the targeted module / department / faculty
  select l.user_id, l.institution_id
  from uniattend.lecturers l
  left join uniattend.lecturer_assignments la on la.lecturer_id = l.id
  left join uniattend.modules m on m.id = la.module_id and m.deleted_at is null
  left join uniattend.departments dl on dl.id = l.department_id
  left join uniattend.departments dm on dm.id = m.department_id
  where a.target_kind in ('module','department','faculty') and a.audience in ('all','lecturers')
    and l.institution_id = a.institution_id and l.user_id is not null and l.status = 'active' and l.deleted_at is null
    and case a.target_kind when 'module' then m.id = a.target_id
                           when 'department' then (m.department_id = a.target_id or l.department_id = a.target_id)
                           else (dm.faculty_id = a.target_id or dl.faculty_id = a.target_id) end
  union
  select s.user_id, s.institution_id from uniattend.students s
  where a.target_kind = 'student' and s.id = a.target_id and s.institution_id = a.institution_id and s.user_id is not null
  union
  select l.user_id, l.institution_id from uniattend.lecturers l
  where a.target_kind = 'lecturer' and l.id = a.target_id and l.institution_id = a.institution_id and l.user_id is not null;
$$;

create or replace function uniattend.fan_out_announcement()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_kind text; v_title text;
begin
  if new.published_at > now() + interval '1 minute' then return new; end if;  -- scheduled ones are not supported yet
  -- The target must belong to the announcement's institution.
  if new.target_kind <> 'all' and not exists (
       select 1 from uniattend.faculties where new.target_kind = 'faculty' and id = new.target_id and institution_id = new.institution_id
       union all select 1 from uniattend.departments where new.target_kind = 'department' and id = new.target_id and institution_id = new.institution_id
       union all select 1 from uniattend.modules where new.target_kind = 'module' and id = new.target_id and institution_id = new.institution_id
       union all select 1 from uniattend.students where new.target_kind = 'student' and id = new.target_id and institution_id = new.institution_id
       union all select 1 from uniattend.lecturers where new.target_kind = 'lecturer' and id = new.target_id and institution_id = new.institution_id) then
    raise exception 'That recipient is not part of this institution.' using errcode = '42501';
  end if;
  v_kind := case when new.category in ('class_cancelled','venue_change','class_reminder','timetable_change') then 'class_update' else 'announcement' end;
  v_title := case new.category
               when 'class_cancelled' then 'Class cancelled: ' when 'venue_change' then 'Venue change: '
               when 'timetable_change' then 'Timetable change: ' when 'class_reminder' then 'Reminder: '
               when 'academic' then 'Academic: ' when 'system' then 'System: ' else '' end || new.title;
  insert into uniattend.notifications (institution_id, user_id, kind, title, body, link, dedupe_key)
  select distinct on (x.user_id) x.institution_id, x.user_id, v_kind, left(v_title, 200),
         left(new.body, 500) || coalesce(E'\n— ' || new.sender_name, ''), '/notifications', 'ann:' || new.id || ':' || x.user_id
  from uniattend.announcement_recipients(new) x
  where x.user_id is not null
  on conflict (dedupe_key) where dedupe_key is not null do nothing;
  return new;
end $$;

-- A lecturer's message to the students of one of their modules.
create or replace function uniattend.send_class_message(p_module uuid, p_category text, p_title text, p_body text)
returns int language plpgsql security definer set search_path = '' as $$
declare m uniattend.modules; v_id uuid; v_name text; n int;
begin
  select * into m from uniattend.modules where id = p_module and deleted_at is null;
  if m is null or not (uniattend.teaches_module(m.id) or uniattend.is_inst_admin(m.institution_id)) then
    raise exception 'only the module''s lecturers can message its students' using errcode = '42501';
  end if;
  if p_category not in ('announcement','class_cancelled','venue_change','class_reminder','timetable_change') then
    raise exception 'unknown message type';
  end if;
  if length(trim(coalesce(p_title, ''))) < 3 or length(trim(coalesce(p_body, ''))) < 3 then
    raise exception 'Write a title and a message.' using errcode = 'P0001';
  end if;
  if (select count(*) from uniattend.announcements where created_by = auth.uid() and created_at > now() - interval '1 hour') >= 20 then
    raise exception 'You have sent 20 messages in the last hour. Wait a little before sending more.' using errcode = 'P0001';
  end if;
  select coalesce(nullif(l.full_name, ''), 'Your lecturer') into v_name from uniattend.lecturers l
   where l.institution_id = m.institution_id and l.user_id = auth.uid();
  insert into uniattend.announcements (institution_id, title, body, audience, target_kind, target_id, category, sender_name, created_by)
  values (m.institution_id, m.code || ' · ' || left(trim(p_title), 150), left(trim(p_body), 2000), 'students', 'module', m.id,
          p_category, coalesce(v_name, 'Your lecturer'), auth.uid())
  returning id into v_id;
  select count(*) into n from uniattend.notifications where dedupe_key like 'ann:' || v_id || ':%';
  perform uniattend.write_audit(m.institution_id, 'class_message', 'modules', m.id::text, jsonb_build_object('category', p_category, 'recipients', n));
  return n;
end $$;

create or replace function uniattend.push_claim(p_secret text, p_limit int default 500)
returns table (notification_id uuid, kind text, title text, body text, link text, created_at timestamptz,
               institution_name text, logo_url text, endpoint text, p256dh text, auth text)
language plpgsql security definer set search_path = '' as $$
declare v_minutes int; v_ids uuid[];
begin
  if not uniattend.push_secret_ok(p_secret) then raise exception 'not allowed' using errcode = '42501'; end if;
  select reminder_minutes into v_minutes from uniattend.push_config where id = 1;
  perform uniattend.queue_class_reminders(v_minutes);

  update uniattend.notifications n set pushed_at = now()
   where n.pushed_at is null and n.created_at < now() - interval '1 hour';

  with picked as (
    select n.id from uniattend.notifications n
    where n.pushed_at is null
    order by n.created_at
    limit least(greatest(coalesce(p_limit, 500), 1), 2000)
    for update skip locked),
  claimed as (
    update uniattend.notifications n set pushed_at = now()
      from picked where n.id = picked.id
    returning n.id)
  select coalesce(array_agg(id), '{}') into v_ids from claimed;

  return query
  select n.id, n.kind, n.title, n.body, n.link, n.created_at,
         coalesce(nullif(i.theme->'header'->>'title', ''), i.name),
         nullif(i.theme->'header'->>'logoUrl', ''),
         ps.endpoint, ps.p256dh, ps.auth
  from uniattend.notifications n
  join uniattend.push_subscriptions ps on ps.user_id = n.user_id
  left join uniattend.institutions i on i.id = n.institution_id
  where n.id = any(v_ids)
    and coalesce((ps.prefs->>(case when n.kind in ('class_reminder', 'class_update') then 'classes'
                                   when n.kind = 'announcement' then 'announcements'
                                   else 'attendance' end))::boolean, true);
end $$;

revoke all on function uniattend.announcement_recipients(uniattend.announcements) from public, anon, authenticated;
revoke all on function uniattend.send_class_message(uuid, text, text, text) from public, anon;
grant execute on function uniattend.send_class_message(uuid, text, text, text) to authenticated;
