-- UniAttend 0010 — late arrivals: the lecturer has the final say.
--
-- After the grace period, a check-in that passes the QR/location/device checks is
-- recorded as 'late_pending' (shown grey: arrived, awaiting the lecturer) together
-- with how many minutes after the grace period the student arrived. The lecturer
-- accepts (-> late, counts as attended) or denies (-> absent). Anything still
-- undecided when the session closes is accepted.

alter table uniattend.attendance_records drop constraint if exists attendance_records_status_check;
alter table uniattend.attendance_records add constraint attendance_records_status_check check (status in
  ('present','absent','late','late_pending','excused','pending_verification','disputed'));
alter table uniattend.attendance_records
  add column if not exists minutes_late int check (minutes_late is null or minutes_late between 0 and 1440);
-- check_in() looks for the same device used by other students in the last 30 days.
-- Without this index that scans every record the institution wrote in 30 days.
create index if not exists attendance_records_device_recent on uniattend.attendance_records(institution_id, device_hash, created_at)
  where device_hash is not null;
create index if not exists attendance_records_late_pending on uniattend.attendance_records(session_id)
  where status = 'late_pending';

create or replace function uniattend.check_in(p_session uuid, p_code text, p_token text,
                                           p_gps jsonb, p_device_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  s uniattend.class_sessions; st uniattend.institution_settings; v uniattend.venues; m uniattend.modules;
  stu uniattend.students; existing uniattend.attendance_records; rec uniattend.attendance_records;
  step bigint; method text; v_status text;
  reasons jsonb := '[]'::jsonb; layers jsonb := '{}'::jsonb;
  earned float8 := 0; possible float8 := 0; score int; outcome text;
  -- gps
  smp jsonb; n int := 0; wsum float8 := 0; lat float8 := 0; lng float8 := 0; acc_sum float8 := 0;
  acc float8; best_acc float8 := 'infinity'; accs float8[] := '{}'; w float8;
  signed float8; sigma float8; p float8; gps_pts float8; dist float8;
  -- device
  dev_pts float8; others int;
  -- lateness
  v_late int; v_title text; v_body text;
begin
  if uid is null then raise exception 'not signed in' using errcode = '42501'; end if;

  -- 1. Which session. By id (from the QR) or by typed code among the caller's institutions.
  if p_session is not null then
    select * into s from uniattend.class_sessions where id = p_session;
  elsif p_code is not null then
    select cs.* into s from uniattend.class_sessions cs
    join uniattend.students x on x.institution_id = cs.institution_id and x.user_id = uid
    join uniattend.module_enrolments e on e.module_id = cs.module_id and e.student_id = x.id and e.status = 'active'
    where cs.join_code = upper(trim(p_code)) and cs.status = 'open'
    limit 1;
  end if;
  if s is null then raise exception 'No open session matches that code.' using errcode = 'P0002'; end if;

  -- 2. Who, derived from the session's institution and auth.uid() — never from input.
  select * into stu from uniattend.students
   where institution_id = s.institution_id and user_id = uid and status = 'active' and deleted_at is null;
  if stu is null or not uniattend.has_role(s.institution_id, array['student']) then
    raise exception 'You are not registered as a student at this institution.' using errcode = '42501';
  end if;
  if not exists (select 1 from uniattend.module_enrolments
                 where module_id = s.module_id and student_id = stu.id and status = 'active') then
    raise exception 'You are not enrolled in this module.' using errcode = '42501';
  end if;
  if s.status <> 'open' or now() not between s.opens_at and s.closes_at then
    raise exception 'This session is not accepting check-ins.' using errcode = 'P0001';
  end if;
  if not uniattend.institution_can_operate(s.institution_id) then
    raise exception 'Attendance is unavailable for this institution right now.' using errcode = 'P0001';
  end if;

  -- 3. Rate limit: 5 attempts per student per session per minute.
  if (select count(*) from uniattend.attendance_verification_events
      where student_id = stu.id and session_id = s.id and created_at > now() - interval '1 minute') >= 5 then
    raise exception 'Too many attempts. Wait a minute and try again.' using errcode = 'P0001';
  end if;

  -- 4. Duplicate.
  select * into existing from uniattend.attendance_records where session_id = s.id and student_id = stu.id;
  if existing.id is not null and existing.status <> 'pending_verification' then
    insert into uniattend.attendance_verification_events (institution_id, session_id, student_id, outcome, score, layers, reasons)
    values (s.institution_id, s.id, stu.id, 'duplicate', coalesce(existing.score, 0), '{}', '["Already recorded"]');
    return jsonb_build_object('outcome', 'duplicate', 'status', existing.status, 'score', existing.score,
                              'reasons', jsonb_build_array('You are already recorded for this session.'));
  end if;

  select * into st from uniattend.institution_settings where institution_id = s.institution_id;
  select * into m from uniattend.modules where id = s.module_id;
  if s.venue_id is not null then select * into v from uniattend.venues where id = s.venue_id; end if;

  -- 5. Session proof layer (40). A valid live QR, or the typed code if allowed.
  possible := possible + 40;
  step := case when p_session is not null then uniattend.qr_verify(s.id, p_token) end;
  if step is not null then
    earned := earned + 40; method := 'qr';
    layers := layers || jsonb_build_object('qr', jsonb_build_object('points', 40, 'max', 40, 'step', step));
  elsif upper(trim(coalesce(p_code, ''))) = s.join_code and (st.allow_manual_code or not s.require_qr) then
    earned := earned + 15; method := 'code';
    reasons := reasons || '"Checked in with the typed code instead of scanning the live QR."';
    layers := layers || jsonb_build_object('qr', jsonb_build_object('points', 15, 'max', 40, 'typed_code', true));
  else
    reasons := reasons || to_jsonb(case when p_token is not null
      then 'The QR code had expired or was not valid. Scan the code currently on screen.'
      else 'No valid session code was provided.' end);
    insert into uniattend.attendance_verification_events (institution_id, session_id, student_id, outcome, score, layers, reasons)
    values (s.institution_id, s.id, stu.id, 'rejected', 0, jsonb_build_object('qr', jsonb_build_object('points', 0, 'max', 40)), reasons);
    return jsonb_build_object('outcome', 'rejected', 'status', null, 'score', 0, 'reasons', reasons);
  end if;

  -- 6. Location layer (40). Probability of being inside, given reported accuracy.
  if s.require_gps then
    possible := possible + 40;
    if p_gps is null or jsonb_typeof(p_gps->'samples') <> 'array' or jsonb_array_length(p_gps->'samples') = 0 then
      gps_pts := 0;
      reasons := reasons || '"Location was not shared, so presence at the venue could not be checked."';
      layers := layers || jsonb_build_object('gps', jsonb_build_object('points', 0, 'max', 40, 'shared', false));
    else
      for smp in select value from jsonb_array_elements(p_gps->'samples') limit 20 loop
        if jsonb_typeof(smp->'lat') = 'number' and jsonb_typeof(smp->'lng') = 'number' and jsonb_typeof(smp->'accuracy') = 'number'
           and (smp->>'lat')::float8 between -90 and 90 and (smp->>'lng')::float8 between -180 and 180
           and (smp->>'accuracy')::float8 > 0 then
          acc := (smp->>'accuracy')::float8;
          w := 1 / greatest(9, acc * acc);
          lat := lat + w * (smp->>'lat')::float8; lng := lng + w * (smp->>'lng')::float8; wsum := wsum + w;
          acc_sum := acc_sum + acc; best_acc := least(best_acc, acc); accs := accs || acc; n := n + 1;
        end if;
      end loop;
      if n = 0 then
        gps_pts := 0;
        reasons := reasons || '"Location data could not be read."';
        layers := layers || jsonb_build_object('gps', jsonb_build_object('points', 0, 'max', 40, 'shared', true, 'valid', false));
      else
        lat := lat / wsum; lng := lng / wsum;
        acc := greatest(3, least(acc_sum / n, best_acc));
        if v.polygon is not null then
          signed := uniattend.polygon_signed_distance_m(lat, lng, v.polygon);
        else
          signed := uniattend.geo_distance_m(lat, lng, v.lat, v.lng) - coalesce(v.radius_m, st.gps_default_radius_m);
        end if;
        sigma := greatest(4, acc * 0.6);
        p := 1 / (1 + exp(least(50, greatest(-50, 1.7 * signed / sigma))));
        gps_pts := 40 * p;
        if acc > st.gps_max_accuracy_m then
          gps_pts := least(gps_pts, 8);
          reasons := reasons || to_jsonb(format('Location was too imprecise to confirm (±%s m). Try near a window or with Wi-Fi on.', round(acc)));
        elsif p < 0.5 then
          reasons := reasons || to_jsonb(format('Location appears to be about %s m outside the venue (accuracy ±%s m).', round(greatest(signed, 0)), round(acc)));
        end if;
        -- Integrity: a run of identical, implausibly precise readings is what a spoofing app produces.
        if n >= 4 and (select count(distinct x) from unnest(accs) x) = 1 and best_acc <= 5 then
          gps_pts := least(gps_pts, 10);
          reasons := reasons || '"Location readings were unusually uniform and could not be relied on."';
        end if;
        dist := round(greatest(signed, 0)::numeric, 0);
        layers := layers || jsonb_build_object('gps', jsonb_build_object(
          'points', round(gps_pts::numeric, 1), 'max', 40, 'samples', n,
          'accuracy_m', round(acc::numeric, 0), 'outside_by_m', dist, 'p_inside', round(p::numeric, 2)));
      end if;
    end if;
    earned := earned + gps_pts;
  else
    layers := layers || jsonb_build_object('gps', jsonb_build_object('required', false));
  end if;

  -- 7. Device layer (20). Signals only; changing phones is normal and never blocks.
  possible := possible + 20;
  if p_device_hash is null or p_device_hash !~ '^[0-9a-f]{64}$' then
    dev_pts := 10; p_device_hash := null;
    reasons := reasons || '"This browser could not provide a device check."';
  elsif exists (select 1 from uniattend.attendance_records
                where session_id = s.id and device_hash = p_device_hash and student_id <> stu.id) then
    dev_pts := 0;
    reasons := reasons || '"This device has already been used to check in another student for this session."';
  else
    select count(distinct student_id) into others from uniattend.attendance_records
     where institution_id = s.institution_id and device_hash = p_device_hash and student_id <> stu.id
       and created_at > now() - interval '30 days';
    dev_pts := case when others >= 2 then 10 else 20 end;
    if others >= 2 then
      reasons := reasons || '"This device has recently been used by several students."';
    end if;
  end if;
  earned := earned + dev_pts;
  layers := layers || jsonb_build_object('device', jsonb_build_object('points', dev_pts, 'max', 20));

  -- 8. Verdict. A proven session is never turned into an absence by weak signals:
  -- below the accept threshold it goes to a person for review.
  score := round(100 * earned / possible);
  -- How late: whole minutes after the grace period ended, measured at the moment the
  -- live QR and location put the student in the venue.
  v_late := case when now() > s.late_after
                 then greatest(1, floor(extract(epoch from now() - s.late_after) / 60))::int end;
  if v_late is not null then
    reasons := reasons || to_jsonb(format('Arrived %s min after the grace period ended.%s', v_late,
      case when s.require_gps and coalesce(p, 0) >= 0.5 then ' Location confirmed in the venue at that time.' else '' end));
  end if;
  if score >= st.accept_score then
    outcome := 'accepted';
    -- A late arrival waits for the lecturer, who has the final say. If the lecturer has not
    -- denied it by the time the session closes, it counts as attended (late).
    v_status := case when v_late is not null then 'late_pending' else 'present' end;
  else
    outcome := 'review';
    v_status := 'pending_verification';
  end if;

  insert into uniattend.attendance_records as ar (institution_id, session_id, module_id, student_id, status, method,
                                               score, checked_in_at, device_hash, explanation, minutes_late)
  values (s.institution_id, s.id, s.module_id, stu.id, v_status, method, score, now(), p_device_hash, reasons, v_late)
  on conflict (session_id, student_id) do update
    set status = excluded.status, method = excluded.method, score = excluded.score,
        checked_in_at = excluded.checked_in_at, device_hash = excluded.device_hash, explanation = excluded.explanation,
        minutes_late = excluded.minutes_late
    where ar.status = 'pending_verification' and excluded.score > coalesce(ar.score, 0)
  returning * into rec;
  if rec.id is null then  -- an earlier pending attempt scored at least as well
    select * into rec from uniattend.attendance_records where session_id = s.id and student_id = stu.id;
  end if;

  insert into uniattend.attendance_evidence (institution_id, record_id, kind, data)
  select s.institution_id, rec.id, k, layers->k from unnest(array['qr','gps','device']) k where layers ? k;

  insert into uniattend.attendance_verification_events (institution_id, session_id, student_id, outcome, score, layers, reasons, token_step)
  values (s.institution_id, s.id, stu.id, outcome, score, layers, reasons, step);

  if rec.status = 'late_pending' then
    v_title := m.code || ': arrived ' || rec.minutes_late || ' min late';
    v_body := 'Your lecturer decides whether it counts. If it is not denied, it counts as attended (late).';
  elsif outcome = 'accepted' then
    v_title := m.code || ': you are checked in';
    v_body := 'Recorded as ' || replace(rec.status, '_', ' ') || '.';
  else
    v_title := m.code || ': check-in sent for review';
    v_body := 'Your lecturer will confirm it. You do not need to do anything else.';
  end if;
  insert into uniattend.notifications (institution_id, user_id, kind, title, body, link)
  values (s.institution_id, uid, case when outcome = 'accepted' then 'check_in_ok' else 'check_in_review' end,
          v_title, v_body, '/student/history');

  return jsonb_build_object('outcome', outcome, 'status', rec.status, 'score', rec.score,
                            'reasons', reasons, 'module_code', m.code, 'session_title', s.title,
                            'minutes_late', rec.minutes_late, 'checked_in_at', rec.checked_in_at,
                            'opens_at', s.opens_at, 'late_after', s.late_after);
end $$;

create or replace function uniattend.close_session(p_session uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s uniattend.class_sessions; n_absent int; n_late_auto int;
begin
  select * into s from uniattend.class_sessions where id = p_session for update;
  if s is null or not (uniattend.teaches_module(s.module_id) or uniattend.is_inst_admin(s.institution_id)) then
    raise exception 'not your session' using errcode = '42501';
  end if;
  if s.status <> 'open' then raise exception 'session is already %', s.status; end if;

  update uniattend.class_sessions set status = 'closed', closed_at = now(),
         closes_at = least(closes_at, now()) where id = p_session;
  delete from uniattend.session_secrets where session_id = p_session;
  delete from uniattend.acoustic_submissions sub using uniattend.acoustic_windows w
   where sub.window_id = w.id and w.session_id = p_session;

  -- Late arrivals the lecturer did not deny count as attended.
  update uniattend.attendance_records
     set status = 'late',
         override_note = 'Late arrival accepted automatically: the lecturer did not deny it before the session closed.'
   where session_id = p_session and status = 'late_pending';
  get diagnostics n_late_auto = row_count;

  -- Absence is recorded only once the session is over, never pre-emptively.
  insert into uniattend.attendance_records (institution_id, session_id, module_id, student_id, status, method, explanation)
  select s.institution_id, s.id, s.module_id, e.student_id, 'absent', 'system',
         '["No check-in was received before the session closed."]'::jsonb
  from uniattend.module_enrolments e
  where e.module_id = s.module_id and e.status = 'active'
  on conflict (session_id, student_id) do nothing;
  get diagnostics n_absent = row_count;

  perform uniattend.write_audit(s.institution_id, 'close', 'class_sessions', s.id::text,
                             jsonb_build_object('absent', n_absent, 'late_auto_accepted', n_late_auto));
  return (select jsonb_build_object(
    'absent', n_absent,
    'late_auto_accepted', n_late_auto,
    'present', count(*) filter (where status = 'present'),
    'late', count(*) filter (where status = 'late'),
    'pending', count(*) filter (where status = 'pending_verification'))
    from uniattend.attendance_records where session_id = p_session);
end $$;

-- Accept or deny late arrivals, one student or many at once. A decision can be
-- changed: a late arrival already accepted or denied may be flipped.
create or replace function uniattend.decide_late(p_session uuid, p_students uuid[], p_accept boolean, p_note text default null)
returns int language plpgsql security definer set search_path = '' as $$
declare s uniattend.class_sessions; r uniattend.attendance_records; n int := 0; v_note text;
begin
  select * into s from uniattend.class_sessions where id = p_session;
  if s is null or not (uniattend.teaches_module(s.module_id) or uniattend.is_inst_admin(s.institution_id)) then
    raise exception 'only the module lecturer or an administrator may decide late arrivals' using errcode = '42501';
  end if;
  if p_accept is null or coalesce(cardinality(p_students), 0) = 0 or cardinality(p_students) > 2000 then
    raise exception 'choose between 1 and 2000 students';
  end if;
  v_note := coalesce(nullif(left(trim(p_note), 500), ''),
                     case when p_accept then 'Late arrival accepted by the lecturer.' else 'Late arrival denied by the lecturer.' end);

  for r in
    update uniattend.attendance_records ar
       set status = case when p_accept then 'late' else 'absent' end,
           overridden_by = auth.uid(), overridden_at = now(), override_note = v_note
     where ar.session_id = p_session and ar.student_id = any(p_students)
       and (ar.status = 'late_pending' or (ar.minutes_late is not null and ar.status in ('late','absent')))
    returning ar.*
  loop
    n := n + 1;
    insert into uniattend.attendance_evidence (institution_id, record_id, kind, data)
    values (s.institution_id, r.id, 'manual', jsonb_build_object('status', r.status, 'note', v_note, 'by', auth.uid(),
                                                                 'late_decision', case when p_accept then 'accepted' else 'denied' end));
    insert into uniattend.notifications (institution_id, user_id, kind, title, body, link)
    select s.institution_id, st.user_id, 'attendance_corrected',
           case when p_accept then 'Late arrival accepted' else 'Late arrival not accepted' end,
           s.title || ': ' || case when p_accept then 'counted as attended (late, ' || r.minutes_late || ' min).'
                                   else 'recorded as absent. You can dispute this from your history.' end,
           '/student/history'
    from uniattend.students st where st.id = r.student_id and st.user_id is not null;
  end loop;

  perform uniattend.write_audit(s.institution_id, case when p_accept then 'late_accept' else 'late_deny' end,
                             'class_sessions', s.id::text, jsonb_build_object('students', n));
  return n;
end $$;

revoke all on function uniattend.decide_late(uuid, uuid[], boolean, text) from public, anon;
grant execute on function uniattend.decide_late(uuid, uuid[], boolean, text) to authenticated;
