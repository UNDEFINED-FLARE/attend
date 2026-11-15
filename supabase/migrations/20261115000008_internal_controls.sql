-- 0008 — internal controls against a misused or borrowed admin account (2026-11-15)
--
-- Three layers, friction only where it matters:
--   * Step-up ("confirm it's you"): the dangerous actions need a recent password
--     re-check. Enforced here in the database, so a modified client or a direct
--     RPC call cannot skip it. One confirmation lasts 20 minutes.
--   * Alerts: every dangerous action notifies the OTHER admins and the person
--     affected, and a sign-in from a new device alerts the account owner. Passive,
--     so a borrowed-session or stolen-password attack is seen within seconds.
--   * Damage limits: the last administrator of an institution cannot be removed.

-- ========================================================= step-up ("sudo")

-- Set ONLY by the step-up Edge Function (service_role) after it re-checks the
-- user's password. Users may read their own row but never write it, so nobody
-- can grant themselves step-up from the client.
create table public.admin_step_up (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  verified_at timestamptz not null default now()
);
alter table public.admin_step_up enable row level security;
create policy admin_step_up_select on public.admin_step_up for select to authenticated
  using (user_id = (select auth.uid()));
grant select on public.admin_step_up to authenticated;
grant select, insert, update, delete on public.admin_step_up to service_role;

create or replace function public.step_up_active()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admin_step_up
                 where user_id = auth.uid() and verified_at > now() - interval '20 minutes');
$$;

-- Raises a recognisable error (P0004) that the app maps to the "confirm it's you"
-- prompt, then retries the action once step-up is set.
create or replace function public.require_step_up()
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  if not public.step_up_active() then
    raise exception 'Confirm it''s you to continue.' using errcode = 'P0004';
  end if;
end $$;

-- Called on sign-out / "sign out everywhere" so a later action must re-confirm.
create or replace function public.clear_step_up()
returns void language sql volatile security definer set search_path = '' as $$
  delete from public.admin_step_up where user_id = auth.uid();
$$;

-- ============================================================= alerts

-- Notify every active admin of an institution (optionally not the actor).
create or replace function public.notify_admins(p_inst uuid, p_kind text, p_title text,
                                                p_body text, p_link text, p_exclude uuid default null)
returns void language sql volatile security definer set search_path = '' as $$
  insert into public.notifications (institution_id, user_id, kind, title, body, link)
  select p_inst, r.user_id, p_kind, p_title, p_body, p_link
  from public.user_roles r
  where r.institution_id = p_inst and r.role = 'institution_admin' and r.status = 'active'
    and (p_exclude is null or r.user_id <> p_exclude);
$$;

-- Devices seen for a user. Written only through note_sign_in(), so a borrowed
-- session cannot pre-register itself as "known" to suppress its own alert.
create table public.known_devices (
  user_id     uuid not null references auth.users(id) on delete cascade,
  device_hash text not null check (device_hash ~ '^[0-9a-f]{64}$'),
  label       text,
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now(),
  primary key (user_id, device_hash)
);
alter table public.known_devices enable row level security;
create policy known_devices_select on public.known_devices for select to authenticated
  using (user_id = (select auth.uid()));
grant select on public.known_devices to authenticated;
grant select, insert, update, delete on public.known_devices to service_role;

-- The app calls this once just after sign-in. A new device on a privileged
-- account (that already has at least one known device) raises an alert.
create or replace function public.note_sign_in(p_device_hash text, p_label text default null)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare uid uuid := auth.uid(); known boolean; privileged boolean; seen int;
begin
  if uid is null or p_device_hash is null or p_device_hash !~ '^[0-9a-f]{64}$' then return; end if;
  select exists (select 1 from public.known_devices where user_id = uid and device_hash = p_device_hash) into known;
  select count(*) into seen from public.known_devices where user_id = uid;
  insert into public.known_devices (user_id, device_hash, label)
  values (uid, p_device_hash, left(coalesce(p_label, ''), 120))
  on conflict (user_id, device_hash) do update set last_seen = now();
  if known then return; end if;
  select exists (select 1 from public.user_roles
                 where user_id = uid and role in ('institution_admin','super_admin') and status = 'active')
    into privileged;
  if privileged and seen > 0 then
    insert into public.notifications (institution_id, user_id, kind, title, body, link)
    select r.institution_id, uid, 'new_device', 'New sign-in to your account',
           'A device we had not seen before signed in' ||
             coalesce(' (' || left(p_label, 120) || ')', '') ||
             '. If this was not you, change your password and sign out everywhere.',
           '/settings/security'
    from public.user_roles r
    where r.user_id = uid and r.role in ('institution_admin','super_admin') and r.status = 'active'
    order by case r.role when 'super_admin' then 0 else 1 end
    limit 1;
  end if;
end $$;

-- ================================= dangerous actions: step-up + alerts + guards
-- These replace the 0005 versions, adding require_step_up() after the authority
-- check (so an unauthorised caller still fails first), alerts, and guards.

-- Keeps the 0006 confirmed-email check; adds step-up and alerts.
create or replace function public.grant_role(p_inst uuid, p_email text, p_role text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare target uuid; confirmed timestamptz; rid uuid;
begin
  if p_role = 'super_admin' then
    if not public.is_super_admin() then raise exception 'super admin only' using errcode = '42501'; end if;
    p_inst := null;
  else
    if p_role not in ('institution_admin','lecturer','student') then raise exception 'bad role'; end if;
    if not public.is_inst_admin(p_inst) then raise exception 'institution admin only' using errcode = '42501'; end if;
  end if;
  perform public.require_step_up();
  select id, email_confirmed_at into target, confirmed from auth.users where lower(email) = lower(trim(p_email));
  if target is null then raise exception 'No account uses that email yet. Ask them to sign up first.'; end if;
  if confirmed is null then
    raise exception 'That account has not confirmed its email yet. Ask them to click the link in their confirmation email, then try again.';
  end if;
  insert into public.user_roles (user_id, institution_id, role, granted_by)
  values (target, p_inst, p_role, auth.uid())
  on conflict (user_id, institution_id, role) do update set status = 'active'
  returning id into rid;
  insert into public.notifications (institution_id, user_id, kind, title, body, link)
  values (p_inst, target, 'role_granted', 'You were added as ' || replace(p_role, '_', ' '),
          'An administrator gave you this access.', '/dashboard');
  if p_inst is not null then
    perform public.notify_admins(p_inst, 'role_change', replace(p_role, '_', ' ') || ' added',
      lower(trim(p_email)) || ' was added as ' || replace(p_role, '_', ' ') || '.', '/admin', auth.uid());
  end if;
  return rid;
end $$;

create or replace function public.set_role_status(p_role_id uuid, p_status text)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.user_roles; n_admins int;
begin
  select * into r from public.user_roles where id = p_role_id;
  if r is null then raise exception 'no such role'; end if;
  if r.role = 'super_admin' or r.institution_id is null then
    if not public.is_super_admin() then raise exception 'super admin only' using errcode = '42501'; end if;
  elsif not public.is_inst_admin(r.institution_id) then
    raise exception 'institution admin only' using errcode = '42501';
  end if;
  if r.user_id = auth.uid() and p_status <> 'active' then
    raise exception 'you cannot suspend your own access';
  end if;
  if p_status not in ('active','suspended') then raise exception 'bad status'; end if;
  perform public.require_step_up();
  -- The last active administrator of an institution may not be removed.
  if r.role = 'institution_admin' and r.institution_id is not null and p_status <> 'active' then
    select count(*) into n_admins from public.user_roles
      where institution_id = r.institution_id and role = 'institution_admin' and status = 'active';
    if n_admins <= 1 then
      raise exception 'This is the only administrator. Add another before suspending this one.';
    end if;
  end if;
  update public.user_roles set status = p_status where id = p_role_id;
  if r.institution_id is not null then
    perform public.notify_admins(r.institution_id, 'role_change', 'Administrator access ' || p_status,
      'An administrator role was set to ' || p_status || '.', '/admin', auth.uid());
  end if;
end $$;

create or replace function public.set_institution_status(p_inst uuid, p_status text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_super_admin() then raise exception 'super admin only' using errcode = '42501'; end if;
  perform public.require_step_up();
  if p_status not in ('pending','active','suspended','archived') then raise exception 'bad status'; end if;
  update public.institutions set status = p_status where id = p_inst;
  if not found then raise exception 'no such institution'; end if;
  insert into public.notifications (institution_id, user_id, kind, title, body, link)
  select p_inst, r.user_id, 'institution_status', 'Institution ' || p_status,
         'Your institution is now ' || p_status || '.', '/admin'
  from public.user_roles r where r.institution_id = p_inst and r.role = 'institution_admin';
end $$;

create or replace function public.change_subscription(p_inst uuid, p_plan_code text, p_status text,
                                                      p_period_end timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
declare plan uuid;
begin
  if not public.is_super_admin() then raise exception 'super admin only' using errcode = '42501'; end if;
  perform public.require_step_up();
  select id into plan from public.subscription_plans where code = p_plan_code;
  if plan is null then raise exception 'no such plan'; end if;
  update public.institution_subscriptions
     set plan_id = plan, status = p_status, current_period_end = p_period_end
   where institution_id = p_inst and status in ('trialing','active','past_due','suspended');
  if not found then
    insert into public.institution_subscriptions (institution_id, plan_id, status, current_period_end)
    values (p_inst, plan, p_status, p_period_end);
  end if;
  perform public.notify_admins(p_inst, 'subscription', 'Subscription changed',
    'Your plan is now ' || p_plan_code || ' (' || p_status || ').', '/admin', auth.uid());
end $$;

-- ============================================================= grants
-- New functions default to EXECUTE for PUBLIC; lock them down. (0005's revoke
-- loop ran before this migration, so these need doing here.)
do $$
declare fn text;
begin
  foreach fn in array array[
    'step_up_active()', 'require_step_up()', 'clear_step_up()',
    'notify_admins(uuid,text,text,text,text,uuid)', 'note_sign_in(text,text)']
  loop
    execute format('revoke all on function public.%s from public, anon', fn);
  end loop;
  -- Only the two the client calls directly are given to authenticated.
  grant execute on function public.note_sign_in(text,text), public.clear_step_up() to authenticated;
end $$;
