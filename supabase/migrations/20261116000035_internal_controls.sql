-- 0035 — internal controls: step-up ("confirm it's you") on privileged role
-- changes, and new-device sign-in alerts. (2026-11-16)
--
-- SAFE TO DEPLOY AS-IS: step-up enforcement is gated by a platform flag that is
-- OFF by default, so this migration changes no behaviour until a super admin
-- turns it on (uniattend.set_step_up_enabled(true)) AND the UI is wired to the
-- P0004 prompt (see docs/INTERNAL-CONTROLS.md). New-device alerts fire only once
-- note_sign_in() is called from the sign-in flow.
--
-- Builds on what main already has (membership-consent alerts, last-admin guard,
-- app-lock, support-access least privilege); adds the two pieces it lacked.

-- ------------------------------------------------ platform security settings
create table uniattend.security_settings (
  id              boolean primary key default true check (id),   -- single row
  step_up_enabled boolean not null default false,
  updated_at      timestamptz not null default now()
);
insert into uniattend.security_settings (id) values (true) on conflict do nothing;
alter table uniattend.security_settings enable row level security;
create policy security_settings_read on uniattend.security_settings
  for select to authenticated using (true);
grant select on uniattend.security_settings to authenticated;
grant select, insert, update, delete on uniattend.security_settings to service_role;

create or replace function uniattend.set_step_up_enabled(p_on boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not uniattend.is_super_admin() then raise exception 'super admin only' using errcode = '42501'; end if;
  update uniattend.security_settings set step_up_enabled = coalesce(p_on, false), updated_at = now() where id;
end $$;

-- --------------------------------------------- step-up ("confirm it's you")
-- Written ONLY by the step-up Edge Function (service role) after it re-checks the
-- user's password, so nobody can grant themselves step-up from the client.
create table uniattend.admin_step_up (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  verified_at timestamptz not null default now()
);
alter table uniattend.admin_step_up enable row level security;
create policy admin_step_up_read on uniattend.admin_step_up
  for select to authenticated using (user_id = (select auth.uid()));
grant select on uniattend.admin_step_up to authenticated;
grant select, insert, update, delete on uniattend.admin_step_up to service_role;

create or replace function uniattend.step_up_active()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from uniattend.admin_step_up
                 where user_id = auth.uid() and verified_at > now() - interval '20 minutes');
$$;

create or replace function uniattend.require_step_up()
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  if not uniattend.step_up_active() then
    raise exception 'Confirm it''s you to continue.' using errcode = 'P0004';
  end if;
end $$;

-- Called on sign-out / "sign out everywhere" so the next dangerous action re-confirms.
create or replace function uniattend.clear_step_up()
returns void language sql volatile security definer set search_path = '' as $$
  delete from uniattend.admin_step_up where user_id = auth.uid();
$$;

-- Enforce step-up on privileged role changes, whatever path makes the write
-- (grant_role, set_role_status, ...). Fires only when enabled, for an interactive
-- user acting on SOMEONE ELSE. Self-service (signup, linking your own account,
-- leaving) and service-role/system writes are exempt.
create or replace function uniattend.user_roles_step_up()
returns trigger language plpgsql security definer set search_path = '' as $$
declare powerful text[] := array['institution_admin','super_admin','faculty_admin',
                                 'department_admin','integration_admin','attendance_officer','auditor'];
begin
  if auth.uid() is null then return new; end if;            -- service role / migrations
  if new.user_id = auth.uid() then return new; end if;      -- self-service
  if not (new.role = any (powerful)) then return new; end if;
  if tg_op = 'UPDATE' and new.role = old.role and new.status is not distinct from old.status
     and new.left_at is not distinct from old.left_at then return new; end if;  -- nothing security-relevant changed
  if not coalesce((select step_up_enabled from uniattend.security_settings where id), false) then return new; end if;
  perform uniattend.require_step_up();
  return new;
end $$;
create trigger user_roles_step_up before insert or update on uniattend.user_roles
  for each row execute function uniattend.user_roles_step_up();

-- --------------------------------------------------- new-device sign-in alerts
-- Written only through note_sign_in(), so a borrowed session cannot quietly mark
-- its own device "known" to suppress the alert.
create table uniattend.known_devices (
  user_id     uuid not null references auth.users(id) on delete cascade,
  device_hash text not null,
  label       text,
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now(),
  primary key (user_id, device_hash)
);
alter table uniattend.known_devices enable row level security;
create policy known_devices_read on uniattend.known_devices
  for select to authenticated using (user_id = (select auth.uid()));
grant select on uniattend.known_devices to authenticated;
grant select, insert, update, delete on uniattend.known_devices to service_role;

-- Call once just after sign-in. A new device on an admin/staff account that
-- already has at least one known device raises an alert to the owner.
create or replace function uniattend.note_sign_in(p_device_hash text, p_label text default null)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare uid uuid := auth.uid(); known boolean; privileged boolean; seen int;
  powerful text[] := array['super_admin','institution_admin','faculty_admin','department_admin',
                           'integration_admin','attendance_officer','auditor'];
begin
  if uid is null or p_device_hash is null or length(p_device_hash) not between 8 and 128 then return; end if;
  select exists (select 1 from uniattend.known_devices where user_id = uid and device_hash = p_device_hash) into known;
  select count(*) into seen from uniattend.known_devices where user_id = uid;
  insert into uniattend.known_devices (user_id, device_hash, label)
  values (uid, p_device_hash, left(coalesce(p_label, ''), 120))
  on conflict (user_id, device_hash) do update set last_seen = now();
  if known then return; end if;
  select exists (select 1 from uniattend.user_roles
                 where user_id = uid and status = 'active' and role = any (powerful)) into privileged;
  if privileged and seen > 0 then
    insert into uniattend.notifications (institution_id, user_id, kind, title, body, link)
    select r.institution_id, uid, 'new_device', 'New sign-in to your account',
           'A device we had not seen before signed in' ||
             coalesce(' (' || left(p_label, 120) || ')', '') ||
             '. If this was not you, change your password and sign out everywhere.', '/settings'
    from uniattend.user_roles r
    where r.user_id = uid and r.status = 'active' and r.role = any (powerful)
    order by case r.role when 'super_admin' then 0 else 1 end
    limit 1;
  end if;
end $$;

-- ------------------------------------------------------------------- grants
-- New functions default to EXECUTE for PUBLIC; lock them down.
do $$
declare fn text;
begin
  foreach fn in array array[
    'step_up_active()', 'require_step_up()', 'clear_step_up()', 'note_sign_in(text,text)',
    'set_step_up_enabled(boolean)', 'user_roles_step_up()']
  loop
    execute format('revoke all on function uniattend.%s from public, anon', fn);
  end loop;
  grant execute on function uniattend.note_sign_in(text,text), uniattend.clear_step_up(),
                           uniattend.set_step_up_enabled(boolean) to authenticated;
end $$;

insert into uniattend.schema_versions (version, name) values ('20261116000035', 'internal_controls')
on conflict (version) do nothing;
