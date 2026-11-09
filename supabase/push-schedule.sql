-- UniAttend: deliver phone notifications every minute (class reminders and anything queued).
-- Run once in the Supabase SQL Editor AFTER migration 0011, as the project owner.
-- Replace the two placeholders first:
--   <SITE>    your deployed address, e.g. https://attend-blueflare.vercel.app
--   <SECRET>  the PUSH_DISPATCH_SECRET you set in Vercel (32+ characters)

-- 1. Give the database the same secret (stored only as a SHA-256 hash).
--    Run as a super admin through the app, or directly here:
insert into uniattend.push_config (id, secret_sha256, reminder_minutes)
values (1, encode(extensions.digest('<SECRET>', 'sha256'), 'hex'), 15)
on conflict (id) do update set secret_sha256 = excluded.secret_sha256, updated_at = now();

-- 2. Call the sender every minute.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule(jobid) from cron.job where jobname = 'uniattend-push';
select cron.schedule('uniattend-push', '* * * * *', $job$
  select net.http_post(
    url     := '<SITE>/api/push/dispatch',
    headers := jsonb_build_object('Authorization', 'Bearer <SECRET>', 'Content-Type', 'application/json'),
    body    := '{}'::jsonb,
    timeout_milliseconds := 55000);
$job$);

-- Check it is running (results appear within a minute):
-- select status_code, content::text, created from net._http_response order by created desc limit 5;
