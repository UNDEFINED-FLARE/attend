-- UniAttend 0004 — authorization predicates and row level security.
--
-- Predicates are SECURITY DEFINER so evaluating a policy on one table does not
-- re-enter RLS on another and recurse, and they pin search_path to '' (an
-- unpinned search_path on a definer function is a privilege-escalation vector).
-- Identity always comes from auth.uid(); no predicate takes a user id argument.

create or replace function public.is_super_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.user_roles r
                 where r.user_id = auth.uid() and r.role = 'super_admin' and r.status = 'active');
$$;

create or replace function public.has_role(p_inst uuid, p_roles text[])
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.user_roles r
                 where r.user_id = auth.uid() and r.institution_id = p_inst
                   and r.role = any(p_roles) and r.status = 'active');
$$;

create or replace function public.is_member(p_inst uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.has_role(p_inst, array['institution_admin','lecturer','student']);
$$;

create or replace function public.is_inst_admin(p_inst uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.has_role(p_inst, array['institution_admin']) or public.is_super_admin();
$$;

create or replace function public.teaches_module(p_module uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.lecturer_assignments la
    join public.lecturers l on l.id = la.lecturer_id
    join public.user_roles r on r.user_id = l.user_id and r.institution_id = l.institution_id
                            and r.role = 'lecturer' and r.status = 'active'
    where la.module_id = p_module and l.user_id = auth.uid() and l.status = 'active');
$$;

create or replace function public.enrolled_in_module(p_module uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.module_enrolments e
    join public.students s on s.id = e.student_id
    where e.module_id = p_module and e.status = 'active'
      and s.user_id = auth.uid() and s.status = 'active');
$$;

create or replace function public.is_own_student(p_student uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.students s where s.id = p_student and s.user_id = auth.uid());
$$;

create or replace function public.lecturer_sees_student(p_student uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.module_enrolments e
    join public.lecturer_assignments la on la.module_id = e.module_id
    join public.lecturers l on l.id = la.lecturer_id
    where e.student_id = p_student and l.user_id = auth.uid() and l.status = 'active');
$$;

create or replace function public.module_of_record(p_record uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select module_id from public.attendance_records where id = p_record;
$$;

-- ------------------------------------------------------------ enable RLS

do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- ---------------------------------------------------------- institutions

create policy institutions_select on public.institutions for select to authenticated
  using (public.is_super_admin() or public.is_member(id) or created_by = (select auth.uid()));
create policy institutions_update on public.institutions for update to authenticated
  using (public.is_inst_admin(id)) with check (public.is_inst_admin(id));
-- status changes are blocked for institution admins by a trigger in 0005;
-- inserts go through request_institution(); deletes are super-admin only.
create policy institutions_delete on public.institutions for delete to authenticated
  using (public.is_super_admin());

create policy institution_settings_select on public.institution_settings for select to authenticated
  using (public.is_super_admin() or public.is_member(institution_id));
create policy institution_settings_update on public.institution_settings for update to authenticated
  using (public.is_inst_admin(institution_id)) with check (public.is_inst_admin(institution_id));

create policy institution_domains_select on public.institution_domains for select to authenticated
  using (public.is_inst_admin(institution_id));
create policy institution_domains_write on public.institution_domains for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

-- -------------------------------------------------------------- people

create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or public.is_super_admin()
         or exists (select 1 from public.user_roles r
                    where r.user_id = profiles.id and public.is_inst_admin(r.institution_id)));
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy user_roles_select on public.user_roles for select to authenticated
  using (user_id = (select auth.uid()) or public.is_super_admin()
         or (institution_id is not null and public.is_inst_admin(institution_id)));
-- no write policies: roles change only through grant_role()/revoke_role()

-- ------------------------------------------- academic structure (shared)
-- Any member may read their own institution's structure; only admins write.

do $$
declare t text;
begin
  foreach t in array array['campuses','venues','faculties','departments','academic_programmes',
                           'academic_periods','modules','lecturer_assignments','timetables']
  loop
    execute format($f$create policy %I on public.%I for select to authenticated
                     using (public.is_super_admin() or public.is_member(institution_id))$f$,
                   t || '_select', t);
    execute format($f$create policy %I on public.%I for insert to authenticated
                     with check (public.is_inst_admin(institution_id))$f$, t || '_insert', t);
    execute format($f$create policy %I on public.%I for update to authenticated
                     using (public.is_inst_admin(institution_id))
                     with check (public.is_inst_admin(institution_id))$f$, t || '_update', t);
    execute format($f$create policy %I on public.%I for delete to authenticated
                     using (public.is_inst_admin(institution_id))$f$, t || '_delete', t);
  end loop;
end $$;

-- ------------------------------------------------------ students/lecturers

create policy students_select on public.students for select to authenticated
  using (public.is_inst_admin(institution_id) or user_id = (select auth.uid())
         or public.lecturer_sees_student(id));
create policy students_admin_write on public.students for all to authenticated
  using (public.is_inst_admin(institution_id)) with check (public.is_inst_admin(institution_id));

create policy lecturers_select on public.lecturers for select to authenticated
  using (public.is_super_admin() or public.is_member(institution_id));
create policy lecturers_admin_write on public.lecturers for all to authenticated
  using (public.is_inst_admin(institution_id)) with check (public.is_inst_admin(institution_id));

create policy module_enrolments_select on public.module_enrolments for select to authenticated
  using (public.is_inst_admin(institution_id) or public.teaches_module(module_id)
         or public.is_own_student(student_id));
create policy module_enrolments_admin_write on public.module_enrolments for all to authenticated
  using (public.is_inst_admin(institution_id)) with check (public.is_inst_admin(institution_id));

-- ------------------------------------------------------------- attendance
-- Reads only. Every write goes through a definer function in 0005, which is
-- where the server — never the client — decides a status.

create policy class_sessions_select on public.class_sessions for select to authenticated
  using (public.is_inst_admin(institution_id) or public.teaches_module(module_id)
         or public.enrolled_in_module(module_id));

create policy attendance_records_select on public.attendance_records for select to authenticated
  using (public.is_inst_admin(institution_id) or public.teaches_module(module_id)
         or public.is_own_student(student_id));

create policy verification_events_select on public.attendance_verification_events for select to authenticated
  using (public.is_inst_admin(institution_id) or public.is_own_student(student_id)
         or exists (select 1 from public.class_sessions cs
                    where cs.id = session_id and public.teaches_module(cs.module_id)));

create policy attendance_evidence_select on public.attendance_evidence for select to authenticated
  using (public.is_inst_admin(institution_id) or public.teaches_module(public.module_of_record(record_id))
         or exists (select 1 from public.attendance_records ar
                    where ar.id = record_id and public.is_own_student(ar.student_id)));

create policy attendance_disputes_select on public.attendance_disputes for select to authenticated
  using (public.is_inst_admin(institution_id) or public.is_own_student(student_id)
         or public.teaches_module(public.module_of_record(record_id)));

create policy acoustic_windows_select on public.acoustic_windows for select to authenticated
  using (exists (select 1 from public.class_sessions cs where cs.id = session_id
                 and (public.teaches_module(cs.module_id) or public.enrolled_in_module(cs.module_id))));

-- session_secrets, acoustic_submissions: RLS on, deliberately no policies.

-- ------------------------------------------------------------ commercial

create policy subscription_plans_select on public.subscription_plans for select to authenticated
  using (is_active or public.is_super_admin());
create policy subscription_plans_write on public.subscription_plans for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

create policy institution_subscriptions_select on public.institution_subscriptions for select to authenticated
  using (public.is_inst_admin(institution_id));
create policy institution_subscriptions_write on public.institution_subscriptions for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

create policy payments_select on public.payments for select to authenticated
  using (public.is_inst_admin(institution_id));

create policy usage_metrics_select on public.usage_metrics for select to authenticated
  using (public.is_inst_admin(institution_id));

-- ------------------------------------------------- notifications & audit

create policy notifications_select on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));

create policy announcements_select on public.announcements for select to authenticated
  using (published_at <= now() and (expires_at is null or expires_at > now())
         and (institution_id is null or public.is_member(institution_id) or public.is_super_admin()));
create policy announcements_write on public.announcements for all to authenticated
  using (case when institution_id is null then public.is_super_admin()
              else public.is_inst_admin(institution_id) end)
  with check (case when institution_id is null then public.is_super_admin()
                   else public.is_inst_admin(institution_id) end);

create policy audit_logs_select on public.audit_logs for select to authenticated
  using (public.is_super_admin() or (institution_id is not null and public.is_inst_admin(institution_id)));
