-- UniAttend 0033 — the institution API, version 1.
--
-- The same roster push as /api/roster, made safe to retry and easier to operate:
-- * api_roster_push(): an Idempotency-Key header makes a retried request return
--   the first answer instead of applying the roster twice. The same key with a
--   different body is refused, so a key cannot silently mean two things. Keys are
--   kept for 7 days per connection.
-- * api_status(): what the key belongs to and its last runs — for checking a new
--   key and for monitoring from the institution's side.
-- * api_run(): one run's result and its rejected rows (first 200), for that
--   connection only.
-- Every function takes the API key, finds the connection by the key's SHA-256 and
-- derives the institution from it; nothing in a request can name another one.

create table if not exists uniattend.integration_requests (
  integration_id  uuid not null references uniattend.integrations(id) on delete cascade,
  idempotency_key text not null check (idempotency_key ~ '^[A-Za-z0-9._:-]{8,100}$'),
  body_sha256     text not null check (body_sha256 ~ '^[0-9a-f]{64}$'),
  run_id          uuid,
  response        jsonb,
  created_at      timestamptz not null default now(),
  primary key (integration_id, idempotency_key)
);
alter table uniattend.integration_requests enable row level security;  -- no policies: functions only
revoke all on uniattend.integration_requests from public, anon, authenticated;

-- The connection an API key belongs to, or an error. Shared by the v1 functions.
create or replace function uniattend._api_connection(p_key text)
returns uniattend.integrations language plpgsql stable security definer set search_path = '' as $$
declare it uniattend.integrations;
begin
  select i.* into it from uniattend.integrations i join uniattend.integration_secrets s on s.integration_id = i.id
   where i.kind = 'api' and s.key_sha256 = encode(extensions.digest(coalesce(p_key, ''), 'sha256'), 'hex');
  if it.id is null then raise exception 'That API key is not valid.' using errcode = '42501'; end if;
  return it;
end $$;

create or replace function uniattend.api_roster_push(p_key text, p_payload jsonb, p_idempotency_key text default null,
                                                     p_body_sha256 text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare it uniattend.integrations; v_run uuid; res jsonb; fin jsonb; prev uniattend.integration_requests; v_out jsonb;
begin
  it := uniattend._api_connection(p_key);
  if it.status <> 'active' then raise exception 'This connection is paused.' using errcode = 'P0001'; end if;
  if not exists (select 1 from uniattend.institutions where id = it.institution_id and status = 'active' and deleted_at is null) then
    raise exception 'The institution is not active.' using errcode = 'P0001';
  end if;

  if p_idempotency_key is not null then
    if p_idempotency_key !~ '^[A-Za-z0-9._:-]{8,100}$' then
      raise exception 'The Idempotency-Key must be 8 to 100 letters, digits or . _ : -' using errcode = '22023';
    end if;
    if p_body_sha256 is null or p_body_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'Missing body hash.' using errcode = '22023'; end if;
    delete from uniattend.integration_requests where integration_id = it.id and created_at < now() - interval '7 days';
    -- Claim the key first: a concurrent retry waits here, then finds the stored answer.
    insert into uniattend.integration_requests (integration_id, idempotency_key, body_sha256)
    values (it.id, p_idempotency_key, p_body_sha256) on conflict do nothing;
    if not found then
      select * into prev from uniattend.integration_requests where integration_id = it.id and idempotency_key = p_idempotency_key;
      if prev.body_sha256 <> p_body_sha256 then
        raise exception 'This Idempotency-Key was already used with a different body.' using errcode = 'UA409';
      end if;
      if prev.response is null then raise exception 'A request with this Idempotency-Key is still being processed.' using errcode = 'UA409'; end if;
      return prev.response || jsonb_build_object('replayed', true);
    end if;
  end if;

  if (select count(*) from uniattend.integration_runs where integration_id = it.id and started_at > now() - interval '1 hour') >= 120 then
    raise exception 'Too many requests. Send at most 120 rosters an hour.' using errcode = 'P0001';
  end if;
  insert into uniattend.integration_runs (integration_id, institution_id, trigger) values (it.id, it.institution_id, 'api') returning id into v_run;
  res := uniattend.roster_apply(it.institution_id, it.id, v_run, p_payload);
  fin := uniattend.integration_finish(v_run, 'ok', null, coalesce((p_payload->>'complete')::boolean, false));
  v_out := res || jsonb_build_object('run_id', v_run, 'complete', coalesce((p_payload->>'complete')::boolean, false),
                                     'enrolments_dropped', coalesce((fin->>'enrolments_dropped')::int, 0),
                                     'held_back', coalesce((fin->>'held_back')::int, 0), 'replayed', false);
  if p_idempotency_key is not null then
    update uniattend.integration_requests set run_id = v_run, response = v_out
     where integration_id = it.id and idempotency_key = p_idempotency_key;
  end if;
  return v_out;
end $$;

create or replace function uniattend.api_status(p_key text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare it uniattend.integrations;
begin
  it := uniattend._api_connection(p_key);
  return jsonb_build_object(
    'institution', (select name from uniattend.institutions where id = it.institution_id),
    'connection', it.name, 'status', it.status,
    'runs_last_hour', (select count(*) from uniattend.integration_runs where integration_id = it.id and started_at > now() - interval '1 hour'),
    'limit_per_hour', 120,
    'recent_runs', (select coalesce(jsonb_agg(x order by x.started_at desc), '[]'::jsonb) from (
        select r.id, r.status, r.started_at, r.finished_at, r.summary from uniattend.integration_runs r
        where r.integration_id = it.id order by r.started_at desc limit 10) x));
end $$;

create or replace function uniattend.api_run(p_key text, p_run uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare it uniattend.integrations; r uniattend.integration_runs;
begin
  it := uniattend._api_connection(p_key);
  select * into r from uniattend.integration_runs where id = p_run and integration_id = it.id;
  if r.id is null then raise exception 'No such run for this key.' using errcode = 'P0002'; end if;
  return jsonb_build_object('id', r.id, 'status', r.status, 'started_at', r.started_at, 'finished_at', r.finished_at,
    'summary', r.summary, 'error', r.error,
    'rejected', (select coalesce(jsonb_agg(jsonb_build_object('row', e.row_no, 'record', e.ref, 'problem', e.message) order by e.row_no), '[]'::jsonb)
                 from (select * from uniattend.integration_errors where run_id = r.id order by row_no limit 200) e));
end $$;

revoke execute on function uniattend._api_connection(text) from public, anon, authenticated;
revoke execute on function uniattend.api_roster_push(text, jsonb, text, text) from public;
revoke execute on function uniattend.api_status(text) from public;
revoke execute on function uniattend.api_run(text, uuid) from public;
-- Called by the app's /api/v1 routes with the public key; the API key is the authority.
grant execute on function uniattend.api_roster_push(text, jsonb, text, text), uniattend.api_status(text), uniattend.api_run(text, uuid)
  to anon, authenticated;

insert into uniattend.schema_versions (version, name) values ('20261115000033', 'api_v1')
on conflict (version) do nothing;
