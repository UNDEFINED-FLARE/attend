-- 0013 — campus location sharing and class navigation (2026-11-10)
--
-- Location is personal information under POPIA. The design keeps it minimal:
--   * Off until the institution enables it AND the student gives consent.
--   * Only the LATEST position is kept: one row per student, no history.
--   * The row is deleted as soon as the student is off campus (unless they
--     turned on safety sharing themselves), stops sharing, or withdraws consent.
--     Positions not refreshed for 12 hours are purged.
--   * Only the student and their own institution's admins can read it.
--   * Nobody writes the table directly; report_location() decides on/off campus
--     on the server, so a modified app cannot keep sharing off campus silently.

-- ------------------------------------------------------------ schema

-- Campus outlines already exist (campuses.outline, migration 0009); report_location uses them.

alter table uniattend.institution_settings
  add column location_sharing_enabled boolean not null default false,
  add column location_interval_s      int not null default 60 check (location_interval_s between 15 and 900);

create table uniattend.location_consents (
  institution_id uuid not null references uniattend.institutions(id) on delete cascade,
  user_id        uuid not null references auth.users(id) on delete cascade,
  notice_version text not null,
  granted_at     timestamptz not null default now(),
  withdrawn_at   timestamptz,
  primary key (institution_id, user_id)
);

create table uniattend.live_locations (
  institution_id uuid not null references uniattend.institutions(id) on delete cascade,
  user_id        uuid not null references auth.users(id) on delete cascade,
  lat            double precision not null check (lat between -90 and 90),
  lng            double precision not null check (lng between -180 and 180),
  accuracy_m     real not null check (accuracy_m > 0 and accuracy_m <= 5000),
  on_campus      boolean not null,
  campus_id      uuid,
  mode           text not null check (mode in ('campus','safety')),
  updated_at     timestamptz not null default now(),
  primary key (institution_id, user_id),
  foreign key (institution_id, campus_id) references uniattend.campuses(institution_id, id) on delete set null (campus_id)
);
create index live_locations_fresh on uniattend.live_locations (institution_id, updated_at);

-- ------------------------------------------------------------ access

alter table uniattend.location_consents enable row level security;
alter table uniattend.live_locations enable row level security;

create policy location_consents_select on uniattend.location_consents for select to authenticated
  using (user_id = (select auth.uid()) or uniattend.is_inst_admin(institution_id));
create policy live_locations_select on uniattend.live_locations for select to authenticated
  using (user_id = (select auth.uid()) or uniattend.is_inst_admin(institution_id));
-- No insert/update/delete policies: all writes go through the functions below.

-- The uniattend schema gives anon/authenticated full table privileges by default
-- (0001). For location data take them back: users may only READ (RLS above
-- narrows to own row / own institution), anon gets nothing, and every write goes
-- through the functions below.
revoke insert, update, delete, truncate on uniattend.location_consents, uniattend.live_locations from anon, authenticated;
revoke select on uniattend.location_consents, uniattend.live_locations from anon;

-- ------------------------------------------------------------ functions

create or replace function uniattend.set_location_consent(p_inst uuid, p_give boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if not uniattend.has_role(p_inst, array['student']) then raise exception 'students only' using errcode = '42501'; end if;
  if p_give then
    insert into uniattend.location_consents (institution_id, user_id, notice_version)
    values (p_inst, uid, 'campus-location-v1')
    on conflict (institution_id, user_id) do update
      set notice_version = excluded.notice_version, granted_at = now(), withdrawn_at = null;
  else
    update uniattend.location_consents set withdrawn_at = now() where institution_id = p_inst and user_id = uid;
    delete from uniattend.live_locations where institution_id = p_inst and user_id = uid;
  end if;
end $$;

-- Called by the student's phone every location_interval_s seconds while sharing.
create or replace function uniattend.report_location(
  p_inst uuid, p_lat float8, p_lng float8, p_accuracy float8, p_safety boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  c record; d float8; best float8;
  v_campus uuid; v_name text; inside boolean := false;
  v_mode text;
begin
  if uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if not uniattend.has_role(p_inst, array['student']) then raise exception 'students only' using errcode = '42501'; end if;

  if not exists (select 1 from uniattend.institution_settings s
                 where s.institution_id = p_inst and s.location_sharing_enabled) then
    delete from uniattend.live_locations where institution_id = p_inst and user_id = uid;
    return jsonb_build_object('stored', false, 'reason', 'disabled');
  end if;
  if not exists (select 1 from uniattend.location_consents k
                 where k.institution_id = p_inst and k.user_id = uid and k.withdrawn_at is null) then
    raise exception 'Agree to campus location sharing first.' using errcode = '42501';
  end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180
     or p_accuracy is null or p_accuracy <= 0 or p_accuracy > 5000 then
    raise exception 'That location reading is not valid.';
  end if;

  -- On campus = inside any campus boundary (signed distance <= 0).
  for c in select cp.id, cp.name, cp.outline from uniattend.campuses cp
           where cp.institution_id = p_inst and cp.deleted_at is null and cp.outline is not null loop
    d := uniattend.polygon_signed_distance_m(p_lat, p_lng, c.outline);
    if d <= 0 and (best is null or d < best) then
      best := d; v_campus := c.id; v_name := c.name; inside := true;
    end if;
  end loop;

  -- Housekeeping: a position nobody refreshed for 12 hours is gone.
  delete from uniattend.live_locations where institution_id = p_inst and updated_at < now() - interval '12 hours';

  if not inside and not coalesce(p_safety, false) then
    delete from uniattend.live_locations where institution_id = p_inst and user_id = uid;
    return jsonb_build_object('stored', false, 'on_campus', false, 'reason', 'off_campus');
  end if;

  v_mode := case when inside then 'campus' else 'safety' end;
  insert into uniattend.live_locations as l (institution_id, user_id, lat, lng, accuracy_m, on_campus, campus_id, mode, updated_at)
  values (p_inst, uid, p_lat, p_lng, p_accuracy, inside, v_campus, v_mode, now())
  on conflict (institution_id, user_id) do update
    set lat = excluded.lat, lng = excluded.lng, accuracy_m = excluded.accuracy_m, on_campus = excluded.on_campus,
        campus_id = excluded.campus_id, mode = excluded.mode, updated_at = excluded.updated_at;
  return jsonb_build_object('stored', true, 'on_campus', inside, 'campus', v_name, 'mode', v_mode);
end $$;

create or replace function uniattend.stop_location_sharing(p_inst uuid)
returns void language sql security definer set search_path = '' as $$
  delete from uniattend.live_locations where institution_id = p_inst and user_id = auth.uid();
$$;

-- Admin live map. SECURITY INVOKER: RLS on live_locations and students applies,
-- so an admin sees their institution and a student sees only themselves.
create or replace function uniattend.campus_live_locations(p_inst uuid)
returns table (user_id uuid, full_name text, student_number text, lat float8, lng float8, accuracy_m real,
               on_campus boolean, campus_name text, mode text, updated_at timestamptz)
language sql stable security invoker set search_path = '' as $$
  select l.user_id, coalesce(nullif(st.full_name, ''), p.full_name), st.student_number,
         l.lat, l.lng, l.accuracy_m, l.on_campus, c.name, l.mode, l.updated_at
  from uniattend.live_locations l
  left join uniattend.students st on st.institution_id = l.institution_id and st.user_id = l.user_id and st.deleted_at is null
  left join uniattend.profiles p on p.id = l.user_id
  left join uniattend.campuses c on c.id = l.campus_id
  where l.institution_id = p_inst and l.updated_at > now() - interval '12 hours'
  order by l.updated_at desc;
$$;

-- A student's upcoming classes with the venue location, for navigation.
-- Timetables store a weekday + local time; the institution's timezone turns
-- that into real timestamps. SECURITY INVOKER: only the student's own enrolments.
create or replace function uniattend.my_next_classes(p_inst uuid, p_limit int default 5)
returns table (module_code text, module_title text, venue_id uuid, venue_name text, venue_code text,
               lat float8, lng float8, radius_m int, starts_at timestamptz, ends_at timestamptz)
language sql stable security invoker set search_path = '' as $$
  with tz as (
    select coalesce((select i.timezone from uniattend.institutions i where i.id = p_inst), 'Africa/Johannesburg') as zone
  ), clock as (
    select (now() at time zone (select zone from tz)) as local_now
  ), me as (
    select s.id from uniattend.students s
    where s.institution_id = p_inst and s.user_id = auth.uid() and s.deleted_at is null
  ), slots as (
    select t.module_id, t.venue_id, t.starts_at as t_start, t.ends_at as t_end,
           (select local_now from clock)::date
             + ((t.weekday - extract(isodow from (select local_now from clock))::int + 7) % 7) as day
    from uniattend.timetables t
    join uniattend.module_enrolments e
      on e.institution_id = t.institution_id and e.module_id = t.module_id and e.status = 'active'
    where t.institution_id = p_inst and e.student_id in (select id from me)
  ), occurrences as (
    -- a class that already ended today moves to the same weekday next week
    select sl.*, case when sl.day = (select local_now from clock)::date
                       and sl.t_end < (select local_now from clock)::time
                      then sl.day + 7 else sl.day end as on_day
    from slots sl
  )
  select m.code, m.title, v.id, v.name, v.code, v.lat, v.lng, v.radius_m,
         ((o.on_day + o.t_start) at time zone (select zone from tz)),
         ((o.on_day + o.t_end) at time zone (select zone from tz))
  from occurrences o
  join uniattend.modules m on m.id = o.module_id
  left join uniattend.venues v on v.id = o.venue_id and v.deleted_at is null
  order by 9
  limit greatest(1, least(coalesce(p_limit, 5), 20));
$$;

-- New functions are executable by PUBLIC by default (see 0005's note). Lock them
-- down, then allow signed-in users; each function checks role/consent itself.
do $$
declare fn text;
begin
  foreach fn in array array[
    'set_location_consent(uuid,boolean)', 'report_location(uuid,float8,float8,float8,boolean)',
    'stop_location_sharing(uuid)', 'campus_live_locations(uuid)', 'my_next_classes(uuid,int)']
  loop
    execute format('revoke all on function uniattend.%s from public, anon', fn);
    execute format('grant execute on function uniattend.%s to authenticated', fn);
  end loop;
end $$;
