-- UniAttend 0034 — UniAttend staff see a university's records only when it lets them.
--
-- Until now a platform administrator counted as an administrator of every
-- institution (is_inst_admin() included is_super_admin()), so UniAttend's own staff
-- could read every university's students and attendance. Now:
-- * is_inst_admin() is true for a platform administrator only while the
--   institution has an active support-access grant. Everything that depends on
--   it — students, attendance, evidence, reviews, reports, exports, imports,
--   corrections — is closed to UniAttend staff without one.
-- * grant_support_access(): an institution's own administrator lets UniAttend in
--   for 1 to 168 hours, with a reason. revoke_support_access() ends it at once.
--   Both are audited; UniAttend staff are notified; every action taken under a
--   grant is in the audit log with the staff member as the actor.
-- * What the platform needs to run the service stays open without a grant:
--   approving and suspending institutions, plans and billing, onboarding,
--   campus and timetable-link setup, closing an institution that asked to leave,
--   adding an institution's first administrator, and data-subject requests
--   addressed to UniAttend as operator.
-- * Explicit platform reads of personal data are removed: lecturers, the audit
--   log (institution entries), role assignments and profiles (except
--   administrators' own contact details), and integration errors.

create table if not exists uniattend.support_access_grants (
  id             uuid primary key default gen_random_uuid(),
  institution_id uuid not null references uniattend.institutions(id) on delete cascade,
  granted_by     uuid references auth.users(id) on delete set null,
  reason         text not null check (length(trim(reason)) between 5 and 500),
  expires_at     timestamptz not null,
  revoked_at     timestamptz,
  revoked_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  check (expires_at > created_at and expires_at <= created_at + interval '168 hours')
);
create index if not exists support_access_active on uniattend.support_access_grants(institution_id, expires_at) where revoked_at is null;
alter table uniattend.support_access_grants enable row level security;
drop policy if exists support_access_select on uniattend.support_access_grants;
create policy support_access_select on uniattend.support_access_grants for select to authenticated
  using (uniattend.has_role(institution_id, array['institution_admin']) or uniattend.is_super_admin());
revoke all on uniattend.support_access_grants from anon;
grant select on uniattend.support_access_grants to authenticated;

create or replace function uniattend.support_access_active(p_inst uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from uniattend.support_access_grants g
                 where g.institution_id = p_inst and g.revoked_at is null and g.expires_at > now());
$$;

-- The heart of the change.
create or replace function uniattend.is_inst_admin(p_inst uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select uniattend.has_role(p_inst, array['institution_admin'])
      or (uniattend.is_super_admin() and uniattend.support_access_active(p_inst));
$$;

-- ---------------------------------------------------------------- grants
create or replace function uniattend.grant_support_access(p_inst uuid, p_hours int, p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_name text;
begin
  -- Only the institution's own administrators decide; UniAttend cannot let itself in.
  if not uniattend.has_role(p_inst, array['institution_admin']) then
    raise exception 'Only your institution''s administrators can give UniAttend access.' using errcode = '42501';
  end if;
  if p_hours is null or p_hours < 1 or p_hours > 168 then raise exception 'Choose between 1 hour and 7 days.' using errcode = '22023'; end if;
  if length(trim(coalesce(p_reason, ''))) < 5 then raise exception 'Say what UniAttend should help with.' using errcode = '22023'; end if;
  update uniattend.support_access_grants set revoked_at = now(), revoked_by = auth.uid()
   where institution_id = p_inst and revoked_at is null and expires_at > now();
  insert into uniattend.support_access_grants (institution_id, granted_by, reason, expires_at)
  values (p_inst, auth.uid(), left(trim(p_reason), 500), now() + make_interval(hours => p_hours)) returning id into v_id;
  select name into v_name from uniattend.institutions where id = p_inst;
  insert into uniattend.notifications (institution_id, user_id, kind, title, body, link)
  select null, r.user_id, 'support_access', v_name || ' gave UniAttend access for ' || p_hours || ' h', left(trim(p_reason), 300), '/super'
  from uniattend.user_roles r where r.role = 'super_admin' and r.status = 'active';
  perform uniattend.write_audit(p_inst, 'support_access_granted', 'support_access_grants', v_id::text,
                                jsonb_build_object('hours', p_hours, 'reason', left(trim(p_reason), 300)));
  return v_id;
end $$;

create or replace function uniattend.revoke_support_access(p_inst uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if not (uniattend.has_role(p_inst, array['institution_admin']) or uniattend.is_super_admin()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  update uniattend.support_access_grants set revoked_at = now(), revoked_by = auth.uid()
   where institution_id = p_inst and revoked_at is null and expires_at > now();
  get diagnostics n = row_count;
  if n > 0 then perform uniattend.write_audit(p_inst, 'support_access_revoked', 'support_access_grants', null, '{}'::jsonb); end if;
  return n;
end $$;

-- UniAttend's view: which institutions it may currently help, and until when.
create or replace function uniattend.support_access_overview()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not uniattend.is_super_admin() then raise exception 'Not allowed.' using errcode = '42501'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('institution_id', g.institution_id, 'institution', i.name,
            'reason', g.reason, 'expires_at', g.expires_at, 'granted_at', g.created_at) order by g.expires_at), '[]'::jsonb)
          from uniattend.support_access_grants g join uniattend.institutions i on i.id = g.institution_id
          where g.revoked_at is null and g.expires_at > now());
end $$;

-- ---------------------------------------------------------------- platform tasks that need no grant
-- Campus setup and the timetable link (UniAttend sets these up during onboarding).
drop policy if exists campuses_insert on uniattend.campuses;
create policy campuses_insert on uniattend.campuses for insert to authenticated
  with check (uniattend.is_inst_admin(institution_id) or uniattend.is_super_admin());
drop policy if exists campuses_update on uniattend.campuses;
create policy campuses_update on uniattend.campuses for update to authenticated
  using (uniattend.is_inst_admin(institution_id) or uniattend.is_super_admin())
  with check (uniattend.is_inst_admin(institution_id) or uniattend.is_super_admin());
drop policy if exists campuses_delete on uniattend.campuses;
create policy campuses_delete on uniattend.campuses for delete to authenticated
  using (uniattend.is_inst_admin(institution_id) or uniattend.is_super_admin());
drop policy if exists institution_settings_update on uniattend.institution_settings;
create policy institution_settings_update on uniattend.institution_settings for update to authenticated
  using (uniattend.is_inst_admin(institution_id) or uniattend.is_super_admin())
  with check (uniattend.is_inst_admin(institution_id) or uniattend.is_super_admin());
drop policy if exists institutions_update on uniattend.institutions;
create policy institutions_update on uniattend.institutions for update to authenticated
  using (uniattend.is_inst_admin(id) or uniattend.is_super_admin())
  with check (uniattend.is_inst_admin(id) or uniattend.is_super_admin());
-- Billing.
drop policy if exists institution_subscriptions_select on uniattend.institution_subscriptions;
create policy institution_subscriptions_select on uniattend.institution_subscriptions for select to authenticated
  using (uniattend.is_inst_admin(institution_id) or uniattend.is_super_admin());
drop policy if exists payments_select on uniattend.payments;
create policy payments_select on uniattend.payments for select to authenticated
  using (uniattend.is_inst_admin(institution_id) or uniattend.is_super_admin());
drop policy if exists usage_metrics_select on uniattend.usage_metrics;
create policy usage_metrics_select on uniattend.usage_metrics for select to authenticated
  using (uniattend.is_inst_admin(institution_id) or uniattend.is_super_admin());

-- ---------------------------------------------------------------- explicit platform reads removed
drop policy if exists lecturers_select on uniattend.lecturers;
create policy lecturers_select on uniattend.lecturers for select to authenticated
  using (uniattend.is_member(institution_id) or uniattend.is_inst_admin(institution_id));
drop policy if exists audit_logs_select on uniattend.audit_logs;
create policy audit_logs_select on uniattend.audit_logs for select to authenticated
  using ((institution_id is null and uniattend.is_super_admin())
         or (institution_id is not null and (uniattend.is_inst_admin(institution_id) or uniattend.is_auditor(institution_id))));
drop policy if exists user_roles_select on uniattend.user_roles;
create policy user_roles_select on uniattend.user_roles for select to authenticated
  using (user_id = (select auth.uid())
         or (uniattend.is_super_admin() and role in ('super_admin', 'institution_admin'))
         or (institution_id is not null and (uniattend.is_inst_admin(institution_id) or uniattend.is_auditor(institution_id))));
drop policy if exists profiles_select on uniattend.profiles;
create policy profiles_select on uniattend.profiles for select to authenticated
  using (id = (select auth.uid())
         or exists (select 1 from uniattend.user_roles r
                    where r.user_id = profiles.id
                      and ((uniattend.is_super_admin() and r.role in ('super_admin', 'institution_admin'))
                           or uniattend.is_inst_admin(r.institution_id) or uniattend.is_auditor(r.institution_id)))
         or (uniattend.is_super_admin() and exists (select 1 from uniattend.data_requests d where d.user_id = profiles.id)));
drop policy if exists integration_errors_select on uniattend.integration_errors;
create policy integration_errors_select on uniattend.integration_errors for select to authenticated
  using (uniattend.can_integrate(institution_id));

-- ---------------------------------------------------------------- functions the platform uses
create or replace function uniattend._rewrite(p_fn text, p_from text, p_to text, p_times int default 1)
returns void language plpgsql set search_path = '' as $$
declare def text; n int;
begin
  select pg_get_functiondef(p.oid) into def from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'uniattend' and p.proname = p_fn;
  if def is null then raise exception '0034: function % not found', p_fn; end if;
  n := (length(def) - length(replace(def, p_from, ''))) / length(p_from);
  if n <> p_times then raise exception '0034: expected % of "%" in %, found %', p_times, p_from, p_fn, n; end if;
  execute replace(def, p_from, p_to);
end $$;
do $$
begin
  perform uniattend._rewrite('onboarding_status', 'if not uniattend.is_inst_admin(p_inst) then',
                             'if not (uniattend.is_inst_admin(p_inst) or uniattend.is_super_admin()) then');
  perform uniattend._rewrite('onboarding_sign_off', 'if not uniattend.is_inst_admin(p_inst) then',
                             'if not (uniattend.is_inst_admin(p_inst) or uniattend.is_super_admin()) then');
  -- Closing an institution deletes its credentials without needing a grant.
  perform uniattend._rewrite('revoke_integration_credentials', 'if not uniattend.is_inst_admin(p_inst) then',
                             'if not (uniattend.is_inst_admin(p_inst) or uniattend.is_super_admin()) then');
  -- UniAttend may add an institution's administrators (e.g. the first one), nothing else.
  perform uniattend._rewrite('grant_role', 'if not uniattend.is_inst_admin(p_inst) then',
                             'if not (uniattend.is_inst_admin(p_inst) or (p_role = ''institution_admin'' and uniattend.is_super_admin())) then');
end $$;
drop function uniattend._rewrite(text, text, text, int);

revoke execute on function uniattend.support_access_active(uuid) from public, anon;
revoke execute on function uniattend.grant_support_access(uuid, int, text) from public, anon;
revoke execute on function uniattend.revoke_support_access(uuid) from public, anon;
revoke execute on function uniattend.support_access_overview() from public, anon;
grant execute on function uniattend.support_access_active(uuid), uniattend.grant_support_access(uuid, int, text),
  uniattend.revoke_support_access(uuid), uniattend.support_access_overview() to authenticated;

insert into uniattend.schema_versions (version, name) values ('20261115000034', 'support_access')
on conflict (version) do nothing;
