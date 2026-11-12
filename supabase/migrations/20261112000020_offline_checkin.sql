-- UniAttend 0020 — check-ins made without signal.
--
-- A phone with no signal keeps the evidence it collected at the moment of the
-- check-in (the QR it scanned or the code typed, location samples, device check
-- and the time) and sends it when it is back online. check_in_offline() never
-- accepts such a check-in by itself: it goes to the lecturer as "pending review"
-- with a plain explanation, and keeps the original time.
--
-- * While the session is still open, the QR is checked against the 20-second
--   window it was shown in: proof the student saw the live code at that time.
-- * After the session closed, the QR key is gone, so it can't be checked; the
--   lecturer is told so. An automatic "absent" becomes "pending review"; a
--   lecturer's own decision is never changed.
-- * Sent within 48 hours of the check-in, for a time inside the session window.

alter table uniattend.attendance_records drop constraint if exists attendance_records_method_check;
alter table uniattend.attendance_records add constraint attendance_records_method_check
  check (method in ('qr','code','manual','acoustic','system','card','offline'));
alter table uniattend.attendance_evidence drop constraint if exists attendance_evidence_kind_check;
alter table uniattend.attendance_evidence add constraint attendance_evidence_kind_check
  check (kind in ('qr','gps','device','acoustic','manual','offline'));

create or replace function uniattend.check_in_offline(p_session uuid, p_code text, p_token text,
                                                     p_gps jsonb, p_device_hash text, p_captured_at timestamptz)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  s uniattend.class_sessions; st uniattend.institution_settings; v uniattend.venues; m uniattend.modules;
  stu uniattend.students; existing uniattend.attendance_records; rec uniattend.attendance_records;
  reasons jsonb := '[]'::jsonb; layers jsonb := '{}'::jsonb; points float8 := 0; possible float8 := 100;
  m_tok text[]; step bigint; secret_left boolean; v_shown timestamptz; v_late int; v_tz text;
  smp jsonb; n int := 0; wsum float8 := 0; lat float8 := 0; lng float8 := 0; acc_sum float8 := 0;
  acc float8; best_acc float8 := 'infinity'; w float8; signed float8; p float8;
  fmt text := 'HH24:MI';
begin
  if uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if p_captured_at is null then raise exception 'The time of the check-in is missing.' using errcode = 'P0001'; end if;

  -- Which session: by id (from the QR) or by the typed code, among the student's own modules.
  if p_session is not null then
    select * into s from uniattend.class_sessions where id = p_session;
  elsif p_code is not null then
    select cs.* into s from uniattend.class_sessions cs
    join uniattend.students x on x.institution_id = cs.institution_id and x.user_id = uid
    join uniattend.module_enrolments e on e.module_id = cs.module_id and e.student_id = x.id and e.status = 'active'
    where cs.join_code = upper(trim(p_code))
      and p_captured_at between cs.opens_at - interval '10 minutes' and cs.closes_at + interval '10 minutes'
    order by cs.opens_at desc limit 1;
  end if;
  if s is null then raise exception 'No session matches that check-in.' using errcode = 'P0002'; end if;

  select * into stu from uniattend.students
   where institution_id = s.institution_id and user_id = uid and status = 'active' and deleted_at is null;
  if stu is null or not uniattend.has_role(s.institution_id, array['student']) then
    raise exception 'You are not registered as a student at this institution.' using errcode = '42501';
  end if;
  if not exists (select 1 from uniattend.module_enrolments where module_id = s.module_id and student_id = stu.id and status = 'active') then
    raise exception 'You are not enrolled in this module.' using errcode = '42501';
  end if;
  if not uniattend.institution_can_operate(s.institution_id) then
    raise exception 'Attendance is unavailable for this institution right now.' using errcode = 'P0001';
  end if;

  -- The time must be believable: not in the future, inside the session, and sent within 48 hours.
  if p_captured_at > now() + interval '2 minutes' then
    raise exception 'The check-in time is in the future. Check the date and time on your phone.' using errcode = 'P0001';
  end if;
  if now() - p_captured_at > interval '48 hours' then
    raise exception 'Check-ins saved without signal must be sent within 48 hours. Ask your lecturer to correct the register.' using errcode = 'P0001';
  end if;
  if p_captured_at not between s.opens_at - interval '10 minutes' and s.closes_at + interval '10 minutes' then
    raise exception 'That check-in was made outside the time the session was open.' using errcode = 'P0001';
  end if;

  if (select count(*) from uniattend.attendance_verification_events
      where student_id = stu.id and session_id = s.id and created_at > now() - interval '1 minute') >= 5 then
    raise exception 'Too many attempts. Wait a minute and try again.' using errcode = 'P0001';
  end if;

  select * into st from uniattend.institution_settings where institution_id = s.institution_id;
  select * into m from uniattend.modules where id = s.module_id;
  if s.venue_id is not null then select * into v from uniattend.venues where id = s.venue_id; end if;
  select coalesce(i.timezone, 'Africa/Johannesburg') into v_tz from uniattend.institutions i where i.id = s.institution_id;

  -- Already recorded? Only an empty, pending or automatic "absent" record can become a review.
  select * into existing from uniattend.attendance_records where session_id = s.id and student_id = stu.id;
  if existing.id is not null and not (existing.status = 'pending_verification'
       or (existing.status = 'absent' and existing.method = 'system' and existing.overridden_by is null)) then
    insert into uniattend.attendance_verification_events (institution_id, session_id, student_id, outcome, score, layers, reasons)
    values (s.institution_id, s.id, stu.id, 'duplicate', coalesce(existing.score, 0), '{"offline": true}', '["Already recorded"]');
    return jsonb_build_object('outcome', 'duplicate', 'status', existing.status, 'score', existing.score,
      'reasons', jsonb_build_array(case when existing.status = 'absent'
        then 'Your lecturer has already recorded this session. If it is wrong, dispute it from your history.'
        else 'You are already recorded for this session.' end));
  end if;

  reasons := reasons || to_jsonb(format('Checked in without signal at %s; sent at %s.',
    to_char(p_captured_at at time zone v_tz, fmt), to_char(now() at time zone v_tz, fmt)));

  -- The QR, against the window it was shown in.
  secret_left := exists (select 1 from uniattend.session_secrets where session_id = s.id);
  m_tok := regexp_match(coalesce(p_token, ''), '^([0-9]{1,12})\.([A-Za-z0-9_-]{22})$');
  if p_session is not null and m_tok is not null and secret_left then
    step := m_tok[1]::bigint;
    if uniattend.qr_sign(s.id, step) is distinct from m_tok[2] then
      reasons := reasons || '"The scanned QR code was not valid for this session."';
      layers := layers || jsonb_build_object('qr', jsonb_build_object('points', 0, 'max', 40, 'valid', false));
    else
      v_shown := to_timestamp(step * 20);
      if abs(extract(epoch from p_captured_at - v_shown)) > 120 then
        points := points + 10;
        reasons := reasons || to_jsonb(format('The QR code scanned was the one on screen at %s, but the phone says it checked in at %s.',
          to_char(v_shown at time zone v_tz, fmt), to_char(p_captured_at at time zone v_tz, fmt)));
      else
        points := points + 40;
        reasons := reasons || to_jsonb(format('The QR code matches the one on screen at %s.', to_char(v_shown at time zone v_tz, fmt)));
      end if;
      layers := layers || jsonb_build_object('qr', jsonb_build_object('points', case when abs(extract(epoch from p_captured_at - v_shown)) > 120 then 10 else 40 end,
                                                                     'max', 40, 'step', step, 'shown_at', v_shown));
    end if;
  elsif p_session is not null and m_tok is not null then
    points := points + 15;
    reasons := reasons || '"The session had closed before this was sent, so the QR code could not be checked."';
    layers := layers || jsonb_build_object('qr', jsonb_build_object('points', 15, 'max', 40, 'checkable', false));
  elsif p_session is not null and p_token ~ '^P\.' then
    points := points + case when uniattend.qr_verify(s.id, p_token) = -1 then 30 else 0 end;
    reasons := reasons || to_jsonb(case when uniattend.qr_verify(s.id, p_token) = -1 then 'Scanned the printed QR code.' else 'The printed QR code could not be checked.' end);
    layers := layers || jsonb_build_object('qr', jsonb_build_object('printed', true, 'max', 40));
  elsif upper(trim(coalesce(p_code, ''))) = s.join_code then
    points := points + 15;
    reasons := reasons || '"Typed the session code instead of scanning the QR."';
    layers := layers || jsonb_build_object('qr', jsonb_build_object('points', 15, 'max', 40, 'typed_code', true));
  else
    reasons := reasons || '"No valid session code was provided."';
    layers := layers || jsonb_build_object('qr', jsonb_build_object('points', 0, 'max', 40));
  end if;

  -- Location at the time, if it was shared.
  if p_gps is not null and jsonb_typeof(p_gps->'samples') = 'array' and (v.lat is not null or v.polygon is not null) then
    for smp in select value from jsonb_array_elements(p_gps->'samples') limit 20 loop
      if jsonb_typeof(smp->'lat') = 'number' and jsonb_typeof(smp->'lng') = 'number' and jsonb_typeof(smp->'accuracy') = 'number'
         and (smp->>'lat')::float8 between -90 and 90 and (smp->>'lng')::float8 between -180 and 180 and (smp->>'accuracy')::float8 > 0 then
        acc := (smp->>'accuracy')::float8; w := 1 / greatest(9, acc * acc);
        lat := lat + w * (smp->>'lat')::float8; lng := lng + w * (smp->>'lng')::float8; wsum := wsum + w;
        acc_sum := acc_sum + acc; best_acc := least(best_acc, acc); n := n + 1;
      end if;
    end loop;
  end if;
  if n > 0 then
    lat := lat / wsum; lng := lng / wsum; acc := greatest(3, least(acc_sum / n, best_acc));
    signed := case when v.polygon is not null then uniattend.polygon_signed_distance_m(lat, lng, v.polygon)
                   else uniattend.geo_distance_m(lat, lng, v.lat, v.lng) - coalesce(v.radius_m, st.gps_default_radius_m) end;
    p := 1 / (1 + exp(least(50, greatest(-50, 1.7 * signed / greatest(4, acc * 0.6)))));
    points := points + 40 * p;
    reasons := reasons || to_jsonb(case when p >= 0.5 then format('Location at the time was in the venue (±%s m).', round(acc))
      else format('Location at the time was about %s m outside the venue (±%s m).', round(greatest(signed, 0)), round(acc)) end);
    layers := layers || jsonb_build_object('gps', jsonb_build_object('points', round((40 * p)::numeric, 1), 'max', 40, 'samples', n,
      'accuracy_m', round(acc::numeric, 0), 'outside_by_m', round(greatest(signed, 0)::numeric, 0), 'p_inside', round(p::numeric, 2)));
  elsif s.require_gps then
    reasons := reasons || '"Location was not available at the time."';
    layers := layers || jsonb_build_object('gps', jsonb_build_object('points', 0, 'max', 40, 'shared', false));
  else
    possible := possible - 40;
  end if;

  -- Device.
  if p_device_hash is null or p_device_hash !~ '^[0-9a-f]{64}$' then
    points := points + 10; p_device_hash := null;
  elsif exists (select 1 from uniattend.attendance_records where session_id = s.id and device_hash = p_device_hash and student_id <> stu.id) then
    reasons := reasons || '"This device was also used to check in another student for this session."';
  else
    points := points + 20;
  end if;

  v_late := case when p_captured_at > s.late_after then greatest(1, floor(extract(epoch from p_captured_at - s.late_after) / 60))::int end;
  if v_late is not null then reasons := reasons || to_jsonb(format('That was %s min after the grace period ended.', v_late)); end if;

  insert into uniattend.attendance_records as ar (institution_id, session_id, module_id, student_id, status, method,
                                                  score, checked_in_at, device_hash, explanation, minutes_late)
  values (s.institution_id, s.id, s.module_id, stu.id, 'pending_verification', 'offline',
          round(100 * points / possible), p_captured_at, p_device_hash, reasons, v_late)
  on conflict (session_id, student_id) do update
    set status = 'pending_verification', method = 'offline', score = excluded.score, checked_in_at = excluded.checked_in_at,
        device_hash = excluded.device_hash, explanation = excluded.explanation, minutes_late = excluded.minutes_late
    where (ar.status = 'pending_verification' and excluded.score > coalesce(ar.score, 0))
       or (ar.status = 'absent' and ar.method = 'system' and ar.overridden_by is null)
  returning * into rec;
  if rec.id is null then select * into rec from uniattend.attendance_records where session_id = s.id and student_id = stu.id; end if;

  insert into uniattend.attendance_evidence (institution_id, record_id, kind, data)
  values (s.institution_id, rec.id, 'offline', layers || jsonb_build_object('captured_at', p_captured_at, 'sent_at', now()));
  insert into uniattend.attendance_verification_events (institution_id, session_id, student_id, outcome, score, layers, reasons, token_step)
  values (s.institution_id, s.id, stu.id, 'review', least(100, greatest(0, rec.score)), layers || '{"offline": true}', reasons, step);
  insert into uniattend.notifications (institution_id, user_id, kind, title, body, link)
  values (s.institution_id, uid, 'check_in_review', m.code || ': check-in sent for review',
          'You checked in without signal at ' || to_char(p_captured_at at time zone v_tz, fmt) || '. Your lecturer will confirm it.', '/student/history');

  return jsonb_build_object('outcome', 'review', 'status', rec.status, 'score', rec.score, 'reasons', reasons,
                            'module_code', m.code, 'session_title', s.title, 'checked_in_at', rec.checked_in_at, 'offline', true);
end $$;

revoke all on function uniattend.check_in_offline(uuid, text, text, jsonb, text, timestamptz) from public, anon;
grant execute on function uniattend.check_in_offline(uuid, text, text, jsonb, text, timestamptz) to authenticated;
