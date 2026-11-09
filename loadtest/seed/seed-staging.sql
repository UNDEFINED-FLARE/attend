-- UniAttend load-test seed. STAGING ONLY. Never run against production (ref rbnnbmduwrvokhbkezyh).
--
-- Creates one active institution "loadtest" on the Enterprise plan with:
--   * N_STUDENTS confirmed student accounts   auth user id = md5('loadtest-student-<i>')::uuid,
--     email loadtest+s<i>@<EMAIL_DOMAIN>, all with password SEED_PASSWORD (one bcrypt hash, reused)
--   * N_SESSIONS modules, one open session each  session id = md5('loadtest-session-<k>')::uuid
--     student i is enrolled in module ((i-1) % N_SESSIONS) + 1  (500 per session at 10k/20)
--   * one lecturer assigned to every module
--   * one mapped venue at VENUE_LAT/VENUE_LNG, radius 80 m
--   * every session's QR secret set to QR_SECRET_HEX, so k6 can mint valid 20 s tokens
--
-- The k6 scripts must be given the same N_STUDENTS, N_SESSIONS, QR_SECRET_HEX, VENUE_LAT,
-- VENUE_LNG, LOADTEST_EMAIL_DOMAIN and SEED_PASSWORD.
--
-- Safe to re-run: it adds missing rows and re-opens the sessions for another 4 hours.
--
-- GUARD: run this first, in the same SQL session, to confirm the target is staging:
--   set uniattend.loadtest_target = 'staging';
-- If other institutions already have students (e.g. a copy of production data), also run:
--   set uniattend.loadtest_allow_other_data = 'yes';

do $$
declare
  -- ---------------------------------------------------------- parameters
  n_students    int     := 10000;
  n_sessions    int     := 20;
  email_domain  text    := 'loadtest.example';
  seed_password text    := 'change-me-staging-only';
  qr_secret_hex text    := '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f';
  venue_lat     float8  := -25.7545;
  venue_lng     float8  := 28.2314;
  open_minutes  int     := 240;
  late_minutes  int     := 180;   -- set to 0 to exercise the late_pending path
  -- ---------------------------------------------------------- derived
  inst   uuid := md5('loadtest-institution')::uuid;
  lect_u uuid := md5('loadtest-lecturer')::uuid;
  venue  uuid := md5('loadtest-venue')::uuid;
  lect   uuid;
  pw     text;
  k      int;
  others int;
begin
  if coalesce(current_setting('uniattend.loadtest_target', true), '') <> 'staging' then
    raise exception 'Refusing to seed: run  set uniattend.loadtest_target = ''staging'';  first, and only on a staging project.';
  end if;
  select count(*) into others from uniattend.students s where s.institution_id <> inst and s.deleted_at is null;
  if others > 0 and coalesce(current_setting('uniattend.loadtest_allow_other_data', true), '') <> 'yes' then
    raise exception 'Refusing to seed: this database already has % students in other institutions. Is this production?', others;
  end if;

  pw := extensions.crypt(seed_password, extensions.gen_salt('bf', 8));

  -- institution, settings, subscription
  insert into uniattend.institutions (id, name, slug, short_name, status, contact_email)
  values (inst, 'Load Test University', 'loadtest', 'LOADTEST', 'active', 'loadtest@' || email_domain)
  on conflict (id) do update set status = 'active', deleted_at = null;
  insert into uniattend.institution_settings (institution_id) values (inst) on conflict (institution_id) do nothing;
  if not exists (select 1 from uniattend.institution_subscriptions where institution_id = inst and status = 'active') then
    insert into uniattend.institution_subscriptions (institution_id, plan_id, status, current_period_end)
    select inst, p.id, 'active', now() + interval '1 year' from uniattend.subscription_plans p where p.code = 'enterprise';
  end if;

  insert into uniattend.venues (id, institution_id, name, code, capacity, lat, lng, radius_m)
  values (venue, inst, 'Load test hall', 'LT-HALL', 10000, venue_lat, venue_lng, 80)
  on conflict (id) do update set lat = excluded.lat, lng = excluded.lng, radius_m = excluded.radius_m, deleted_at = null;

  -- auth users: students + lecturer (handle_new_user creates their profiles)
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                          confirmation_token, recovery_token, email_change_token_new, email_change)
  select '00000000-0000-0000-0000-000000000000'::uuid, md5('loadtest-student-' || i)::uuid, 'authenticated', 'authenticated',
         'loadtest+s' || i || '@' || email_domain, pw, now(),
         '{"provider":"email","providers":["email"]}'::jsonb,
         jsonb_build_object('full_name', 'Load Student ' || i, 'app', 'uniattend'), now(), now(), '', '', '', ''
  from generate_series(1, n_students) i
  union all
  select '00000000-0000-0000-0000-000000000000'::uuid, lect_u, 'authenticated', 'authenticated',
         'loadtest+lecturer@' || email_domain, pw, now(),
         '{"provider":"email","providers":["email"]}'::jsonb,
         jsonb_build_object('full_name', 'Load Lecturer', 'app', 'uniattend'), now(), now(), '', '', '', ''
  on conflict (id) do nothing;

  insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  select u.id::text, u.id, jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true), 'email', now(), now(), now()
  from auth.users u
  where u.email like 'loadtest+%@' || email_domain
    and not exists (select 1 from auth.identities x where x.user_id = u.id and x.provider = 'email');

  -- lecturer
  insert into uniattend.lecturers (institution_id, user_id, staff_number, full_name, email)
  values (inst, lect_u, 'LT-STAFF-1', 'Load Lecturer', 'loadtest+lecturer@' || email_domain)
  on conflict (institution_id, staff_number) do nothing;
  select id into lect from uniattend.lecturers where institution_id = inst and staff_number = 'LT-STAFF-1';
  insert into uniattend.user_roles (user_id, institution_id, role) values (lect_u, inst, 'lecturer')
  on conflict (user_id, institution_id, role) do nothing;

  -- students
  insert into uniattend.students (institution_id, user_id, student_number, full_name, email)
  select inst, md5('loadtest-student-' || i)::uuid, 'LT' || lpad(i::text, 8, '0'), 'Load Student ' || i,
         'loadtest+s' || i || '@' || email_domain
  from generate_series(1, n_students) i
  on conflict (institution_id, student_number) do nothing;
  insert into uniattend.user_roles (user_id, institution_id, role)
  select md5('loadtest-student-' || i)::uuid, inst, 'student' from generate_series(1, n_students) i
  on conflict (user_id, institution_id, role) do nothing;

  -- modules, assignments, enrolments
  insert into uniattend.modules (institution_id, code, title, expected_students)
  select inst, 'LT' || lpad(k2::text, 3, '0'), 'Load test module ' || k2, ceil(n_students::numeric / n_sessions)
  from generate_series(1, n_sessions) k2
  on conflict (institution_id, code, academic_period_id) do nothing;
  insert into uniattend.lecturer_assignments (institution_id, module_id, lecturer_id)
  select inst, m.id, lect from uniattend.modules m where m.institution_id = inst and m.code like 'LT%'
  on conflict (module_id, lecturer_id) do nothing;
  insert into uniattend.module_enrolments (institution_id, module_id, student_id)
  select inst, m.id, s.id
  from uniattend.students s
  join uniattend.modules m on m.institution_id = inst
   and m.code = 'LT' || lpad((((substring(s.student_number from 3)::int - 1) % n_sessions) + 1)::text, 3, '0')
  where s.institution_id = inst and s.student_number like 'LT%'
  on conflict (module_id, student_id) do nothing;

  -- one open session per module, with a known QR secret
  for k in 1 .. n_sessions loop
    insert into uniattend.class_sessions (id, institution_id, module_id, venue_id, lecturer_id, title, status,
                                          opens_at, closes_at, late_after, join_code, require_qr, require_gps, created_by)
    select md5('loadtest-session-' || k)::uuid, inst, m.id, venue, lect, 'Load test ' || k, 'open',
           now(), now() + make_interval(mins => open_minutes), now() + make_interval(mins => late_minutes),
           uniattend.generate_join_code(inst), true, true, lect_u
    from uniattend.modules m where m.institution_id = inst and m.code = 'LT' || lpad(k::text, 3, '0')
    on conflict (id) do update set status = 'open', opens_at = now(), closed_at = null,
           closes_at = now() + make_interval(mins => open_minutes), late_after = now() + make_interval(mins => late_minutes);
    insert into uniattend.session_secrets (session_id, secret)
    values (md5('loadtest-session-' || k)::uuid, decode(qr_secret_hex, 'hex'))
    on conflict (session_id) do update set secret = excluded.secret;
  end loop;

  raise notice 'Seeded institution % with % students across % open sessions.', inst, n_students, n_sessions;
end $$;
