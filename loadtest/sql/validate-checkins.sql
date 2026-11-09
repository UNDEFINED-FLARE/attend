-- Run after each check-in test (staging). Read-only. Results go in the report's §8 table.
-- Expected: query 1 = 0 rows; the others quantify findings D-2, D-4 and outcome mix.

-- 1. Duplicate attendance records (must be zero; the unique constraint should make this impossible)
select session_id, student_id, count(*) as records
from uniattend.attendance_records
where institution_id = md5('loadtest-institution')::uuid
group by 1, 2 having count(*) > 1;

-- 2. Students with more than one ACCEPTED verification event in a session (finding D-2: racing duplicates)
select count(*) as students_with_duplicate_accepted_events, coalesce(sum(n - 1), 0) as extra_accepted_events
from (select session_id, student_id, count(*) n
      from uniattend.attendance_verification_events
      where institution_id = md5('loadtest-institution')::uuid and outcome = 'accepted'
      group by 1, 2 having count(*) > 1) d;

-- 3. Duplicate "you are checked in" notifications (side effect of D-2)
select count(*) as users_with_duplicate_checkin_notifications
from (select user_id, count(*) n
      from uniattend.notifications
      where institution_id = md5('loadtest-institution')::uuid and kind in ('check_in_ok', 'check_in_review')
      group by 1 having count(*) > (select count(*) from uniattend.class_sessions
                                    where institution_id = md5('loadtest-institution')::uuid)) d;

-- 4. Evidence rows per record above the expected maximum of 3 (qr, gps, device)
select count(*) as records_with_excess_evidence
from (select record_id from uniattend.attendance_evidence
      where institution_id = md5('loadtest-institution')::uuid and kind in ('qr','gps','device')
      group by 1 having count(*) > 3) e;

-- 5. Outcome mix of every attempt
select outcome, count(*) from uniattend.attendance_verification_events
where institution_id = md5('loadtest-institution')::uuid group by 1 order by 1;

-- 6. Record status mix, and records vs distinct students
select status, count(*) as records, count(distinct student_id) as students
from uniattend.attendance_records where institution_id = md5('loadtest-institution')::uuid group by 1 order by 1;

-- 7. late_pending left behind in closed sessions (finding D-4; run after closing the sessions)
select count(*) as orphan_late_pending
from uniattend.attendance_records ar join uniattend.class_sessions cs on cs.id = ar.session_id
where ar.institution_id = md5('loadtest-institution')::uuid and ar.status = 'late_pending' and cs.status = 'closed';

-- 8. Check-ins per second at the database, for comparison with k6's RPS (accepted + review)
select date_trunc('second', created_at) as second, count(*)
from uniattend.attendance_verification_events
where institution_id = md5('loadtest-institution')::uuid and outcome in ('accepted', 'review')
group by 1 order by 2 desc limit 10;
