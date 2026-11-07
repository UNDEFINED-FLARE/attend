-- UniAttend 0003 — commercial layer, notifications, announcements, audit.

create table public.subscription_plans (
  id               uuid primary key default gen_random_uuid(),
  code             text not null unique check (code ~ '^[a-z0-9_-]{2,40}$'),
  name             text not null,
  description      text,
  -- Prices are configured by the super admin; null means "contact sales".
  price_cents      bigint check (price_cents >= 0),
  currency         text not null default 'ZAR',
  billing_interval text not null default 'year' check (billing_interval in ('month','year')),
  max_students     int check (max_students > 0),    -- null = unlimited
  max_lecturers    int check (max_lecturers > 0),
  max_modules      int check (max_modules > 0),
  features         jsonb not null default '{}'::jsonb,
  is_active        boolean not null default true,
  sort_order       int not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create trigger subscription_plans_touch before update on public.subscription_plans
  for each row execute function public.touch_updated_at();

-- Tier shapes only. No prices are invented here.
insert into public.subscription_plans (code, name, description, max_students, max_lecturers, max_modules, features, sort_order) values
 ('starter', 'Starter', 'Small institutions. Core QR + GPS attendance.', 2000, 100, 150,
  '{"bulk_import": false, "advanced_analytics": false, "acoustic": false, "custom_policies": false, "exports_pdf": false}', 1),
 ('professional', 'Professional', 'Larger institutions. Bulk import, analytics, enhanced verification.', 20000, 1000, 2000,
  '{"bulk_import": true, "advanced_analytics": true, "acoustic": true, "custom_policies": false, "exports_pdf": true}', 2),
 ('enterprise', 'Enterprise', 'Large universities. Custom policies, integrations, dedicated support.', null, null, null,
  '{"bulk_import": true, "advanced_analytics": true, "acoustic": true, "custom_policies": true, "exports_pdf": true, "sso": true}', 3);

create table public.institution_subscriptions (
  id                   uuid primary key default gen_random_uuid(),
  institution_id       uuid not null references public.institutions(id) on delete cascade,
  plan_id              uuid not null references public.subscription_plans(id),
  status               text not null default 'trialing'
                         check (status in ('trialing','active','past_due','suspended','cancelled')),
  current_period_start timestamptz not null default now(),
  current_period_end   timestamptz not null default now() + interval '30 days',
  cancel_at            timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
-- one live subscription per institution
create unique index institution_subscriptions_live on public.institution_subscriptions(institution_id)
  where status in ('trialing','active','past_due','suspended');
create trigger institution_subscriptions_touch before update on public.institution_subscriptions
  for each row execute function public.touch_updated_at();

-- Written only by the payment webhook (service role) after signature verification.
create table public.payments (
  id              uuid primary key default gen_random_uuid(),
  institution_id  uuid not null references public.institutions(id) on delete cascade,
  subscription_id uuid references public.institution_subscriptions(id) on delete set null,
  provider        text not null check (provider in ('payfast','paystack','manual')),
  provider_ref    text not null,
  amount_cents    bigint not null check (amount_cents >= 0),
  currency        text not null default 'ZAR',
  status          text not null check (status in ('pending','succeeded','failed','refunded')),
  verified_at     timestamptz,
  created_at      timestamptz not null default now(),
  unique (provider, provider_ref)
);

create table public.usage_metrics (
  id             uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete cascade,
  metric         text not null,
  value          bigint not null,
  measured_on    date not null default current_date,
  unique (institution_id, metric, measured_on)
);

create table public.notifications (
  id             uuid primary key default gen_random_uuid(),
  institution_id uuid references public.institutions(id) on delete cascade,
  user_id        uuid not null references auth.users(id) on delete cascade,
  kind           text not null,
  title          text not null,
  body           text,
  link           text check (link is null or link ~ '^/'),   -- in-app paths only
  read_at        timestamptz,
  created_at     timestamptz not null default now()
);
create index notifications_user on public.notifications(user_id, created_at desc);

create table public.announcements (
  id             uuid primary key default gen_random_uuid(),
  institution_id uuid references public.institutions(id) on delete cascade,  -- null = platform-wide
  title          text not null,
  body           text not null,
  audience       text not null default 'all' check (audience in ('all','students','lecturers','admins')),
  published_at   timestamptz not null default now(),
  expires_at     timestamptz,
  created_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now()
);

create table public.audit_logs (
  id             bigint generated always as identity primary key,
  institution_id uuid references public.institutions(id) on delete set null,
  actor_id       uuid,
  action         text not null,
  entity         text not null,
  entity_id      text,
  details        jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);
create index audit_logs_inst on public.audit_logs(institution_id, created_at desc);
