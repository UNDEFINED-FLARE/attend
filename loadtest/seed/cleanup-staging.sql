-- Removes everything the load tests created on STAGING: the loadtest institution (cascades its
-- modules, sessions, records, events, enrolments) and every auth user whose email starts with
-- "loadtest+" (seeded students, the lecturer, and registration-test sign-ups).
--   set uniattend.loadtest_target = 'staging';   -- required, same SQL session

do $$
declare n int;
begin
  if coalesce(current_setting('uniattend.loadtest_target', true), '') <> 'staging' then
    raise exception 'Refusing: set uniattend.loadtest_target = ''staging''; first.';
  end if;
  -- Order matters: the audit triggers on user_roles and students write audit_logs rows that
  -- reference the institution, so those go first while the institution still exists.
  delete from auth.users where email like 'loadtest+%';
  get diagnostics n = row_count;
  delete from uniattend.students where institution_id = md5('loadtest-institution')::uuid;
  delete from uniattend.user_roles where institution_id = md5('loadtest-institution')::uuid;
  delete from uniattend.institutions where id = md5('loadtest-institution')::uuid;
  raise notice 'Removed the loadtest institution and % auth users.', n;
end $$;
