-- UniAttend 0036 — signing in with the university's own account: where it is set up,
-- and what each institution offers on the sign-in page.
--
-- * institution_identity_providers: an institution's identity provider (OpenID
--   Connect now; SAML is listed but stays unavailable until it is enabled on the
--   Supabase plan and tested). The sign-in itself is run by Supabase Auth as a
--   custom provider ('custom:<name>'): Supabase checks state, nonce, PKCE and the
--   ID token's signature, issuer and audience, and creates the session. So no
--   client secret is kept here; it lives only in Supabase Auth.
--   A provider moves through five separate states — designed, configured,
--   connectivity_tested, login_tested, approved — plus suspended. Only an
--   approved and enabled provider is ever offered on the sign-in page.
--   Nobody writes this table directly; the platform's functions (0037 on) do.
-- * institutions.allow_email_sign_in: the transition. While true, people of that
--   institution may still use an email and password, and link_my_accounts() links
--   them by email as before. When false, email linking stops for that institution:
--   its people sign in with the university account only.
-- * sign_in_directory(): what the public sign-in page may show — active
--   institutions only, their name, logo and campuses, and which way in each offers.

create table if not exists uniattend.institution_identity_providers (
  id                    uuid primary key default gen_random_uuid(),
  institution_id        uuid not null references uniattend.institutions(id) on delete cascade,
  provider_type         text not null check (provider_type in ('oidc', 'saml')),
  -- What people see on the button, e.g. "UNIVEN account".
  provider_name         text not null check (length(trim(provider_name)) between 2 and 80),
  -- The provider as registered in Supabase Auth: 'custom:<name>' for OIDC.
  supabase_provider     text unique check (supabase_provider is null or supabase_provider ~ '^custom:[a-z0-9][a-z0-9-]{1,40}$'),
  issuer_url            text check (issuer_url is null or issuer_url ~ '^https://[^\s/?#]+'),
  client_id             text check (client_id is null or length(client_id) <= 300),
  scopes                text not null default 'openid profile email' check (scopes ~ '^[A-Za-z0-9_:./ -]+$' and length(scopes) <= 300),
  saml_metadata_url     text check (saml_metadata_url is null or saml_metadata_url ~ '^https://'),
  saml_entity_id        text check (saml_entity_id is null or length(saml_entity_id) <= 500),
  -- Which claim holds the student or staff number, the email and the name.
  identifier_claim      text not null default 'preferred_username' check (identifier_claim ~ '^[A-Za-z0-9_:./-]{1,100}$'),
  email_claim           text not null default 'email' check (email_claim ~ '^[A-Za-z0-9_:./-]{1,100}$'),
  name_claim            text not null default 'name' check (name_claim ~ '^[A-Za-z0-9_:./-]{1,100}$'),
  configuration_status  text not null default 'designed'
                        check (configuration_status in ('designed','configured','connectivity_tested','login_tested','approved','suspended')),
  enabled               boolean not null default false,
  last_connectivity_test_at timestamptz,
  last_connectivity_result  text check (last_connectivity_result is null or length(last_connectivity_result) <= 1000),
  last_login_test_at    timestamptz,
  last_success_at       timestamptz,
  last_error            text check (last_error is null or length(last_error) <= 1000),
  approved_at           timestamptz,
  approved_by           uuid references auth.users(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (institution_id, id),
  -- An OIDC provider can't be approved without the pieces Supabase needs.
  constraint idp_oidc_complete check (provider_type <> 'oidc' or configuration_status = 'designed'
    or (supabase_provider is not null and issuer_url is not null and client_id is not null)),
  -- Offered only once approved.
  constraint idp_enabled_only_approved check (not enabled or configuration_status = 'approved')
);
create index if not exists idp_institution on uniattend.institution_identity_providers (institution_id);
drop trigger if exists idp_touch on uniattend.institution_identity_providers;
create trigger idp_touch before update on uniattend.institution_identity_providers
  for each row execute function uniattend.touch_updated_at();

alter table uniattend.institution_identity_providers enable row level security;
-- Read: the institution's own administrators and integration administrators, and
-- the platform. No write policy: changes go through audited functions.
drop policy if exists idp_read on uniattend.institution_identity_providers;
create policy idp_read on uniattend.institution_identity_providers for select to authenticated
  using (uniattend.is_inst_admin(institution_id) or uniattend.is_super_admin());
revoke all on uniattend.institution_identity_providers from anon, authenticated;
grant select on uniattend.institution_identity_providers to authenticated;

alter table uniattend.institutions add column if not exists allow_email_sign_in boolean not null default true;

-- Email linking only where the institution still allows email sign-in.
create or replace function uniattend._rewrite(p_fn text, p_from text, p_to text, p_times int default 1)
returns void language plpgsql set search_path = '' as $$
declare def text; n int;
begin
  select pg_get_functiondef(p.oid) into def from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'uniattend' and p.proname = p_fn;
  if def is null then raise exception '0036: function % not found', p_fn; end if;
  n := (length(def) - length(replace(def, p_from, ''))) / length(p_from);
  if n <> p_times then raise exception '0036: expected % of "%" in %, found %', p_times, p_from, p_fn, n; end if;
  execute replace(def, p_from, p_to);
end $$;
do $$
begin
  perform uniattend._rewrite('link_my_accounts',
    'where i.id = s.institution_id and i.status = ''active'' and i.deleted_at is null)',
    'where i.id = s.institution_id and i.status = ''active'' and i.deleted_at is null and i.allow_email_sign_in)');
  perform uniattend._rewrite('link_my_accounts',
    'where i.id = l.institution_id and i.status = ''active'' and i.deleted_at is null)',
    'where i.id = l.institution_id and i.status = ''active'' and i.deleted_at is null and i.allow_email_sign_in)');
end $$;
drop function uniattend._rewrite(text, text, text, int);

-- The public list for the sign-in page. Only what a visitor needs to choose their
-- institution and the way in; nothing about people, and nothing about providers
-- that are not approved.
create or replace function uniattend.sign_in_directory(p_slug text default null)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x order by x->>'name'), '[]'::jsonb) from (
    select jsonb_strip_nulls(jsonb_build_object(
      'slug', i.slug,
      'name', i.name,
      'short_name', coalesce(nullif(trim(i.short_name), ''), nullif(trim(d.short_name), '')),
      'logo', case when coalesce(i.theme->'header'->>'logoUrl', '') ~ '^https://' then i.theme->'header'->>'logoUrl' end,
      'campuses', (select jsonb_agg(c.name order by c.name) from uniattend.campuses c where c.institution_id = i.id),
      'method', case when p.id is not null then 'sso' when i.allow_email_sign_in then 'email' else 'none' end,
      'provider', p.supabase_provider,
      'provider_name', p.provider_name,
      'scopes', p.scopes)) as x
    from uniattend.institutions i
    left join uniattend.institution_directory d on d.id = i.directory_id
    left join lateral (
      select ip.id, ip.supabase_provider, ip.provider_name, ip.scopes
        from uniattend.institution_identity_providers ip
       where ip.institution_id = i.id and ip.enabled and ip.configuration_status = 'approved'
         and ip.provider_type = 'oidc' and ip.supabase_provider is not null
       order by ip.approved_at desc nulls last limit 1) p on true
    where i.status = 'active' and i.deleted_at is null
      and (p_slug is null or i.slug = lower(trim(p_slug)))
  ) s;
$$;
revoke all on function uniattend.sign_in_directory(text) from public;
grant execute on function uniattend.sign_in_directory(text) to anon, authenticated;

insert into uniattend.schema_versions (version, name) values ('20261118000036', 'identity_providers')
on conflict (version) do nothing;
