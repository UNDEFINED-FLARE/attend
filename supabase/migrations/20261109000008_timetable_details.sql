-- UniAttend 0008 — details carried over from timetable imports, and admin control.
--
-- * venues.building: the building a room is in ("E-BLOCK"), so rooms can be
--   placed on the campus map together.
-- * modules.expected_students: class size from the university timetable.
-- * timetables.lecturer_id: who teaches each class, shown to students.
-- * lecturers.source: where a lecturer record came from ('timetable' for ones
--   created from an import, so admins can review them).

alter table uniattend.venues add column if not exists building text check (building is null or length(building) <= 120);
create index if not exists venues_building on uniattend.venues(institution_id, building);

alter table uniattend.modules add column if not exists expected_students int check (expected_students is null or expected_students between 0 and 100000);

alter table uniattend.lecturers add column if not exists source text check (source is null or source in ('manual','timetable','import'));

alter table uniattend.timetables add column if not exists lecturer_id uuid;
do $$
begin
  alter table uniattend.timetables
    add constraint timetables_lecturer_fk foreign key (institution_id, lecturer_id)
    references uniattend.lecturers(institution_id, id) on delete set null (lecturer_id);
exception when duplicate_object then null;
end $$;
create index if not exists timetables_lecturer on uniattend.timetables(lecturer_id);

-- * institutions.theme: the institution's own look, set on the Design page —
--   colours, header and footer, and which student cards show in what order.
--   Validated by the app; size-capped here.
alter table uniattend.institutions add column if not exists theme jsonb not null default '{}'::jsonb;
do $$
begin
  alter table uniattend.institutions add constraint institutions_theme_size check (pg_column_size(theme) < 16384);
exception when duplicate_object then null;
end $$;
