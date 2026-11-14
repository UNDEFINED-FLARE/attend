-- UniAttend 0022 — invoicing by hand, and warning before access runs out.
--
-- * record_manual_payment(): the platform administrator records an invoice paid
--   by EFT (amount, reference, months). It is kept in payments (provider
--   'manual'), the subscription becomes active and is extended from whichever is
--   later, today or its current end. Audited. Same reference twice is refused.
-- * subscription_notice(): what an institution's own admins see: plan, status,
--   end date, days left and whether attendance is running, so a trial or paid
--   period never ends without warning.

create or replace function uniattend.record_manual_payment(p_inst uuid, p_amount_cents bigint, p_reference text,
                                                          p_months int, p_plan_code text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare sub uniattend.institution_subscriptions; v_plan uuid; v_from timestamptz; v_end timestamptz; v_pay uuid;
begin
  if not uniattend.is_super_admin() then raise exception 'super admin only' using errcode = '42501'; end if;
  if p_amount_cents is null or p_amount_cents < 0 then raise exception 'Enter the amount paid.'; end if;
  if p_months is null or p_months not between 1 and 36 then raise exception 'Choose between 1 and 36 months.'; end if;
  if length(trim(coalesce(p_reference, ''))) < 3 then raise exception 'Enter the invoice or EFT reference.'; end if;
  if exists (select 1 from uniattend.payments where provider = 'manual' and provider_ref = trim(p_reference)) then
    raise exception 'A payment with that reference is already recorded.';
  end if;
  if p_plan_code is not null then
    select id into v_plan from uniattend.subscription_plans where code = p_plan_code;
    if v_plan is null then raise exception 'no such plan'; end if;
  end if;

  select * into sub from uniattend.institution_subscriptions
   where institution_id = p_inst and status in ('trialing','active','past_due','suspended') limit 1;
  v_from := greatest(now(), coalesce(case when sub.status = 'active' then sub.current_period_end end, now()));
  v_end := v_from + make_interval(months => p_months);

  if sub.id is null then
    if v_plan is null then select id into v_plan from uniattend.subscription_plans where code = 'starter'; end if;
    insert into uniattend.institution_subscriptions (institution_id, plan_id, status, current_period_end)
    values (p_inst, v_plan, 'active', v_end) returning * into sub;
  else
    update uniattend.institution_subscriptions
       set status = 'active', current_period_end = v_end, plan_id = coalesce(v_plan, plan_id)
     where id = sub.id returning * into sub;
  end if;

  insert into uniattend.payments (institution_id, subscription_id, provider, provider_ref, amount_cents, currency, status, verified_at)
  values (p_inst, sub.id, 'manual', trim(p_reference), p_amount_cents, 'ZAR', 'succeeded', now())
  returning id into v_pay;
  perform uniattend.write_audit(p_inst, 'manual_payment', 'payments', v_pay::text,
    jsonb_build_object('amount_cents', p_amount_cents, 'reference', trim(p_reference), 'months', p_months, 'until', v_end));
  insert into uniattend.notifications (institution_id, user_id, kind, title, body, link)
  select p_inst, r.user_id, 'institution_status', 'Payment received',
         'Thank you. UniAttend is active until ' || to_char(v_end at time zone 'Africa/Johannesburg', 'DD Mon YYYY') || '.', '/admin'
  from uniattend.user_roles r where r.institution_id = p_inst and r.role = 'institution_admin' and r.status = 'active';
  return jsonb_build_object('payment', v_pay, 'active_until', v_end);
end $$;

create or replace function uniattend.subscription_notice(p_inst uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when not (uniattend.is_inst_admin(p_inst) or uniattend.is_super_admin()) then null else
    (select jsonb_build_object(
       'plan', (lp.plan).name, 'status', lp.sub_status, 'ends_at', lp.period_end,
       'days_left', case when lp.period_end is null then null else floor(extract(epoch from lp.period_end - now()) / 86400)::int end,
       'operating', uniattend.institution_can_operate(p_inst))
     from uniattend.live_plan(p_inst) lp)
  end;
$$;

revoke all on function uniattend.record_manual_payment(uuid, bigint, text, int, text) from public, anon;
revoke all on function uniattend.subscription_notice(uuid) from public, anon;
grant execute on function uniattend.record_manual_payment(uuid, bigint, text, int, text) to authenticated;
grant execute on function uniattend.subscription_notice(uuid) to authenticated;
