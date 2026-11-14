-- UniAttend 0026 — saved column mappings for imports.
--
-- An institution's files rarely use UniAttend's field names (STUDENT_NO, not
-- student_number). An administrator maps the columns once on the Import page and
-- the mapping is remembered per institution and dataset, so the next file with
-- the same layout needs no work. A mapping holds column names and tidy-up rules
-- only: no data from any file.

create table if not exists uniattend.integration_mappings (
  id             uuid primary key default gen_random_uuid(),
  institution_id uuid not null references uniattend.institutions(id) on delete cascade,
  dataset        text not null check (dataset in ('faculties','departments','programmes','academic_periods','venues','modules',
                                                  'lecturers','students','enrolments','assignments')),
  name           text not null check (length(trim(name)) between 1 and 80),
  mapping        jsonb not null check (jsonb_typeof(mapping) = 'object' and pg_column_size(mapping) < 8192),
  updated_by     uuid references auth.users(id) on delete set null,
  updated_at     timestamptz not null default now(),
  unique (institution_id, dataset, name)
);

alter table uniattend.integration_mappings enable row level security;
drop policy if exists integration_mappings_select on uniattend.integration_mappings;
create policy integration_mappings_select on uniattend.integration_mappings for select to authenticated
  using (uniattend.is_inst_admin(institution_id));
drop policy if exists integration_mappings_insert on uniattend.integration_mappings;
create policy integration_mappings_insert on uniattend.integration_mappings for insert to authenticated
  with check (uniattend.is_inst_admin(institution_id));
drop policy if exists integration_mappings_update on uniattend.integration_mappings;
create policy integration_mappings_update on uniattend.integration_mappings for update to authenticated
  using (uniattend.is_inst_admin(institution_id)) with check (uniattend.is_inst_admin(institution_id));
drop policy if exists integration_mappings_delete on uniattend.integration_mappings;
create policy integration_mappings_delete on uniattend.integration_mappings for delete to authenticated
  using (uniattend.is_inst_admin(institution_id));
revoke all on uniattend.integration_mappings from anon;
grant select, insert, update, delete on uniattend.integration_mappings to authenticated;
