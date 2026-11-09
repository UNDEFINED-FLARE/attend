-- Clears the load-test institution's attendance data and re-opens its sessions, so the next
-- k6 run starts from "nobody has checked in". STAGING ONLY; touches only the loadtest institution.
--   set uniattend.loadtest_target = 'staging';   -- required, same SQL session

do $$
declare inst uuid := md5('loadtest-institution')::uuid;
begin
  if coalesce(current_setting('uniattend.loadtest_target', true), '') <> 'staging' then
    raise exception 'Refusing: set uniattend.loadtest_target = ''staging''; first.';
  end if;
  delete from uniattend.attendance_records where institution_id = inst;            -- cascades evidence, disputes
  delete from uniattend.attendance_verification_events where institution_id = inst;
  delete from uniattend.notifications where institution_id = inst;
  update uniattend.class_sessions
     set status = 'open', opens_at = now(), closed_at = null,
         closes_at = now() + interval '4 hours', late_after = now() + interval '3 hours'
   where institution_id = inst and id in (select md5('loadtest-session-' || k)::uuid from generate_series(1, 1000) k);
end $$;
