-- UniAttend 0035 — performance indexes from docs/capacity/10k-readiness-report.md (P0 item 2).
--
-- Each matches a query the app runs often. CREATE INDEX IF NOT EXISTS, so re-running is a
-- no-op and nothing breaks if it hasn't run yet (queries just aren't sped up until it does).
-- On a very large production table you can build these with CREATE INDEX CONCURRENTLY outside
-- a transaction instead; the IF NOT EXISTS keeps this file safe to run either way.

create index if not exists verification_events_session on uniattend.attendance_verification_events(session_id);
create index if not exists class_sessions_lecturer on uniattend.class_sessions(lecturer_id) where lecturer_id is not null;
create index if not exists class_sessions_venue on uniattend.class_sessions(venue_id) where venue_id is not null;
-- The student home and /student/history ask for the student's own records and disputes.
create index if not exists attendance_disputes_student on uniattend.attendance_disputes(student_id, created_at desc);

insert into uniattend.schema_versions (version, name) values ('20261116000035', 'readiness_indexes')
on conflict (version) do nothing;
