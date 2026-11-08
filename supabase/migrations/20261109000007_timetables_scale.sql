-- UniAttend 0007 — timetables, venue clash protection, and scale.
--
-- * Timetable slots get a kind (lecture/tutorial/...) and an optional group.
-- * A venue cannot be double-booked: overlapping slots in the same venue on
--   the same weekday are rejected with a message naming the clash.
-- * Indexes for the queries dashboards run at large-institution volume.
-- * institution_dashboard(): every dashboard figure computed in one SQL call,
--   instead of shipping thousands of rows to the web server.

alter table uniattend.timetables
  add column if not exists kind text not null default 'lecture'
    check (kind in ('lecture','tutorial','practical','test','other')),
  add column if not exists group_name text check (group_name is null or length(group_name) <= 40),
  add column if not exists created_by uuid references auth.users(id) on delete set null;

create index if not exists timetables_inst_day   on uniattend.timetables(institution_id, weekday, starts_at);
create index if not exists timetables_venue_day  on uniattend.timetables(venue_id, weekday);
create index if not exists timetables_module     on uniattend.timetables(module_id);
create index if not exists attendance_records_inst_created on uniattend.attendance_records(institution_id, created_at desc);
create index if not exists verification_events_inst_created on uniattend.attendance_verification_events(institution_id, created_at desc);
create index if not exists class_sessions_inst_status on uniattend.class_sessions(institution_id, status, opens_at desc);
create index if not exists module_enrolments_module on uniattend.module_enrolments(module_id) where status = 'active';

create or replace function uniattend.timetable_no_clash()
returns trigger language plpgsql security definer set search_path = '' as $$
declare c record;
begin
  if new.venue_id is null then return new; end if;
  select t.starts_at, t.ends_at, m.code into c
    from uniattend.timetables t join uniattend.modules m on m.id = t.module_id
   where t.venue_id = new.venue_id and t.weekday = new.weekday and t.id <> new.id
     and t.starts_at < new.ends_at and new.starts_at < t.ends_at
   limit 1;
  if found then
    raise exception 'That venue is already booked on % from % to % for %.',
      (array['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'])[new.weekday],
      to_char(c.starts_at, 'HH24:MI'), to_char(c.ends_at, 'HH24:MI'), c.code
      using errcode = '23P01';
  end if;
  return new;
end $$;

drop trigger if exists timetables_no_clash on uniattend.timetables;
create trigger timetables_no_clash before insert or update on uniattend.timetables
  for each row execute function uniattend.timetable_no_clash();

create or replace function uniattend.institution_dashboard(p_inst uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare tz text; today timestamptz; res jsonb;
begin
  if not uniattend.is_inst_admin(p_inst) then
    raise exception 'institution admin only' using errcode = '42501';
  end if;
  select coalesce(timezone, 'Africa/Johannesburg') into tz from uniattend.institutions where id = p_inst;
  today := date_trunc('day', now() at time zone tz) at time zone tz;

  with r as (
    select status, created_at, checked_in_at, module_id
    from uniattend.attendance_records
    where institution_id = p_inst and created_at >= today - interval '29 days'
  ),
  ev as (
    select layers->'gps' as g
    from uniattend.attendance_verification_events
    where institution_id = p_inst and created_at >= today - interval '29 days' and outcome <> 'duplicate'
  )
  select jsonb_build_object(
    'today', (select jsonb_build_object(
        'present', count(*) filter (where status = 'present'),
        'late',    count(*) filter (where status = 'late'),
        'absent',  count(*) filter (where status = 'absent'),
        'pending', count(*) filter (where status = 'pending_verification'),
        'rate', round(100.0 * count(*) filter (where status in ('present','late'))
                      / nullif(count(*) filter (where status in ('present','late','absent')), 0), 1))
      from r where created_at >= today),
    'yesterday_rate', (select round(100.0 * count(*) filter (where status in ('present','late'))
                      / nullif(count(*) filter (where status in ('present','late','absent')), 0), 1)
      from r where created_at >= today - interval '1 day' and created_at < today),
    'hourly', coalesce((select jsonb_agg(jsonb_build_object('h', h, 'status', status, 'n', n)) from (
        select extract(hour from checked_in_at at time zone tz)::int as h, status, count(*) as n
        from r where created_at >= today and checked_in_at is not null group by 1, 2) q), '[]'::jsonb),
    'daily', (select jsonb_agg(jsonb_build_object('day', to_char(d at time zone tz, 'YYYY-MM-DD'), 'rate', x.rate) order by d)
      from generate_series(today - interval '13 days', today, interval '1 day') d
      left join lateral (
        select round(100.0 * count(*) filter (where status in ('present','late'))
                     / nullif(count(*) filter (where status in ('present','late','absent')), 0), 1) as rate
        from r where created_at >= d and created_at < d + interval '1 day') x on true),
    'departments', coalesce((select jsonb_agg(row_to_json(q) order by q.rate nulls first) from (
        select coalesce(dp.name, 'No department') as name,
               count(*) filter (where r.status = 'present') as present,
               count(*) filter (where r.status = 'late') as late,
               count(*) filter (where r.status = 'absent') as absent,
               round(100.0 * count(*) filter (where r.status in ('present','late'))
                     / nullif(count(*) filter (where r.status in ('present','late','absent')), 0), 1) as rate
        from r join uniattend.modules m on m.id = r.module_id
        left join uniattend.departments dp on dp.id = m.department_id
        group by 1) q), '[]'::jsonb),
    'gps', (select jsonb_build_object(
        'inside',  count(*) filter (where (g->>'p_inside')::numeric >= 0.5),
        'outside', count(*) filter (where (g->>'p_inside')::numeric < 0.5),
        'no_location', count(*) filter (where g->>'p_inside' is null))
      from ev where g is not null and coalesce(g->>'required', 'true') <> 'false'),
    'recent', coalesce((select jsonb_agg(row_to_json(q)) from (
        select ar.status, ar.method, ar.checked_in_at, s.full_name, s.student_number, m.code
        from uniattend.attendance_records ar
        join uniattend.students s on s.id = ar.student_id
        join uniattend.modules m on m.id = ar.module_id
        where ar.institution_id = p_inst and ar.checked_in_at is not null
        order by ar.checked_in_at desc limit 6) q), '[]'::jsonb),
    'timezone', tz
  ) into res;
  return res;
end $$;

revoke all on function uniattend.timetable_no_clash() from public, anon;
revoke all on function uniattend.institution_dashboard(uuid) from public, anon;
grant execute on function uniattend.institution_dashboard(uuid) to authenticated;
