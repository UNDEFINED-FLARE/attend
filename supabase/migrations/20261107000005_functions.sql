-- UniAttend 0005 — server-side business logic.
--
-- Rule: no function accepts a user id, role, institution id-as-authority, or a
-- desired attendance status from a student. Identity comes from auth.uid();
-- institution comes from the row being acted on; status is computed here.

-- ================================================================ audit

create or replace function uniattend.write_audit(p_inst uuid, p_action text, p_entity text,
                                              p_entity_id text, p_details jsonb default '{}')
returns void language sql security definer set search_path = '' as $$
  insert into uniattend.audit_logs (institution_id, actor_id, action, entity, entity_id, details)
  values (p_inst, auth.uid(), p_action, p_entity, p_entity_id, coalesce(p_details, '{}'::jsonb));
$$;

create or replace function uniattend.audit_trigger()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  r jsonb := to_jsonb(coalesce(new, old));
  o jsonb := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end;
  d jsonb := '{}'::jsonb;
  inst uuid;
begin
  inst := coalesce((r->>'institution_id')::uuid,
                   case when tg_table_name = 'institutions' then (r->>'id')::uuid end);
  if tg_table_name = 'attendance_records' then
    d := jsonb_build_object('from', o->>'status', 'to', r->>'status', 'note', r->>'override_note');
  elsif tg_table_name = 'user_roles' then
    d := jsonb_build_object('user_id', r->>'user_id', 'role', r->>'role', 'status', r->>'status');
  elsif tg_table_name in ('institutions','institution_subscriptions') then
    d := jsonb_build_object('from', o->>'status', 'to', r->>'status');
  end if;
  insert into uniattend.audit_logs (institution_id, actor_id, action, entity, entity_id, details)
  values (inst, auth.uid(), lower(tg_op), tg_table_name, coalesce(r->>'id', r->>'institution_id'), d);
  return coalesce(new, old);
end $$;

create trigger audit_user_roles after insert or update or delete on uniattend.user_roles
  for each row execute function uniattend.audit_trigger();
create trigger audit_institutions after update on uniattend.institutions
  for each row when (old.status is distinct from new.status) execute function uniattend.audit_trigger();
create trigger audit_subscriptions after insert or update on uniattend.institution_subscriptions
  for each row execute function uniattend.audit_trigger();
create trigger audit_settings after update on uniattend.institution_settings
  for each row execute function uniattend.audit_trigger();
create trigger audit_attendance after update on uniattend.attendance_records
  for each row when (old.status is distinct from new.status) execute function uniattend.audit_trigger();
create trigger audit_students after delete on uniattend.students
  for each row execute function uniattend.audit_trigger();

-- Institution admins may edit name and branding, never status or slug.
create or replace function uniattend.guard_institution_update()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not uniattend.is_super_admin() and auth.uid() is not null then
    if new.status is distinct from old.status or new.slug is distinct from old.slug
       or new.created_by is distinct from old.created_by then
      raise exception 'only the platform administrator can change status or slug' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger institutions_guard before update on uniattend.institutions
  for each row execute function uniattend.guard_institution_update();

-- ======================================================= subscriptions

create or replace function uniattend.live_plan(p_inst uuid)
returns table (plan uniattend.subscription_plans, sub_status text, period_end timestamptz)
language sql stable security definer set search_path = '' as $$
  select p, s.status, s.current_period_end
  from uniattend.institution_subscriptions s
  join uniattend.subscription_plans p on p.id = s.plan_id
  where s.institution_id = p_inst and s.status in ('trialing','active','past_due','suspended')
  limit 1;
$$;

create or replace function uniattend.institution_can_operate(p_inst uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from uniattend.institutions i where i.id = p_inst and i.status = 'active' and i.deleted_at is null)
     and exists (select 1 from uniattend.live_plan(p_inst) lp
                 where lp.sub_status in ('active','past_due')
                    or (lp.sub_status = 'trialing' and lp.period_end > now()));
$$;

create or replace function uniattend.plan_feature(p_inst uuid, p_feature text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select ((lp.plan).features ->> p_feature)::boolean from uniattend.live_plan(p_inst) lp), false);
$$;

-- Statement-level, so a 5,000-row import costs one count, not 5,000.
create or replace function uniattend.enforce_plan_limits()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  inst uuid; lim int; n int; col text;
begin
  col := case tg_table_name when 'students' then 'max_students'
                            when 'lecturers' then 'max_lecturers'
                            else 'max_modules' end;
  for inst in select distinct institution_id from inserted loop
    select case col when 'max_students' then (lp.plan).max_students
                    when 'max_lecturers' then (lp.plan).max_lecturers
                    else (lp.plan).max_modules end
      into lim from uniattend.live_plan(inst) lp;
    if not found then
      raise exception 'institution has no active subscription' using errcode = 'P0001';
    end if;
    if lim is not null then
      execute format('select count(*) from uniattend.%I where institution_id = $1 and deleted_at is null', tg_table_name)
        into n using inst;
      if n > lim then
        raise exception 'plan limit reached: % allows % %', col, lim, tg_table_name
          using errcode = 'P0001', hint = 'Upgrade the subscription plan to add more.';
      end if;
    end if;
  end loop;
  return null;
end $$;

create trigger students_plan_limit after insert on uniattend.students
  referencing new table as inserted for each statement execute function uniattend.enforce_plan_limits();
create trigger lecturers_plan_limit after insert on uniattend.lecturers
  referencing new table as inserted for each statement execute function uniattend.enforce_plan_limits();
create trigger modules_plan_limit after insert on uniattend.modules
  referencing new table as inserted for each statement execute function uniattend.enforce_plan_limits();

-- ====================================================== accounts & roles

create or replace function uniattend.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- auth.users is shared with other apps in this project, so only accounts
  -- created through UniAttend's signup (metadata app = 'uniattend') get a
  -- profile here. Anyone else gets one on first use via ensure_profile().
  -- A profile is all a new account gets: roles are granted, never claimed.
  if new.raw_user_meta_data->>'app' = 'uniattend' then
    insert into uniattend.profiles (id, full_name, email)
    values (new.id, left(coalesce(new.raw_user_meta_data->>'full_name', ''), 200), new.email)
    on conflict (id) do nothing;
  end if;
  return new;
end $$;

create or replace function uniattend.ensure_profile()
returns void language sql security definer set search_path = '' as $$
  insert into uniattend.profiles (id, full_name, email)
  select u.id, left(coalesce(u.raw_user_meta_data->>'full_name', ''), 200), u.email
  from auth.users u where u.id = auth.uid()
  on conflict (id) do nothing;
$$;

create trigger uniattend_on_auth_user_created after insert on auth.users
  for each row execute function uniattend.handle_new_user();

-- Links the signed-in user to student/lecturer rows an administrator already
-- created, and grants the matching role. Only for a CONFIRMED email, and only
-- when either the email matches exactly, or the email is on a verified
-- institution domain and its local part is the student number
-- (e.g. 21001234@mvula.univen.ac.za).
create or replace function uniattend.link_my_accounts()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  em text; confirmed timestamptz; localpart text; v_domain text;
  n_students int := 0; n_lecturers int := 0;
begin
  if uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  perform uniattend.ensure_profile();
  select lower(u.email), u.email_confirmed_at into em, confirmed from auth.users u where u.id = uid;
  if em is null or confirmed is null then
    return jsonb_build_object('linked', false, 'reason', 'Confirm your email address first.');
  end if;
  localpart := split_part(em, '@', 1);
  v_domain := split_part(em, '@', 2);

  with c as (
    update uniattend.students s set user_id = uid
    where s.user_id is null and s.deleted_at is null and s.status = 'active'
      and (lower(s.email) = em
           or (lower(s.student_number) = localpart and exists (
                 select 1 from uniattend.institution_domains d
                 where d.institution_id = s.institution_id and d.domain = v_domain and d.verified_at is not null)))
      and not exists (select 1 from uniattend.students s2 where s2.institution_id = s.institution_id and s2.user_id = uid)
    returning s.institution_id)
  insert into uniattend.user_roles (user_id, institution_id, role)
  select uid, institution_id, 'student' from c
  on conflict (user_id, institution_id, role) do nothing;
  get diagnostics n_students = row_count;

  with c as (
    update uniattend.lecturers l set user_id = uid
    where l.user_id is null and l.deleted_at is null and l.status = 'active' and lower(l.email) = em
      and not exists (select 1 from uniattend.lecturers l2 where l2.institution_id = l.institution_id and l2.user_id = uid)
    returning l.institution_id)
  insert into uniattend.user_roles (user_id, institution_id, role)
  select uid, institution_id, 'lecturer' from c
  on conflict (user_id, institution_id, role) do nothing;
  get diagnostics n_lecturers = row_count;

  return jsonb_build_object('linked', true, 'students', n_students, 'lecturers', n_lecturers);
end $$;

create or replace function uniattend.my_roles()
returns table (institution_id uuid, institution_name text, institution_slug text,
               institution_status text, brand_primary text, role text)
language sql stable security definer set search_path = '' as $$
  select r.institution_id, i.name, i.slug, i.status, i.brand_primary, r.role
  from uniattend.user_roles r left join uniattend.institutions i on i.id = r.institution_id
  where r.user_id = auth.uid() and r.status = 'active'
    and (i.id is null or i.deleted_at is null)
  order by case r.role when 'super_admin' then 0 when 'institution_admin' then 1
                       when 'lecturer' then 2 else 3 end, i.name;
$$;

create or replace function uniattend.request_institution(p_name text, p_slug text, p_contact_email text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); inst uuid; starter uuid;
begin
  if uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  perform uniattend.ensure_profile();
  if (select count(*) from uniattend.institutions where created_by = uid and status = 'pending') >= 2 then
    raise exception 'you already have applications awaiting approval';
  end if;
  insert into uniattend.institutions (name, slug, contact_email, created_by)
  values (trim(p_name), lower(trim(p_slug)), nullif(trim(p_contact_email), ''), uid)
  returning id into inst;
  insert into uniattend.institution_settings (institution_id) values (inst);
  insert into uniattend.user_roles (user_id, institution_id, role, granted_by)
  values (uid, inst, 'institution_admin', uid);
  select id into starter from uniattend.subscription_plans where code = 'starter';
  insert into uniattend.institution_subscriptions (institution_id, plan_id, status, current_period_end)
  values (inst, starter, 'trialing', now() + interval '30 days');
  return inst;
end $$;

create or replace function uniattend.set_institution_status(p_inst uuid, p_status text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not uniattend.is_super_admin() then raise exception 'super admin only' using errcode = '42501'; end if;
  if p_status not in ('pending','active','suspended','archived') then raise exception 'bad status'; end if;
  update uniattend.institutions set status = p_status where id = p_inst;
  if not found then raise exception 'no such institution'; end if;
  insert into uniattend.notifications (institution_id, user_id, kind, title, body, link)
  select p_inst, r.user_id, 'institution_status', 'Institution ' || p_status,
         'Your institution is now ' || p_status || '.', '/admin'
  from uniattend.user_roles r where r.institution_id = p_inst and r.role = 'institution_admin';
end $$;

create or replace function uniattend.change_subscription(p_inst uuid, p_plan_code text, p_status text,
                                                      p_period_end timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
declare plan uuid;
begin
  if not uniattend.is_super_admin() then raise exception 'super admin only' using errcode = '42501'; end if;
  select id into plan from uniattend.subscription_plans where code = p_plan_code;
  if plan is null then raise exception 'no such plan'; end if;
  update uniattend.institution_subscriptions
     set plan_id = plan, status = p_status, current_period_end = p_period_end
   where institution_id = p_inst and status in ('trialing','active','past_due','suspended');
  if not found then
    insert into uniattend.institution_subscriptions (institution_id, plan_id, status, current_period_end)
    values (p_inst, plan, p_status, p_period_end);
  end if;
end $$;

create or replace function uniattend.grant_role(p_inst uuid, p_email text, p_role text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare target uuid; rid uuid;
begin
  if p_role = 'super_admin' then
    if not uniattend.is_super_admin() then raise exception 'super admin only' using errcode = '42501'; end if;
    p_inst := null;
  else
    if p_role not in ('institution_admin','lecturer','student') then raise exception 'bad role'; end if;
    if not uniattend.is_inst_admin(p_inst) then raise exception 'institution admin only' using errcode = '42501'; end if;
  end if;
  select id into target from auth.users where lower(email) = lower(trim(p_email));
  if target is null then raise exception 'No account uses that email yet. Ask them to sign up first.'; end if;
  insert into uniattend.user_roles (user_id, institution_id, role, granted_by)
  values (target, p_inst, p_role, auth.uid())
  on conflict (user_id, institution_id, role) do update set status = 'active'
  returning id into rid;
  return rid;
end $$;

create or replace function uniattend.set_role_status(p_role_id uuid, p_status text)
returns void language plpgsql security definer set search_path = '' as $$
declare r uniattend.user_roles;
begin
  select * into r from uniattend.user_roles where id = p_role_id;
  if r is null then raise exception 'no such role'; end if;
  if r.role = 'super_admin' or r.institution_id is null then
    if not uniattend.is_super_admin() then raise exception 'super admin only' using errcode = '42501'; end if;
  elsif not uniattend.is_inst_admin(r.institution_id) then
    raise exception 'institution admin only' using errcode = '42501';
  end if;
  if r.user_id = auth.uid() and p_status <> 'active' then
    raise exception 'you cannot suspend your own access';
  end if;
  if p_status not in ('active','suspended') then raise exception 'bad status'; end if;
  update uniattend.user_roles set status = p_status where id = p_role_id;
end $$;

-- ============================================================ geometry

create or replace function uniattend.geo_distance_m(lat1 float8, lng1 float8, lat2 float8, lng2 float8)
returns float8 language sql immutable set search_path = '' as $$
  select 2 * 6371008.8 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)));
$$;

-- Signed distance in metres from a point to a polygon ring [[lat,lng],...]:
-- negative inside, positive outside. Local equirectangular projection is exact
-- enough at lecture-hall scale.
create or replace function uniattend.polygon_signed_distance_m(p_lat float8, p_lng float8, p_poly jsonb)
returns float8 language plpgsql immutable set search_path = '' as $$
declare
  n int := jsonb_array_length(p_poly);
  kx float8 := cos(radians(p_lat)) * 111320.0; ky float8 := 110540.0;
  i int; j int; xi float8; yi float8; xj float8; yj float8;
  inside boolean := false; best float8 := 'infinity'; dx float8; dy float8; t float8; d float8;
begin
  j := n - 1;
  for i in 0 .. n - 1 loop
    xi := ((p_poly->i->>1)::float8 - p_lng) * kx; yi := ((p_poly->i->>0)::float8 - p_lat) * ky;
    xj := ((p_poly->j->>1)::float8 - p_lng) * kx; yj := ((p_poly->j->>0)::float8 - p_lat) * ky;
    if ((yi > 0) <> (yj > 0)) and (0 < (xj - xi) * (0 - yi) / (yj - yi) + xi) then
      inside := not inside;
    end if;
    dx := xj - xi; dy := yj - yi;
    t := case when dx = 0 and dy = 0 then 0
              else greatest(0, least(1, (-xi * dx - yi * dy) / (dx * dx + dy * dy))) end;
    d := sqrt(power(xi + t * dx, 2) + power(yi + t * dy, 2));
    best := least(best, d);
    j := i;
  end loop;
  return case when inside then -best else best end;
end $$;

-- ============================================================ QR tokens

create or replace function uniattend.qr_step() returns bigint
language sql volatile set search_path = '' as $$
  select floor(extract(epoch from clock_timestamp()) / 20)::bigint;
$$;

create or replace function uniattend.qr_sign(p_session uuid, p_step bigint)
returns text language sql stable security definer set search_path = '' as $$
  select translate(left(encode(extensions.hmac(convert_to(p_session::text || ':' || p_step::text, 'UTF8'), s.secret, 'sha256'), 'base64'), 22), '+/', '-_')
  from uniattend.session_secrets s where s.session_id = p_session;
$$;

-- Returns the step a token was minted for, or null if it is forged or stale.
-- Accepts the current and previous 20-second step, so a token lives 20–40 s.
create or replace function uniattend.qr_verify(p_session uuid, p_token text)
returns bigint language plpgsql stable security definer set search_path = '' as $$
declare m text[]; step bigint; now_step bigint := uniattend.qr_step();
begin
  m := regexp_match(coalesce(p_token, ''), '^([0-9]{1,12})\.([A-Za-z0-9_-]{22})$');
  if m is null then return null; end if;
  step := m[1]::bigint;
  if step not between now_step - 1 and now_step then return null; end if;
  if uniattend.qr_sign(p_session, step) is distinct from m[2] then return null; end if;
  return step;
end $$;

create or replace function uniattend.session_qr_token(p_session uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s uniattend.class_sessions; step bigint := uniattend.qr_step();
begin
  select * into s from uniattend.class_sessions where id = p_session;
  if s is null or not (uniattend.teaches_module(s.module_id) or uniattend.is_inst_admin(s.institution_id)) then
    raise exception 'not your session' using errcode = '42501';
  end if;
  if s.status <> 'open' or now() not between s.opens_at and s.closes_at then
    return jsonb_build_object('open', false);
  end if;
  return jsonb_build_object(
    'open', true,
    'token', step::text || '.' || uniattend.qr_sign(p_session, step),
    'join_code', s.join_code,
    'refresh_in_ms', greatest(1000, ((step + 1) * 20 - extract(epoch from clock_timestamp())) * 1000)::int);
end $$;

-- ===================================================== session lifecycle

create or replace function uniattend.generate_join_code(p_inst uuid)
returns text language plpgsql volatile security definer set search_path = '' as $$
declare alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; b bytea; out text; i int;
begin
  loop
    b := extensions.gen_random_bytes(6); out := '';
    for i in 0..5 loop out := out || substr(alphabet, 1 + (get_byte(b, i) % 32), 1); end loop;
    exit when not exists (select 1 from uniattend.class_sessions
                          where institution_id = p_inst and join_code = out and status = 'open');
  end loop;
  return out;
end $$;

create or replace function uniattend.open_session(p_module uuid, p_venue uuid, p_title text,
                                               p_minutes int default 90, p_late_minutes int default null)
returns uniattend.class_sessions language plpgsql security definer set search_path = '' as $$
declare
  m uniattend.modules; v uniattend.venues; st uniattend.institution_settings; s uniattend.class_sessions;
  lect uuid; gps boolean; mins int := least(480, greatest(5, coalesce(p_minutes, 90)));
begin
  select * into m from uniattend.modules where id = p_module and deleted_at is null;
  if m is null or not (uniattend.teaches_module(m.id) or uniattend.is_inst_admin(m.institution_id)) then
    raise exception 'not your module' using errcode = '42501';
  end if;
  if not uniattend.institution_can_operate(m.institution_id) then
    raise exception 'institution is not active or its subscription has lapsed' using errcode = 'P0001';
  end if;
  select * into st from uniattend.institution_settings where institution_id = m.institution_id;
  if p_venue is not null then
    select * into v from uniattend.venues where id = p_venue and institution_id = m.institution_id and deleted_at is null;
    if v is null then raise exception 'unknown venue'; end if;
  end if;
  -- GPS can only be required where the venue has been mapped.
  gps := st.require_gps and v.id is not null and (v.polygon is not null or (v.lat is not null and v.lng is not null));
  select id into lect from uniattend.lecturers where institution_id = m.institution_id and user_id = auth.uid();

  insert into uniattend.class_sessions (institution_id, module_id, venue_id, lecturer_id, title, opens_at,
                                     closes_at, late_after, join_code, require_qr, require_gps, created_by)
  values (m.institution_id, m.id, v.id, lect, coalesce(nullif(trim(p_title), ''), m.code || ' lecture'),
          now(), now() + make_interval(mins => mins),
          now() + make_interval(mins => coalesce(p_late_minutes, st.late_after_minutes)),
          uniattend.generate_join_code(m.institution_id), st.require_qr, gps, auth.uid())
  returning * into s;
  insert into uniattend.session_secrets (session_id, secret) values (s.id, extensions.gen_random_bytes(32));

  insert into uniattend.notifications (institution_id, user_id, kind, title, body, link)
  select m.institution_id, st2.user_id, 'session_open', m.code || ': attendance is open',
         s.title || coalesce(' in ' || v.name, '') || '. Scan the code on screen.', '/student/check-in'
  from uniattend.module_enrolments e join uniattend.students st2 on st2.id = e.student_id
  where e.module_id = m.id and e.status = 'active' and st2.user_id is not null;

  perform uniattend.write_audit(m.institution_id, 'open', 'class_sessions', s.id::text,
                             jsonb_build_object('module', m.code, 'require_gps', gps));
  return s;
end $$;

create or replace function uniattend.close_session(p_session uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s uniattend.class_sessions; n_absent int;
begin
  select * into s from uniattend.class_sessions where id = p_session for update;
  if s is null or not (uniattend.teaches_module(s.module_id) or uniattend.is_inst_admin(s.institution_id)) then
    raise exception 'not your session' using errcode = '42501';
  end if;
  if s.status <> 'open' then raise exception 'session is already %', s.status; end if;

  update uniattend.class_sessions set status = 'closed', closed_at = now(),
         closes_at = least(closes_at, now()) where id = p_session;
  delete from uniattend.session_secrets where session_id = p_session;
  delete from uniattend.acoustic_submissions sub using uniattend.acoustic_windows w
   where sub.window_id = w.id and w.session_id = p_session;

  -- Absence is recorded only once the session is over, never pre-emptively.
  insert into uniattend.attendance_records (institution_id, session_id, module_id, student_id, status, method, explanation)
  select s.institution_id, s.id, s.module_id, e.student_id, 'absent', 'system',
         '["No check-in was received before the session closed."]'::jsonb
  from uniattend.module_enrolments e
  where e.module_id = s.module_id and e.status = 'active'
  on conflict (session_id, student_id) do nothing;
  get diagnostics n_absent = row_count;

  perform uniattend.write_audit(s.institution_id, 'close', 'class_sessions', s.id::text,
                             jsonb_build_object('absent', n_absent));
  return (select jsonb_build_object(
    'absent', n_absent,
    'present', count(*) filter (where status = 'present'),
    'late', count(*) filter (where status = 'late'),
    'pending', count(*) filter (where status = 'pending_verification'))
    from uniattend.attendance_records where session_id = p_session);
end $$;

-- ============================================================= check-in

create or replace function uniattend.check_in(p_session uuid, p_code text, p_token text,
                                           p_gps jsonb, p_device_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  s uniattend.class_sessions; st uniattend.institution_settings; v uniattend.venues; m uniattend.modules;
  stu uniattend.students; existing uniattend.attendance_records; rec uniattend.attendance_records;
  step bigint; method text; v_status text;
  reasons jsonb := '[]'::jsonb; layers jsonb := '{}'::jsonb;
  earned float8 := 0; possible float8 := 0; score int; outcome text;
  -- gps
  smp jsonb; n int := 0; wsum float8 := 0; lat float8 := 0; lng float8 := 0; acc_sum float8 := 0;
  acc float8; best_acc float8 := 'infinity'; accs float8[] := '{}'; w float8;
  signed float8; sigma float8; p float8; gps_pts float8; dist float8;
  -- device
  dev_pts float8; others int;
begin
  if uid is null then raise exception 'not signed in' using errcode = '42501'; end if;

  -- 1. Which session. By id (from the QR) or by typed code among the caller's institutions.
  if p_session is not null then
    select * into s from uniattend.class_sessions where id = p_session;
  elsif p_code is not null then
    select cs.* into s from uniattend.class_sessions cs
    join uniattend.students x on x.institution_id = cs.institution_id and x.user_id = uid
    join uniattend.module_enrolments e on e.module_id = cs.module_id and e.student_id = x.id and e.status = 'active'
    where cs.join_code = upper(trim(p_code)) and cs.status = 'open'
    limit 1;
  end if;
  if s is null then raise exception 'No open session matches that code.' using errcode = 'P0002'; end if;

  -- 2. Who, derived from the session's institution and auth.uid() — never from input.
  select * into stu from uniattend.students
   where institution_id = s.institution_id and user_id = uid and status = 'active' and deleted_at is null;
  if stu is null or not uniattend.has_role(s.institution_id, array['student']) then
    raise exception 'You are not registered as a student at this institution.' using errcode = '42501';
  end if;
  if not exists (select 1 from uniattend.module_enrolments
                 where module_id = s.module_id and student_id = stu.id and status = 'active') then
    raise exception 'You are not enrolled in this module.' using errcode = '42501';
  end if;
  if s.status <> 'open' or now() not between s.opens_at and s.closes_at then
    raise exception 'This session is not accepting check-ins.' using errcode = 'P0001';
  end if;
  if not uniattend.institution_can_operate(s.institution_id) then
    raise exception 'Attendance is unavailable for this institution right now.' using errcode = 'P0001';
  end if;

  -- 3. Rate limit: 5 attempts per student per session per minute.
  if (select count(*) from uniattend.attendance_verification_events
      where student_id = stu.id and session_id = s.id and created_at > now() - interval '1 minute') >= 5 then
    raise exception 'Too many attempts. Wait a minute and try again.' using errcode = 'P0001';
  end if;

  -- 4. Duplicate.
  select * into existing from uniattend.attendance_records where session_id = s.id and student_id = stu.id;
  if existing.id is not null and existing.status <> 'pending_verification' then
    insert into uniattend.attendance_verification_events (institution_id, session_id, student_id, outcome, score, layers, reasons)
    values (s.institution_id, s.id, stu.id, 'duplicate', coalesce(existing.score, 0), '{}', '["Already recorded"]');
    return jsonb_build_object('outcome', 'duplicate', 'status', existing.status, 'score', existing.score,
                              'reasons', jsonb_build_array('You are already recorded for this session.'));
  end if;

  select * into st from uniattend.institution_settings where institution_id = s.institution_id;
  select * into m from uniattend.modules where id = s.module_id;
  if s.venue_id is not null then select * into v from uniattend.venues where id = s.venue_id; end if;

  -- 5. Session proof layer (40). A valid live QR, or the typed code if allowed.
  possible := possible + 40;
  step := case when p_session is not null then uniattend.qr_verify(s.id, p_token) end;
  if step is not null then
    earned := earned + 40; method := 'qr';
    layers := layers || jsonb_build_object('qr', jsonb_build_object('points', 40, 'max', 40, 'step', step));
  elsif upper(trim(coalesce(p_code, ''))) = s.join_code and (st.allow_manual_code or not s.require_qr) then
    earned := earned + 15; method := 'code';
    reasons := reasons || '"Checked in with the typed code instead of scanning the live QR."';
    layers := layers || jsonb_build_object('qr', jsonb_build_object('points', 15, 'max', 40, 'typed_code', true));
  else
    reasons := reasons || to_jsonb(case when p_token is not null
      then 'The QR code had expired or was not valid. Scan the code currently on screen.'
      else 'No valid session code was provided.' end);
    insert into uniattend.attendance_verification_events (institution_id, session_id, student_id, outcome, score, layers, reasons)
    values (s.institution_id, s.id, stu.id, 'rejected', 0, jsonb_build_object('qr', jsonb_build_object('points', 0, 'max', 40)), reasons);
    return jsonb_build_object('outcome', 'rejected', 'status', null, 'score', 0, 'reasons', reasons);
  end if;

  -- 6. Location layer (40). Probability of being inside, given reported accuracy.
  if s.require_gps then
    possible := possible + 40;
    if p_gps is null or jsonb_typeof(p_gps->'samples') <> 'array' or jsonb_array_length(p_gps->'samples') = 0 then
      gps_pts := 0;
      reasons := reasons || '"Location was not shared, so presence at the venue could not be checked."';
      layers := layers || jsonb_build_object('gps', jsonb_build_object('points', 0, 'max', 40, 'shared', false));
    else
      for smp in select value from jsonb_array_elements(p_gps->'samples') limit 20 loop
        if jsonb_typeof(smp->'lat') = 'number' and jsonb_typeof(smp->'lng') = 'number' and jsonb_typeof(smp->'accuracy') = 'number'
           and (smp->>'lat')::float8 between -90 and 90 and (smp->>'lng')::float8 between -180 and 180
           and (smp->>'accuracy')::float8 > 0 then
          acc := (smp->>'accuracy')::float8;
          w := 1 / greatest(9, acc * acc);
          lat := lat + w * (smp->>'lat')::float8; lng := lng + w * (smp->>'lng')::float8; wsum := wsum + w;
          acc_sum := acc_sum + acc; best_acc := least(best_acc, acc); accs := accs || acc; n := n + 1;
        end if;
      end loop;
      if n = 0 then
        gps_pts := 0;
        reasons := reasons || '"Location data could not be read."';
        layers := layers || jsonb_build_object('gps', jsonb_build_object('points', 0, 'max', 40, 'shared', true, 'valid', false));
      else
        lat := lat / wsum; lng := lng / wsum;
        acc := greatest(3, least(acc_sum / n, best_acc));
        if v.polygon is not null then
          signed := uniattend.polygon_signed_distance_m(lat, lng, v.polygon);
        else
          signed := uniattend.geo_distance_m(lat, lng, v.lat, v.lng) - coalesce(v.radius_m, st.gps_default_radius_m);
        end if;
        sigma := greatest(4, acc * 0.6);
        p := 1 / (1 + exp(least(50, greatest(-50, 1.7 * signed / sigma))));
        gps_pts := 40 * p;
        if acc > st.gps_max_accuracy_m then
          gps_pts := least(gps_pts, 8);
          reasons := reasons || to_jsonb(format('Location was too imprecise to confirm (±%s m). Try near a window or with Wi-Fi on.', round(acc)));
        elsif p < 0.5 then
          reasons := reasons || to_jsonb(format('Location appears to be about %s m outside the venue (accuracy ±%s m).', round(greatest(signed, 0)), round(acc)));
        end if;
        -- Integrity: a run of identical, implausibly precise readings is what a spoofing app produces.
        if n >= 4 and (select count(distinct x) from unnest(accs) x) = 1 and best_acc <= 5 then
          gps_pts := least(gps_pts, 10);
          reasons := reasons || '"Location readings were unusually uniform and could not be relied on."';
        end if;
        dist := round(greatest(signed, 0)::numeric, 0);
        layers := layers || jsonb_build_object('gps', jsonb_build_object(
          'points', round(gps_pts::numeric, 1), 'max', 40, 'samples', n,
          'accuracy_m', round(acc::numeric, 0), 'outside_by_m', dist, 'p_inside', round(p::numeric, 2)));
      end if;
    end if;
    earned := earned + gps_pts;
  else
    layers := layers || jsonb_build_object('gps', jsonb_build_object('required', false));
  end if;

  -- 7. Device layer (20). Signals only; changing phones is normal and never blocks.
  possible := possible + 20;
  if p_device_hash is null or p_device_hash !~ '^[0-9a-f]{64}$' then
    dev_pts := 10; p_device_hash := null;
    reasons := reasons || '"This browser could not provide a device check."';
  elsif exists (select 1 from uniattend.attendance_records
                where session_id = s.id and device_hash = p_device_hash and student_id <> stu.id) then
    dev_pts := 0;
    reasons := reasons || '"This device has already been used to check in another student for this session."';
  else
    select count(distinct student_id) into others from uniattend.attendance_records
     where institution_id = s.institution_id and device_hash = p_device_hash and student_id <> stu.id
       and created_at > now() - interval '30 days';
    dev_pts := case when others >= 2 then 10 else 20 end;
    if others >= 2 then
      reasons := reasons || '"This device has recently been used by several students."';
    end if;
  end if;
  earned := earned + dev_pts;
  layers := layers || jsonb_build_object('device', jsonb_build_object('points', dev_pts, 'max', 20));

  -- 8. Verdict. A proven session is never turned into an absence by weak signals:
  -- below the accept threshold it goes to a person for review.
  score := round(100 * earned / possible);
  if score >= st.accept_score then
    outcome := 'accepted';
    v_status := case when now() > s.late_after then 'late' else 'present' end;
  else
    outcome := 'review';
    v_status := 'pending_verification';
  end if;

  insert into uniattend.attendance_records as ar (institution_id, session_id, module_id, student_id, status, method,
                                               score, checked_in_at, device_hash, explanation)
  values (s.institution_id, s.id, s.module_id, stu.id, v_status, method, score, now(), p_device_hash, reasons)
  on conflict (session_id, student_id) do update
    set status = excluded.status, method = excluded.method, score = excluded.score,
        checked_in_at = excluded.checked_in_at, device_hash = excluded.device_hash, explanation = excluded.explanation
    where ar.status = 'pending_verification' and excluded.score > coalesce(ar.score, 0)
  returning * into rec;
  if rec.id is null then  -- an earlier pending attempt scored at least as well
    select * into rec from uniattend.attendance_records where session_id = s.id and student_id = stu.id;
  end if;

  insert into uniattend.attendance_evidence (institution_id, record_id, kind, data)
  select s.institution_id, rec.id, k, layers->k from unnest(array['qr','gps','device']) k where layers ? k;

  insert into uniattend.attendance_verification_events (institution_id, session_id, student_id, outcome, score, layers, reasons, token_step)
  values (s.institution_id, s.id, stu.id, outcome, score, layers, reasons, step);

  insert into uniattend.notifications (institution_id, user_id, kind, title, body, link)
  values (s.institution_id, uid, case when outcome = 'accepted' then 'check_in_ok' else 'check_in_review' end,
          m.code || case when outcome = 'accepted' then ': you are checked in' else ': check-in sent for review' end,
          case when outcome = 'accepted' then 'Recorded as ' || replace(rec.status, '_', ' ') || '.'
               else 'Your lecturer will confirm it. You do not need to do anything else.' end,
          '/student/history');

  return jsonb_build_object('outcome', outcome, 'status', rec.status, 'score', rec.score,
                            'reasons', reasons, 'module_code', m.code, 'session_title', s.title);
end $$;

-- ======================================================= corrections

create or replace function uniattend.override_attendance(p_session uuid, p_student uuid, p_status text, p_note text)
returns uniattend.attendance_records language plpgsql security definer set search_path = '' as $$
declare s uniattend.class_sessions; r uniattend.attendance_records; uid uuid;
begin
  select * into s from uniattend.class_sessions where id = p_session;
  if s is null or not (uniattend.teaches_module(s.module_id) or uniattend.is_inst_admin(s.institution_id)) then
    raise exception 'only the module lecturer or an administrator may correct the register' using errcode = '42501';
  end if;
  if p_status not in ('present','absent','late','excused') then
    raise exception 'not a status a person may set: %', p_status;
  end if;
  if length(trim(coalesce(p_note, ''))) < 3 then raise exception 'a reason is required for every correction'; end if;
  if not exists (select 1 from uniattend.module_enrolments where module_id = s.module_id and student_id = p_student) then
    raise exception 'student is not enrolled in this module';
  end if;

  insert into uniattend.attendance_records as ar (institution_id, session_id, module_id, student_id, status, method,
                                               overridden_by, overridden_at, override_note)
  values (s.institution_id, s.id, s.module_id, p_student, p_status, 'manual', auth.uid(), now(), trim(p_note))
  on conflict (session_id, student_id) do update
    set status = excluded.status, overridden_by = excluded.overridden_by,
        overridden_at = excluded.overridden_at, override_note = excluded.override_note
  returning * into r;

  insert into uniattend.attendance_evidence (institution_id, record_id, kind, data)
  values (s.institution_id, r.id, 'manual', jsonb_build_object('status', p_status, 'note', trim(p_note), 'by', auth.uid()));

  select user_id into uid from uniattend.students where id = p_student;
  if uid is not null then
    insert into uniattend.notifications (institution_id, user_id, kind, title, body, link)
    values (s.institution_id, uid, 'attendance_corrected', 'Attendance updated',
            'Your attendance for ' || s.title || ' was set to ' || p_status || '.', '/student/history');
  end if;
  return r;
end $$;

create or replace function uniattend.submit_dispute(p_record uuid, p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare r uniattend.attendance_records; d uuid;
begin
  select * into r from uniattend.attendance_records where id = p_record;
  if r is null or not uniattend.is_own_student(r.student_id) then
    raise exception 'not your attendance record' using errcode = '42501';
  end if;
  if r.status not in ('absent','late','pending_verification') then
    raise exception 'only absent, late or pending records can be disputed';
  end if;
  insert into uniattend.attendance_disputes (institution_id, record_id, student_id, reason, previous_status)
  values (r.institution_id, r.id, r.student_id, trim(p_reason), r.status) returning id into d;
  update uniattend.attendance_records set status = 'disputed' where id = r.id;

  insert into uniattend.notifications (institution_id, user_id, kind, title, body, link)
  select r.institution_id, l.user_id, 'dispute_opened', 'New attendance dispute',
         'A student disputed their attendance record.', '/lecturer/disputes'
  from uniattend.lecturer_assignments la join uniattend.lecturers l on l.id = la.lecturer_id
  where la.module_id = r.module_id and l.user_id is not null;
  return d;
end $$;

create or replace function uniattend.resolve_dispute(p_dispute uuid, p_upheld boolean, p_new_status text, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare d uniattend.attendance_disputes; r uniattend.attendance_records; uid uuid; final text;
begin
  select * into d from uniattend.attendance_disputes where id = p_dispute for update;
  if d is null then raise exception 'no such dispute'; end if;
  select * into r from uniattend.attendance_records where id = d.record_id;
  if not (uniattend.teaches_module(r.module_id) or uniattend.is_inst_admin(r.institution_id)) then
    raise exception 'not your module' using errcode = '42501';
  end if;
  if d.status <> 'open' then raise exception 'dispute already resolved'; end if;
  if p_upheld and coalesce(p_new_status, '') not in ('present','late','excused') then
    raise exception 'an upheld dispute must set present, late or excused';
  end if;
  final := case when p_upheld then p_new_status
                when d.previous_status = 'pending_verification' then 'absent'
                else d.previous_status end;
  update uniattend.attendance_disputes
     set status = case when p_upheld then 'upheld' else 'rejected' end,
         resolved_by = auth.uid(), resolved_at = now(), resolution_note = nullif(trim(p_note), '')
   where id = d.id;
  update uniattend.attendance_records
     set status = final, overridden_by = auth.uid(), overridden_at = now(),
         override_note = 'Dispute ' || case when p_upheld then 'upheld' else 'rejected' end
                         || coalesce(': ' || nullif(trim(p_note), ''), '')
   where id = r.id;
  select user_id into uid from uniattend.students where id = d.student_id;
  if uid is not null then
    insert into uniattend.notifications (institution_id, user_id, kind, title, body, link)
    values (d.institution_id, uid, 'dispute_resolved',
            'Dispute ' || case when p_upheld then 'upheld' else 'not upheld' end,
            'Your attendance is now recorded as ' || final || '.', '/student/history');
  end if;
end $$;

-- ============================================================= reports
-- Percentages count RESOLVED sessions only (carried over from aa_course_report).
-- present + late = attended; excused leaves the denominator; pending and
-- disputed are unresolved and reported alongside, with the worst case, so
-- "we could not verify" never silently becomes "was not there".

create or replace function uniattend.module_report(p_module uuid)
returns table (student_id uuid, student_number text, full_name text, sessions int, attended int,
               late int, absent int, excused int, unresolved int,
               percent numeric, worst_case_percent numeric, meets_requirement boolean, at_risk boolean)
language plpgsql stable security definer set search_path = '' as $$
declare m uniattend.modules; v_min int; v_total int;
begin
  select * into m from uniattend.modules where id = p_module;
  if m is null or not (uniattend.teaches_module(m.id) or uniattend.is_inst_admin(m.institution_id)) then
    raise exception 'not your module' using errcode = '42501';
  end if;
  select coalesce(m.min_attendance_pct, st.min_attendance_pct) into v_min
    from uniattend.institution_settings st where st.institution_id = m.institution_id;
  select count(*) into v_total from uniattend.class_sessions where module_id = p_module and status = 'closed';

  return query
  with t as (
    select s.id, s.student_number, s.full_name,
      count(*) filter (where a.status in ('present','late')) as n_att,
      count(*) filter (where a.status = 'late') as n_late,
      count(*) filter (where a.status = 'absent') as n_abs,
      count(*) filter (where a.status = 'excused') as n_exc,
      count(*) filter (where a.status in ('pending_verification','disputed')) as n_unr
    from uniattend.module_enrolments e
    join uniattend.students s on s.id = e.student_id
    left join uniattend.class_sessions cs on cs.module_id = e.module_id and cs.status = 'closed'
    left join uniattend.attendance_records a on a.session_id = cs.id and a.student_id = s.id
    where e.module_id = p_module and e.status = 'active'
    group by s.id, s.student_number, s.full_name)
  select t.id, t.student_number, t.full_name, v_total, t.n_att::int, t.n_late::int, t.n_abs::int,
    t.n_exc::int, t.n_unr::int,
    case when t.n_att + t.n_abs = 0 then null else round(100.0 * t.n_att / (t.n_att + t.n_abs), 1) end,
    case when t.n_att + t.n_abs + t.n_unr = 0 then null
         else round(100.0 * t.n_att / (t.n_att + t.n_abs + t.n_unr), 1) end,
    case when t.n_att + t.n_abs = 0 then null else 100.0 * t.n_att / (t.n_att + t.n_abs) >= v_min end,
    case when t.n_att + t.n_abs + t.n_unr = 0 then null
         else 100.0 * t.n_att / (t.n_att + t.n_abs + t.n_unr) < v_min end
  from t order by t.student_number;
end $$;

create or replace function uniattend.my_attendance()
returns table (institution_id uuid, module_id uuid, code text, title text, attended int, absent int,
               excused int, unresolved int, percent numeric, min_pct int)
language sql stable security definer set search_path = '' as $$
  with me as (select s.id, s.institution_id from uniattend.students s where s.user_id = auth.uid())
  select m.institution_id, m.id, m.code, m.title,
    (count(*) filter (where a.status in ('present','late')))::int,
    (count(*) filter (where a.status = 'absent'))::int,
    (count(*) filter (where a.status = 'excused'))::int,
    (count(*) filter (where a.status in ('pending_verification','disputed')))::int,
    case when count(*) filter (where a.status in ('present','late','absent')) = 0 then null
         else round(100.0 * count(*) filter (where a.status in ('present','late'))
                    / count(*) filter (where a.status in ('present','late','absent')), 1) end,
    coalesce(m.min_attendance_pct, st.min_attendance_pct)
  from me
  join uniattend.module_enrolments e on e.student_id = me.id and e.status = 'active'
  join uniattend.modules m on m.id = e.module_id
  join uniattend.institution_settings st on st.institution_id = m.institution_id
  left join uniattend.attendance_records a on a.module_id = m.id and a.student_id = me.id
  group by m.institution_id, m.id, m.code, m.title, m.min_attendance_pct, st.min_attendance_pct
  order by m.code;
$$;

create or replace function uniattend.institution_overview(p_inst uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not uniattend.is_inst_admin(p_inst) then raise exception 'institution admin only' using errcode = '42501'; end if;
  return jsonb_build_object(
    'students',  (select count(*) from uniattend.students where institution_id = p_inst and deleted_at is null and status = 'active'),
    'lecturers', (select count(*) from uniattend.lecturers where institution_id = p_inst and deleted_at is null and status = 'active'),
    'modules',   (select count(*) from uniattend.modules where institution_id = p_inst and deleted_at is null),
    'sessions_30d', (select count(*) from uniattend.class_sessions where institution_id = p_inst and opens_at > now() - interval '30 days'),
    'attendance_30d', (select round(100.0 * count(*) filter (where status in ('present','late'))
                              / nullif(count(*) filter (where status in ('present','late','absent')), 0), 1)
                       from uniattend.attendance_records where institution_id = p_inst and created_at > now() - interval '30 days'),
    'pending_reviews', (select count(*) from uniattend.attendance_records where institution_id = p_inst and status = 'pending_verification'),
    'open_disputes', (select count(*) from uniattend.attendance_disputes where institution_id = p_inst and status = 'open'),
    'low_modules', coalesce((select jsonb_agg(x order by (x->>'percent')::numeric) from (
        select jsonb_build_object('module_id', m.id, 'code', m.code, 'title', m.title,
          'percent', round(100.0 * count(*) filter (where a.status in ('present','late'))
                         / nullif(count(*) filter (where a.status in ('present','late','absent')), 0), 1)) x
        from uniattend.modules m join uniattend.attendance_records a on a.module_id = m.id
        where m.institution_id = p_inst
        group by m.id, m.code, m.title
        having count(*) filter (where a.status in ('present','late','absent')) > 0
        order by 100.0 * count(*) filter (where a.status in ('present','late'))
                 / nullif(count(*) filter (where a.status in ('present','late','absent')), 0)
        limit 5) q), '[]'::jsonb));
end $$;

create or replace function uniattend.platform_overview()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not uniattend.is_super_admin() then raise exception 'super admin only' using errcode = '42501'; end if;
  return jsonb_build_object(
    'institutions', (select jsonb_object_agg(status, n) from (select status, count(*) n from uniattend.institutions group by status) q),
    'students', (select count(*) from uniattend.students where deleted_at is null),
    'lecturers', (select count(*) from uniattend.lecturers where deleted_at is null),
    'sessions_30d', (select count(*) from uniattend.class_sessions where opens_at > now() - interval '30 days'),
    'checkins_30d', (select count(*) from uniattend.attendance_verification_events where created_at > now() - interval '30 days'),
    'rejected_30d', (select count(*) from uniattend.attendance_verification_events where outcome = 'rejected' and created_at > now() - interval '30 days'));
end $$;

-- ============================================================== import

-- p_rows: [{"student_number","full_name","email","module_code"}...]
create or replace function uniattend.import_students(p_inst uuid, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  pattern text; n_rows int; ins int := 0; upd int := 0; enr int := 0; errors jsonb;
begin
  if not uniattend.is_inst_admin(p_inst) then raise exception 'institution admin only' using errcode = '42501'; end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'rows must be an array'; end if;
  n_rows := jsonb_array_length(p_rows);
  if n_rows > 10000 then raise exception 'import at most 10,000 rows at a time'; end if;
  if n_rows > 50 and not uniattend.plan_feature(p_inst, 'bulk_import') then
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

create or replace function uniattend.mark_notifications_read(p_ids uuid[] default null)
returns void language sql security definer set search_path = '' as $$
  update uniattend.notifications set read_at = now()
  where user_id = auth.uid() and read_at is null and (p_ids is null or id = any(p_ids));
$$;

-- ============================================================== grants
-- Postgres grants EXECUTE to PUBLIC by default and anon inherits it, so revoke
-- from PUBLIC and give back to authenticated only what clients may call.

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'uniattend'
  loop
    execute format('revoke all on function %s from public, anon', f.sig);
  end loop;
end $$;

do $$
declare fn text;
begin
  foreach fn in array array[
    -- predicates used inside RLS policies
    'is_super_admin()','has_role(uuid,text[])','is_member(uuid)','is_inst_admin(uuid)',
    'teaches_module(uuid)','enrolled_in_module(uuid)','is_own_student(uuid)',
    'lecturer_sees_student(uuid)','module_of_record(uuid)',
    -- client RPCs
    'link_my_accounts()','ensure_profile()','my_roles()','request_institution(text,text,text)',
    'set_institution_status(uuid,text)','change_subscription(uuid,text,text,timestamptz)',
    'grant_role(uuid,text,text)','set_role_status(uuid,text)',
    'session_qr_token(uuid)','open_session(uuid,uuid,text,int,int)','close_session(uuid)',
    'check_in(uuid,text,text,jsonb,text)','override_attendance(uuid,uuid,text,text)',
    'submit_dispute(uuid,text)','resolve_dispute(uuid,boolean,text,text)',
    'module_report(uuid)','my_attendance()','institution_overview(uuid)','platform_overview()',
    'import_students(uuid,jsonb)','mark_notifications_read(uuid[])','plan_feature(uuid,text)',
    'institution_can_operate(uuid)']
  loop
    execute format('grant execute on function uniattend.%s to authenticated', fn);
  end loop;
end $$;

-- ============================================================= realtime

do $$
declare t text;
begin
  foreach t in array array['attendance_records','class_sessions','notifications'] loop
    begin
      execute format('alter publication supabase_realtime add table uniattend.%I', t);
    exception when duplicate_object or undefined_object then null;
    end;
  end loop;
end $$;
