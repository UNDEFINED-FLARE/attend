-- UniAttend 0019 — design drafts, version history, branded sign-in and logo upload.
--
-- * theme_versions: an institution's unpublished draft (one at most) and every
--   published design (the newest 30 are kept), so admins can work on a design
--   without everyone seeing it, and go back to an earlier one.
-- * save_theme_draft / discard_theme_draft / publish_theme: the only way to
--   write them; admins of that institution only, audited.
-- * public_branding(key): the name, logo, colours and sign-in text of one
--   institution, readable before signing in so the sign-in page carries the
--   institution's look. Nothing else about the institution is exposed.
-- * Storage bucket "branding" for uploaded logos (PNG, JPEG or WebP, 512 KB),
--   public to read; only an institution's admins write in its own folder.

create table if not exists uniattend.theme_versions (
  id              uuid primary key default gen_random_uuid(),
  institution_id  uuid not null references uniattend.institutions(id) on delete cascade,
  status          text not null check (status in ('draft','published')),
  theme           jsonb not null check (jsonb_typeof(theme) = 'object' and pg_column_size(theme) < 16384),
  note            text check (length(note) <= 120),
  created_by      uuid references auth.users(id) on delete set null,
  created_by_name text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create unique index if not exists theme_versions_one_draft on uniattend.theme_versions(institution_id) where status = 'draft';
create index if not exists theme_versions_history on uniattend.theme_versions(institution_id, created_at desc);

alter table uniattend.theme_versions enable row level security;
drop policy if exists theme_versions_select on uniattend.theme_versions;
create policy theme_versions_select on uniattend.theme_versions for select to authenticated
  using (uniattend.is_super_admin() or uniattend.is_inst_admin(institution_id));
-- no insert/update/delete policies: writes go through the functions below
grant select on uniattend.theme_versions to authenticated;

create or replace function uniattend.theme_author()
returns text language sql stable security definer set search_path = '' as $$
  select nullif(trim(full_name), '') from uniattend.profiles where id = auth.uid();
$$;

create or replace function uniattend.save_theme_draft(p_institution uuid, p_theme jsonb)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare v_at timestamptz := now();
begin
  if not uniattend.is_inst_admin(p_institution) then
    raise exception 'only the institution''s administrators can change its design' using errcode = '42501';
  end if;
  if jsonb_typeof(p_theme) is distinct from 'object' then raise exception 'not a design'; end if;
  update uniattend.theme_versions
     set theme = p_theme, updated_at = v_at, created_by = auth.uid(), created_by_name = uniattend.theme_author()
   where institution_id = p_institution and status = 'draft';
  if not found then
    insert into uniattend.theme_versions (institution_id, status, theme, created_by, created_by_name)
    values (p_institution, 'draft', p_theme, auth.uid(), uniattend.theme_author());
  end if;
  return v_at;
end $$;

create or replace function uniattend.discard_theme_draft(p_institution uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not uniattend.is_inst_admin(p_institution) then
    raise exception 'only the institution''s administrators can change its design' using errcode = '42501';
  end if;
  delete from uniattend.theme_versions where institution_id = p_institution and status = 'draft';
end $$;

create or replace function uniattend.publish_theme(p_institution uuid, p_theme jsonb, p_note text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_old jsonb;
begin
  if not uniattend.is_inst_admin(p_institution) then
    raise exception 'only the institution''s administrators can change its design' using errcode = '42501';
  end if;
  if jsonb_typeof(p_theme) is distinct from 'object' then raise exception 'not a design'; end if;
  select theme into v_old from uniattend.institutions where id = p_institution;
  -- The first publish keeps the design that was live before history existed.
  if v_old is not null and v_old <> '{}'::jsonb
     and not exists (select 1 from uniattend.theme_versions where institution_id = p_institution and status = 'published') then
    insert into uniattend.theme_versions (institution_id, status, theme, note, created_at)
    values (p_institution, 'published', v_old, 'Design before version history', now() - interval '1 second');
  end if;
  update uniattend.institutions
     set theme = p_theme,
         brand_primary = case when p_theme->'colors'->>'primary' ~ '^#[0-9a-fA-F]{6}$' then p_theme->'colors'->>'primary' else brand_primary end
   where id = p_institution;
  insert into uniattend.theme_versions (institution_id, status, theme, note, created_by, created_by_name)
  values (p_institution, 'published', p_theme, nullif(left(trim(coalesce(p_note, '')), 120), ''), auth.uid(), uniattend.theme_author())
  returning id into v_id;
  delete from uniattend.theme_versions where institution_id = p_institution and status = 'draft';
  delete from uniattend.theme_versions where id in (
    select id from uniattend.theme_versions where institution_id = p_institution and status = 'published'
     order by created_at desc offset 30);
  perform uniattend.write_audit(p_institution, 'theme_published', 'institutions', p_institution::text,
    jsonb_build_object('version', v_id, 'note', p_note));
  return v_id;
end $$;

-- What the sign-in page may show before anyone signs in: by slug or id.
create or replace function uniattend.public_branding(p_key text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
           'id', i.id, 'slug', i.slug, 'name', i.name,
           'theme', jsonb_strip_nulls(jsonb_build_object(
             'colors', i.theme->'colors', 'appearance', i.theme->'appearance', 'shape', i.theme->'shape',
             'font', i.theme->'font', 'login', i.theme->'login',
             'header', jsonb_build_object('title', i.theme->'header'->'title', 'subtitle', i.theme->'header'->'subtitle',
                                          'logoUrl', i.theme->'header'->'logoUrl'))),
           'brand_primary', i.brand_primary)
    from uniattend.institutions i
   where i.deleted_at is null and i.status in ('active','pending')
     and (i.slug = lower(trim(p_key))
          or (p_key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and i.id::text = lower(p_key)))
   limit 1;
$$;

-- Storage folder check: '<institution id>/file' and the caller administers it.
create or replace function uniattend.can_write_branding(p_name text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_folder text := split_part(coalesce(p_name, ''), '/', 1);
begin
  if v_folder !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
  return uniattend.is_inst_admin(v_folder::uuid);
end $$;

revoke all on function uniattend.theme_author() from public, anon, authenticated;
revoke all on function uniattend.save_theme_draft(uuid, jsonb) from public, anon;
revoke all on function uniattend.discard_theme_draft(uuid) from public, anon;
revoke all on function uniattend.publish_theme(uuid, jsonb, text) from public, anon;
revoke all on function uniattend.can_write_branding(text) from public, anon;
grant execute on function uniattend.save_theme_draft(uuid, jsonb) to authenticated;
grant execute on function uniattend.discard_theme_draft(uuid) to authenticated;
grant execute on function uniattend.publish_theme(uuid, jsonb, text) to authenticated;
grant execute on function uniattend.can_write_branding(text) to authenticated;
grant execute on function uniattend.public_branding(text) to anon, authenticated;

-- Logo bucket (only where Supabase Storage exists; local test databases have none).
do $$
begin
  if to_regclass('storage.buckets') is null or to_regclass('storage.objects') is null then return; end if;
  execute $sql$
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('branding', 'branding', true, 524288, array['image/png','image/jpeg','image/webp'])
    on conflict (id) do update set public = true, file_size_limit = 524288,
      allowed_mime_types = array['image/png','image/jpeg','image/webp']
  $sql$;
  execute 'drop policy if exists branding_insert on storage.objects';
  execute 'drop policy if exists branding_update on storage.objects';
  execute 'drop policy if exists branding_delete on storage.objects';
  execute $sql$create policy branding_insert on storage.objects for insert to authenticated
    with check (bucket_id = 'branding' and uniattend.can_write_branding(name))$sql$;
  execute $sql$create policy branding_update on storage.objects for update to authenticated
    using (bucket_id = 'branding' and uniattend.can_write_branding(name))
    with check (bucket_id = 'branding' and uniattend.can_write_branding(name))$sql$;
  execute $sql$create policy branding_delete on storage.objects for delete to authenticated
    using (bucket_id = 'branding' and uniattend.can_write_branding(name))$sql$;
end $$;
