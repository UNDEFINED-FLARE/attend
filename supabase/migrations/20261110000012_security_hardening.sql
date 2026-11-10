-- 0012 — security review fixes (2026-11-10), on top of the uniattend schema.
--
-- 2. (app code) open redirect after sign-in / email links: see src/lib/safe-redirect.ts
-- 3. grant_role only targets accounts with a confirmed email, matching
--    link_my_accounts, so a pre-registered (squatted) address cannot receive a role.
-- 4. apply_paystack_payment: claims the payment and extends the subscription in
--    one transaction, so concurrent webhook deliveries apply a payment once.
-- (Fix 1 from the review, explicit table grants, is already covered here by the
--  uniattend schema and its default privileges in 0001.)
-- --------------------------------------------- 3. confirmed accounts only

create or replace function uniattend.grant_role(p_inst uuid, p_email text, p_role text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare target uuid; confirmed timestamptz; rid uuid;
begin
  if p_role = 'super_admin' then
    if not uniattend.is_super_admin() then raise exception 'super admin only' using errcode = '42501'; end if;
    p_inst := null;
  else
    if p_role not in ('institution_admin','lecturer','student') then raise exception 'bad role'; end if;
    if not uniattend.is_inst_admin(p_inst) then raise exception 'institution admin only' using errcode = '42501'; end if;
  end if;
  select id, email_confirmed_at into target, confirmed from auth.users where lower(email) = lower(trim(p_email));
  if target is null then raise exception 'No account uses that email yet. Ask them to sign up first.'; end if;
  if confirmed is null then
    raise exception 'That account has not confirmed its email yet. Ask them to click the link in their confirmation email, then try again.';
  end if;
  insert into uniattend.user_roles (user_id, institution_id, role, granted_by)
  values (target, p_inst, p_role, auth.uid())
  on conflict (user_id, institution_id, role) do update set status = 'active'
  returning id into rid;
  return rid;
end $$;

-- ------------------------------------------------- 4. Paystack, exactly once

-- Called only by the paystack-webhook Edge Function (service_role) AFTER it has
-- verified the signature and re-verified the transaction with Paystack.
-- Returns 'applied' | 'duplicate' | 'mismatch'.
create or replace function uniattend.apply_paystack_payment(
  p_institution uuid, p_plan_code text, p_reference text, p_amount bigint, p_currency text)
returns text language plpgsql security invoker set search_path = '' as $$
declare
  v_plan uniattend.subscription_plans;
  v_payment uuid;
  v_sub uniattend.institution_subscriptions;
  v_until timestamptz;
begin
  select * into v_plan from uniattend.subscription_plans where code = p_plan_code;
  if v_plan.id is null or v_plan.price_cents is null
     or p_amount is distinct from v_plan.price_cents or p_currency is distinct from v_plan.currency then
    -- Keep a record for a human to look at, but grant nothing.
    insert into uniattend.payments (institution_id, provider, provider_ref, amount_cents, currency, status)
    values (p_institution, 'paystack', p_reference, greatest(coalesce(p_amount, 0), 0), coalesce(p_currency, 'ZAR'), 'failed')
    on conflict (provider, provider_ref) do nothing;
    return 'mismatch';
  end if;

  -- Claim the payment. The unique (provider, provider_ref) row lock means only one
  -- delivery can create it or move it from 'pending' to 'succeeded'; every other
  -- delivery gets no row back and stops here.
  insert into uniattend.payments as pay (institution_id, provider, provider_ref, amount_cents, currency, status, verified_at)
  values (p_institution, 'paystack', p_reference, p_amount, p_currency, 'succeeded', now())
  on conflict (provider, provider_ref) do update
    set status = 'succeeded', amount_cents = excluded.amount_cents,
        currency = excluded.currency, verified_at = excluded.verified_at
    where pay.status = 'pending' and pay.institution_id = excluded.institution_id
  returning pay.id into v_payment;
  if v_payment is null then return 'duplicate'; end if;

  select * into v_sub from uniattend.institution_subscriptions
  where institution_id = p_institution and status in ('trialing','active','past_due','suspended')
  order by current_period_end desc limit 1
  for update;

  -- Extend from the later of "now" and the current paid-up date.
  v_until := greatest(coalesce(v_sub.current_period_end, now()), now())
             + case v_plan.billing_interval when 'year' then interval '1 year' else interval '1 month' end;

  if v_sub.id is not null then
    update uniattend.institution_subscriptions
    set plan_id = v_plan.id, status = 'active', current_period_end = v_until
    where id = v_sub.id;
  else
    insert into uniattend.institution_subscriptions (institution_id, plan_id, status, current_period_end)
    values (p_institution, v_plan.id, 'active', v_until)
    returning * into v_sub;
  end if;
  update uniattend.payments set subscription_id = v_sub.id where id = v_payment;
  return 'applied';
end $$;

-- New functions are executable by PUBLIC by default; lock this one to the server.
revoke all on function uniattend.apply_paystack_payment(uuid, text, text, bigint, text) from public, anon, authenticated;
grant execute on function uniattend.apply_paystack_payment(uuid, text, text, bigint, text) to service_role;
