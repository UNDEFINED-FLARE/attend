-- UniAttend 0016 — check-in controls, printed QR, card scanning and check-out.
--
-- * Printed QR: a FIXED code for a session, for printing or showing without a
--   laptop. A fixed code can be photographed and shared, so it is only accepted
--   when the session requires GPS (the location check does the real work), and
--   regenerating the session's key cancels it.
-- * Controls: pause/resume check-in, regenerate the QR key and join code, change
--   the check-in window.
-- * Card scanning: a lecturer or scan station reads a student card (barcode or
--   QR holding the student number) and records the student in or out.
-- * Check-out: card scan or the student's own "I'm leaving"; time present is
--   kept, and leaving more than 10 minutes before the end marks "Left early".

alter table uniattend.class_sessions add column if not exists allow_printed_qr boolean not null default false;
alter table uniattend.attendance_records add column if not exists checked_out_at timestamptz;
alter table uniattend.attendance_records drop constraint if exists attendance_records_method_check;
alter table uniattend.attendance_records add constraint attendance_records_method_check
  check (method in ('qr','code','manual','acoustic','system','card'));

-- ------------------------------------------------------------ printed QR
-- Live tokens are "<step>.<sig>"; the printed one is "P.<sig>" signed for step -1,
-- which no live 20-second step can ever equal.
create or replace function uniattend.qr_verify(p_session uuid, p_token text)
returns bigint language plpgsql stable security definer set search_path = '' as $$
declare m text[]; step bigint; now_step bigint := uniattend.qr_step();
begin
  m := regexp_match(coalesce(p_token, ''), '^P\.([A-Za-z0-9_-]{22})$');
  if m is not null then
    if not exists (select 1 from uniattend.class_sessions s
                   where s.id = p_session and s.allow_printed_qr and s.require_gps) then
      return null;
    end if;
    return case when uniattend.qr_sign(p_session, -1) = m[1] then -1 end;
  end if;
  m := regexp_match(coalesce(p_token, ''), '^([0-9]{1,12})\.([A-Za-z0-9_-]{22})$');
  if m is null then return null; end if;
  step := m[1]::bigint;
  if step not between now_step - 1 and now_step then return null; end if;
  if uniattend.qr_sign(p_session, step) is distinct from m[2] then return null; end if;
  return step;
end $$;

create or replace function uniattend.printed_qr_token(p_session uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare s uniattend.class_sessions;
begin
  select * into s from uniattend.class_sessions where id = p_session;
  if s is null or not (uniattend.teaches_module(s.module_id) or uniattend.is_inst_admin(s.institution_id)) then
    raise exception 'not your session' using errcode = '42501';
  end if;
  if not (s.allow_printed_qr and s.require_gps) then return null; end if;
  return 'P.' || uniattend.qr_sign(p_session, -1);
end $$;

-- ------------------------------------------------------------ controls
-- p_action: 'pause' | 'resume' | 'regenerate' | 'printed_on' | 'printed_off' | 'window'
-- For 'window': p_closes_in_min (minutes from now the check-in closes) and/or p_late_in_min.
create or replace function uniattend.session_control(p_session uuid, p_action text,
                                                     p_closes_in_min int default null, p_late_in_min int default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s uniattend.class_sessions; v_code text;
begin
  select * into s from uniattend.class_sessions where id = p_session for update;
  if s is null or not (uniattend.teaches_module(s.module_id) or uniattend.is_inst_admin(s.institution_id)) then
    raise exception 'not your session' using errcode = '42501';
  end if;
  if s.status not in ('open', 'scheduled') then raise exception 'This session is already %.', s.status using errcode = 'P0001'; end if;

  case p_action
  when 'pause' then
    update uniattend.class_sessions set status = 'scheduled' where id = s.id;
  when 'resume' then
    v_code := s.join_code;
    -- The join code must be unique among OPEN sessions; pick a new one if it was reused meanwhile.
    if exists (select 1 from uniattend.class_sessions o where o.institution_id = s.institution_id
               and o.join_code = v_code and o.status = 'open' and o.id <> s.id) then
      v_code := uniattend.generate_join_code(s.institution_id);
    end if;
    update uniattend.class_sessions set status = 'open', join_code = v_code where id = s.id;
  when 'regenerate' then
    update uniattend.session_secrets set secret = extensions.gen_random_bytes(32) where session_id = s.id;
    update uniattend.class_sessions set join_code = uniattend.generate_join_code(s.institution_id) where id = s.id;
  when 'printed_on' then
    if not s.require_gps then
      raise exception 'A printed QR needs the location check: this session''s venue has no map position.' using errcode = 'P0001';
    end if;
    update uniattend.class_sessions set allow_printed_qr = true where id = s.id;
  when 'printed_off' then
    update uniattend.class_sessions set allow_printed_qr = false where id = s.id;
  when 'window' then
    if p_closes_in_min is not null and p_closes_in_min not between 1 and 480 then raise exception 'choose 1 to 480 minutes'; end if;
    if p_late_in_min is not null and p_late_in_min not between 0 and 480 then raise exception 'choose 0 to 480 minutes'; end if;
    update uniattend.class_sessions
       set closes_at  = coalesce(now() + make_interval(mins => p_closes_in_min), closes_at),
           late_after = coalesce(now() + make_interval(mins => p_late_in_min), late_after)
     where id = s.id;
  else
    raise exception 'unknown action %', p_action;
  end case;

  perform uniattend.write_audit(s.institution_id, 'session_' || p_action, 'class_sessions', s.id::text, '{}'::jsonb);
  return (select jsonb_build_object('status', status, 'join_code', join_code, 'closes_at', closes_at,
                                    'late_after', late_after, 'allow_printed_qr', allow_printed_qr)
          from uniattend.class_sessions where id = s.id);
end $$;

-- ------------------------------------------------------------ check-out (shared)
create or replace function uniattend.apply_checkout(p_record uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r uniattend.attendance_records; s uniattend.class_sessions; v_left uuid; v_early boolean;
begin
  select * into r from uniattend.attendance_records where id = p_record for update;
  select * into s from uniattend.class_sessions where id = r.session_id;
  if r.status not in ('present','late','late_pending','pending_verification') then
    raise exception 'Only someone who checked in can check out.' using errcode = 'P0001';
  end if;
  if r.checked_out_at is not null then
    return jsonb_build_object('outcome', 'duplicate', 'checked_out_at', r.checked_out_at);
  end if;
  v_early := now() < s.closes_at - interval '10 minutes';
  if v_early and r.custom_status_id is null and r.status in ('present','late') then
    select id into v_left from uniattend.attendance_statuses
     where institution_id = r.institution_id and lower(name) = 'left early' and active limit 1;
  end if;
  update uniattend.attendance_records
     set checked_out_at = now(), custom_status_id = coalesce(v_left, custom_status_id)
   where id = r.id;
  insert into uniattend.attendance_evidence (institution_id, record_id, kind, data)
  values (r.institution_id, r.id, 'manual', jsonb_build_object('checkout', now(), 'left_early', v_early, 'by', auth.uid(),
          'note', case when v_early then 'Checked out early' else 'Checked out' end));
  return jsonb_build_object('outcome', 'checked_out', 'left_early', v_early,
    'minutes_present', case when r.checked_in_at is not null then floor(extract(epoch from now() - r.checked_in_at) / 60)::int end);
end $$;

-- The student's own "I'm leaving".
create or replace function uniattend.check_out(p_session uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r uniattend.attendance_records;
begin
  select ar.* into r from uniattend.attendance_records ar
  join uniattend.students st on st.id = ar.student_id and st.user_id = auth.uid()
  where ar.session_id = p_session;
  if r.id is null then raise exception 'You have not checked in to this session.' using errcode = 'P0002'; end if;
  return uniattend.apply_checkout(r.id);
end $$;

-- ------------------------------------------------------------ card scanning
create or replace function uniattend.scan_student(p_session uuid, p_code text, p_direction text default 'in')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s uniattend.class_sessions; st uniattend.students; r uniattend.attendance_records; v_code text; v_late int; v_status text; res jsonb;
begin
  select * into s from uniattend.class_sessions where id = p_session;
  if s is null or not (uniattend.teaches_module(s.module_id) or uniattend.is_inst_admin(s.institution_id)) then
    raise exception 'not your session' using errcode = '42501';
  end if;
  -- Cards often print the number with spaces or a prefix letter case difference.
  v_code := upper(regexp_replace(coalesce(p_code, ''), '\s', '', 'g'));
  if length(v_code) not between 3 and 40 then
    return jsonb_build_object('outcome', 'unknown', 'message', 'That card could not be read.');
  end if;
  select * into st from uniattend.students
   where institution_id = s.institution_id and upper(student_number) = v_code and deleted_at is null;
  if st.id is null then
    return jsonb_build_object('outcome', 'unknown', 'message', 'No student with number ' || v_code || ' at this institution.');
  end if;
  res := jsonb_build_object('student_number', st.student_number, 'full_name', st.full_name);
  if not exists (select 1 from uniattend.module_enrolments where module_id = s.module_id and student_id = st.id and status = 'active') then
    return res || jsonb_build_object('outcome', 'not_enrolled', 'message', st.full_name || ' is not enrolled in this module.');
  end if;
  select * into r from uniattend.attendance_records where session_id = s.id and student_id = st.id;

  if p_direction = 'out' then
    if r.id is null then return res || jsonb_build_object('outcome', 'not_in', 'message', st.full_name || ' never checked in.'); end if;
    return res || uniattend.apply_checkout(r.id);
  end if;

  if s.status <> 'open' then
    return res || jsonb_build_object('outcome', 'closed', 'message', 'Check-in is paused or closed for this session.');
  end if;
  if r.id is not null and r.status in ('present','late','excused') then
    return res || jsonb_build_object('outcome', 'duplicate', 'status', r.status, 'message', st.full_name || ' is already recorded.');
  end if;
  v_late := case when now() > s.late_after then greatest(1, floor(extract(epoch from now() - s.late_after) / 60))::int end;
  -- A card shown to the lecturer in person is direct evidence: late arrivals are simply late.
  v_status := case when v_late is null then 'present' else 'late' end;
  insert into uniattend.attendance_records as ar (institution_id, session_id, module_id, student_id, status, method,
                                                  checked_in_at, minutes_late, overridden_by, overridden_at, override_note, explanation)
  values (s.institution_id, s.id, s.module_id, st.id, v_status, 'card', now(), v_late, auth.uid(), now(),
          'Student card scanned', '["Student card scanned by staff."]'::jsonb)
  on conflict (session_id, student_id) do update
    set status = excluded.status, method = 'card', checked_in_at = excluded.checked_in_at, minutes_late = excluded.minutes_late,
        overridden_by = excluded.overridden_by, overridden_at = excluded.overridden_at, override_note = excluded.override_note
  returning * into r;
  insert into uniattend.attendance_evidence (institution_id, record_id, kind, data)
  values (s.institution_id, r.id, 'manual', jsonb_build_object('to', v_status, 'note', 'Student card scanned', 'by', auth.uid(), 'via', 'card'));
  return res || jsonb_build_object('outcome', 'checked_in', 'status', v_status, 'minutes_late', v_late);
end $$;

-- ------------------------------------------------------------ grants
do $$
declare f text;
begin
  foreach f in array array['printed_qr_token(uuid)', 'session_control(uuid,text,integer,integer)', 'apply_checkout(uuid)',
                           'check_out(uuid)', 'scan_student(uuid,text,text)'] loop
    execute format('revoke all on function uniattend.%s from public, anon', f);
  end loop;
end $$;
grant execute on function uniattend.printed_qr_token(uuid) to authenticated;
grant execute on function uniattend.session_control(uuid,text,integer,integer) to authenticated;
grant execute on function uniattend.check_out(uuid) to authenticated;
grant execute on function uniattend.scan_student(uuid,text,text) to authenticated;
-- apply_checkout is internal only (called by check_out and scan_student).
