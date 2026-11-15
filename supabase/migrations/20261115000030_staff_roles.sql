-- UniAttend 0030 — staff roles for real university administration.
--
-- New roles, granted by an institution administrator (never chosen at sign-up):
--   faculty_admin       one faculty: its modules' attendance, reviews and reports.
--   department_admin    one department: the same, for that department's modules.
--   attendance_officer  the whole institution's attendance: reviews, disputes,
--                       corrections and exports. No structure, people or settings.
--   integration_admin   connections, imports and sync runs. No attendance records.
--   auditor             read-only: attendance, decisions, the audit log and who
--                       holds which role. Cannot change anything.
-- A person holds at most one of each role per institution; granting it again
-- moves the scope (another faculty or department).
--
-- How it is enforced: the database decides, not the app. Two checks cover every
-- module-level rule — may_view_module() (read) and may_correct_module() (change).
-- The existing read policies and functions are widened to use them. Functions
-- are edited in place by exact text replacement, and the migration stops if a
-- piece of text it expects to change is not there, so nothing is altered silently.

-- ---------------------------------------------------------------- roles and scope
alter table uniattend.user_roles drop constraint if exists user_roles_role_check;
alter table uniattend.user_roles add constraint user_roles_role_check check (role in
  ('super_admin', 'institution_admin', 'lecturer', 'student',
   'faculty_admin', 'department_admin', 'attendance_officer', 'integration_admin', 'auditor'));
alter table uniattend.user_roles
  add column if not exists faculty_id uuid,
  add column if not exists department_id uuid;
alter table uniattend.user_roles drop constraint if exists user_roles_faculty_fk;
alter table uniattend.user_roles add constraint user_roles_faculty_fk
  foreign key (institution_id, faculty_id) references uniattend.faculties(institution_id, id) on delete cascade;
alter table uniattend.user_roles drop constraint if exists user_roles_department_fk;
alter table uniattend.user_roles add constraint user_roles_department_fk
  foreign key (institution_id, department_id) references uniattend.departments(institution_id, id) on delete cascade;
alter table uniattend.user_roles drop constraint if exists user_roles_scope_check;
alter table uniattend.user_roles add constraint user_roles_scope_check check (
  (role = 'faculty_admin') = (faculty_id is not null) and (role = 'department_admin') = (department_id is not null));

-- ---------------------------------------------------------------- checks
-- Members read their institution's structure (modules, venues, departments…).
create or replace function uniattend.is_member(p_inst uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select uniattend.has_role(p_inst, array['institution_admin','lecturer','student','faculty_admin',
                                          'department_admin','attendance_officer','integration_admin','auditor']);
$$;

-- Sees every module's attendance in the institution.
create or replace function uniattend.sees_all_attendance(p_inst uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select uniattend.is_inst_admin(p_inst) or uniattend.has_role(p_inst, array['attendance_officer','auditor']);
$$;

-- The module is in a faculty or department this person administers.
create or replace function uniattend.scope_has_module(p_module uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from uniattend.modules m
    left join uniattend.departments d on d.id = m.department_id
    join uniattend.user_roles r on r.user_id = auth.uid() and r.institution_id = m.institution_id and r.status = 'active'
    where m.id = p_module
      and ((r.role = 'department_admin' and r.department_id = m.department_id)
           or (r.role = 'faculty_admin' and r.faculty_id = d.faculty_id)));
$$;

create or replace function uniattend.may_view_module(p_module uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select uniattend.teaches_module(p_module) or uniattend.scope_has_module(p_module)
      or exists (select 1 from uniattend.modules m where m.id = p_module and uniattend.sees_all_attendance(m.institution_id));
$$;

-- Like may_view_module, without the auditor (read-only).
create or replace function uniattend.may_correct_module(p_module uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select uniattend.teaches_module(p_module) or uniattend.scope_has_module(p_module)
      or exists (select 1 from uniattend.modules m where m.id = p_module
                 and (uniattend.is_inst_admin(m.institution_id) or uniattend.has_role(m.institution_id, array['attendance_officer'])));
$$;

create or replace function uniattend.staff_sees_student(p_student uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from uniattend.students s where s.id = p_student
                 and uniattend.has_role(s.institution_id, array['attendance_officer','auditor']))
      or exists (select 1 from uniattend.module_enrolments e where e.student_id = p_student and uniattend.scope_has_module(e.module_id));
$$;

create or replace function uniattend.can_integrate(p_inst uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select uniattend.is_inst_admin(p_inst) or uniattend.has_role(p_inst, array['integration_admin']);
$$;

create or replace function uniattend.is_auditor(p_inst uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select uniattend.has_role(p_inst, array['auditor']);
$$;

-- ---------------------------------------------------------------- read policies
drop policy if exists students_select on uniattend.students;
create policy students_select on uniattend.students for select to authenticated
  using (uniattend.is_inst_admin(institution_id) or user_id = (select auth.uid())
         or uniattend.lecturer_sees_student(id) or uniattend.staff_sees_student(id));

drop policy if exists module_enrolments_select on uniattend.module_enrolments;
create policy module_enrolments_select on uniattend.module_enrolments for select to authenticated
  using (uniattend.may_view_module(module_id) or uniattend.is_own_student(student_id));

drop policy if exists class_sessions_select on uniattend.class_sessions;
create policy class_sessions_select on uniattend.class_sessions for select to authenticated
  using (uniattend.may_view_module(module_id) or uniattend.enrolled_in_module(module_id));

drop policy if exists attendance_records_select on uniattend.attendance_records;
create policy attendance_records_select on uniattend.attendance_records for select to authenticated
  using (uniattend.may_view_module(module_id) or uniattend.is_own_student(student_id));

drop policy if exists verification_events_select on uniattend.attendance_verification_events;
create policy verification_events_select on uniattend.attendance_verification_events for select to authenticated
  using (uniattend.sees_all_attendance(institution_id) or uniattend.is_own_student(student_id)
         or exists (select 1 from uniattend.class_sessions cs
                    where cs.id = session_id and uniattend.may_view_module(cs.module_id)));

drop policy if exists attendance_evidence_select on uniattend.attendance_evidence;
create policy attendance_evidence_select on uniattend.attendance_evidence for select to authenticated
  using (uniattend.may_view_module(uniattend.module_of_record(record_id))
         or exists (select 1 from uniattend.attendance_records ar
                    where ar.id = record_id and uniattend.is_own_student(ar.student_id)));

drop policy if exists attendance_disputes_select on uniattend.attendance_disputes;
create policy attendance_disputes_select on uniattend.attendance_disputes for select to authenticated
  using (uniattend.is_own_student(student_id) or uniattend.may_view_module(uniattend.module_of_record(record_id)));

drop policy if exists audit_logs_select on uniattend.audit_logs;
create policy audit_logs_select on uniattend.audit_logs for select to authenticated
  using (uniattend.is_super_admin() or (institution_id is not null
         and (uniattend.is_inst_admin(institution_id) or uniattend.is_auditor(institution_id))));

drop policy if exists user_roles_select on uniattend.user_roles;
create policy user_roles_select on uniattend.user_roles for select to authenticated
  using (user_id = (select auth.uid()) or uniattend.is_super_admin()
         or (institution_id is not null and (uniattend.is_inst_admin(institution_id) or uniattend.is_auditor(institution_id))));

drop policy if exists profiles_select on uniattend.profiles;
create policy profiles_select on uniattend.profiles for select to authenticated
  using (id = (select auth.uid()) or uniattend.is_super_admin()
         or exists (select 1 from uniattend.user_roles r
                    where r.user_id = profiles.id
                      and (uniattend.is_inst_admin(r.institution_id) or uniattend.is_auditor(r.institution_id))));

-- ---------------------------------------------------------------- functions, widened in place
create or replace function uniattend._rewrite(p_fn text, p_from text, p_to text, p_times int default 1)
returns void language plpgsql set search_path = '' as $$
declare def text; n int;
begin
  select pg_get_functiondef(p.oid) into def from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'uniattend' and p.proname = p_fn;
  if def is null then raise exception '0030: function % not found', p_fn; end if;
  n := (length(def) - length(replace(def, p_from, ''))) / length(p_from);
  if n <> p_times then raise exception '0030: expected % of "%" in %, found %', p_times, p_from, p_fn, n; end if;
  execute replace(def, p_from, p_to);
end $$;

do $$
begin
  -- Reviews: attendance officers and faculty/department admins review and decide;
  -- auditors see the queue but cannot decide (decide_review uses _may_review).
  perform uniattend._rewrite('_may_review', 'uniattend.is_inst_admin(p_inst) or uniattend.teaches_module(p_module)',
                             'uniattend.may_correct_module(p_module)');
  perform uniattend._rewrite('review_queue', 'v_admin boolean := uniattend.is_inst_admin(p_inst)',
                             'v_admin boolean := uniattend.sees_all_attendance(p_inst)');
  perform uniattend._rewrite('review_queue', 'uniattend.has_role(p_inst, array[''lecturer''])',
                             'uniattend.has_role(p_inst, array[''lecturer'',''faculty_admin'',''department_admin''])');
  perform uniattend._rewrite('review_queue', '(v_admin or uniattend.teaches_module(r.module_id))',
                             '(v_admin or uniattend.may_view_module(r.module_id))', 2);
  perform uniattend._rewrite('missing_registers', 'v_admin boolean := uniattend.is_inst_admin(p_inst)',
                             'v_admin boolean := uniattend.sees_all_attendance(p_inst)');
  perform uniattend._rewrite('missing_registers', 'uniattend.has_role(p_inst, array[''lecturer''])',
                             'uniattend.has_role(p_inst, array[''lecturer'',''faculty_admin'',''department_admin''])');
  perform uniattend._rewrite('missing_registers', '(v_admin or uniattend.teaches_module(e.module_id) or',
                             '(v_admin or uniattend.may_view_module(e.module_id) or');
  -- Reports and exports: everyone who may see the module.
  perform uniattend._rewrite('module_report', 'not (uniattend.teaches_module(m.id) or uniattend.is_inst_admin(m.institution_id))',
                             'not uniattend.may_view_module(m.id)');
  perform uniattend._rewrite('log_export', 'not (uniattend.teaches_module(p_module) or uniattend.is_inst_admin(v_inst))',
                             'not uniattend.may_view_module(p_module)');
  -- An integration admin downloads an import's rejected rows (and it is logged).
  perform uniattend._rewrite('log_export', 'elsif v_inst is null or not uniattend.is_inst_admin(v_inst) then',
                             'elsif v_inst is null or not (uniattend.is_inst_admin(v_inst) or (p_kind = ''rejected_rows'' and uniattend.can_integrate(v_inst))) then');
  -- Corrections and disputes: everyone who may correct the module.
  perform uniattend._rewrite('override_attendance', 'not (uniattend.teaches_module(s.module_id) or uniattend.is_inst_admin(s.institution_id))',
                             'not uniattend.may_correct_module(s.module_id)');
  perform uniattend._rewrite('resolve_dispute', 'not (uniattend.teaches_module(r.module_id) or uniattend.is_inst_admin(r.institution_id))',
                             'not uniattend.may_correct_module(r.module_id)');
end $$;

-- Integration administrators: the connection, import and sync functions and tables.
do $$
declare f text; n int; pol record;
begin
  foreach f in array array['import_students','save_integration','integration_action','import_roster','import_start',
                           'import_add','import_preview','import_commit','import_cancel','retry_run'] loop
    select (length(def) - length(replace(def, 'uniattend.is_inst_admin(', ''))) / length('uniattend.is_inst_admin(') into n
      from (select pg_get_functiondef(p.oid) def from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
            where ns.nspname = 'uniattend' and p.proname = f) x;
    if coalesce(n, 0) = 0 then raise exception '0030: % has no administrator check to widen', f; end if;
    perform uniattend._rewrite(f, 'uniattend.is_inst_admin(', 'uniattend.can_integrate(', n);
  end loop;
  for pol in select policyname, tablename, qual, with_check from pg_policies
             where schemaname = 'uniattend' and tablename in ('integrations','integration_runs','integration_staging',
               'integration_external_ids','integration_errors','integration_checkpoints','integration_mappings')
               and (qual like '%is_inst_admin(%' or with_check like '%is_inst_admin(%') loop
    execute format('alter policy %I on uniattend.%I %s %s', pol.policyname, pol.tablename,
      case when pol.qual is not null then 'using (' || replace(pol.qual, 'is_inst_admin(', 'can_integrate(') || ')' else '' end,
      case when pol.with_check is not null then 'with check (' || replace(pol.with_check, 'is_inst_admin(', 'can_integrate(') || ')' else '' end);
  end loop;
end $$;

drop function uniattend._rewrite(text, text, text, int);

-- ---------------------------------------------------------------- granting roles
drop function if exists uniattend.grant_role(uuid, text, text);
create or replace function uniattend.grant_role(p_inst uuid, p_email text, p_role text,
                                                p_faculty uuid default null, p_department uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare target uuid; confirmed timestamptz; rid uuid; prev uniattend.user_roles;
begin
  if p_role = 'super_admin' then
    if not uniattend.is_super_admin() then raise exception 'super admin only' using errcode = '42501'; end if;
    p_inst := null;
  else
    if p_role not in ('institution_admin','lecturer','student','faculty_admin','department_admin',
                      'attendance_officer','integration_admin','auditor') then raise exception 'bad role'; end if;
    if not uniattend.is_inst_admin(p_inst) then raise exception 'institution admin only' using errcode = '42501'; end if;
    if not uniattend.is_super_admin() and not exists (
         select 1 from uniattend.institutions where id = p_inst and status = 'active' and deleted_at is null) then
      raise exception 'Your institution must be approved before you can add people to it.' using errcode = '42501';
    end if;
  end if;
  -- The scope: a faculty for a faculty admin, a department for a department admin, nothing otherwise.
  if p_role = 'faculty_admin' then
    if p_faculty is null or not exists (select 1 from uniattend.faculties where id = p_faculty and institution_id = p_inst) then
      raise exception 'Choose one of your faculties for a faculty administrator.' using errcode = '22023';
    end if;
  else p_faculty := null; end if;
  if p_role = 'department_admin' then
    if p_department is null or not exists (select 1 from uniattend.departments where id = p_department and institution_id = p_inst) then
      raise exception 'Choose one of your departments for a department administrator.' using errcode = '22023';
    end if;
  else p_department := null; end if;
  select id, email_confirmed_at into target, confirmed from auth.users where lower(email) = lower(trim(p_email));
  if target is null then raise exception 'No account uses that email yet. Ask them to sign up first.'; end if;
  if confirmed is null then
    raise exception 'That account has not confirmed its email yet. Ask them to click the link in their confirmation email, then try again.';
  end if;
  select * into prev from uniattend.user_roles where user_id = target and institution_id is not distinct from p_inst and left_at is not null limit 1;
  if prev.id is not null and not uniattend.is_super_admin() then
    raise exception 'This person left your institution, so they can''t be added back from here. Ask them to contact UniAttend support.' using errcode = '42501';
  end if;
  insert into uniattend.user_roles (user_id, institution_id, role, granted_by, faculty_id, department_id)
  values (target, p_inst, p_role, auth.uid(), p_faculty, p_department)
  on conflict (user_id, institution_id, role) do update
    set status = 'active', left_at = null, faculty_id = excluded.faculty_id, department_id = excluded.department_id,
        granted_by = excluded.granted_by
  returning id into rid;
  if p_inst is not null then perform uniattend.notify_joined(target, p_inst, p_role); end if;
  return rid;
end $$;
revoke execute on function uniattend.grant_role(uuid, text, text, uuid, uuid) from public, anon;
grant execute on function uniattend.grant_role(uuid, text, text, uuid, uuid) to authenticated;

-- my_roles() also says what each scoped role covers.
drop function if exists uniattend.my_roles();
create function uniattend.my_roles()
returns table (institution_id uuid, institution_name text, institution_slug text,
               institution_status text, brand_primary text, role text, scope_name text)
language sql stable security definer set search_path = '' as $$
  select r.institution_id, i.name, i.slug, i.status, i.brand_primary, r.role, coalesce(f.name, d.name)
  from uniattend.user_roles r
  left join uniattend.institutions i on i.id = r.institution_id
  left join uniattend.faculties f on f.id = r.faculty_id
  left join uniattend.departments d on d.id = r.department_id
  where r.user_id = auth.uid() and r.status = 'active'
    and (i.id is null or i.deleted_at is null)
  order by case r.role when 'super_admin' then 0 when 'institution_admin' then 1 when 'faculty_admin' then 2
                       when 'department_admin' then 3 when 'attendance_officer' then 4 when 'integration_admin' then 5
                       when 'auditor' then 6 when 'lecturer' then 7 else 8 end, i.name;
$$;
revoke execute on function uniattend.my_roles() from public, anon;
grant execute on function uniattend.my_roles() to authenticated;

-- What a faculty or department admin, officer or auditor oversees: each module in
-- scope with its attendance over closed sessions, worst first.
create or replace function uniattend.scope_overview(p_inst uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not (uniattend.sees_all_attendance(p_inst)
                                or uniattend.has_role(p_inst, array['faculty_admin','department_admin'])) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  return (select coalesce(jsonb_agg(q order by q.rate nulls last, q.code), '[]'::jsonb) from (
    select m.id, m.code, m.title, dep.name as department,
           (select count(*) from uniattend.module_enrolments e where e.module_id = m.id and e.status = 'active') as students,
           count(distinct cs.id) as sessions,
           round(100.0 * count(a.id) filter (where a.status in ('present','late'))
                 / nullif(count(a.id) filter (where a.status in ('present','late','absent')), 0), 1) as rate,
           count(a.id) filter (where a.status in ('pending_verification','late_pending','disputed')) as unresolved
    from uniattend.modules m
    left join uniattend.departments dep on dep.id = m.department_id
    left join uniattend.class_sessions cs on cs.module_id = m.id and cs.status = 'closed'
    left join uniattend.attendance_records a on a.session_id = cs.id
    where m.institution_id = p_inst and m.deleted_at is null and uniattend.may_view_module(m.id)
    group by m.id, m.code, m.title, dep.name
    order by m.code
    limit 1000) q);
end $$;
revoke execute on function uniattend.scope_overview(uuid) from public, anon;
grant execute on function uniattend.scope_overview(uuid) to authenticated;

revoke execute on function uniattend.sees_all_attendance(uuid) from public, anon;
revoke execute on function uniattend.scope_has_module(uuid) from public, anon;
revoke execute on function uniattend.may_view_module(uuid) from public, anon;
revoke execute on function uniattend.may_correct_module(uuid) from public, anon;
revoke execute on function uniattend.staff_sees_student(uuid) from public, anon;
revoke execute on function uniattend.can_integrate(uuid) from public, anon;
revoke execute on function uniattend.is_auditor(uuid) from public, anon;
grant execute on function uniattend.sees_all_attendance(uuid), uniattend.scope_has_module(uuid), uniattend.may_view_module(uuid),
  uniattend.may_correct_module(uuid), uniattend.staff_sees_student(uuid), uniattend.can_integrate(uuid), uniattend.is_auditor(uuid)
  to authenticated;

insert into uniattend.schema_versions (version, name) values ('20261115000030', 'staff_roles')
on conflict (version) do nothing;
