-- Permanently remove the ACVOSA app from the acvosa Supabase project.
-- Requested by the project owner on 2026-11-08. THIS DELETES ACVOSA'S DATA FOR GOOD.
--
-- Keeps:   schema uniattend (the new platform), every public.aa_* table/function
--          (old UniAttend data, kept for import), and all auth.users accounts.
-- Removes: ACVOSA's tables, views, functions, enum types, its signup trigger on
--          auth.users, and its storage policies. (Buckets: see step 2 below.)
--
-- Step 1: run the PREVIEW query at the bottom on its own first and read what it lists.
-- Step 2: run everything between BEGIN and COMMIT. It is one transaction and checks
--         itself: if anything other than ACVOSA would change, it rolls back.
-- Step 3: Storage → delete the buckets "activity-images" and "project-evidence"
--         (Supabase only allows deleting stored files through the Storage UI/API).

begin;

do $$
begin
  if not exists (select 1 from pg_tables where schemaname = 'uniattend') then
    raise exception 'Stopped: UniAttend is not installed in this project. Nothing was changed.';
  end if;
end $$;

-- Fingerprint of everything that must survive.
create temp table _keep_before on commit drop as
select
  (select count(*) from pg_tables where schemaname = 'public' and tablename like 'aa\_%') as aa_tables,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name like 'aa\_%') as aa_columns,
  (select count(*) from pg_policies where schemaname = 'public' and tablename like 'aa\_%') as aa_policies,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'aa\_%') as aa_functions,
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'uniattend') as ua_relations,
  (select count(*) from pg_policies where schemaname = 'uniattend') as ua_policies,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'uniattend') as ua_functions,
  (select count(*) from auth.users) as users;

-- ACVOSA's signup trigger on the shared login table.
drop trigger if exists trg_on_auth_user_created on auth.users;

-- Storage policies for ACVOSA's two buckets.
drop policy if exists "activity-images: public read"    on storage.objects;
drop policy if exists "activity-images: admin upload"   on storage.objects;
drop policy if exists "activity-images: admin update"   on storage.objects;
drop policy if exists "activity-images: admin delete"   on storage.objects;
drop policy if exists "project-evidence: public read"   on storage.objects;
drop policy if exists "project-evidence: admin upload"  on storage.objects;
drop policy if exists "project-evidence: admin delete"  on storage.objects;

drop view if exists public.activity_participants cascade;
drop view if exists public.activities_with_counts cascade;

drop table if exists
  public.attendance_records, public.reservations, public.notifications, public.deadlines,
  public.project_phases, public.project_team, public.projects, public.members,
  public.history_events, public.impact_snapshots, public.activities, public.profiles
  cascade;

-- Every overload of each ACVOSA function.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'broadcast_notification', 'cancel_reservation', 'confirm_attendance', 'generate_attendance_code',
      'handle_new_user', 'is_admin', 'prevent_self_role_escalation', 'reserve_activity')
  loop
    execute format('drop function %s cascade', f.sig);
  end loop;
end $$;

drop type if exists
  public.activity_category, public.app_role, public.attendance_method, public.attendance_status,
  public.member_role, public.member_status, public.notification_category, public.priority_level,
  public.project_status, public.reservation_status
  cascade;

-- Self-check: roll everything back if anything that must survive changed.
do $$
declare b record; a record;
begin
  select * into b from _keep_before;
  select
    (select count(*) from pg_tables where schemaname = 'public' and tablename like 'aa\_%') as aa_tables,
    (select count(*) from information_schema.columns where table_schema = 'public' and table_name like 'aa\_%') as aa_columns,
    (select count(*) from pg_policies where schemaname = 'public' and tablename like 'aa\_%') as aa_policies,
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'aa\_%') as aa_functions,
    (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'uniattend') as ua_relations,
    (select count(*) from pg_policies where schemaname = 'uniattend') as ua_policies,
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'uniattend') as ua_functions,
    (select count(*) from auth.users) as users
  into a;
  if to_jsonb(a) is distinct from to_jsonb(b) then
    raise exception 'Stopped and rolled back: something outside ACVOSA would have changed. Before: %, after: %', row_to_json(b), row_to_json(a);
  end if;
end $$;

commit;

-- After commit: anything still left in public that is not old UniAttend (aa_*).
-- An empty result means ACVOSA is gone.
select c.relname as leftover, c.relkind from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('r','v','m') and c.relname not like 'aa\_%';


-- ============================== PREVIEW (run this alone first) ==============================
-- select 'table' as kind, tablename as name, (xpath('/row/n/text()', query_to_xml(format('select count(*) n from public.%I', tablename), false, true, '')))[1]::text as rows
-- from pg_tables where schemaname = 'public' and tablename not like 'aa\_%'
-- union all
-- select 'function', p.oid::regprocedure::text, null from pg_proc p join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public' and p.proname not like 'aa\_%' and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
-- order by 1, 2;
