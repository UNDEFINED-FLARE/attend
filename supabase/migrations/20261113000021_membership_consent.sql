-- UniAttend 0021 — nobody is added to an institution without it being approved,
-- without being told, and without a way out.
--
-- * Accounts are linked to student/lecturer records (by confirmed email) only in
--   ACTIVE institutions. Anyone can apply for an institution and administer it
--   while it is pending; until the platform approves it, it can't attach other
--   people's accounts. grant_role likewise needs an active institution.
-- * Whoever is added gets a notification naming the institution and role.
-- * leave_institution(): a person removes their own membership. The institution's
--   admins can't add them back (grant_role / set_role_status refuse); only the
--   platform administrator can, e.g. after the person asks.

alter table uniattend.user_roles add column if not exists left_at timestamptz;

create or replace function uniattend.notify_joined(p_user uuid, p_inst uuid, p_role text)
returns void language sql security definer set search_path = '' as $$
  insert into uniattend.notifications (institution_id, user_id, kind, title, body, link)
  select p_inst, p_user, 'membership',
         'Added to ' || i.name,
         'You now have access to ' || i.name || ' as ' || replace(p_role, '_', ' ') ||
         '. If this isn''t you or you don''t study or work there, open Security and choose Leave.', '/settings'
  from uniattend.institutions i where i.id = p_inst;
$$;

create or replace function uniattend.link_my_accounts()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  em text; confirmed timestamptz; localpart text; v_domain text;
  n_students int := 0; n_lecturers int := 0; r record;
begin
  if uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  perform uniattend.ensure_profile();
  select lower(u.email), u.email_confirmed_at into em, confirmed from auth.users u where u.id = uid;
  if em is null or confirmed is null then
    return jsonb_build_object('linked', false, 'reason', 'Confirm your email address first.');
  end if;
  localpart := split_part(em, '@', 1);
  v_domain := split_part(em, '@', 2);

  for r in
    with c as (
      update uniattend.students s set user_id = uid
      where s.user_id is null and s.deleted_at is null and s.status = 'active'
        and exists (select 1 from uniattend.institutions i where i.id = s.institution_id and i.status = 'active' and i.deleted_at is null)
        and not exists (select 1 from uniattend.user_roles x where x.user_id = uid and x.institution_id = s.institution_id and x.left_at is not null)
        and (lower(s.email) = em
             or (lower(s.student_number) = localpart and exists (
                   select 1 from uniattend.institution_domains d
                   where d.institution_id = s.institution_id and d.domain = v_domain and d.verified_at is not null)))
        and not exists (select 1 from uniattend.students s2 where s2.institution_id = s.institution_id and s2.user_id = uid)
      returning s.institution_id)
    insert into uniattend.user_roles (user_id, institution_id, role)
    select uid, institution_id, 'student' from c
    on conflict (user_id, institution_id, role) do nothing
    returning institution_id
  loop
    n_students := n_students + 1;
    perform uniattend.notify_joined(uid, r.institution_id, 'student');
  end loop;

  for r in
    with c as (
      update uniattend.lecturers l set user_id = uid
      where l.user_id is null and l.deleted_at is null and l.status = 'active' and lower(l.email) = em
        and exists (select 1 from uniattend.institutions i where i.id = l.institution_id and i.status = 'active' and i.deleted_at is null)
        and not exists (select 1 from uniattend.user_roles x where x.user_id = uid and x.institution_id = l.institution_id and x.left_at is not null)
        and not exists (select 1 from uniattend.lecturers l2 where l2.institution_id = l.institution_id and l2.user_id = uid)
      returning l.institution_id)
    insert into uniattend.user_roles (user_id, institution_id, role)
    select uid, institution_id, 'lecturer' from c
    on conflict (user_id, institution_id, role) do nothing
    returning institution_id
  loop
    n_lecturers := n_lecturers + 1;
    perform uniattend.notify_joined(uid, r.institution_id, 'lecturer');
  end loop;

  return jsonb_build_object('linked', true, 'students', n_students, 'lecturers', n_lecturers);
end $$;

create or replace function uniattend.grant_role(p_inst uuid, p_email text, p_role text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare target uuid; confirmed timestamptz; rid uuid; prev uniattend.user_roles;
begin
  if p_role = 'super_admin' then
    if not uniattend.is_super_admin() then raise exception 'super admin only' using errcode = '42501'; end if;
    p_inst := null;
  else
    if p_role not in ('institution_admin','lecturer','student') then raise exception 'bad role'; end if;
    if not uniattend.is_inst_admin(p_inst) then raise exception 'institution admin only' using errcode = '42501'; end if;
    if not uniattend.is_super_admin() and not exists (
         select 1 from uniattend.institutions where id = p_inst and status = 'active' and deleted_at is null) then
      raise exception 'Your institution must be approved before you can add people to it.' using errcode = '42501';
    end if;
  end if;
  select id, email_confirmed_at into target, confirmed from auth.users where lower(email) = lower(trim(p_email));
  if target is null then raise exception 'No account uses that email yet. Ask them to sign up first.'; end if;
  if confirmed is null then
    raise exception 'That account has not confirmed its email yet. Ask them to click the link in their confirmation email, then try again.';
  end if;
  select * into prev from uniattend.user_roles where user_id = target and institution_id is not distinct from p_inst and left_at is not null limit 1;
  if prev.id is not null and not uniattend.is_super_admin() then
    raise exception 'This person left your institution, so they can''t be added back from here. Ask them to contact UniAttend support.' using errcode = '42501';
  end if;
  insert into uniattend.user_roles (user_id, institution_id, role, granted_by)
  values (target, p_inst, p_role, auth.uid())
  on conflict (user_id, institution_id, role) do update set status = 'active', left_at = null
  returning id into rid;
  if p_inst is not null then perform uniattend.notify_joined(target, p_inst, p_role); end if;
  return rid;
end $$;

create or replace function uniattend.set_role_status(p_role_id uuid, p_status text)
returns void language plpgsql security definer set search_path = '' as $$
declare r uniattend.user_roles;
begin
  select * into r from uniattend.user_roles where id = p_role_id;
  if r is null then raise exception 'no such role'; end if;
  if r.role = 'super_admin' or r.institution_id is null then
    if not uniattend.is_super_admin() then raise exception 'super admin only' using errcode = '42501'; end if;
  elsif not uniattend.is_inst_admin(r.institution_id) then
    raise exception 'institution admin only' using errcode = '42501';
  end if;
  if r.user_id = auth.uid() and p_status <> 'active' then
    raise exception 'you cannot suspend your own access';
  end if;
  if p_status not in ('active','suspended') then raise exception 'bad status'; end if;
  if p_status = 'active' and r.left_at is not null and not uniattend.is_super_admin() then
    raise exception 'This person left your institution, so they can''t be added back from here.' using errcode = '42501';
  end if;
  update uniattend.user_roles set status = p_status, left_at = case when p_status = 'active' then null else left_at end where id = p_role_id;
end $$;

-- A person leaves an institution: all their roles there stop, and it is recorded.
create or replace function uniattend.leave_institution(p_inst uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); n int;
begin
  if uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if exists (select 1 from uniattend.user_roles where user_id = uid and institution_id = p_inst and role = 'institution_admin' and status = 'active')
     and not exists (select 1 from uniattend.user_roles where institution_id = p_inst and role = 'institution_admin' and status = 'active' and user_id <> uid) then
    raise exception 'You are this institution''s only administrator. Add another administrator before leaving.' using errcode = 'P0001';
  end if;
  update uniattend.user_roles set status = 'suspended', left_at = now()
   where user_id = uid and institution_id = p_inst and left_at is null;
  get diagnostics n = row_count;
  if n > 0 then
    perform uniattend.write_audit(p_inst, 'left_institution', 'user_roles', uid::text, '{}'::jsonb);
  end if;
  return n;
end $$;

revoke all on function uniattend.notify_joined(uuid, uuid, text) from public, anon, authenticated;
revoke all on function uniattend.leave_institution(uuid) from public, anon;
grant execute on function uniattend.leave_institution(uuid) to authenticated;
