-- Legacy prototype (public.aa_*): stop signed-in users from changing their own role.
--
-- NOT a UniAttend migration. The aa_* tables belong to an older attendance
-- prototype that shares this Supabase project. UniAttend's code and functions do
-- not use them, but they share the same user accounts.
--
-- The hole: policy aa_profiles_update allows a user to update their own row
-- (id = auth.uid()) and `authenticated` holds UPDATE on every column, including
-- `role`. So any signed-in user can run
--   update public.aa_profiles set role = 'lecturer' where id = auth.uid();
-- and then create sessions and read enrolled students' profiles (student numbers,
-- card barcodes, photos). aa_profiles_insert has the same gap for new rows.
--
-- The fix keeps the prototype working for everything else: a trigger forces new
-- rows from app users to 'student' and keeps the old role on update. Roles can
-- still be changed from the SQL editor or with the service role. It also takes
-- away the anon role's write grants, which it never needed.
--
-- Safe to run more than once. Changes no data. Run in the Supabase SQL editor
-- only after approval. Undo: drop trigger aa_profiles_keep_role on public.aa_profiles;

create or replace function public.aa_profiles_keep_role()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Runs as the caller (not SECURITY DEFINER), so current_user is the API role.
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      new.role := 'student';
    elsif new.role is distinct from old.role then
      new.role := old.role;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists aa_profiles_keep_role on public.aa_profiles;
create trigger aa_profiles_keep_role
  before insert or update on public.aa_profiles
  for each row execute function public.aa_profiles_keep_role();

revoke insert, update, delete on public.aa_profiles from anon;
revoke execute on function public.aa_profiles_keep_role() from public, anon, authenticated;

-- Check (should list the trigger and no anon write grants):
-- select tgname from pg_trigger where tgrelid = 'public.aa_profiles'::regclass and not tgisinternal;
-- select privilege_type from information_schema.role_table_grants
--  where table_schema = 'public' and table_name = 'aa_profiles' and grantee = 'anon';
