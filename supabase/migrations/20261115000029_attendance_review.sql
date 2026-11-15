-- UniAttend 0029 — attendance exceptions: one review queue, and no absence from weak evidence.
--
-- * close_session(): a student who tried to check in and was refused (for example
--   the QR had expired, or the typed code was not allowed) is no longer recorded
--   absent when the class closes. Their record becomes "pending review" with what
--   happened, and a person decides. Students who never tried are absent as before.
-- * review_queue(): every check-in waiting for a person — weak or missing location,
--   a device used by another student, a typed code, an offline check-in, a refused
--   attempt, a late arrival — with its evidence and attempts, for the module's
--   lecturers (their modules) and the institution's administrators (all modules).
--   'decided' lists the decisions of the last 30 days: who decided, what, and why.
-- * decide_review(): decide one or many at once: present, late, absent or excused.
--   A reason is required to record someone absent or excused. Each decision is kept
--   as evidence on the record, the student is told, and it is audited.
-- * missing_registers(): classes from the timetable that should have taken
--   attendance, have ended, and have no attendance session — "not recorded".

-- ---------------------------------------------------------------- close_session
create or replace function uniattend.close_session(p_session uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s uniattend.class_sessions; n_absent int; n_late_auto int; n_review int; v_tz text;
begin
  select * into s from uniattend.class_sessions where id = p_session for update;
  if s is null or not (uniattend.teaches_module(s.module_id) or uniattend.is_inst_admin(s.institution_id)) then
    raise exception 'not your session' using errcode = '42501';
  end if;
  if s.status <> 'open' then raise exception 'session is already %', s.status; end if;
  select coalesce(timezone, 'Africa/Johannesburg') into v_tz from uniattend.institutions where id = s.institution_id;

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

  -- Tried and refused: a person decides, it is never an automatic absence.
  insert into uniattend.attendance_records (institution_id, session_id, module_id, student_id, status, method, explanation)
  select s.institution_id, s.id, s.module_id, e.student_id, 'pending_verification', 'system',
         jsonb_build_array(format('Tried to check in at %s, but it was not accepted: %s', to_char(ev.created_at at time zone v_tz, 'HH24:MI'),
                                  coalesce(ev.reasons->>0, 'no reason was recorded.')),
                           'Sent for review instead of being marked absent.')
  from uniattend.module_enrolments e
  join lateral (select x.created_at, x.reasons from uniattend.attendance_verification_events x
                where x.session_id = s.id and x.student_id = e.student_id and x.outcome = 'rejected'
                order by x.created_at desc limit 1) ev on true
  where e.module_id = s.module_id and e.status = 'active'
  on conflict (session_id, student_id) do nothing;
  get diagnostics n_review = row_count;

  -- Absence is recorded only once the session is over, never pre-emptively.
  insert into uniattend.attendance_records (institution_id, session_id, module_id, student_id, status, method, explanation)
  select s.institution_id, s.id, s.module_id, e.student_id, 'absent', 'system',
         '["No check-in was received before the session closed."]'::jsonb
  from uniattend.module_enrolments e
  where e.module_id = s.module_id and e.status = 'active'
  on conflict (session_id, student_id) do nothing;
  get diagnostics n_absent = row_count;

  perform uniattend.write_audit(s.institution_id, 'close', 'class_sessions', s.id::text,
                             jsonb_build_object('absent', n_absent, 'late_auto_accepted', n_late_auto, 'sent_to_review', n_review));
  return (select jsonb_build_object(
    'absent', n_absent,
    'late_auto_accepted', n_late_auto,
    'sent_to_review', n_review,
    'present', count(*) filter (where status = 'present'),
    'late', count(*) filter (where status = 'late'),
    'pending', count(*) filter (where status = 'pending_verification'))
    from uniattend.attendance_records where session_id = p_session);
end $$;

-- ---------------------------------------------------------------- the queue
-- Who may review a module's records: its lecturers, and the institution's admins.
create or replace function uniattend._may_review(p_inst uuid, p_module uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select uniattend.is_inst_admin(p_inst) or uniattend.teaches_module(p_module);
$$;

create or replace function uniattend.review_queue(p_inst uuid, p_state text default 'open', p_limit int default 200)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_admin boolean := uniattend.is_inst_admin(p_inst); v_max int; v_lim int := least(greatest(coalesce(p_limit, 200), 1), 500);
begin
  if auth.uid() is null or not (v_admin or uniattend.has_role(p_inst, array['lecturer'])) then
    raise exception 'Only lecturers and administrators review attendance.' using errcode = '42501';
  end if;
  if p_state not in ('open', 'decided') then raise exception 'Unknown list.' using errcode = '22023'; end if;
  select gps_max_accuracy_m into v_max from uniattend.institution_settings where institution_id = p_inst;

  if p_state = 'open' then
    return (select coalesce(jsonb_agg(q order by q.opens_at desc, q.student_number), '[]'::jsonb) from (
      select r.id as record_id, r.session_id, cs.title as session_title, cs.opens_at, cs.status as session_status,
             m.code as module_code, st.student_number, st.full_name, r.status, r.method, r.score,
             r.checked_in_at, r.minutes_late, r.explanation as reasons,
             case when r.status = 'late_pending' then 'late'
                  when r.method = 'offline' then 'offline'
                  when r.method = 'system' then 'refused_attempt'
                  when (ev.layers->'device'->>'points')::numeric = 0 then 'device_reused'
                  when ev.layers->'gps'->>'shared' = 'false' then 'no_location'
                  when (ev.layers->'gps'->>'p_inside')::numeric < 0.5 then 'outside_venue'
                  when (ev.layers->'gps'->>'accuracy_m')::numeric > v_max then 'weak_location'
                  when r.method = 'code' then 'typed_code'
                  else 'low_score' end as kind,
             jsonb_build_object(
               'accuracy_m', ev.layers->'gps'->'accuracy_m', 'outside_by_m', ev.layers->'gps'->'outside_by_m',
               'p_inside', ev.layers->'gps'->'p_inside', 'location_required', coalesce(ev.layers->'gps'->>'required', 'true') <> 'false',
               'device_points', ev.layers->'device'->'points', 'qr_points', ev.layers->'qr'->'points',
               'attempts', (select count(*) from uniattend.attendance_verification_events a
                            where a.session_id = r.session_id and a.student_id = r.student_id),
               'refused_attempts', (select count(*) from uniattend.attendance_verification_events a
                                    where a.session_id = r.session_id and a.student_id = r.student_id and a.outcome = 'rejected')) as evidence
      from uniattend.attendance_records r
      join uniattend.class_sessions cs on cs.id = r.session_id
      join uniattend.modules m on m.id = r.module_id
      join uniattend.students st on st.id = r.student_id
      left join lateral (select x.layers from uniattend.attendance_verification_events x
                         where x.session_id = r.session_id and x.student_id = r.student_id and x.outcome <> 'duplicate'
                         order by x.created_at desc limit 1) ev on true
      where r.institution_id = p_inst and r.status in ('pending_verification', 'late_pending')
        and (v_admin or uniattend.teaches_module(r.module_id))
      order by cs.opens_at desc, st.student_number
      limit v_lim) q);
  end if;

  return (select coalesce(jsonb_agg(q order by q.decided_at desc), '[]'::jsonb) from (
    select e.id as decision_id, r.id as record_id, r.session_id, cs.title as session_title, cs.opens_at,
           m.code as module_code, st.student_number, st.full_name,
           e.data->>'review_decision' as decision, e.data->>'previous' as previous, e.data->>'note' as note,
           coalesce(nullif(p.full_name, ''), p.email, 'Someone') as decided_by, e.created_at as decided_at,
           r.status as status_now
    from uniattend.attendance_evidence e
    join uniattend.attendance_records r on r.id = e.record_id
    join uniattend.class_sessions cs on cs.id = r.session_id
    join uniattend.modules m on m.id = r.module_id
    join uniattend.students st on st.id = r.student_id
    left join uniattend.profiles p on p.id = (e.data->>'by')::uuid
    where e.institution_id = p_inst and e.kind = 'manual' and e.data ? 'review_decision'
      and e.created_at > now() - interval '30 days'
      and (v_admin or uniattend.teaches_module(r.module_id))
    order by e.created_at desc
    limit v_lim) q);
end $$;

-- ---------------------------------------------------------------- decisions
create or replace function uniattend.decide_review(p_records uuid[], p_status text, p_note text default null)
returns int language plpgsql security definer set search_path = '' as $$
declare r uniattend.attendance_records; n int := 0; v_note text; v_title text; v_inst uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  if p_status not in ('present', 'late', 'absent', 'excused') then
    raise exception 'Choose present, late, absent or excused.' using errcode = '22023';
  end if;
  if coalesce(cardinality(p_records), 0) = 0 or cardinality(p_records) > 500 then
    raise exception 'Choose between 1 and 500 check-ins.' using errcode = '22023';
  end if;
  v_note := nullif(left(trim(coalesce(p_note, '')), 500), '');
  if p_status in ('absent', 'excused') and length(coalesce(v_note, '')) < 3 then
    raise exception 'Give a reason for recording a student % after review.', p_status using errcode = '22023';
  end if;
  v_note := coalesce(v_note, case p_status when 'present' then 'Confirmed present after review.' else 'Confirmed late after review.' end);

  -- Every chosen record must be one this person may review, or nothing changes.
  if exists (select 1 from uniattend.attendance_records x where x.id = any(p_records)
             and not uniattend._may_review(x.institution_id, x.module_id))
     or (select count(*) from uniattend.attendance_records x where x.id = any(p_records)) <> cardinality(array(select distinct unnest(p_records))) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;

  for r in select * from uniattend.attendance_records x
           where x.id = any(p_records) and x.status in ('pending_verification', 'late_pending')
           order by x.id for update
  loop
    update uniattend.attendance_records
       set status = p_status, overridden_by = auth.uid(), overridden_at = now(), override_note = v_note
     where id = r.id;
    insert into uniattend.attendance_evidence (institution_id, record_id, kind, data)
    values (r.institution_id, r.id, 'manual', jsonb_build_object('review_decision', p_status, 'previous', r.status,
                                                                 'note', v_note, 'by', auth.uid()));
    select cs.title into v_title from uniattend.class_sessions cs where cs.id = r.session_id;
    insert into uniattend.notifications (institution_id, user_id, kind, title, body, link)
    select r.institution_id, st.user_id, 'attendance_corrected', 'Check-in reviewed',
           v_title || ': recorded as ' || p_status || '.'
           || case when p_status = 'absent' then ' You can dispute this from your history.' else '' end,
           '/student/history'
    from uniattend.students st where st.id = r.student_id and st.user_id is not null;
    v_inst := r.institution_id;
    n := n + 1;
  end loop;

  if n > 0 then
    perform uniattend.write_audit(v_inst, 'review_decide', 'attendance_records', null,
                                  jsonb_build_object('status', p_status, 'records', n, 'note', v_note));
  end if;
  return n;
end $$;

-- ---------------------------------------------------------------- not recorded
create or replace function uniattend.missing_registers(p_inst uuid, p_days int default 14)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_admin boolean := uniattend.is_inst_admin(p_inst); v_me uuid;
begin
  if auth.uid() is null or not (v_admin or uniattend.has_role(p_inst, array['lecturer'])) then
    raise exception 'Only lecturers and administrators see missing registers.' using errcode = '42501';
  end if;
  select l.id into v_me from uniattend.lecturers l where l.institution_id = p_inst and l.user_id = auth.uid() and l.deleted_at is null limit 1;
  return (select coalesce(jsonb_agg(q order by q.starts_at desc), '[]'::jsonb) from (
    select e.id as event_id, e.starts_at, e.ends_at, e.kind, e.group_name, m.code as module_code, m.title as module_title,
           v.name as venue, coalesce(l.full_name, '') as lecturer
    from uniattend.timetable_events e
    join uniattend.modules m on m.id = e.module_id
    left join uniattend.venues v on v.id = e.venue_id
    left join uniattend.lecturers l on l.id = e.lecturer_id
    where e.institution_id = p_inst and e.status = 'scheduled' and e.requires_attendance
      and e.session_id is null
      and e.ends_at < now() and e.ends_at > now() - make_interval(days => least(greatest(coalesce(p_days, 14), 1), 60))
      and (v_admin or uniattend.teaches_module(e.module_id) or (v_me is not null and e.lecturer_id = v_me))
      -- A session opened by hand for the same module at that time counts as the register.
      and not exists (select 1 from uniattend.class_sessions cs
                      where cs.module_id = e.module_id and cs.opens_at < e.ends_at and cs.closes_at > e.starts_at)
    order by e.starts_at desc
    limit 300) q);
end $$;

revoke execute on function uniattend._may_review(uuid, uuid) from public, anon, authenticated;
revoke execute on function uniattend.review_queue(uuid, text, int) from public, anon;
revoke execute on function uniattend.decide_review(uuid[], text, text) from public, anon;
revoke execute on function uniattend.missing_registers(uuid, int) from public, anon;
grant execute on function uniattend.review_queue(uuid, text, int) to authenticated;
grant execute on function uniattend.decide_review(uuid[], text, text) to authenticated;
grant execute on function uniattend.missing_registers(uuid, int) to authenticated;

insert into uniattend.schema_versions (version, name) values ('20261115000029', 'attendance_review')
on conflict (version) do nothing;
