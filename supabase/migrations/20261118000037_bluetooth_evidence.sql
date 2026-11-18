-- UniAttend 0037 — Bluetooth as extra evidence that a student is in the room.
--
-- Indoors GPS is often too weak to confirm the venue, so honest students end up in
-- the review queue. With this, the lecturer's phone (UniAttend Android app) can
-- broadcast a Bluetooth Low Energy signal, and a student's phone (also the app)
-- listens for it during check-in.
--
-- * The signal is not fixed: it is an 8-byte value signed with the session's own
--   secret for the current 20-second step, exactly like the live QR, so a value
--   heard yesterday, in another room or at another university never matches.
-- * The phone only sends what it heard (the value and its signal strength, RSSI).
--   check_in() decides. Nothing about the phone's own Bluetooth identity is sent,
--   and only a summary (how many readings, how many matched, the strongest RSSI) is
--   kept as evidence: never the readings themselves.
-- * Bluetooth strengthens the location layer (40): the location points become the
--   larger of the GPS points and the Bluetooth points. It never replaces the QR
--   proof, never lowers a score, and weak or missing Bluetooth only ever means the
--   check-in goes to the review queue (0029), never an absence.
-- * Off by default: the institution turns it on (bluetooth_enabled), then the
--   lecturer turns it on for a session (use_bluetooth).

alter table uniattend.institution_settings
  add column if not exists bluetooth_enabled boolean not null default false,
  -- The faintest signal that still counts as "in the room". -90 dBm is roughly the
  -- far end of a large lecture hall for a phone; 15 dB stronger counts as close.
  add column if not exists bluetooth_min_rssi int not null default -90
    check (bluetooth_min_rssi between -110 and -40);
alter table uniattend.class_sessions
  add column if not exists use_bluetooth boolean not null default false;

alter table uniattend.attendance_evidence drop constraint if exists attendance_evidence_kind_check;
alter table uniattend.attendance_evidence add constraint attendance_evidence_kind_check
  check (kind in ('qr','gps','device','acoustic','manual','offline','bluetooth'));

-- ------------------------------------------------------------ the rotating signal
-- 16 hex characters (8 bytes) for one 20-second step. A different message from the
-- QR signature ('ble:' prefix), so knowing one never gives the other. Not callable
-- by any client: the lecturer gets it from session_ble_token(), check_in() uses it.
create or replace function uniattend.session_ble_id(p_session uuid, p_step bigint)
returns text language sql stable security definer set search_path = '' as $$
  select left(encode(extensions.hmac(convert_to('ble:' || p_session::text || ':' || p_step::text, 'UTF8'),
                                     s.secret, 'sha256'), 'hex'), 16)
  from uniattend.session_secrets s where s.session_id = p_session;
$$;
revoke all on function uniattend.session_ble_id(uuid, bigint) from public, anon, authenticated;

-- Polled by the lecturer's phone while it broadcasts.
create or replace function uniattend.session_ble_token(p_session uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s uniattend.class_sessions; on_ boolean; step bigint := uniattend.qr_step();
begin
  select * into s from uniattend.class_sessions where id = p_session;
  if s is null or not (uniattend.teaches_module(s.module_id) or uniattend.is_inst_admin(s.institution_id)) then
    raise exception 'not your session' using errcode = '42501';
  end if;
  if s.status <> 'open' or now() not between s.opens_at and s.closes_at then
    return jsonb_build_object('open', false);
  end if;
  select st.bluetooth_enabled and s.use_bluetooth into on_
    from uniattend.institution_settings st where st.institution_id = s.institution_id;
  if not coalesce(on_, false) then return jsonb_build_object('open', true, 'bluetooth', false); end if;
  return jsonb_build_object(
    'open', true, 'bluetooth', true,
    'id', uniattend.session_ble_id(p_session, step),
    'refresh_in_ms', greatest(1000, ((step + 1) * 20 - extract(epoch from clock_timestamp())) * 1000)::int);
end $$;
revoke all on function uniattend.session_ble_token(uuid) from public, anon;
grant execute on function uniattend.session_ble_token(uuid) to authenticated;

-- ------------------------------------------------------------ switches
create or replace function uniattend.set_session_bluetooth(p_session uuid, p_on boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
declare s uniattend.class_sessions;
begin
  select * into s from uniattend.class_sessions where id = p_session for update;
  if s is null or not (uniattend.teaches_module(s.module_id) or uniattend.is_inst_admin(s.institution_id)) then
    raise exception 'not your session' using errcode = '42501';
  end if;
  if s.status not in ('open', 'scheduled') then raise exception 'This session is %.', s.status using errcode = 'P0001'; end if;
  if coalesce(p_on, false) and not coalesce((select bluetooth_enabled from uniattend.institution_settings
                                             where institution_id = s.institution_id), false) then
    raise exception 'Bluetooth check-in is turned off for your institution. An administrator can turn it on.' using errcode = 'P0001';
  end if;
  update uniattend.class_sessions set use_bluetooth = coalesce(p_on, false) where id = p_session;
  perform uniattend.write_audit(s.institution_id, 'update', 'class_sessions', s.id::text,
                                jsonb_build_object('use_bluetooth', coalesce(p_on, false)));
  return coalesce(p_on, false);
end $$;
revoke all on function uniattend.set_session_bluetooth(uuid, boolean) from public, anon;
grant execute on function uniattend.set_session_bluetooth(uuid, boolean) to authenticated;

create or replace function uniattend.set_bluetooth_policy(p_inst uuid, p_enabled boolean, p_min_rssi int)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not uniattend.is_inst_admin(p_inst) then raise exception 'institution admin only' using errcode = '42501'; end if;
  if p_min_rssi is null or p_min_rssi not between -110 and -40 then
    raise exception 'The faintest signal must be between -110 and -40 dBm.' using errcode = '22023';
  end if;
  update uniattend.institution_settings set bluetooth_enabled = coalesce(p_enabled, false), bluetooth_min_rssi = p_min_rssi
   where institution_id = p_inst;
  perform uniattend.write_audit(p_inst, 'update', 'institution_settings', p_inst::text,
                                jsonb_build_object('bluetooth_enabled', coalesce(p_enabled, false), 'bluetooth_min_rssi', p_min_rssi));
end $$;
revoke all on function uniattend.set_bluetooth_policy(uuid, boolean, int) from public, anon;
grant execute on function uniattend.set_bluetooth_policy(uuid, boolean, int) to authenticated;

-- ------------------------------------------------------------ check_in(): the Bluetooth layer
create or replace function uniattend._rewrite(p_fn text, p_from text, p_to text, p_times int default 1)
returns void language plpgsql set search_path = '' as $$
declare def text; n int;
begin
  select pg_get_functiondef(p.oid) into def from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'uniattend' and p.proname = p_fn;
  if def is null then raise exception '0037: function % not found', p_fn; end if;
  n := (length(def) - length(replace(def, p_from, ''))) / length(p_from);
  if n <> p_times then raise exception '0037: expected % of "%" in %, found %', p_times, p_from, p_fn, n; end if;
  execute replace(def, p_from, p_to);
end $$;
do $$
begin
  -- A new last argument with a default: existing callers keep working unchanged.
  perform uniattend._rewrite('check_in', 'p_device_hash text)', 'p_device_hash text, p_ble jsonb DEFAULT NULL::jsonb)');
end $$;
-- Replacing the argument list created a second check_in(); remove the old one so
-- the rewrites below (by name) and the API see exactly one.
drop function uniattend.check_in(uuid, text, text, jsonb, text);
revoke all on function uniattend.check_in(uuid, text, text, jsonb, text, jsonb) from public, anon;
grant execute on function uniattend.check_in(uuid, text, text, jsonb, text, jsonb) to authenticated;

do $$
begin
  perform uniattend._rewrite('check_in', '  v_late int; v_title text; v_body text;',
'  v_late int; v_title text; v_body text;
  -- bluetooth (0037)
  bt_on boolean := false; bt_pts float8 := 0; bt_n int := 0; bt_match int := 0; bt_best int;
  bt_rssis int[] := ''{}''; bt_ids text[]; bt_now bigint; ob jsonb;');

  perform uniattend._rewrite('check_in', '  -- 7. Device layer (20).',
'  -- 6b. Bluetooth (0037). The lecturer''s phone broadcasts a value that changes every
  -- 20 seconds; hearing the current one strengthens the location layer. It never
  -- replaces the QR proof and never lowers a score: the location points become the
  -- larger of the GPS and Bluetooth points.
  bt_on := coalesce(st.bluetooth_enabled, false) and coalesce(s.use_bluetooth, false);
  if bt_on then
    -- The current step and the two before it: the phone listens for a few seconds
    -- before the check-in is sent, and the QR itself is accepted for up to 40 s.
    bt_now := uniattend.qr_step();
    select array_agg(uniattend.session_ble_id(s.id, x)) into bt_ids from generate_series(bt_now - 2, bt_now) x;
    if p_ble is not null and jsonb_typeof(p_ble->''observations'') = ''array'' then
      for ob in select value from jsonb_array_elements(p_ble->''observations'') limit 30 loop
        if jsonb_typeof(ob->''id'') = ''string'' and jsonb_typeof(ob->''rssi'') = ''number''
           and (ob->>''id'') ~ ''^[0-9a-f]{16}$'' and (ob->>''rssi'')::float8 between -127 and 0 then
          bt_n := bt_n + 1;
          if (ob->>''id'') = any(bt_ids) then
            bt_match := bt_match + 1;
            bt_rssis := bt_rssis || round((ob->>''rssi'')::float8)::int;
          end if;
        end if;
      end loop;
    end if;
    if bt_match > 0 then
      select max(x) into bt_best from unnest(bt_rssis) x;
      bt_pts := case when bt_best >= st.bluetooth_min_rssi + 15 then 36
                     when bt_best >= st.bluetooth_min_rssi then 30 else 6 end;
      -- Integrity: real radio readings move around; a run of identical ones is made up.
      if bt_match >= 4 and (select count(distinct x) from unnest(bt_rssis) x) = 1 then
        bt_pts := least(bt_pts, 6);
        reasons := reasons || ''"The Bluetooth readings were unusually uniform and could not be relied on."'';
      elsif bt_pts < 30 and coalesce(gps_pts, 0) < 30 then
        reasons := reasons || ''"The class''''s Bluetooth signal was very faint, so it could not confirm you were in the room."'';
      end if;
    elsif bt_n > 0 and coalesce(gps_pts, 0) < 30 then
      reasons := reasons || ''"A Bluetooth signal was heard, but it was not this class''''s current signal."'';
    end if;
    if s.require_gps and bt_pts > gps_pts then
      earned := earned + (bt_pts - gps_pts);
      if bt_pts >= 30 then
        reasons := reasons || ''"The lecturer''''s Bluetooth signal was heard nearby, which confirms you were in the room."'';
      end if;
    end if;
    layers := layers || jsonb_build_object(''bluetooth'', jsonb_build_object(
      ''points'', bt_pts, ''max'', 36, ''heard'', bt_n, ''matched'', bt_match, ''best_rssi'', bt_best,
      ''counted'', coalesce(s.require_gps and bt_pts > gps_pts, false)));
  end if;

  -- 7. Device layer (20).');

  -- A late arrival confirmed by Bluetooth is confirmed in the venue too.
  perform uniattend._rewrite('check_in', 'case when s.require_gps and coalesce(p, 0) >= 0.5 then',
                             'case when s.require_gps and (coalesce(p, 0) >= 0.5 or bt_pts >= 30) then');
  -- Keep the summary as evidence on the record.
  perform uniattend._rewrite('check_in', 'unnest(array[''qr'',''gps'',''device''])',
                             'unnest(array[''qr'',''gps'',''device'',''bluetooth''])');
end $$;
drop function uniattend._rewrite(text, text, text, int);

insert into uniattend.schema_versions (version, name) values ('20261118000037', 'bluetooth_evidence')
on conflict (version) do nothing;
