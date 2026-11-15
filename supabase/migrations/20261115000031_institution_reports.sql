-- UniAttend 0031 — institutional reports, computed in the database.
--
-- * institution_report(): attendance for a date range, filtered by faculty,
--   department or module, for everyone who may see those modules: institution
--   admins, attendance officers and auditors (all modules), faculty and department
--   admins (their scope) and lecturers (the modules they teach). One call returns:
--     - totals (classes, records, present, late, absent, excused, unresolved, rate);
--     - attendance by faculty, by department and by module (lowest first);
--     - a weekly trend;
--     - students at risk: below their module's required attendance (counting
--       unresolved records as missed — the worst case) or absent from three or
--       more classes in a row;
--     - classes that needed a register and have none, and open disputes.
--   Only closed classes count. Rates are present + late over present + late +
--   absent; excused classes leave the count; unresolved records are reported
--   separately, never as absences. Everything is aggregated here, so the browser
--   never receives thousands of rows.
-- * log_export(): report downloads (CSV, Excel, printed/PDF) are audited too.

create or replace function uniattend.institution_report(p_inst uuid, p_from date default null, p_to date default null,
                                                        p_faculty uuid default null, p_department uuid default null,
                                                        p_module uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_tz text; v_from date; v_to date; v_min int; v_out jsonb;
begin
  if auth.uid() is null or not (uniattend.sees_all_attendance(p_inst)
       or uniattend.has_role(p_inst, array['faculty_admin', 'department_admin', 'lecturer'])) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  select coalesce(timezone, 'Africa/Johannesburg') into v_tz from uniattend.institutions where id = p_inst;
  select min_attendance_pct into v_min from uniattend.institution_settings where institution_id = p_inst;
  v_to := coalesce(p_to, (now() at time zone v_tz)::date);
  v_from := coalesce(p_from, v_to - 27);
  if v_to < v_from then raise exception 'The end date is before the start date.' using errcode = '22023'; end if;
  if v_to - v_from > 400 then raise exception 'Choose a period of at most 400 days.' using errcode = '22023'; end if;

  with mods as (
    select m.id, m.code, m.title, d.id as department_id, d.name as department, f.id as faculty_id, f.name as faculty,
           coalesce(m.min_attendance_pct, v_min, 75) as min_pct
    from uniattend.modules m
    left join uniattend.departments d on d.id = m.department_id
    left join uniattend.faculties f on f.id = d.faculty_id
    where m.institution_id = p_inst and m.deleted_at is null
      and (p_module is null or m.id = p_module)
      and (p_department is null or m.department_id = p_department)
      and (p_faculty is null or d.faculty_id = p_faculty)
      and uniattend.may_view_module(m.id)),
  sess as (
    select cs.id, cs.module_id, cs.opens_at, (cs.opens_at at time zone v_tz)::date as day
    from uniattend.class_sessions cs join mods on mods.id = cs.module_id
    where cs.status = 'closed' and (cs.opens_at at time zone v_tz)::date between v_from and v_to),
  rec as (
    select a.student_id, a.status, s.module_id, s.opens_at, s.day
    from uniattend.attendance_records a join sess s on s.id = a.session_id),
  -- counts per module, the building block of every table below
  per_mod as (
    select mods.*,
           (select count(*) from sess where sess.module_id = mods.id) as sessions,
           (select count(*) from uniattend.module_enrolments e where e.module_id = mods.id and e.status = 'active') as students,
           count(rec.status) filter (where rec.status = 'present') as present,
           count(rec.status) filter (where rec.status = 'late') as late,
           count(rec.status) filter (where rec.status = 'absent') as absent,
           count(rec.status) filter (where rec.status = 'excused') as excused,
           count(rec.status) filter (where rec.status in ('pending_verification', 'late_pending', 'disputed')) as unresolved
    from mods left join rec on rec.module_id = mods.id
    group by mods.id, mods.code, mods.title, mods.department_id, mods.department, mods.faculty_id, mods.faculty, mods.min_pct),
  -- a student's run of consecutive absences in one module
  runs as (
    select student_id, module_id, status,
           row_number() over (partition by student_id, module_id order by opens_at)
           - row_number() over (partition by student_id, module_id, (status = 'absent') order by opens_at) as grp
    from rec where status <> 'excused'),
  per_student as (
    select r.student_id, r.module_id,
           count(*) filter (where r.status in ('present', 'late')) as attended,
           count(*) filter (where r.status = 'absent') as absent,
           count(*) filter (where r.status in ('pending_verification', 'late_pending', 'disputed')) as unresolved,
           coalesce((select max(n) from (select count(*) as n from runs x
                                         where x.student_id = r.student_id and x.module_id = r.module_id and x.status = 'absent'
                                         group by x.grp) y), 0) as max_run
    from rec r group by r.student_id, r.module_id)
  select jsonb_build_object(
    'from', v_from, 'to', v_to, 'default_min_pct', coalesce(v_min, 75), 'generated_at', now(),
    'totals', (select jsonb_build_object(
        'modules', count(*), 'sessions', coalesce(sum(sessions), 0), 'present', coalesce(sum(present), 0),
        'late', coalesce(sum(late), 0), 'absent', coalesce(sum(absent), 0), 'excused', coalesce(sum(excused), 0),
        'unresolved', coalesce(sum(unresolved), 0),
        'rate', round(100.0 * sum(present + late) / nullif(sum(present + late + absent), 0), 1)) from per_mod),
    'by_faculty', (select coalesce(jsonb_agg(x order by x.rate nulls last, x.name), '[]'::jsonb) from (
        select coalesce(faculty, 'No faculty') as name, count(*) as modules, sum(sessions) as sessions,
               round(100.0 * sum(present + late) / nullif(sum(present + late + absent), 0), 1) as rate,
               sum(late) as late, sum(unresolved) as unresolved
        from per_mod group by faculty) x),
    'by_department', (select coalesce(jsonb_agg(x order by x.rate nulls last, x.name), '[]'::jsonb) from (
        select coalesce(department, 'No department') as name, coalesce(faculty, '') as faculty, count(*) as modules,
               sum(sessions) as sessions,
               round(100.0 * sum(present + late) / nullif(sum(present + late + absent), 0), 1) as rate,
               sum(late) as late, sum(unresolved) as unresolved
        from per_mod group by department, faculty) x),
    'by_module', (select coalesce(jsonb_agg(x order by x.rate nulls last, x.code), '[]'::jsonb) from (
        select id, code, title, coalesce(department, '') as department, min_pct, students, sessions,
               present, late, absent, excused, unresolved,
               round(100.0 * (present + late) / nullif(present + late + absent, 0), 1) as rate
        from per_mod order by code limit 2000) x),
    'trend', (select coalesce(jsonb_agg(x order by x.week), '[]'::jsonb) from (
        select date_trunc('week', day)::date as week, count(distinct (module_id, opens_at)) as sessions,
               round(100.0 * count(*) filter (where status in ('present', 'late'))
                     / nullif(count(*) filter (where status in ('present', 'late', 'absent')), 0), 1) as rate
        from rec group by 1) x),
    'at_risk', (select coalesce(jsonb_agg(x order by x.worst_case nulls last, x.student_number), '[]'::jsonb) from (
        select st.student_number, st.full_name, pm.code as module_code, pm.min_pct,
               ps.attended, ps.absent, ps.unresolved, ps.max_run as consecutive_absences,
               round(100.0 * ps.attended / nullif(ps.attended + ps.absent + ps.unresolved, 0), 1) as worst_case
        from per_student ps
        join per_mod pm on pm.id = ps.module_id
        join uniattend.students st on st.id = ps.student_id
        where ps.max_run >= 3
           or 100.0 * ps.attended / nullif(ps.attended + ps.absent + ps.unresolved, 0) < pm.min_pct
        order by 9 nulls last, st.student_number
        limit 500) x),
    'missing_registers', (select count(*) from uniattend.timetable_events e join mods on mods.id = e.module_id
        where e.status = 'scheduled' and e.requires_attendance and e.session_id is null and e.ends_at < now()
          and (e.starts_at at time zone v_tz)::date between v_from and v_to
          and not exists (select 1 from uniattend.class_sessions cs
                          where cs.module_id = e.module_id and cs.opens_at < e.ends_at and cs.closes_at > e.starts_at)),
    'open_disputes', (select count(*) from uniattend.attendance_disputes dsp
        join uniattend.attendance_records a on a.id = dsp.record_id join mods on mods.id = a.module_id
        where dsp.status = 'open'))
  into v_out;
  return v_out;
end $$;

revoke execute on function uniattend.institution_report(uuid, date, date, uuid, uuid, uuid) from public, anon;
grant execute on function uniattend.institution_report(uuid, date, date, uuid, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------- audited report downloads
create or replace function uniattend._rewrite(p_fn text, p_from text, p_to text, p_times int default 1)
returns void language plpgsql set search_path = '' as $$
declare def text; n int;
begin
  select pg_get_functiondef(p.oid) into def from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'uniattend' and p.proname = p_fn;
  if def is null then raise exception '0031: function % not found', p_fn; end if;
  n := (length(def) - length(replace(def, p_from, ''))) / length(p_from);
  if n <> p_times then raise exception '0031: expected % of "%" in %, found %', p_times, p_from, p_fn, n; end if;
  execute replace(def, p_from, p_to);
end $$;

do $$
begin
  perform uniattend._rewrite('log_export', 'p_kind not in (''admin_data'', ''module_report'', ''rejected_rows'', ''personal_data'')',
                             'p_kind not in (''admin_data'', ''module_report'', ''rejected_rows'', ''personal_data'', ''institution_report'')');
  perform uniattend._rewrite('log_export', '(p_kind = ''rejected_rows'' and uniattend.can_integrate(v_inst))',
                             '(p_kind = ''rejected_rows'' and uniattend.can_integrate(v_inst)) or (p_kind = ''institution_report'' and (uniattend.sees_all_attendance(v_inst) or uniattend.has_role(v_inst, array[''faculty_admin'', ''department_admin'', ''lecturer''])))');
  perform uniattend._rewrite('log_export', 'where k in (''kind'', ''filter'', ''run'', ''archived'')',
                             'where k in (''kind'', ''filter'', ''run'', ''archived'', ''format'', ''from'', ''to'', ''scope'')');
end $$;

drop function uniattend._rewrite(text, text, text, int);

insert into uniattend.schema_versions (version, name) values ('20261115000031', 'institution_reports')
on conflict (version) do nothing;
