-- UniAttend 0027 — indexes from docs/capacity/10k-readiness-report.md (P0 item 2).
--
-- The report lists these as missing (B-2/D-9 follow-ups); each matches a query the app runs
-- often. On a large production table, build them first with CREATE INDEX CONCURRENTLY outside
-- a transaction; IF NOT EXISTS then makes this migration a no-op for them.
--
-- (An earlier version of this update also changed grant_role and link_my_accounts for S-1.
-- 0021 membership_consent covers S-1 its own way, so those parts were dropped.)

create index if not exists verification_events_session on uniattend.attendance_verification_events(session_id);
create index if not exists class_sessions_lecturer on uniattend.class_sessions(lecturer_id) where lecturer_id is not null;
create index if not exists class_sessions_venue on uniattend.class_sessions(venue_id) where venue_id is not null;
-- The student home and /student/history ask for the student's own records and disputes (B-4).
create index if not exists attendance_disputes_student on uniattend.attendance_disputes(student_id, created_at desc);
