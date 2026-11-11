-- UniAttend 0016 — readiness fixes from docs/capacity/10k-readiness-report.md (P0 items 2 and 6).
--
-- 1. Indexes the report lists as missing (B-2/D-9 follow-ups):
--    attendance_verification_events(session_id), class_sessions(lecturer_id), class_sessions(venue_id).
--    On a large production table, build them first with CREATE INDEX CONCURRENTLY outside a
--    transaction; IF NOT EXISTS then makes this migration a no-op for them.
-- 2. S-1: an unapproved ("pending") institution could attach people to itself.
--    * grant_role() only works for an approved institution, and answers the same way whatever
--      the email: a confirmed account gets the role at once, anyone else when they sign up and
--      confirm that address (role_invitations). It is no longer a way to test whether an email
--      has an account, including accounts of the other app sharing this project.
--    * link_my_accounts() only links students, lecturers and invitations of approved
--      institutions. A pending institution can still set up its people (imports keep working);
--      they are linked when UniAttend approves it and the person next signs in.

-- ------------------------------------------------------------------ 1. indexes
create index if not exists verification_events_session on uniattend.attendance_verification_events(session_id);
create index if not exists class_sessions_lecturer on uniattend.class_sessions(lecturer_id) where lecturer_id is not null;
create index if not exists class_sessions_venue on uniattend.class_sessions(venue_id) where venue_id is not null;
-- /student/history now asks for the student's own disputes (B-4).
create index if not exists attendance_disputes_student on uniattend.attendance_disputes(student_id, created_at desc);

-- ------------------------------------------------------- 2. role invitations
create table uniattend.role_invitations (
  institution_id uuid not null references uniattend.institutions(id) on delete cascade,
  email          text not null check (email = lower(trim(email)) and length(email) between 3 and 320),
  role           text not null check (role in ('institution_admin', 'lecturer', 'student')),
  invited_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  primary key (institution_id, email, role)
);
create index role_invitations_email on uniattend.role_invitations(email);
alter table uniattend.role_invitations enable row level security;
create policy role_invitations_select on uniattend.role_invitations for select to authenticated
  using (uniattend.is_inst_admin(institution_id));
revoke insert, update, delete, truncate on uniattend.role_invitations from anon, authenticated;
revoke select on uniattend.role_invitations from anon;

-- --------------------------------------------------------------- grant_role
-- Returns nothing now (it returned the role id), so the result can't reveal whether the
-- account existed. Callers only checked for an error.
drop function if exists uniattend.grant_role(uuid, text, text);
create function uniattend.grant_role(p_inst uuid, p_email text, p_role text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_email text := lower(trim(p_email)); target uuid;
begin
  if v_email is null or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Enter a valid email address.';
  end if;

  if p_role = 'super_admin' then
    -- Platform staff only; they may see whether the account exists.
    if not uniattend.is_super_admin() then raise exception 'super admin only' using errcode = '42501'; end if;
    select id into target from auth.users where lower(email) = v_email and email_confirmed_at is not null;
    if target is null then raise exception 'No confirmed account uses that email.'; end if;
    insert into uniattend.user_roles (user_id, institution_id, role, granted_by)
    values (target, null, 'super_admin', auth.uid())
    on conflict (user_id, institution_id, role) do update set status = 'active';
    return;
  end if;

  if p_role not in ('institution_admin', 'lecturer', 'student') then raise exception 'bad role'; end if;
  if not uniattend.is_inst_admin(p_inst) then raise exception 'institution admin only' using errcode = '42501'; end if;
  if not exists (select 1 from uniattend.institutions where id = p_inst and status = 'active' and deleted_at is null) then
    raise exception 'You can add people by email once UniAttend has approved your institution.' using errcode = 'P0001';
  end if;

  -- Same outcome whatever the email.
  select id into target from auth.users where lower(email) = v_email and email_confirmed_at is not null;
  if target is not null then
    insert into uniattend.user_roles (user_id, institution_id, role, granted_by)
    values (target, p_inst, p_role, auth.uid())
    on conflict (user_id, institution_id, role) do update set status = 'active';
  else
    insert into uniattend.role_invitations (institution_id, email, role, invited_by)
    values (p_inst, v_email, p_role, auth.uid())
    on conflict (institution_id, email, role) do update set invited_by = excluded.invited_by, created_at = now();
  end if;
  perform uniattend.write_audit(p_inst, 'grant_role', 'user_roles', v_email, jsonb_build_object('role', p_role));
end $$;

-- ----------------------------------------------------------- link_my_accounts
-- As before (0005), plus: only approved institutions, and pending invitations are applied.
create or replace function uniattend.link_my_accounts()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  em text; confirmed timestamptz; localpart text; v_domain text;
  n_students int := 0; n_lecturers int := 0; n_roles int := 0;
begin
  if uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  perform uniattend.ensure_profile();
  select lower(u.email), u.email_confirmed_at into em, confirmed from auth.users u where u.id = uid;
  if em is null or confirmed is null then
    return jsonb_build_object('linked', false, 'reason', 'Confirm your email address first.');
  end if;
  localpart := split_part(em, '@', 1);
  v_domain := split_part(em, '@', 2);

  with c as (
    update uniattend.students s set user_id = uid
    where s.user_id is null and s.deleted_at is null and s.status = 'active'
      and exists (select 1 from uniattend.institutions i
                  where i.id = s.institution_id and i.status = 'active' and i.deleted_at is null)
      and (lower(s.email) = em
           or (lower(s.student_number) = localpart and exists (
                 select 1 from uniattend.institution_domains d
                 where d.institution_id = s.institution_id and d.domain = v_domain and d.verified_at is not null)))
      and not exists (select 1 from uniattend.students s2 where s2.institution_id = s.institution_id and s2.user_id = uid)
    returning s.institution_id)
  insert into uniattend.user_roles (user_id, institution_id, role)
  select uid, institution_id, 'student' from c
  on conflict (user_id, institution_id, role) do nothing;
  get diagnostics n_students = row_count;

  with c as (
    update uniattend.lecturers l set user_id = uid
    where l.user_id is null and l.deleted_at is null and l.status = 'active' and lower(l.email) = em
      and exists (select 1 from uniattend.institutions i
                  where i.id = l.institution_id and i.status = 'active' and i.deleted_at is null)
      and not exists (select 1 from uniattend.lecturers l2 where l2.institution_id = l.institution_id and l2.user_id = uid)
    returning l.institution_id)
  insert into uniattend.user_roles (user_id, institution_id, role)
  select uid, institution_id, 'lecturer' from c
  on conflict (user_id, institution_id, role) do nothing;
  get diagnostics n_lecturers = row_count;

  with inv as (
    delete from uniattend.role_invitations r
    where r.email = em and exists (select 1 from uniattend.institutions i
                                   where i.id = r.institution_id and i.status = 'active' and i.deleted_at is null)
    returning r.institution_id, r.role, r.invited_by)
  insert into uniattend.user_roles (user_id, institution_id, role, granted_by)
  select uid, institution_id, role, invited_by from inv
  on conflict (user_id, institution_id, role) do update set status = 'active';
  get diagnostics n_roles = row_count;

  return jsonb_build_object('linked', true, 'students', n_students, 'lecturers', n_lecturers, 'roles', n_roles);
end $$;

-- ------------------------------------------------------------------ grants
revoke all on function uniattend.grant_role(uuid, text, text) from public, anon;
grant execute on function uniattend.grant_role(uuid, text, text) to authenticated;
