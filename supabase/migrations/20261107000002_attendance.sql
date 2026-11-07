-- UniAttend 0002 — attendance sessions, records, verification and disputes.

create table public.class_sessions (
  id              uuid primary key default gen_random_uuid(),
  institution_id  uuid not null references public.institutions(id) on delete cascade,
  module_id       uuid not null,
  venue_id        uuid,
  lecturer_id     uuid,
  title           text not null default 'Lecture',
  status          text not null default 'open' check (status in ('scheduled','open','closed','cancelled')),
  opens_at        timestamptz not null default now(),
  closes_at       timestamptz not null,
  late_after      timestamptz not null,
  closed_at       timestamptz,
  -- No 0/O/1/I: read off a projector at the back of a hall.
  join_code       text not null check (join_code ~ '^[A-HJ-NP-Z2-9]{6}$'),
  require_qr      boolean not null,
  require_gps     boolean not null,
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (institution_id, id),
  check (closes_at > opens_at),
  foreign key (institution_id, module_id)   references public.modules(institution_id, id) on delete cascade,
  foreign key (institution_id, venue_id)    references public.venues(institution_id, id),
  foreign key (institution_id, lecturer_id) references public.lecturers(institution_id, id)
);
create unique index class_sessions_open_code on public.class_sessions(institution_id, join_code) where status = 'open';
create index class_sessions_module on public.class_sessions(module_id, opens_at desc);
create trigger class_sessions_touch before update on public.class_sessions
  for each row execute function public.touch_updated_at();

-- The QR signing key. RLS is enabled with no policies, so no client can read it,
-- and nothing but SECURITY DEFINER functions in this schema ever touch it.
create table public.session_secrets (
  session_id uuid primary key references public.class_sessions(id) on delete cascade,
  secret     bytea not null
);

create table public.attendance_records (
  id              uuid primary key default gen_random_uuid(),
  institution_id  uuid not null references public.institutions(id) on delete cascade,
  session_id      uuid not null,
  module_id       uuid not null,
  student_id      uuid not null,
  status          text not null check (status in
                    ('present','absent','late','excused','pending_verification','disputed')),
  method          text not null default 'qr' check (method in ('qr','code','manual','acoustic','system')),
  score           int check (score between 0 and 100),
  checked_in_at   timestamptz,
  device_hash     text check (device_hash is null or device_hash ~ '^[0-9a-f]{64}$'),
  explanation     jsonb not null default '[]'::jsonb,
  overridden_by   uuid references auth.users(id) on delete set null,
  overridden_at   timestamptz,
  override_note   text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- The database, not the client, is what stops a second check-in.
  unique (session_id, student_id),
  unique (institution_id, id),
  foreign key (institution_id, session_id) references public.class_sessions(institution_id, id) on delete cascade,
  foreign key (institution_id, module_id)  references public.modules(institution_id, id) on delete cascade,
  foreign key (institution_id, student_id) references public.students(institution_id, id) on delete cascade
);
create index attendance_records_student on public.attendance_records(student_id, created_at desc);
create index attendance_records_module  on public.attendance_records(module_id, status);
create index attendance_records_device  on public.attendance_records(session_id, device_hash);
create trigger attendance_records_touch before update on public.attendance_records
  for each row execute function public.touch_updated_at();

-- Every attempt, accepted or not. This is the audit trail and the rate-limit source.
create table public.attendance_verification_events (
  id              uuid primary key default gen_random_uuid(),
  institution_id  uuid not null references public.institutions(id) on delete cascade,
  session_id      uuid not null,
  student_id      uuid not null,
  outcome         text not null check (outcome in ('accepted','review','rejected','duplicate')),
  score           int not null check (score between 0 and 100),
  layers          jsonb not null,           -- per-layer points and inputs summary
  reasons         jsonb not null default '[]'::jsonb,
  token_step      bigint,
  created_at      timestamptz not null default now(),
  foreign key (institution_id, session_id) references public.class_sessions(institution_id, id) on delete cascade,
  foreign key (institution_id, student_id) references public.students(institution_id, id) on delete cascade
);
create index verification_events_attempts on public.attendance_verification_events(student_id, session_id, created_at desc);

-- Minimal evidence. Privacy by design: we keep the *distance* and *accuracy*, not
-- the student's coordinates, and the device *hash*, not any device identifier.
create table public.attendance_evidence (
  id              uuid primary key default gen_random_uuid(),
  institution_id  uuid not null references public.institutions(id) on delete cascade,
  record_id       uuid not null,
  kind            text not null check (kind in ('qr','gps','device','acoustic','manual')),
  data            jsonb not null,
  created_at      timestamptz not null default now(),
  foreign key (institution_id, record_id) references public.attendance_records(institution_id, id) on delete cascade
);
create index attendance_evidence_record on public.attendance_evidence(record_id);

create table public.attendance_disputes (
  id              uuid primary key default gen_random_uuid(),
  institution_id  uuid not null references public.institutions(id) on delete cascade,
  record_id       uuid not null,
  student_id      uuid not null,
  reason          text not null check (length(trim(reason)) between 10 and 2000),
  status          text not null default 'open' check (status in ('open','upheld','rejected')),
  previous_status text not null,
  resolved_by     uuid references auth.users(id) on delete set null,
  resolution_note text,
  created_at      timestamptz not null default now(),
  resolved_at     timestamptz,
  foreign key (institution_id, record_id)  references public.attendance_records(institution_id, id) on delete cascade,
  foreign key (institution_id, student_id) references public.students(institution_id, id) on delete cascade
);
create unique index attendance_disputes_one_open on public.attendance_disputes(record_id) where status = 'open';

-- Ambient acoustic layer (ported from the aa_* design). Fingerprints are transient:
-- acoustic_submissions has RLS with no SELECT policy and rows are deleted after
-- analysis by the analyse-window Edge Function, which holds the service role.
create table public.acoustic_windows (
  id              uuid primary key default gen_random_uuid(),
  institution_id  uuid not null references public.institutions(id) on delete cascade,
  session_id      uuid not null,
  idx             int not null,
  seconds         int not null default 5 check (seconds between 3 and 15),
  nonce           text not null,
  opens_at        timestamptz not null default now(),
  closes_at       timestamptz not null,
  analysed_at     timestamptz,
  cluster_size    int not null default 0,
  lecturer_bound  boolean not null default false,
  unique (session_id, idx),
  unique (institution_id, id),
  foreign key (institution_id, session_id) references public.class_sessions(institution_id, id) on delete cascade
);

create table public.acoustic_submissions (
  window_id   uuid not null references public.acoustic_windows(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  hash_count  int not null,
  hashes      int[] not null,
  offsets     int[] not null,
  received_at timestamptz not null default now(),
  primary key (window_id, user_id)
);
