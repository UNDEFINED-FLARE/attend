-- UniAttend 0028 — operations: which migrations ran, background-job health, audited exports.
--
-- * schema_versions: one row per UniAttend migration. Migrations are run by hand
--   in the SQL editor, so Supabase's own history never listed them; from now on
--   each migration records itself here. This one records 0001–0028 (all of which
--   are applied before it can run, since it is applied in order).
-- * health_report(): what /api/health shows an uptime monitor — the latest
--   migration, and the names of UniAttend background jobs whose last run failed
--   or that have not run for longer than they should. Nothing private: no data,
--   no secrets, no job commands.
-- * log_export(): every download of attendance or personal data is written to the
--   audit log (who, what, how many rows). Admin exports, lecturers' module reports,
--   rejected-row reports and personal-data downloads all call it.

create table if not exists uniattend.schema_versions (
  version    text primary key check (version ~ '^[0-9]{14}$'),
  name       text not null,
  applied_at timestamptz not null default now()
);
alter table uniattend.schema_versions enable row level security;
drop policy if exists schema_versions_select on uniattend.schema_versions;
create policy schema_versions_select on uniattend.schema_versions for select to authenticated
  using (uniattend.is_super_admin());
grant select on uniattend.schema_versions to authenticated;

insert into uniattend.schema_versions (version, name) values
  ('20261107000001', 'core'), ('20261107000002', 'attendance'), ('20261107000003', 'saas'),
  ('20261107000004', 'rls'), ('20261107000005', 'functions'), ('20261108000006', 'fix_import_safeupdate'),
  ('20261109000007', 'timetables_scale'), ('20261109000008', 'timetable_details'),
  ('20261109000009', 'institution_setup'), ('20261109000010', 'late_arrivals'),
  ('20261109000011', 'push_notifications'), ('20261110000012', 'security_hardening'),
  ('20261110000013', 'campus_location_sharing'), ('20261111000014', 'attendance_register'),
  ('20261111000015', 'early_warning'), ('20261111000016', 'checkin_controls'),
  ('20261111000017', 'remove_location_sharing'), ('20261112000018', 'targeted_notifications'),
  ('20261112000019', 'theme_versions_branding'), ('20261112000020', 'offline_checkin'),
  ('20261113000021', 'membership_consent'), ('20261113000022', 'manual_billing'),
  ('20261113000023', 'data_governance'), ('20261113000024', 'integrations'),
  ('20261114000025', 'sync_engine'), ('20261114000026', 'import_mappings'),
  ('20261114000027', 'timetable_events'), ('20261114000028', 'operations')
on conflict (version) do nothing;

-- ---------------------------------------------------------------- health
-- A job is failing when its last finished run failed, or it is late: the
-- every-minute push job after 10 minutes, the daily jobs after 26 hours.
create or replace function uniattend.health_report()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_jobs jsonb := '[]'::jsonb;
  v_failing text[] := '{}';
begin
  if to_regclass('cron.job_run_details') is not null then
    execute $q$
      select coalesce(jsonb_agg(jsonb_build_object('job', j.jobname, 'last_status', d.status,
                                                   'last_run', d.start_time) order by j.jobname), '[]'::jsonb),
             coalesce(array_agg(j.jobname order by j.jobname) filter (where
               case when d.start_time is null then j.jobname = 'uniattend-push'   -- daily jobs may not have run yet
                    else d.status <> 'succeeded'
                         or d.start_time < now() - case j.jobname when 'uniattend-push' then interval '10 minutes'
                                                                   else interval '26 hours' end end), '{}')
      from cron.job j
      -- The latest finished run (a run in progress is neither a success nor a failure yet).
      left join lateral (select r.status, r.start_time from cron.job_run_details r
                         where r.jobid = j.jobid and r.status in ('succeeded', 'failed')
                         order by r.start_time desc limit 1) d on true
      where j.jobname like 'uniattend-%'
    $q$ into v_jobs, v_failing;
  end if;
  return jsonb_build_object(
    'schema', (select max(version) from uniattend.schema_versions),
    'jobs', v_jobs,
    'failing_jobs', to_jsonb(v_failing));
end $$;

-- ---------------------------------------------------------------- exports
create or replace function uniattend.log_export(p_kind text, p_rows integer, p_inst uuid default null,
                                                p_module uuid default null, p_details jsonb default '{}')
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_inst uuid := p_inst;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  if p_kind not in ('admin_data', 'module_report', 'rejected_rows', 'personal_data') then
    raise exception 'Unknown export.' using errcode = '22023';
  end if;
  if p_module is not null then
    select m.institution_id into v_inst from uniattend.modules m where m.id = p_module;
    if v_inst is null or not (uniattend.teaches_module(p_module) or uniattend.is_inst_admin(v_inst)) then
      raise exception 'Not allowed.' using errcode = '42501';
    end if;
  elsif p_kind = 'personal_data' then
    -- Logged against each institution the person belongs to, so its admins see it.
    insert into uniattend.audit_logs (institution_id, actor_id, action, entity, details)
    select distinct r.institution_id, auth.uid(), 'export', p_kind, jsonb_build_object('rows', greatest(p_rows, 0))
    from uniattend.user_roles r where r.user_id = auth.uid() and r.status = 'active';
    return;
  elsif v_inst is null or not uniattend.is_inst_admin(v_inst) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  insert into uniattend.audit_logs (institution_id, actor_id, action, entity, entity_id, details)
  values (v_inst, auth.uid(), 'export', p_kind, p_module::text,
          jsonb_build_object('rows', greatest(p_rows, 0))
          || (select coalesce(jsonb_object_agg(k, left(v #>> '{}', 200)), '{}'::jsonb)
              from jsonb_each(case when jsonb_typeof(p_details) = 'object' then p_details else '{}'::jsonb end) e(k, v)
              where k in ('kind', 'filter', 'run', 'archived')));
end $$;

revoke execute on function uniattend.health_report() from public;
revoke execute on function uniattend.log_export(text, integer, uuid, uuid, jsonb) from public, anon;
grant execute on function uniattend.health_report() to anon, authenticated;
grant execute on function uniattend.log_export(text, integer, uuid, uuid, jsonb) to authenticated;
