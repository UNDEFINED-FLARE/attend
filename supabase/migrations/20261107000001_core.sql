-- UniAttend 0001 — tenancy, academic structure, people, roles.
--
-- Tenant consistency rule: every institution-owned table carries institution_id,
-- and every parent it references is referenced through (institution_id, id). A
-- module therefore cannot point at another institution's department even if a
-- bug or a hostile client supplies a foreign id: the composite FK rejects it.

-- Everything lives in its own schema so UniAttend can share a Supabase project
-- with other apps (e.g. acvosa's public.profiles / public.attendance_records)
-- without any name clash. Expose it in Dashboard → Project Settings → API →
-- Exposed schemas.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create schema if not exists uniattend;
grant usage on schema uniattend to anon, authenticated, service_role;
-- Supabase's usual table privileges; RLS (0004) is what actually restricts.
alter default privileges in schema uniattend grant select, insert, update, delete on tables to anon, authenticated;
alter default privileges in schema uniattend grant all on tables to service_role;
alter default privileges in schema uniattend grant usage, select on sequences to anon, authenticated, service_role;

-- ------------------------------------------------------------------ shared

create or replace function uniattend.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ------------------------------------------------------------- institutions

create table uniattend.institutions (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (length(trim(name)) between 2 and 200),
  slug          text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,40}$'),
  short_name    text,
  status        text not null default 'pending'
                  check (status in ('pending','active','suspended','archived')),
  country       text not null default 'ZA',
  timezone      text not null default 'Africa/Johannesburg',
  brand_primary text not null default '#0b2545' check (brand_primary ~ '^#[0-9a-fA-F]{6}$'),
  logo_path     text,
  student_number_pattern text,            -- e.g. '^[0-9]{8}$' for UNIVEN
  contact_email text,
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);
create trigger institutions_touch before update on uniattend.institutions
  for each row execute function uniattend.touch_updated_at();

create table uniattend.institution_settings (
  institution_id       uuid primary key references uniattend.institutions(id) on delete cascade,
  min_attendance_pct   int  not null default 75 check (min_attendance_pct between 0 and 100),
  late_after_minutes   int  not null default 10 check (late_after_minutes between 0 and 240),
  require_qr           boolean not null default true,
  allow_manual_code    boolean not null default true,
  require_gps          boolean not null default true,
  acoustic_enabled     boolean not null default false,
  gps_default_radius_m int  not null default 60  check (gps_default_radius_m between 10 and 2000),
  gps_max_accuracy_m   int  not null default 150 check (gps_max_accuracy_m between 10 and 5000),
  accept_score         int  not null default 70 check (accept_score between 0 and 100),
  review_score         int  not null default 35 check (review_score between 0 and 100),
  retention_days       int  not null default 1095 check (retention_days between 30 and 3650),
  updated_at           timestamptz not null default now(),
  check (review_score <= accept_score)
);
create trigger institution_settings_touch before update on uniattend.institution_settings
  for each row execute function uniattend.touch_updated_at();

create table uniattend.institution_domains (
  id             uuid primary key default gen_random_uuid(),
  institution_id uuid not null references uniattend.institutions(id) on delete cascade,
  domain         text not null unique check (domain ~ '^[a-z0-9.-]+\.[a-z]{2,}$'),
  verified_at    timestamptz,
  created_at     timestamptz not null default now()
);

-- -------------------------------------------------------------- people

create table uniattend.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text not null default '',
  email       text,
  phone       text,
  avatar_path text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger profiles_touch before update on uniattend.profiles
  for each row execute function uniattend.touch_updated_at();

create table uniattend.user_roles (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  institution_id uuid references uniattend.institutions(id) on delete cascade,
  role           text not null check (role in ('super_admin','institution_admin','lecturer','student')),
  status         text not null default 'active' check (status in ('active','suspended')),
  granted_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  -- super_admin is platform-wide, every other role belongs to one institution
  check ((role = 'super_admin') = (institution_id is null)),
  unique nulls not distinct (user_id, institution_id, role)
);
create index user_roles_user on uniattend.user_roles(user_id) where status = 'active';
create index user_roles_inst on uniattend.user_roles(institution_id, role);

-- ------------------------------------------------- academic structure

create table uniattend.campuses (
  id             uuid primary key default gen_random_uuid(),
  institution_id uuid not null references uniattend.institutions(id) on delete cascade,
  name           text not null,
  address        text,
  lat            double precision check (lat between -90 and 90),
  lng            double precision check (lng between -180 and 180),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  unique (institution_id, id),
  unique (institution_id, name)
);

create table uniattend.venues (
  id             uuid primary key default gen_random_uuid(),
  institution_id uuid not null references uniattend.institutions(id) on delete cascade,
  campus_id      uuid,
  name           text not null,
  code           text,
  capacity       int check (capacity > 0),
  lat            double precision check (lat between -90 and 90),
  lng            double precision check (lng between -180 and 180),
  radius_m       int check (radius_m between 5 and 2000),
  -- [[lat,lng],...] ring, at least 3 vertices; preferred over the radius when set
  polygon        jsonb check (polygon is null or (jsonb_typeof(polygon) = 'array' and jsonb_array_length(polygon) >= 3)),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  unique (institution_id, id),
  foreign key (institution_id, campus_id) references uniattend.campuses(institution_id, id)
);

create table uniattend.faculties (
  id             uuid primary key default gen_random_uuid(),
  institution_id uuid not null references uniattend.institutions(id) on delete cascade,
  name           text not null,
  code           text not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  unique (institution_id, id),
  unique (institution_id, code)
);

create table uniattend.departments (
  id             uuid primary key default gen_random_uuid(),
  institution_id uuid not null references uniattend.institutions(id) on delete cascade,
  faculty_id     uuid not null,
  name           text not null,
  code           text not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  unique (institution_id, id),
  unique (institution_id, code),
  foreign key (institution_id, faculty_id) references uniattend.faculties(institution_id, id)
);

create table uniattend.academic_programmes (
  id             uuid primary key default gen_random_uuid(),
  institution_id uuid not null references uniattend.institutions(id) on delete cascade,
  department_id  uuid not null,
  name           text not null,
  code           text not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  unique (institution_id, id),
  unique (institution_id, code),
  foreign key (institution_id, department_id) references uniattend.departments(institution_id, id)
);

create table uniattend.academic_periods (
  id             uuid primary key default gen_random_uuid(),
  institution_id uuid not null references uniattend.institutions(id) on delete cascade,
  name           text not null,
  kind           text not null default 'semester' check (kind in ('year','semester','term','block')),
  starts_on      date not null,
  ends_on        date not null,
  is_current     boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (institution_id, id),
  unique (institution_id, name),
  check (ends_on > starts_on)
);

create table uniattend.students (
  id             uuid primary key default gen_random_uuid(),
  institution_id uuid not null references uniattend.institutions(id) on delete cascade,
  user_id        uuid references auth.users(id) on delete set null,
  student_number text not null check (length(trim(student_number)) between 3 and 32),
  full_name      text not null,
  email          text,
  programme_id   uuid,
  year_of_study  int check (year_of_study between 1 and 10),
  status         text not null default 'active' check (status in ('active','suspended','graduated','withdrawn')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  unique (institution_id, id),
  unique (institution_id, student_number),
  unique (institution_id, user_id),
  foreign key (institution_id, programme_id) references uniattend.academic_programmes(institution_id, id)
);
create index students_user on uniattend.students(user_id);
create index students_email on uniattend.students(institution_id, lower(email));

create table uniattend.lecturers (
  id             uuid primary key default gen_random_uuid(),
  institution_id uuid not null references uniattend.institutions(id) on delete cascade,
  user_id        uuid references auth.users(id) on delete set null,
  staff_number   text not null,
  full_name      text not null,
  email          text,
  department_id  uuid,
  status         text not null default 'active' check (status in ('active','suspended','left')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  unique (institution_id, id),
  unique (institution_id, staff_number),
  unique (institution_id, user_id),
  foreign key (institution_id, department_id) references uniattend.departments(institution_id, id)
);
create index lecturers_user on uniattend.lecturers(user_id);
create index lecturers_email on uniattend.lecturers(institution_id, lower(email));

create table uniattend.modules (
  id                 uuid primary key default gen_random_uuid(),
  institution_id     uuid not null references uniattend.institutions(id) on delete cascade,
  department_id      uuid,
  academic_period_id uuid,
  code               text not null,
  title              text not null,
  credits            int check (credits >= 0),
  min_attendance_pct int check (min_attendance_pct between 0 and 100),  -- null = institution default
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz,
  unique (institution_id, id),
  unique nulls not distinct (institution_id, code, academic_period_id),
  foreign key (institution_id, department_id) references uniattend.departments(institution_id, id),
  foreign key (institution_id, academic_period_id) references uniattend.academic_periods(institution_id, id)
);

create table uniattend.module_enrolments (
  id             uuid primary key default gen_random_uuid(),
  institution_id uuid not null references uniattend.institutions(id) on delete cascade,
  module_id      uuid not null,
  student_id     uuid not null,
  status         text not null default 'active' check (status in ('active','dropped')),
  created_at     timestamptz not null default now(),
  unique (module_id, student_id),
  foreign key (institution_id, module_id)  references uniattend.modules(institution_id, id) on delete cascade,
  foreign key (institution_id, student_id) references uniattend.students(institution_id, id) on delete cascade
);
create index module_enrolments_student on uniattend.module_enrolments(student_id);

create table uniattend.lecturer_assignments (
  id             uuid primary key default gen_random_uuid(),
  institution_id uuid not null references uniattend.institutions(id) on delete cascade,
  module_id      uuid not null,
  lecturer_id    uuid not null,
  role           text not null default 'primary' check (role in ('primary','assistant')),
  created_at     timestamptz not null default now(),
  unique (module_id, lecturer_id),
  foreign key (institution_id, module_id)   references uniattend.modules(institution_id, id) on delete cascade,
  foreign key (institution_id, lecturer_id) references uniattend.lecturers(institution_id, id) on delete cascade
);
create index lecturer_assignments_lecturer on uniattend.lecturer_assignments(lecturer_id);

create table uniattend.timetables (
  id             uuid primary key default gen_random_uuid(),
  institution_id uuid not null references uniattend.institutions(id) on delete cascade,
  module_id      uuid not null,
  venue_id       uuid,
  weekday        int not null check (weekday between 1 and 7),   -- ISO: 1 = Monday
  starts_at      time not null,
  ends_at        time not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (ends_at > starts_at),
  foreign key (institution_id, module_id) references uniattend.modules(institution_id, id) on delete cascade,
  foreign key (institution_id, venue_id)  references uniattend.venues(institution_id, id)
);

do $$
declare t text;
begin
  foreach t in array array['campuses','venues','faculties','departments','academic_programmes',
                           'academic_periods','students','lecturers','modules','timetables']
  loop
    execute format('create trigger %I before update on uniattend.%I
                    for each row execute function uniattend.touch_updated_at()', t || '_touch', t);
  end loop;
end $$;
