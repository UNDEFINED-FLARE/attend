-- UniAttend 0014 — the lecturer's register: configurable statuses, bulk save, change history.
--
-- * attendance_statuses: an institution's own statuses ("Left early", "Medical",
--   "Field trip"...), each with a colour and a CATEGORY that decides how it counts:
--     present/late → attended, absent → absent, excused → left out of the percentage.
--   Records keep the category in attendance_records.status, so every existing
--   report, dashboard and percentage keeps working unchanged.
-- * save_register(): the lecturer saves many students at once, in one transaction.
-- * Every manual change keeps its history (from, to, who, when, why) in
--   attendance_evidence; record_history() returns it.

-- ---------------------------------------------------------------- statuses
create table uniattend.attendance_statuses (
  id             uuid primary key default gen_random_uuid(),
  institution_id uuid not null references uniattend.institutions(id) on delete cascade,
  name           text not null check (length(trim(name)) between 2 and 40),
  color          text not null default '#64748b' check (color ~ '^#[0-9a-fA-F]{6}$'),
  description    text check (description is null or length(description) <= 200),
  category       text not null check (category in ('present','late','absent','excused')),
  sort_order     int not null default 100,
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  unique (institution_id, id)
);
create unique index attendance_statuses_name on uniattend.attendance_statuses(institution_id, lower(name));
alter table uniattend.attendance_statuses enable row level security;
create policy attendance_statuses_select on uniattend.attendance_statuses for select to authenticated
  using (uniattend.is_member(institution_id) or uniattend.is_super_admin());
create policy attendance_statuses_write on uniattend.attendance_statuses for all to authenticated
  using (uniattend.is_inst_admin(institution_id)) with check (uniattend.is_inst_admin(institution_id));

alter table uniattend.attendance_records add column if not exists custom_status_id uuid;
alter table uniattend.attendance_records
  add constraint attendance_records_custom_status_fk foreign key (institution_id, custom_status_id)
  references uniattend.attendance_statuses(institution_id, id) on delete set null (custom_status_id);

-- Every institution starts with "Left early" (counts as attended, shown amber).
create or replace function uniattend.seed_attendance_statuses()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into uniattend.attendance_statuses (institution_id, name, color, description, category, sort_order)
  values (new.id, 'Left early', '#d97706', 'Attended but left before the end of the class.', 'present', 10)
  on conflict do nothing;
  return new;
end $$;
create trigger institutions_seed_statuses after insert on uniattend.institutions
  for each row execute function uniattend.seed_attendance_statuses();
insert into uniattend.attendance_statuses (institution_id, name, color, description, category, sort_order)
select i.id, 'Left early', '#d97706', 'Attended but left before the end of the class.', 'present', 10
from uniattend.institutions i
on conflict do nothing;

-- ---------------------------------------------------------------- bulk save
-- p_entries: [{"student": uuid, "status": "present|late|absent|excused", "custom": uuid|null, "note": text|null}, ...]
-- Unchanged entries are skipped. Corrections after the session has closed need a reason.
create or replace function uniattend.save_register(p_session uuid, p_entries jsonb, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s uniattend.class_sessions; e jsonb; v_student uuid; v_status text; v_custom uuid; v_note text;
  prev uniattend.attendance_records; r uniattend.attendance_records; v_by text; uid uuid; changed int := 0; skipped int := 0;
begin
  select * into s from uniattend.class_sessions where id = p_session;
  if s is null or not (uniattend.teaches_module(s.module_id) or uniattend.is_inst_admin(s.institution_id)) then
    raise exception 'only the module lecturer or an administrator may take the register' using errcode = '42501';
  end if;
  if jsonb_typeof(p_entries) <> 'array' or jsonb_array_length(p_entries) = 0 or jsonb_array_length(p_entries) > 3000 then
    raise exception 'nothing to save';
  end if;
  if s.status <> 'open' and length(trim(coalesce(p_note, ''))) < 3 then
    raise exception 'This session is closed: give a reason for the changes.' using errcode = 'P0001';
  end if;
  select coalesce(nullif(p.full_name, ''), p.email, 'Lecturer') into v_by from uniattend.profiles p where p.id = auth.uid();

  for e in select value from jsonb_array_elements(p_entries) loop
    v_student := (e->>'student')::uuid;
    v_status := e->>'status';
    v_custom := nullif(e->>'custom', '')::uuid;
    v_note := coalesce(nullif(trim(e->>'note'), ''), nullif(trim(p_note), ''));
    if v_status not in ('present','late','absent','excused') then raise exception 'not a status a person may set: %', v_status; end if;
    if v_custom is not null then
      -- A custom status must belong to this institution and decides the category.
      select category into v_status from uniattend.attendance_statuses
       where id = v_custom and institution_id = s.institution_id and active;
      if v_status is null then raise exception 'unknown attendance status'; end if;
    end if;
    if not exists (select 1 from uniattend.module_enrolments where module_id = s.module_id and student_id = v_student) then
      raise exception 'a student in the list is not enrolled in this module';
    end if;

    select * into prev from uniattend.attendance_records where session_id = s.id and student_id = v_student;
    if prev.id is not null and prev.status = v_status and prev.custom_status_id is not distinct from v_custom then
      skipped := skipped + 1; continue;
    end if;

    insert into uniattend.attendance_records as ar (institution_id, session_id, module_id, student_id, status, custom_status_id, method,
                                                    checked_in_at, overridden_by, overridden_at, override_note)
    values (s.institution_id, s.id, s.module_id, v_student, v_status, v_custom, 'manual',
            case when v_status in ('present','late') then now() end, auth.uid(), now(), coalesce(v_note, 'Register taken by the lecturer.'))
    on conflict (session_id, student_id) do update
      set status = excluded.status, custom_status_id = excluded.custom_status_id,
          overridden_by = excluded.overridden_by, overridden_at = excluded.overridden_at, override_note = excluded.override_note
    returning * into r;

    insert into uniattend.attendance_evidence (institution_id, record_id, kind, data)
    values (s.institution_id, r.id, 'manual', jsonb_build_object(
      'from', prev.status, 'from_custom', prev.custom_status_id, 'to', v_status, 'to_custom', v_custom,
      'note', coalesce(v_note, 'Register taken by the lecturer.'), 'by', auth.uid(), 'by_name', v_by, 'session_open', s.status = 'open'));

    -- Tell the student when a closed record is corrected (not for the live register).
    if s.status <> 'open' then
      select user_id into uid from uniattend.students where id = v_student;
      if uid is not null then
        insert into uniattend.notifications (institution_id, user_id, kind, title, body, link)
        values (s.institution_id, uid, 'attendance_corrected', 'Attendance updated',
                'Your attendance for ' || s.title || ' was set to ' ||
                coalesce((select name from uniattend.attendance_statuses where id = v_custom), v_status) || '.', '/student/history');
      end if;
    end if;
    changed := changed + 1;
  end loop;

  perform uniattend.write_audit(s.institution_id, 'register', 'class_sessions', s.id::text,
                             jsonb_build_object('changed', changed, 'unchanged', skipped));
  return jsonb_build_object('changed', changed, 'unchanged', skipped);
end $$;

-- ---------------------------------------------------------------- history
-- Everything that happened to one record: check-in attempts and manual changes, oldest first.
create or replace function uniattend.record_history(p_record uuid)
returns table (at timestamptz, kind text, summary text, by_name text, note text)
language plpgsql stable security definer set search_path = '' as $$
declare r uniattend.attendance_records;
begin
  select * into r from uniattend.attendance_records where id = p_record;
  if r is null or not (uniattend.teaches_module(r.module_id) or uniattend.is_inst_admin(r.institution_id)
                       or uniattend.is_own_student(r.student_id)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query
  select v.created_at, 'check_in'::text,
         initcap(v.outcome) || ' · score ' || v.score, null::text,
         nullif(array_to_string(array(select jsonb_array_elements_text(v.reasons)), ' '), '')
  from uniattend.attendance_verification_events v
  where v.session_id = r.session_id and v.student_id = r.student_id
  union all
  select ev.created_at, 'change'::text,
         case when ev.data ? 'from' then coalesce(
                (select name from uniattend.attendance_statuses where id = (ev.data->>'from_custom')::uuid), ev.data->>'from', 'none')
              || ' → ' ||
              coalesce((select name from uniattend.attendance_statuses where id = (ev.data->>'to_custom')::uuid), ev.data->>'to')
              else 'Set to ' || coalesce(ev.data->>'status', '?') end,
         coalesce(ev.data->>'by_name', 'Staff'), ev.data->>'note'
  from uniattend.attendance_evidence ev
  where ev.record_id = r.id and ev.kind = 'manual'
  union all
  select d.created_at, 'dispute'::text, 'Dispute ' || d.status, null::text, d.reason
  from uniattend.attendance_disputes d where d.record_id = r.id
  order by 1;
end $$;

-- ------------------------------------------------------------------ grants
revoke all on function uniattend.save_register(uuid, jsonb, text) from public, anon;
revoke all on function uniattend.record_history(uuid) from public, anon;
revoke all on function uniattend.seed_attendance_statuses() from public, anon;
grant execute on function uniattend.save_register(uuid, jsonb, text) to authenticated;
grant execute on function uniattend.record_history(uuid) to authenticated;
