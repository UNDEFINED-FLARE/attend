-- UniAttend 0011 — phone notifications.
--
-- Every notification row (attendance open, check-in results, late decisions,
-- corrections, disputes) can now also be pushed to the person's phone or browser.
-- New sources of notifications:
--   * class reminders, queued shortly before each timetabled class;
--   * announcements, fanned out to their audience when published.
-- A sender (the app's /api/push/dispatch, called every minute by pg_cron) claims
-- unsent notifications with a shared secret and delivers them with Web Push.

-- ------------------------------------------------------------ subscriptions
create table uniattend.push_subscriptions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  endpoint      text not null unique check (endpoint ~ '^https://' and length(endpoint) <= 1000),
  p256dh        text not null check (length(p256dh) between 20 and 200),
  auth          text not null check (length(auth) between 8 and 100),
  user_agent    text check (user_agent is null or length(user_agent) <= 300),
  -- What this device wants: class reminders, announcements, attendance updates.
  prefs         jsonb not null default '{"classes": true, "announcements": true, "attendance": true}'::jsonb,
  created_at    timestamptz not null default now(),
  last_sent_at  timestamptz
);
create index push_subscriptions_user on uniattend.push_subscriptions(user_id);
alter table uniattend.push_subscriptions enable row level security;
create policy push_subscriptions_own on uniattend.push_subscriptions for select to authenticated
  using (user_id = (select auth.uid()));
create policy push_subscriptions_delete on uniattend.push_subscriptions for delete to authenticated
  using (user_id = (select auth.uid()));
-- Inserts and updates go through save_push_subscription(), which also moves a
-- device from a previous account to the one now signed in.

-- The sender's shared secret, stored as a hash. No policies: only functions read it.
create table uniattend.push_config (
  id             int primary key default 1 check (id = 1),
  secret_sha256  text not null check (secret_sha256 ~ '^[0-9a-f]{64}$'),
  reminder_minutes int not null default 15 check (reminder_minutes between 5 and 120),
  updated_at     timestamptz not null default now()
);
alter table uniattend.push_config enable row level security;

-- ------------------------------------------------------- notifications
alter table uniattend.notifications add column if not exists pushed_at timestamptz;
alter table uniattend.notifications add column if not exists dedupe_key text;
create unique index if not exists notifications_dedupe on uniattend.notifications(dedupe_key) where dedupe_key is not null;
create index if not exists notifications_unpushed on uniattend.notifications(created_at) where pushed_at is null;
-- Nothing already in people's inboxes is pushed.
update uniattend.notifications set pushed_at = created_at where pushed_at is null;

-- ---------------------------------------------------------------- functions

create or replace function uniattend.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text,
                                                            p_user_agent text default null, p_prefs jsonb default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_prefs jsonb;
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '42501'; end if;
  v_prefs := jsonb_build_object(
    'classes',       coalesce((p_prefs->>'classes')::boolean, true),
    'announcements', coalesce((p_prefs->>'announcements')::boolean, true),
    'attendance',    coalesce((p_prefs->>'attendance')::boolean, true));
  insert into uniattend.push_subscriptions as ps (user_id, endpoint, p256dh, auth, user_agent, prefs)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300), v_prefs)
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
        user_agent = excluded.user_agent, prefs = excluded.prefs
  returning ps.id into v_id;
  return v_id;
end $$;

create or replace function uniattend.set_push_secret(p_secret text, p_reminder_minutes int default 15)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not uniattend.is_super_admin() then raise exception 'super admin only' using errcode = '42501'; end if;
  if length(coalesce(p_secret, '')) < 32 then raise exception 'use a secret of at least 32 characters'; end if;
  insert into uniattend.push_config (id, secret_sha256, reminder_minutes)
  values (1, encode(extensions.digest(p_secret, 'sha256'), 'hex'), p_reminder_minutes)
  on conflict (id) do update set secret_sha256 = excluded.secret_sha256,
    reminder_minutes = excluded.reminder_minutes, updated_at = now();
end $$;

create or replace function uniattend.push_secret_ok(p_secret text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from uniattend.push_config
                 where id = 1 and secret_sha256 = encode(extensions.digest(coalesce(p_secret, ''), 'sha256'), 'hex'));
$$;

-- Reminders for classes starting within the next N minutes (South African time),
-- one per student per class per day. Safe to call as often as you like.
create or replace function uniattend.queue_class_reminders(p_minutes int default 15)
returns int language plpgsql security definer set search_path = '' as $$
declare v_now timestamp := now() at time zone 'Africa/Johannesburg'; n int;
begin
  insert into uniattend.notifications (institution_id, user_id, kind, title, body, link, dedupe_key)
  select t.institution_id, s.user_id, 'class_reminder',
         m.code || ' starts at ' || to_char(t.starts_at, 'HH24:MI'),
         initcap(t.kind) || ' · ' || coalesce(v.name, 'venue not set') || coalesce(' · ' || l.full_name, '')
           || ' · until ' || to_char(t.ends_at, 'HH24:MI'),
         '/student/map',
         'class:' || t.id || ':' || v_now::date || ':' || s.user_id
  from uniattend.timetables t
  join uniattend.modules m on m.id = t.module_id and m.deleted_at is null
  join uniattend.institutions i on i.id = t.institution_id and i.status = 'active'
  join uniattend.module_enrolments e on e.module_id = t.module_id and e.status = 'active'
  join uniattend.students s on s.id = e.student_id and s.user_id is not null and s.status = 'active' and s.deleted_at is null
  left join uniattend.venues v on v.id = t.venue_id
  left join uniattend.lecturers l on l.id = t.lecturer_id
  where t.weekday = extract(isodow from v_now)::int
    and t.starts_at >  v_now::time
    and t.starts_at <= (v_now + make_interval(mins => least(120, greatest(1, p_minutes))))::time
    and (v_now + make_interval(mins => least(120, greatest(1, p_minutes))))::date = v_now::date
  on conflict (dedupe_key) where dedupe_key is not null do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- Announcements reach their audience's inboxes (and phones) when published.
create or replace function uniattend.fan_out_announcement()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.published_at > now() + interval '1 minute' then return new; end if;  -- scheduled ones are not supported yet
  insert into uniattend.notifications (institution_id, user_id, kind, title, body, link, dedupe_key)
  select distinct on (r.user_id) coalesce(new.institution_id, r.institution_id), r.user_id, 'announcement', new.title,
         left(new.body, 500), '/notifications', 'ann:' || new.id || ':' || r.user_id
  from uniattend.user_roles r
  where r.status = 'active'
    and (new.institution_id is null or r.institution_id = new.institution_id)
    and case new.audience
          when 'students'  then r.role = 'student'
          when 'lecturers' then r.role = 'lecturer'
          when 'admins'    then r.role in ('institution_admin', 'super_admin')
          else true end
  on conflict (dedupe_key) where dedupe_key is not null do nothing;
  return new;
end $$;
create trigger announcements_fan_out after insert on uniattend.announcements
  for each row execute function uniattend.fan_out_announcement();

-- The sender claims what to deliver. Queues due class reminders first, skips
-- anything older than an hour, and marks what it returns as pushed.
create or replace function uniattend.push_claim(p_secret text, p_limit int default 500)
returns table (notification_id uuid, kind text, title text, body text, link text, created_at timestamptz,
               institution_name text, logo_url text, endpoint text, p256dh text, auth text)
language plpgsql security definer set search_path = '' as $$
declare v_minutes int; v_ids uuid[];
begin
  if not uniattend.push_secret_ok(p_secret) then raise exception 'not allowed' using errcode = '42501'; end if;
  select reminder_minutes into v_minutes from uniattend.push_config where id = 1;
  perform uniattend.queue_class_reminders(v_minutes);

  update uniattend.notifications n set pushed_at = now()
   where n.pushed_at is null and n.created_at < now() - interval '1 hour';

  with picked as (
    select n.id from uniattend.notifications n
    where n.pushed_at is null
    order by n.created_at
    limit least(greatest(coalesce(p_limit, 500), 1), 2000)
    for update skip locked),
  claimed as (
    update uniattend.notifications n set pushed_at = now()
      from picked where n.id = picked.id
    returning n.id)
  select coalesce(array_agg(id), '{}') into v_ids from claimed;

  return query
  select n.id, n.kind, n.title, n.body, n.link, n.created_at,
         coalesce(nullif(i.theme->'header'->>'title', ''), i.name),
         nullif(i.theme->'header'->>'logoUrl', ''),
         ps.endpoint, ps.p256dh, ps.auth
  from uniattend.notifications n
  join uniattend.push_subscriptions ps on ps.user_id = n.user_id
  left join uniattend.institutions i on i.id = n.institution_id
  where n.id = any(v_ids)
    and coalesce((ps.prefs->>(case when n.kind = 'class_reminder' then 'classes'
                                   when n.kind = 'announcement' then 'announcements'
                                   else 'attendance' end))::boolean, true);
end $$;

-- A subscription the push service says is gone (404/410).
create or replace function uniattend.push_forget(p_secret text, p_endpoint text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not uniattend.push_secret_ok(p_secret) then raise exception 'not allowed' using errcode = '42501'; end if;
  delete from uniattend.push_subscriptions where endpoint = p_endpoint;
end $$;

create or replace function uniattend.push_sent(p_secret text, p_endpoints text[])
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not uniattend.push_secret_ok(p_secret) then raise exception 'not allowed' using errcode = '42501'; end if;
  update uniattend.push_subscriptions set last_sent_at = now() where endpoint = any(p_endpoints);
end $$;

-- ------------------------------------------------------------------ grants
do $$
declare f text;
begin
  foreach f in array array[
    'save_push_subscription(text,text,text,text,jsonb)', 'set_push_secret(text,integer)', 'push_secret_ok(text)',
    'queue_class_reminders(integer)', 'fan_out_announcement()', 'push_claim(text,integer)',
    'push_forget(text,text)', 'push_sent(text,text[])'] loop
    execute format('revoke all on function uniattend.%s from public, anon', f);
  end loop;
end $$;
grant execute on function uniattend.save_push_subscription(text,text,text,text,jsonb) to authenticated;
grant execute on function uniattend.set_push_secret(text,integer) to authenticated;
-- The sender calls these with the publishable key and the shared secret.
grant execute on function uniattend.push_claim(text,integer) to anon, authenticated;
grant execute on function uniattend.push_forget(text,text) to anon, authenticated;
grant execute on function uniattend.push_sent(text,text[]) to anon, authenticated;

-- "Send me a test" from the notification settings.
create or replace function uniattend.push_test()
returns void language plpgsql security definer set search_path = '' as $$
declare v_inst uuid;
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if (select count(*) from uniattend.notifications where user_id = auth.uid() and kind = 'test'
        and created_at > now() - interval '1 minute') >= 3 then
    raise exception 'Wait a minute before sending another test.' using errcode = 'P0001';
  end if;
  select institution_id into v_inst from uniattend.user_roles where user_id = auth.uid() and status = 'active'
   order by institution_id nulls last limit 1;
  insert into uniattend.notifications (institution_id, user_id, kind, title, body, link)
  values (v_inst, auth.uid(), 'test', 'Notifications are on', 'You''ll get class reminders, announcements and attendance updates here.', '/notifications');
end $$;
revoke all on function uniattend.push_test() from public, anon;
grant execute on function uniattend.push_test() to authenticated;
