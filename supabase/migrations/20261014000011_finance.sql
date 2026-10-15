-- =============================================================================
-- Adrenaline Rush: fees, installments, payments, refunds, receipts, expenses
-- and the optional Razorpay payment links (roadmap phase 6). Safe to re-run.
--
-- Money rules
--   * Every amount is numeric(12,2) with a char(3) currency. No floats anywhere.
--   * A fee plan belongs to exactly one enrollment. final_fee = base_fee - discount
--     is computed here, never trusted from a client.
--   * When a plan has installments, they must add up to final_fee exactly
--     (checked at COMMIT by a deferred constraint trigger, so a schedule can be
--     replaced inside one transaction / one save_fee_plan() call).
--   * Payments and refunds are never deleted: they are voided with a reason.
--     Only "completed" payments count as collected; pending/failed/voided never do.
--   * A refund can never exceed what is left of its payment (row lock + sum check).
--   * Installment status is derived on the fly: completed payments (net of their
--     refunds) are applied in payment-date order, first to the installment the
--     payment was recorded against (if any), then to the earliest unpaid ones.
--     Nothing is stored, so a payment can never be counted twice.
--   * Receipt numbers are sequential per organization and year: AR-2026-0001.
--   * Gateway (Razorpay) payments are written only by the server's webhook through
--     record_gateway_payment(), idempotently by the Razorpay payment id.
--
-- Visibility: finance.view reads, finance.manage writes. Staff and instructors
-- have neither by default, so they cannot read a single payment row.
-- =============================================================================

do $$ begin
  create type public.finance_payment_method as enum ('cash', 'upi', 'bank_transfer', 'card', 'cheque', 'razorpay', 'other');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.finance_payment_status as enum ('pending', 'completed', 'failed', 'voided');
exception when duplicate_object then null;
end $$;

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------

create table if not exists public.fee_plans (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  enrollment_id    uuid not null unique references public.enrollments (id) on delete restrict,
  -- Copied from the enrollment by a trigger (never from the client).
  candidate_id     uuid not null references public.candidates (id) on delete restrict,
  course_id        uuid not null references public.courses (id) on delete restrict,
  currency         char(3) not null default 'INR' check (currency ~ '^[A-Z]{3}$'),
  base_fee         numeric(12, 2) not null check (base_fee >= 0),
  discount_type    text not null default 'none' check (discount_type in ('none', 'amount', 'percent')),
  discount_value   numeric(12, 2) not null default 0 check (discount_value >= 0),
  discount_amount  numeric(12, 2) not null default 0,
  discount_reason  text check (discount_reason is null or char_length(discount_reason) <= 300),
  final_fee        numeric(12, 2) not null default 0,
  notes            text check (notes is null or char_length(notes) <= 2000),
  created_by       uuid references public.user_profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (discount_type <> 'percent' or discount_value <= 100),
  check (discount_amount >= 0 and discount_amount <= base_fee),
  check (final_fee = base_fee - discount_amount)
);
create index if not exists fee_plans_org_idx on public.fee_plans (organization_id, created_at desc);
create index if not exists fee_plans_candidate_idx on public.fee_plans (candidate_id);
create index if not exists fee_plans_course_idx on public.fee_plans (course_id);

create table if not exists public.fee_installments (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  fee_plan_id      uuid not null references public.fee_plans (id) on delete cascade,
  seq              smallint not null check (seq between 1 and 60),
  due_date         date not null,
  amount           numeric(12, 2) not null check (amount > 0),
  label            text check (label is null or char_length(label) <= 80),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (fee_plan_id, seq)
);
create index if not exists fee_installments_due_idx on public.fee_installments (organization_id, due_date);

create table if not exists public.payments (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations (id) on delete cascade,
  fee_plan_id       uuid not null references public.fee_plans (id) on delete restrict,
  -- Copied from the fee plan by a trigger.
  enrollment_id     uuid not null references public.enrollments (id) on delete restrict,
  candidate_id      uuid not null references public.candidates (id) on delete restrict,
  -- Optional: the installment the payer meant to pay (applied there first).
  installment_id    uuid references public.fee_installments (id) on delete set null,
  amount            numeric(12, 2) not null check (amount > 0),
  currency          char(3) not null check (currency ~ '^[A-Z]{3}$'),
  paid_on           date not null,
  method            public.finance_payment_method not null,
  reference         text check (reference is null or char_length(reference) <= 120),
  notes             text check (notes is null or char_length(notes) <= 2000),
  status            public.finance_payment_status not null default 'completed',
  receipt_number    text check (receipt_number is null or char_length(receipt_number) <= 40),
  gateway           text check (gateway is null or gateway = 'razorpay'),
  gateway_payment_id text check (gateway_payment_id is null or gateway_payment_id ~ '^[A-Za-z0-9_]{6,64}$'),
  gateway_link_id   text check (gateway_link_id is null or char_length(gateway_link_id) <= 64),
  void_reason       text check (void_reason is null or char_length(btrim(void_reason)) between 3 and 500),
  voided_at         timestamptz,
  voided_by         uuid references public.user_profiles (id) on delete set null,
  recorded_by       uuid references public.user_profiles (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (organization_id, receipt_number),
  check ((method = 'razorpay') = (gateway_payment_id is not null)),
  check ((gateway is null) = (gateway_payment_id is null)),
  check (status <> 'voided' or (void_reason is not null and voided_at is not null))
);
create index if not exists payments_org_paid_idx on public.payments (organization_id, paid_on desc);
create index if not exists payments_plan_idx on public.payments (fee_plan_id, paid_on);
create index if not exists payments_candidate_idx on public.payments (candidate_id);
-- Webhook idempotency: one row per Razorpay payment, however often it is delivered.
create unique index if not exists payments_gateway_payment_key on public.payments (gateway_payment_id) where gateway_payment_id is not null;

create table if not exists public.payment_refunds (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  payment_id       uuid not null references public.payments (id) on delete restrict,
  fee_plan_id      uuid not null references public.fee_plans (id) on delete restrict,
  amount           numeric(12, 2) not null check (amount > 0),
  refunded_on      date not null,
  method           public.finance_payment_method not null default 'bank_transfer',
  reference        text check (reference is null or char_length(reference) <= 120),
  reason           text not null check (char_length(btrim(reason)) between 3 and 500),
  status           text not null default 'completed' check (status in ('completed', 'voided')),
  void_reason      text check (void_reason is null or char_length(btrim(void_reason)) between 3 and 500),
  voided_at        timestamptz,
  voided_by        uuid references public.user_profiles (id) on delete set null,
  recorded_by      uuid references public.user_profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (status <> 'voided' or (void_reason is not null and voided_at is not null))
);
create index if not exists payment_refunds_payment_idx on public.payment_refunds (payment_id);
create index if not exists payment_refunds_org_idx on public.payment_refunds (organization_id, refunded_on desc);

-- Next receipt number per organization and year.
create table if not exists public.receipt_counters (
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  year             integer not null check (year between 2000 and 2999),
  last_number      integer not null default 0 check (last_number >= 0),
  primary key (organization_id, year)
);

create table if not exists public.expense_categories (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  name             text not null check (char_length(btrim(name)) between 1 and 60),
  position         integer not null default 0,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create unique index if not exists expense_categories_name_key on public.expense_categories (organization_id, lower(name));

create table if not exists public.expenses (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  category_id      uuid not null references public.expense_categories (id) on delete restrict,
  spent_on         date not null,
  amount           numeric(12, 2) not null check (amount > 0),
  currency         char(3) not null default 'INR' check (currency ~ '^[A-Z]{3}$'),
  description      text not null check (char_length(btrim(description)) between 1 and 200),
  vendor           text check (vendor is null or char_length(vendor) <= 120),
  method           public.finance_payment_method not null default 'bank_transfer',
  reference        text check (reference is null or char_length(reference) <= 120),
  notes            text check (notes is null or char_length(notes) <= 2000),
  receipt_url      text check (receipt_url is null or (receipt_url ~* '^https://' and char_length(receipt_url) <= 500)),
  course_id        uuid references public.courses (id) on delete set null,
  batch_id         uuid references public.batches (id) on delete set null,
  status           text not null default 'recorded' check (status in ('recorded', 'voided')),
  void_reason      text check (void_reason is null or char_length(btrim(void_reason)) between 3 and 500),
  voided_at        timestamptz,
  voided_by        uuid references public.user_profiles (id) on delete set null,
  created_by       uuid references public.user_profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (status <> 'voided' or (void_reason is not null and voided_at is not null))
);
create index if not exists expenses_org_spent_idx on public.expenses (organization_id, spent_on desc);
create index if not exists expenses_category_idx on public.expenses (category_id);
create index if not exists expenses_course_idx on public.expenses (course_id);
create index if not exists expenses_batch_idx on public.expenses (batch_id);

-- Razorpay payment links created from a fee plan (optional integration).
create table if not exists public.payment_links (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations (id) on delete cascade,
  fee_plan_id       uuid not null references public.fee_plans (id) on delete restrict,
  installment_id    uuid references public.fee_installments (id) on delete set null,
  amount            numeric(12, 2) not null check (amount >= 1),
  currency          char(3) not null check (currency ~ '^[A-Z]{3}$'),
  provider          text not null default 'razorpay' check (provider = 'razorpay'),
  provider_link_id  text unique check (provider_link_id is null or provider_link_id ~ '^[A-Za-z0-9_]{6,64}$'),
  short_url         text check (short_url is null or (short_url ~* '^https://' and char_length(short_url) <= 500)),
  status            text not null default 'creating' check (status in ('creating', 'created', 'paid', 'partially_paid', 'expired', 'cancelled', 'failed')),
  error             text check (error is null or char_length(error) <= 500),
  payment_id        uuid references public.payments (id) on delete set null,
  paid_at           timestamptz,
  created_by        uuid references public.user_profiles (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists payment_links_plan_idx on public.payment_links (fee_plan_id, created_at desc);

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------

-- Raised for rule violations whose message is written for people (shown as is).
-- SQLSTATE 'ARFIN'.

create or replace function public.org_today(org uuid)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select (now() at time zone coalesce((select o.timezone from public.organizations o where o.id = org), 'Asia/Kolkata'))::date;
$$;

-- Reserves the next receipt number for an organization and year.
create or replace function public.next_receipt_number(org uuid, yr integer)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  insert into public.receipt_counters as rc (organization_id, year, last_number)
  values (org, yr, 1)
  on conflict (organization_id, year) do update set last_number = rc.last_number + 1
  returning rc.last_number into n;
  return 'AR-' || yr::text || '-' || lpad(n::text, 4, '0');
end;
$$;

create or replace function public.seed_expense_categories(org uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.expense_categories (organization_id, name, position) values
    (org, 'Marketing & ads', 1),
    (org, 'Software & tools', 2),
    (org, 'Trainer payout', 3),
    (org, 'Venue', 4),
    (org, 'Equipment', 5),
    (org, 'Other', 6)
  on conflict do nothing;
$$;

create or replace function public.organizations_seed_finance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.seed_expense_categories(new.id);
  return new;
end;
$$;
drop trigger if exists organizations_seed_finance on public.organizations;
create trigger organizations_seed_finance after insert on public.organizations
  for each row execute function public.organizations_seed_finance();

-- Existing organizations get the default categories once (only when they have none).
select public.seed_expense_categories(o.id)
from public.organizations o
where not exists (select 1 from public.expense_categories c where c.organization_id = o.id);

-- -----------------------------------------------------------------------------
-- Triggers: fee plans and installments
-- -----------------------------------------------------------------------------

drop trigger if exists fee_plans_updated_at on public.fee_plans;
create trigger fee_plans_updated_at before update on public.fee_plans
  for each row execute function public.set_updated_at();
drop trigger if exists fee_installments_updated_at on public.fee_installments;
create trigger fee_installments_updated_at before update on public.fee_installments
  for each row execute function public.set_updated_at();

create or replace function public.fee_plans_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  enr record;
begin
  if tg_op = 'UPDATE' then
    if new.organization_id <> old.organization_id or new.enrollment_id <> old.enrollment_id then
      raise exception 'A fee plan cannot move to another enrollment' using errcode = 'ARFIN';
    end if;
    if new.currency <> old.currency and exists (select 1 from public.payments p where p.fee_plan_id = new.id) then
      raise exception 'The currency cannot change once payments are recorded' using errcode = 'ARFIN';
    end if;
  end if;
  select e.organization_id, e.candidate_id, e.course_id into enr from public.enrollments e where e.id = new.enrollment_id;
  if not found or enr.organization_id <> new.organization_id then
    raise exception 'Enrollment belongs to another organization' using errcode = '23503';
  end if;
  new.candidate_id := enr.candidate_id;
  new.course_id := enr.course_id;

  if new.discount_type = 'none' then
    new.discount_value := 0;
    new.discount_amount := 0;
  elsif new.discount_type = 'amount' then
    if new.discount_value > new.base_fee then
      raise exception 'The discount cannot be more than the fee' using errcode = 'ARFIN';
    end if;
    new.discount_amount := new.discount_value;
  else
    if new.discount_value > 100 then
      raise exception 'A percentage discount cannot be more than 100%%' using errcode = 'ARFIN';
    end if;
    -- Half-up rounding to the paisa, same as the app's percentOf().
    new.discount_amount := round(new.base_fee * new.discount_value / 100, 2);
  end if;
  new.final_fee := new.base_fee - new.discount_amount;
  new.discount_reason := nullif(btrim(coalesce(new.discount_reason, '')), '');
  if new.discount_amount > 0 and new.discount_reason is null then
    raise exception 'Give a reason for the discount' using errcode = 'ARFIN';
  end if;
  return new;
end;
$$;
drop trigger if exists fee_plans_before_write on public.fee_plans;
create trigger fee_plans_before_write before insert or update on public.fee_plans
  for each row execute function public.fee_plans_before_write();

create or replace function public.fee_installments_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and (new.fee_plan_id <> old.fee_plan_id or new.organization_id <> old.organization_id) then
    raise exception 'An installment cannot move to another fee plan' using errcode = 'ARFIN';
  end if;
  if not exists (select 1 from public.fee_plans f where f.id = new.fee_plan_id and f.organization_id = new.organization_id) then
    raise exception 'Fee plan belongs to another organization' using errcode = '23503';
  end if;
  new.label := nullif(btrim(coalesce(new.label, '')), '');
  return new;
end;
$$;
drop trigger if exists fee_installments_before_write on public.fee_installments;
create trigger fee_installments_before_write before insert or update on public.fee_installments
  for each row execute function public.fee_installments_before_write();

-- Installments (when there are any) must add up to the final fee. Deferred to
-- COMMIT so a whole schedule can be replaced in one transaction.
create or replace function public.check_fee_plan_installments()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  plan_id uuid;
  fee numeric;
  total numeric;
  cnt integer;
begin
  -- Same function for both tables: read the plan id without naming a field the other table lacks.
  plan_id := (to_jsonb(coalesce(new, old)) ->> case when tg_table_name = 'fee_plans' then 'id' else 'fee_plan_id' end)::uuid;
  select f.final_fee into fee from public.fee_plans f where f.id = plan_id;
  if not found then
    return null;
  end if;
  select count(*), coalesce(sum(i.amount), 0) into cnt, total from public.fee_installments i where i.fee_plan_id = plan_id;
  if cnt > 0 and total <> fee then
    raise exception 'Installments add up to % but the final fee is %. Make them equal.', total, fee using errcode = 'ARFIN';
  end if;
  return null;
end;
$$;
drop trigger if exists fee_installments_sum_check on public.fee_installments;
create constraint trigger fee_installments_sum_check after insert or update or delete on public.fee_installments
  deferrable initially deferred
  for each row execute function public.check_fee_plan_installments();
drop trigger if exists fee_plans_sum_check on public.fee_plans;
create constraint trigger fee_plans_sum_check after insert or update on public.fee_plans
  deferrable initially deferred
  for each row execute function public.check_fee_plan_installments();

-- -----------------------------------------------------------------------------
-- Triggers: payments and refunds
-- -----------------------------------------------------------------------------

drop trigger if exists payments_updated_at on public.payments;
create trigger payments_updated_at before update on public.payments
  for each row execute function public.set_updated_at();
drop trigger if exists payment_refunds_updated_at on public.payment_refunds;
create trigger payment_refunds_updated_at before update on public.payment_refunds
  for each row execute function public.set_updated_at();

create or replace function public.payments_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  plan record;
begin
  if tg_op = 'INSERT' then
    select f.organization_id, f.enrollment_id, f.candidate_id, f.currency into plan from public.fee_plans f where f.id = new.fee_plan_id;
    if not found or plan.organization_id <> new.organization_id then
      raise exception 'Fee plan belongs to another organization' using errcode = '23503';
    end if;
    new.enrollment_id := plan.enrollment_id;
    new.candidate_id := plan.candidate_id;
    new.currency := coalesce(new.currency, plan.currency);
    if new.currency <> plan.currency then
      raise exception 'Record the payment in the fee plan''s currency (%)', plan.currency using errcode = 'ARFIN';
    end if;
    if new.installment_id is not null
       and not exists (select 1 from public.fee_installments i where i.id = new.installment_id and i.fee_plan_id = new.fee_plan_id) then
      raise exception 'That installment belongs to another fee plan' using errcode = 'ARFIN';
    end if;
    if new.status = 'voided' then
      raise exception 'A new payment cannot start as voided' using errcode = 'ARFIN';
    end if;
    if new.status = 'completed' and new.paid_on > public.org_today(new.organization_id) + 1 then
      raise exception 'A received payment cannot be dated in the future' using errcode = 'ARFIN';
    end if;
    new.receipt_number := null;
    new.void_reason := null;
    new.voided_at := null;
    new.voided_by := null;
  else
    if new.organization_id <> old.organization_id or new.fee_plan_id <> old.fee_plan_id or new.amount <> old.amount
       or new.currency <> old.currency or new.paid_on <> old.paid_on or new.method <> old.method
       or new.gateway_payment_id is distinct from old.gateway_payment_id or new.receipt_number is distinct from old.receipt_number
       and old.receipt_number is not null then
      raise exception 'Payments cannot be edited. Void it with a reason and record it again.' using errcode = 'ARFIN';
    end if;
    new.enrollment_id := old.enrollment_id;
    new.candidate_id := old.candidate_id;
    if new.installment_id is distinct from old.installment_id and new.installment_id is not null
       and not exists (select 1 from public.fee_installments i where i.id = new.installment_id and i.fee_plan_id = new.fee_plan_id) then
      raise exception 'That installment belongs to another fee plan' using errcode = 'ARFIN';
    end if;
    if new.status <> old.status then
      if old.status = 'voided' then
        raise exception 'A voided payment cannot be changed' using errcode = 'ARFIN';
      end if;
      if old.status = 'completed' and new.status <> 'voided' then
        raise exception 'A received payment can only be voided' using errcode = 'ARFIN';
      end if;
      if old.status = 'failed' and new.status <> 'voided' then
        raise exception 'A failed payment can only be voided' using errcode = 'ARFIN';
      end if;
      if new.status = 'voided' then
        if exists (select 1 from public.payment_refunds r where r.payment_id = new.id and r.status = 'completed') then
          raise exception 'Void the refunds of this payment first' using errcode = 'ARFIN';
        end if;
        new.void_reason := nullif(btrim(coalesce(new.void_reason, '')), '');
        if new.void_reason is null then
          raise exception 'Give a reason for voiding the payment' using errcode = 'ARFIN';
        end if;
        new.voided_at := now();
        new.voided_by := auth.uid();
      end if;
    elsif old.status = 'voided' and (new.void_reason is distinct from old.void_reason or new.installment_id is distinct from old.installment_id) then
      raise exception 'A voided payment cannot be changed' using errcode = 'ARFIN';
    end if;
    if new.status <> 'voided' then
      new.void_reason := old.void_reason;
      new.voided_at := old.voided_at;
      new.voided_by := old.voided_by;
    end if;
  end if;
  -- Every received payment gets the next receipt number, once.
  if new.status = 'completed' and new.receipt_number is null then
    new.receipt_number := public.next_receipt_number(new.organization_id, extract(year from new.paid_on)::integer);
  end if;
  return new;
end;
$$;
drop trigger if exists payments_before_write on public.payments;
create trigger payments_before_write before insert or update on public.payments
  for each row execute function public.payments_before_write();

create or replace function public.payment_refunds_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  pay record;
  already numeric;
begin
  if tg_op = 'INSERT' then
    -- Lock the payment so two refunds recorded at the same moment cannot both pass.
    select p.organization_id, p.fee_plan_id, p.amount, p.status, p.paid_on, p.currency into pay
    from public.payments p where p.id = new.payment_id for update;
    if not found or pay.organization_id <> new.organization_id then
      raise exception 'Payment belongs to another organization' using errcode = '23503';
    end if;
    if pay.status <> 'completed' then
      raise exception 'Only received payments can be refunded' using errcode = 'ARFIN';
    end if;
    if new.refunded_on < pay.paid_on then
      raise exception 'A refund cannot be dated before its payment' using errcode = 'ARFIN';
    end if;
    if new.refunded_on > public.org_today(new.organization_id) + 1 then
      raise exception 'A refund cannot be dated in the future' using errcode = 'ARFIN';
    end if;
    select coalesce(sum(r.amount), 0) into already from public.payment_refunds r where r.payment_id = new.payment_id and r.status = 'completed';
    if already + new.amount > pay.amount then
      raise exception 'Refunds cannot exceed the payment: % % can still be refunded', pay.currency, (pay.amount - already) using errcode = 'ARFIN';
    end if;
    new.fee_plan_id := pay.fee_plan_id;
    new.status := 'completed';
    new.reason := btrim(new.reason);
    new.void_reason := null;
    new.voided_at := null;
    new.voided_by := null;
  else
    if new.payment_id <> old.payment_id or new.amount <> old.amount or new.refunded_on <> old.refunded_on
       or new.organization_id <> old.organization_id or new.fee_plan_id <> old.fee_plan_id then
      raise exception 'Refunds cannot be edited. Void it with a reason and record it again.' using errcode = 'ARFIN';
    end if;
    if old.status = 'voided' then
      raise exception 'A voided refund cannot be changed' using errcode = 'ARFIN';
    end if;
    if new.status = 'voided' then
      new.void_reason := nullif(btrim(coalesce(new.void_reason, '')), '');
      if new.void_reason is null then
        raise exception 'Give a reason for voiding the refund' using errcode = 'ARFIN';
      end if;
      new.voided_at := now();
      new.voided_by := auth.uid();
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists payment_refunds_before_write on public.payment_refunds;
create trigger payment_refunds_before_write before insert or update on public.payment_refunds
  for each row execute function public.payment_refunds_before_write();

-- -----------------------------------------------------------------------------
-- Triggers: expenses, categories, payment links
-- -----------------------------------------------------------------------------

drop trigger if exists expenses_updated_at on public.expenses;
create trigger expenses_updated_at before update on public.expenses
  for each row execute function public.set_updated_at();
drop trigger if exists expense_categories_updated_at on public.expense_categories;
create trigger expense_categories_updated_at before update on public.expense_categories
  for each row execute function public.set_updated_at();
drop trigger if exists payment_links_updated_at on public.payment_links;
create trigger payment_links_updated_at before update on public.payment_links
  for each row execute function public.set_updated_at();

create or replace function public.expenses_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  batch_course uuid;
begin
  if tg_op = 'UPDATE' then
    if new.organization_id <> old.organization_id then
      raise exception 'Expenses cannot move between organizations' using errcode = '42501';
    end if;
    if old.status = 'voided' then
      raise exception 'A voided expense cannot be changed' using errcode = 'ARFIN';
    end if;
  end if;
  if not exists (select 1 from public.expense_categories c where c.id = new.category_id and c.organization_id = new.organization_id) then
    raise exception 'Expense category belongs to another organization' using errcode = '23503';
  end if;
  if new.course_id is not null and not exists (select 1 from public.courses c where c.id = new.course_id and c.organization_id = new.organization_id) then
    raise exception 'Course belongs to another organization' using errcode = '23503';
  end if;
  if new.batch_id is not null then
    select b.course_id into batch_course from public.batches b where b.id = new.batch_id and b.organization_id = new.organization_id;
    if not found then
      raise exception 'Batch belongs to another organization' using errcode = '23503';
    end if;
    if new.course_id is null then
      new.course_id := batch_course;
    elsif new.course_id <> batch_course then
      raise exception 'The batch belongs to a different course' using errcode = 'ARFIN';
    end if;
  end if;
  if new.method = 'razorpay' then
    raise exception 'Choose how the expense was paid (cash, UPI, bank transfer, card, cheque or other)' using errcode = 'ARFIN';
  end if;
  if tg_op = 'INSERT' then
    if new.status = 'voided' then
      raise exception 'A new expense cannot start as voided' using errcode = 'ARFIN';
    end if;
    new.void_reason := null;
    new.voided_at := null;
    new.voided_by := null;
  elsif new.status = 'voided' then
    new.void_reason := nullif(btrim(coalesce(new.void_reason, '')), '');
    if new.void_reason is null then
      raise exception 'Give a reason for voiding the expense' using errcode = 'ARFIN';
    end if;
    new.voided_at := now();
    new.voided_by := auth.uid();
  end if;
  return new;
end;
$$;
drop trigger if exists expenses_before_write on public.expenses;
create trigger expenses_before_write before insert or update on public.expenses
  for each row execute function public.expenses_before_write();

create or replace function public.payment_links_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.fee_plans f where f.id = new.fee_plan_id and f.organization_id = new.organization_id and f.currency = new.currency) then
    raise exception 'Fee plan belongs to another organization or uses another currency' using errcode = '23503';
  end if;
  if new.installment_id is not null
     and not exists (select 1 from public.fee_installments i where i.id = new.installment_id and i.fee_plan_id = new.fee_plan_id) then
    raise exception 'That installment belongs to another fee plan' using errcode = 'ARFIN';
  end if;
  -- Only the verified webhook (no signed-in user) may mark a link as paid.
  if auth.uid() is not null and new.status in ('paid', 'partially_paid')
     and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    raise exception 'Only Razorpay can mark a payment link as paid' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and (new.amount <> old.amount or new.fee_plan_id <> old.fee_plan_id or new.organization_id <> old.organization_id) then
    raise exception 'A payment link cannot be edited' using errcode = 'ARFIN';
  end if;
  return new;
end;
$$;
drop trigger if exists payment_links_before_write on public.payment_links;
create trigger payment_links_before_write before insert or update on public.payment_links
  for each row execute function public.payment_links_before_write();

-- -----------------------------------------------------------------------------
-- Audit: every money change is written to audit_logs by the database
-- -----------------------------------------------------------------------------

create or replace function public.finance_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  entity text := tg_argv[0];
  rec jsonb := to_jsonb(coalesce(new, old));
  changed jsonb := '{}'::jsonb;
  act text;
begin
  if tg_op = 'UPDATE' then
    select coalesce(jsonb_object_agg(n.key, n.value), '{}'::jsonb) into changed
    from jsonb_each(to_jsonb(new)) n
    join jsonb_each(to_jsonb(old)) o using (key)
    where n.value is distinct from o.value and n.key not in ('updated_at');
    if changed = '{}'::jsonb then
      return new;
    end if;
    act := case when changed ? 'status' and changed ->> 'status' = 'voided' then entity || '.voided' else entity || '.updated' end;
  else
    act := entity || case when tg_op = 'INSERT' then '.created' else '.deleted' end;
  end if;
  insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, details)
  values (
    (rec ->> 'organization_id')::uuid,
    auth.uid(),
    act,
    entity,
    (rec ->> 'id')::uuid,
    case
      when tg_op = 'UPDATE' then jsonb_build_object('changed', changed)
      else jsonb_strip_nulls(jsonb_build_object(
        'amount', rec -> 'amount', 'currency', rec -> 'currency', 'final_fee', rec -> 'final_fee',
        'base_fee', rec -> 'base_fee', 'discount_amount', rec -> 'discount_amount', 'status', rec -> 'status',
        'fee_plan_id', rec -> 'fee_plan_id', 'payment_id', rec -> 'payment_id', 'enrollment_id', rec -> 'enrollment_id',
        'receipt_number', rec -> 'receipt_number', 'method', rec -> 'method', 'due_date', rec -> 'due_date',
        'seq', rec -> 'seq', 'name', rec -> 'name', 'description', rec -> 'description', 'reason', rec -> 'reason'))
    end
  );
  return coalesce(new, old);
end;
$$;

drop trigger if exists fee_plans_audit on public.fee_plans;
create trigger fee_plans_audit after insert or update or delete on public.fee_plans
  for each row execute function public.finance_audit('fee_plan');
drop trigger if exists fee_installments_audit on public.fee_installments;
create trigger fee_installments_audit after insert or update or delete on public.fee_installments
  for each row execute function public.finance_audit('fee_installment');
drop trigger if exists payments_audit on public.payments;
create trigger payments_audit after insert or update or delete on public.payments
  for each row execute function public.finance_audit('payment');
drop trigger if exists payment_refunds_audit on public.payment_refunds;
create trigger payment_refunds_audit after insert or update or delete on public.payment_refunds
  for each row execute function public.finance_audit('payment_refund');
drop trigger if exists expenses_audit on public.expenses;
create trigger expenses_audit after insert or update or delete on public.expenses
  for each row execute function public.finance_audit('expense');
drop trigger if exists expense_categories_audit on public.expense_categories;
-- Not on insert: default categories are seeded when an organization is created.
create trigger expense_categories_audit after update or delete on public.expense_categories
  for each row execute function public.finance_audit('expense_category');
drop trigger if exists payment_links_audit on public.payment_links;
create trigger payment_links_audit after insert or update or delete on public.payment_links
  for each row execute function public.finance_audit('payment_link');

-- -----------------------------------------------------------------------------
-- Calculations (SECURITY INVOKER: Row Level Security applies to the caller)
-- -----------------------------------------------------------------------------

-- Per fee plan: collected, refunded, net, outstanding and credit.
create or replace view public.fee_plan_balances
with (security_invoker = true)
as
select
  f.id as fee_plan_id,
  f.organization_id,
  f.enrollment_id,
  f.candidate_id,
  f.course_id,
  f.currency,
  f.final_fee,
  coalesce(p.gross, 0)::numeric(12, 2) as gross_paid,
  coalesce(r.refunded, 0)::numeric(12, 2) as refunded,
  (coalesce(p.gross, 0) - coalesce(r.refunded, 0))::numeric(12, 2) as net_paid,
  greatest(f.final_fee - (coalesce(p.gross, 0) - coalesce(r.refunded, 0)), 0)::numeric(12, 2) as outstanding,
  greatest((coalesce(p.gross, 0) - coalesce(r.refunded, 0)) - f.final_fee, 0)::numeric(12, 2) as credit
from public.fee_plans f
left join lateral (
  select sum(x.amount) as gross from public.payments x where x.fee_plan_id = f.id and x.status = 'completed'
) p on true
left join lateral (
  select sum(y.amount) as refunded from public.payment_refunds y where y.fee_plan_id = f.id and y.status = 'completed'
) r on true;

-- How much of each installment is paid (see the header for the rules).
create or replace function public.fee_plan_allocation(p_plan uuid)
returns table (installment_id uuid, paid numeric)
language plpgsql
stable
set search_path = ''
as $$
declare
  ids uuid[];
  amts numeric[];
  rem numeric[];
  n integer;
  i integer;
  idx integer;
  net numeric;
  take numeric;
  pay record;
begin
  select array_agg(x.id order by x.seq), array_agg(x.amount order by x.seq) into ids, amts
  from public.fee_installments x where x.fee_plan_id = p_plan;
  n := coalesce(array_length(ids, 1), 0);
  if n = 0 then
    return;
  end if;
  rem := amts;
  for pay in
    select p.installment_id as target,
           p.amount - coalesce((select sum(r.amount) from public.payment_refunds r where r.payment_id = p.id and r.status = 'completed'), 0) as net
    from public.payments p
    where p.fee_plan_id = p_plan and p.status = 'completed'
    order by p.paid_on, p.created_at, p.id
  loop
    net := pay.net;
    continue when net <= 0;
    if pay.target is not null then
      idx := array_position(ids, pay.target);
      if idx is not null then
        take := least(net, rem[idx]);
        rem[idx] := rem[idx] - take;
        net := net - take;
      end if;
    end if;
    i := 1;
    while net > 0 and i <= n loop
      take := least(net, rem[i]);
      rem[i] := rem[i] - take;
      net := net - take;
      i := i + 1;
    end loop;
  end loop;
  for i in 1 .. n loop
    installment_id := ids[i];
    paid := amts[i] - rem[i];
    return next;
  end loop;
end;
$$;

-- Installments with paid amount and status: paid / partially_paid / due / overdue.
create or replace function public.fee_plan_schedule(p_plan uuid, p_today date default null)
returns table (
  installment_id uuid,
  seq smallint,
  label text,
  due_date date,
  amount numeric,
  paid numeric,
  remaining numeric,
  status text
)
language sql
stable
set search_path = ''
as $$
  with today as (
    select coalesce(p_today, public.org_today(f.organization_id)) as d from public.fee_plans f where f.id = p_plan
  )
  select i.id, i.seq, i.label, i.due_date, i.amount, a.paid, i.amount - a.paid,
         case
           when a.paid >= i.amount then 'paid'
           when i.due_date < (select d from today) then 'overdue'
           when a.paid > 0 then 'partially_paid'
           else 'due'
         end
  from public.fee_installments i
  join public.fee_plan_allocation(p_plan) a on a.installment_id = i.id
  order by i.seq;
$$;

-- Enrollments whose fees still count (cancelled and dropped ones are no longer payable).
create or replace function public.enrollment_fee_qualifies(s public.enrollment_status)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select s in ('pending', 'active', 'on_hold', 'completed');
$$;

-- Unpaid installments past their due date, for the overview and reminders.
create or replace function public.finance_overdue_installments(p_org uuid, p_course uuid default null, p_batch uuid default null, p_today date default null)
returns table (
  fee_plan_id uuid,
  enrollment_id uuid,
  candidate_id uuid,
  course_id uuid,
  batch_id uuid,
  currency text,
  installment_id uuid,
  seq smallint,
  label text,
  due_date date,
  amount numeric,
  remaining numeric,
  days_overdue integer
)
language plpgsql
stable
set search_path = ''
as $$
declare
  plan record;
  s record;
  today date := coalesce(p_today, public.org_today(p_org));
begin
  if not public.has_permission(p_org, 'finance.view') then
    raise exception 'You do not have permission to view finance' using errcode = '42501';
  end if;
  for plan in
    select f.id, f.enrollment_id, f.candidate_id, f.course_id, e.batch_id, f.currency
    from public.fee_plans f
    join public.enrollments e on e.id = f.enrollment_id
    where f.organization_id = p_org
      and public.enrollment_fee_qualifies(e.status)
      and (p_course is null or f.course_id = p_course)
      and (p_batch is null or e.batch_id = p_batch)
      and exists (select 1 from public.fee_installments i where i.fee_plan_id = f.id and i.due_date < today)
  loop
    for s in select * from public.fee_plan_schedule(plan.id, today) x where x.status = 'overdue' loop
      fee_plan_id := plan.id;
      enrollment_id := plan.enrollment_id;
      candidate_id := plan.candidate_id;
      course_id := plan.course_id;
      batch_id := plan.batch_id;
      currency := plan.currency;
      installment_id := s.installment_id;
      seq := s.seq;
      label := s.label;
      due_date := s.due_date;
      amount := s.amount;
      remaining := s.remaining;
      days_overdue := today - s.due_date;
      return next;
    end loop;
  end loop;
end;
$$;

-- Totals for the overview. Period filters use the payment / refund / expense
-- dates (calendar dates in the business time zone). Only rows in the business
-- currency are added up; others are counted in other_currency_rows.
create or replace function public.finance_summary(
  p_org uuid,
  p_from date default null,
  p_to date default null,
  p_course uuid default null,
  p_batch uuid default null
)
returns table (
  currency text,
  booked numeric,
  gross numeric,
  refunds numeric,
  net numeric,
  expenses numeric,
  cash_result numeric,
  outstanding numeric,
  overdue numeric,
  overdue_count integer,
  payment_count integer,
  expense_count integer,
  other_currency_rows integer
)
language plpgsql
stable
set search_path = ''
as $$
declare
  cur text;
begin
  if not public.has_permission(p_org, 'finance.view') then
    raise exception 'You do not have permission to view finance' using errcode = '42501';
  end if;
  select o.default_currency into cur from public.organizations o where o.id = p_org;
  currency := cur;

  select coalesce(sum(f.final_fee), 0) into booked
  from public.fee_plans f join public.enrollments e on e.id = f.enrollment_id
  where f.organization_id = p_org and f.currency = cur and public.enrollment_fee_qualifies(e.status)
    and (p_course is null or f.course_id = p_course) and (p_batch is null or e.batch_id = p_batch)
    and (p_from is null or e.enrolled_at::date >= p_from) and (p_to is null or e.enrolled_at::date <= p_to);

  select coalesce(sum(p.amount), 0), count(*) into gross, payment_count
  from public.payments p join public.fee_plans f on f.id = p.fee_plan_id join public.enrollments e on e.id = p.enrollment_id
  where p.organization_id = p_org and p.status = 'completed' and p.currency = cur
    and (p_from is null or p.paid_on >= p_from) and (p_to is null or p.paid_on <= p_to)
    and (p_course is null or f.course_id = p_course) and (p_batch is null or e.batch_id = p_batch);

  select coalesce(sum(r.amount), 0) into refunds
  from public.payment_refunds r join public.fee_plans f on f.id = r.fee_plan_id join public.enrollments e on e.id = f.enrollment_id
  where r.organization_id = p_org and r.status = 'completed' and f.currency = cur
    and (p_from is null or r.refunded_on >= p_from) and (p_to is null or r.refunded_on <= p_to)
    and (p_course is null or f.course_id = p_course) and (p_batch is null or e.batch_id = p_batch);

  select coalesce(sum(x.amount), 0), count(*) into expenses, expense_count
  from public.expenses x
  where x.organization_id = p_org and x.status = 'recorded' and x.currency = cur
    and (p_from is null or x.spent_on >= p_from) and (p_to is null or x.spent_on <= p_to)
    and (p_course is null or x.course_id = p_course) and (p_batch is null or x.batch_id = p_batch);

  net := gross - refunds;
  cash_result := net - expenses;

  select coalesce(sum(b.outstanding), 0) into outstanding
  from public.fee_plan_balances b join public.enrollments e on e.id = b.enrollment_id
  where b.organization_id = p_org and b.currency = cur and public.enrollment_fee_qualifies(e.status)
    and (p_course is null or b.course_id = p_course) and (p_batch is null or e.batch_id = p_batch);

  select coalesce(sum(o.remaining), 0), count(*) into overdue, overdue_count
  from public.finance_overdue_installments(p_org, p_course, p_batch) o
  where o.currency = cur;

  select
    (select count(*) from public.payments p where p.organization_id = p_org and p.status = 'completed' and p.currency <> cur
       and (p_from is null or p.paid_on >= p_from) and (p_to is null or p.paid_on <= p_to))
    + (select count(*) from public.expenses x where x.organization_id = p_org and x.status = 'recorded' and x.currency <> cur
       and (p_from is null or x.spent_on >= p_from) and (p_to is null or x.spent_on <= p_to))
  into other_currency_rows;
  return next;
end;
$$;

-- Creates or updates the fee plan of an enrollment and replaces its schedule
-- in one transaction. Installments keep their ids by position (seq) so payments
-- recorded against "installment 2" stay attached to it.
create or replace function public.save_fee_plan(
  p_enrollment uuid,
  p_currency text,
  p_base_fee numeric,
  p_discount_type text,
  p_discount_value numeric,
  p_discount_reason text,
  p_notes text,
  p_installments jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  org uuid;
  plan_id uuid;
  item jsonb;
  n integer := 0;
begin
  select e.organization_id into org from public.enrollments e where e.id = p_enrollment;
  if org is null then
    raise exception 'Enrollment not found' using errcode = 'P0002';
  end if;
  if not public.has_permission(org, 'finance.manage') then
    raise exception 'You do not have permission to manage fees' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_installments, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_installments, '[]'::jsonb)) > 60 then
    raise exception 'Use at most 60 installments' using errcode = 'ARFIN';
  end if;

  insert into public.fee_plans as fp (organization_id, enrollment_id, candidate_id, course_id, currency, base_fee,
                                      discount_type, discount_value, discount_reason, notes, created_by)
  select org, p_enrollment, e.candidate_id, e.course_id, upper(p_currency), p_base_fee, p_discount_type, coalesce(p_discount_value, 0),
         p_discount_reason, nullif(btrim(coalesce(p_notes, '')), ''), auth.uid()
  from public.enrollments e where e.id = p_enrollment
  on conflict (enrollment_id) do update set
    currency = excluded.currency,
    base_fee = excluded.base_fee,
    discount_type = excluded.discount_type,
    discount_value = excluded.discount_value,
    discount_reason = excluded.discount_reason,
    notes = excluded.notes
  returning fp.id into plan_id;

  for item in select * from jsonb_array_elements(coalesce(p_installments, '[]'::jsonb)) loop
    n := n + 1;
    insert into public.fee_installments as fi (organization_id, fee_plan_id, seq, due_date, amount, label)
    values (org, plan_id, n, (item ->> 'due_date')::date, (item ->> 'amount')::numeric, item ->> 'label')
    on conflict (fee_plan_id, seq) do update set due_date = excluded.due_date, amount = excluded.amount, label = excluded.label
      where (fi.due_date, fi.amount, fi.label) is distinct from (excluded.due_date, excluded.amount, excluded.label);
  end loop;
  delete from public.fee_installments i where i.fee_plan_id = plan_id and i.seq > n;
  -- Run the deferred "installments add up" check now, so the caller gets a clear error.
  set constraints all immediate;
  return plan_id;
end;
$$;

-- Records a fee reminder on the candidate's timeline (no amounts: people who
-- can see the timeline but not finance learn nothing about money).
create or replace function public.log_fee_reminder(p_plan uuid, p_channel text, p_status text, p_installment uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  plan record;
begin
  select f.organization_id, f.candidate_id into plan from public.fee_plans f where f.id = p_plan;
  if not found or not public.has_permission(plan.organization_id, 'finance.manage') then
    raise exception 'You do not have permission to send fee reminders' using errcode = '42501';
  end if;
  if p_channel not in ('whatsapp', 'email') or p_status not in ('opened', 'sent', 'failed', 'not_sent') then
    raise exception 'Unknown reminder channel or status' using errcode = '22023';
  end if;
  insert into public.candidate_activities (organization_id, candidate_id, type, summary, details, actor_id)
  values (plan.organization_id, plan.candidate_id, 'fee_reminder',
          case
            when p_channel = 'whatsapp' then 'Fee reminder opened in WhatsApp'
            when p_status = 'sent' then 'Fee reminder emailed'
            when p_status = 'failed' then 'Fee reminder email failed'
            else 'Fee reminder email not sent (no email provider)'
          end,
          jsonb_build_object('channel', p_channel, 'status', p_status, 'fee_plan_id', p_plan, 'installment_id', p_installment),
          auth.uid());
  insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, details)
  values (plan.organization_id, auth.uid(), 'fee_plan.reminder', 'fee_plan', p_plan,
          jsonb_build_object('channel', p_channel, 'status', p_status, 'installment_id', p_installment));
end;
$$;

-- Called only by the server's verified Razorpay webhook (service role).
-- Idempotent by Razorpay payment id; amounts come from Razorpay's signed
-- payload, never from a browser.
create or replace function public.record_gateway_payment(
  p_provider_link_id text,
  p_gateway_payment_id text,
  p_amount_paise bigint,
  p_currency text,
  p_paid_at timestamptz,
  p_link_status text default 'paid'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  link record;
  pay_id uuid;
  existing uuid;
  tz text;
begin
  if p_amount_paise is null or p_amount_paise <= 0 then
    return jsonb_build_object('result', 'invalid_amount');
  end if;
  select l.* into link from public.payment_links l where l.provider_link_id = p_provider_link_id for update;
  if not found then
    return jsonb_build_object('result', 'unknown_link');
  end if;
  select p.id into existing from public.payments p where p.gateway_payment_id = p_gateway_payment_id;
  if existing is not null then
    return jsonb_build_object('result', 'duplicate', 'payment_id', existing);
  end if;
  if upper(p_currency) <> link.currency then
    update public.payment_links set error = 'Paid in another currency: ' || upper(p_currency) where id = link.id;
    return jsonb_build_object('result', 'currency_mismatch');
  end if;
  select o.timezone into tz from public.organizations o where o.id = link.organization_id;

  insert into public.payments (organization_id, fee_plan_id, installment_id, amount, currency, paid_on, method, reference,
                               notes, status, gateway, gateway_payment_id, gateway_link_id)
  values (link.organization_id, link.fee_plan_id, link.installment_id, (p_amount_paise::numeric / 100)::numeric(12, 2), link.currency,
          (coalesce(p_paid_at, now()) at time zone coalesce(tz, 'Asia/Kolkata'))::date, 'razorpay', p_gateway_payment_id,
          'Paid online through a Razorpay payment link', 'completed', 'razorpay', p_gateway_payment_id, p_provider_link_id)
  on conflict (gateway_payment_id) where gateway_payment_id is not null do nothing
  returning id into pay_id;
  if pay_id is null then
    select p.id into existing from public.payments p where p.gateway_payment_id = p_gateway_payment_id;
    return jsonb_build_object('result', 'duplicate', 'payment_id', existing);
  end if;

  update public.payment_links
  set status = case when p_link_status in ('paid', 'partially_paid') then p_link_status else 'paid' end,
      payment_id = pay_id, paid_at = coalesce(p_paid_at, now()), error = null
  where id = link.id;
  return jsonb_build_object('result', 'recorded', 'payment_id', pay_id);
end;
$$;

-- -----------------------------------------------------------------------------
-- Email log: allow fee reminder emails
-- -----------------------------------------------------------------------------

alter table public.email_log drop constraint if exists email_log_kind_check;
alter table public.email_log add constraint email_log_kind_check check (kind in ('automation', 'test', 'share', 'fee_reminder'));

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------

alter table public.fee_plans           enable row level security;
alter table public.fee_installments    enable row level security;
alter table public.payments            enable row level security;
alter table public.payment_refunds     enable row level security;
alter table public.receipt_counters    enable row level security;
alter table public.expense_categories  enable row level security;
alter table public.expenses            enable row level security;
alter table public.payment_links       enable row level security;

drop policy if exists "finance viewers read fee plans" on public.fee_plans;
create policy "finance viewers read fee plans" on public.fee_plans for select to authenticated
  using (public.has_permission(organization_id, 'finance.view'));
drop policy if exists "finance managers add fee plans" on public.fee_plans;
create policy "finance managers add fee plans" on public.fee_plans for insert to authenticated
  with check (public.has_permission(organization_id, 'finance.manage') and created_by = (select auth.uid()));
drop policy if exists "finance managers update fee plans" on public.fee_plans;
create policy "finance managers update fee plans" on public.fee_plans for update to authenticated
  using (public.has_permission(organization_id, 'finance.manage'))
  with check (public.has_permission(organization_id, 'finance.manage'));
drop policy if exists "finance managers delete fee plans" on public.fee_plans;
create policy "finance managers delete fee plans" on public.fee_plans for delete to authenticated
  using (public.has_permission(organization_id, 'finance.manage'));

drop policy if exists "finance viewers read installments" on public.fee_installments;
create policy "finance viewers read installments" on public.fee_installments for select to authenticated
  using (public.has_permission(organization_id, 'finance.view'));
drop policy if exists "finance managers write installments" on public.fee_installments;
create policy "finance managers write installments" on public.fee_installments for all to authenticated
  using (public.has_permission(organization_id, 'finance.manage'))
  with check (public.has_permission(organization_id, 'finance.manage'));

drop policy if exists "finance viewers read payments" on public.payments;
create policy "finance viewers read payments" on public.payments for select to authenticated
  using (public.has_permission(organization_id, 'finance.view'));
drop policy if exists "finance managers record payments" on public.payments;
create policy "finance managers record payments" on public.payments for insert to authenticated
  with check (public.has_permission(organization_id, 'finance.manage') and recorded_by = (select auth.uid()));
drop policy if exists "finance managers update payments" on public.payments;
create policy "finance managers update payments" on public.payments for update to authenticated
  using (public.has_permission(organization_id, 'finance.manage'))
  with check (public.has_permission(organization_id, 'finance.manage'));

drop policy if exists "finance viewers read refunds" on public.payment_refunds;
create policy "finance viewers read refunds" on public.payment_refunds for select to authenticated
  using (public.has_permission(organization_id, 'finance.view'));
drop policy if exists "finance managers record refunds" on public.payment_refunds;
create policy "finance managers record refunds" on public.payment_refunds for insert to authenticated
  with check (public.has_permission(organization_id, 'finance.manage') and recorded_by = (select auth.uid()));
drop policy if exists "finance managers update refunds" on public.payment_refunds;
create policy "finance managers update refunds" on public.payment_refunds for update to authenticated
  using (public.has_permission(organization_id, 'finance.manage'))
  with check (public.has_permission(organization_id, 'finance.manage'));

drop policy if exists "finance viewers read expense categories" on public.expense_categories;
create policy "finance viewers read expense categories" on public.expense_categories for select to authenticated
  using (public.has_permission(organization_id, 'finance.view'));
drop policy if exists "finance managers write expense categories" on public.expense_categories;
create policy "finance managers write expense categories" on public.expense_categories for all to authenticated
  using (public.has_permission(organization_id, 'finance.manage'))
  with check (public.has_permission(organization_id, 'finance.manage'));

drop policy if exists "finance viewers read expenses" on public.expenses;
create policy "finance viewers read expenses" on public.expenses for select to authenticated
  using (public.has_permission(organization_id, 'finance.view'));
drop policy if exists "finance managers record expenses" on public.expenses;
create policy "finance managers record expenses" on public.expenses for insert to authenticated
  with check (public.has_permission(organization_id, 'finance.manage') and created_by = (select auth.uid()));
drop policy if exists "finance managers update expenses" on public.expenses;
create policy "finance managers update expenses" on public.expenses for update to authenticated
  using (public.has_permission(organization_id, 'finance.manage'))
  with check (public.has_permission(organization_id, 'finance.manage'));

drop policy if exists "finance viewers read payment links" on public.payment_links;
create policy "finance viewers read payment links" on public.payment_links for select to authenticated
  using (public.has_permission(organization_id, 'finance.view'));
drop policy if exists "finance managers create payment links" on public.payment_links;
create policy "finance managers create payment links" on public.payment_links for insert to authenticated
  with check (public.has_permission(organization_id, 'finance.manage') and created_by = (select auth.uid()));
drop policy if exists "finance managers update payment links" on public.payment_links;
create policy "finance managers update payment links" on public.payment_links for update to authenticated
  using (public.has_permission(organization_id, 'finance.manage'))
  with check (public.has_permission(organization_id, 'finance.manage'));

-- receipt_counters: no policies; only the definer trigger writes it.

-- -----------------------------------------------------------------------------
-- Table grants (Supabase's defaults grant everything to anon/authenticated)
-- -----------------------------------------------------------------------------

revoke all on public.fee_plans, public.fee_installments, public.payments, public.payment_refunds, public.receipt_counters,
  public.expense_categories, public.expenses, public.payment_links, public.fee_plan_balances
  from anon, authenticated;

grant select, delete on public.fee_plans to authenticated;
grant insert (organization_id, enrollment_id, candidate_id, course_id, currency, base_fee, discount_type, discount_value,
              discount_reason, notes, created_by)
  on public.fee_plans to authenticated;
grant update (currency, base_fee, discount_type, discount_value, discount_reason, notes) on public.fee_plans to authenticated;

grant select, delete on public.fee_installments to authenticated;
grant insert (organization_id, fee_plan_id, seq, due_date, amount, label) on public.fee_installments to authenticated;
grant update (due_date, amount, label) on public.fee_installments to authenticated;

-- No DELETE: payments and refunds are voided, never removed.
grant select on public.payments to authenticated;
-- enrollment_id / candidate_id are always overwritten from the fee plan by the trigger.
grant insert (organization_id, fee_plan_id, enrollment_id, candidate_id, installment_id, amount, currency, paid_on, method, reference, notes, status, recorded_by)
  on public.payments to authenticated;
grant update (status, void_reason, notes, reference, installment_id) on public.payments to authenticated;

grant select on public.payment_refunds to authenticated;
grant insert (organization_id, payment_id, fee_plan_id, amount, refunded_on, method, reference, reason, recorded_by)
  on public.payment_refunds to authenticated;
grant update (status, void_reason) on public.payment_refunds to authenticated;

grant select, insert, update, delete on public.expense_categories to authenticated;

grant select on public.expenses to authenticated;
grant insert (organization_id, category_id, spent_on, amount, currency, description, vendor, method, reference, notes,
              receipt_url, course_id, batch_id, created_by)
  on public.expenses to authenticated;
grant update (category_id, spent_on, amount, currency, description, vendor, method, reference, notes, receipt_url,
              course_id, batch_id, status, void_reason)
  on public.expenses to authenticated;

grant select on public.payment_links to authenticated;
grant insert (organization_id, fee_plan_id, installment_id, amount, currency, status, created_by) on public.payment_links to authenticated;
grant update (status, provider_link_id, short_url, error) on public.payment_links to authenticated;

grant select on public.fee_plan_balances to authenticated;

grant all on public.fee_plans, public.fee_installments, public.payments, public.payment_refunds, public.receipt_counters,
  public.expense_categories, public.expenses, public.payment_links to service_role;
grant select on public.fee_plan_balances to service_role;

-- -----------------------------------------------------------------------------
-- Function grants: only this migration's functions (others keep theirs)
-- -----------------------------------------------------------------------------

revoke execute on function public.org_today(uuid) from public, anon, authenticated;
revoke execute on function public.next_receipt_number(uuid, integer) from public, anon, authenticated;
revoke execute on function public.seed_expense_categories(uuid) from public, anon, authenticated;
revoke execute on function public.organizations_seed_finance() from public, anon, authenticated;
revoke execute on function public.fee_plans_before_write() from public, anon, authenticated;
revoke execute on function public.fee_installments_before_write() from public, anon, authenticated;
revoke execute on function public.check_fee_plan_installments() from public, anon, authenticated;
revoke execute on function public.payments_before_write() from public, anon, authenticated;
revoke execute on function public.payment_refunds_before_write() from public, anon, authenticated;
revoke execute on function public.expenses_before_write() from public, anon, authenticated;
revoke execute on function public.payment_links_before_write() from public, anon, authenticated;
revoke execute on function public.finance_audit() from public, anon, authenticated;
revoke execute on function public.fee_plan_allocation(uuid) from public, anon, authenticated;
revoke execute on function public.fee_plan_schedule(uuid, date) from public, anon, authenticated;
revoke execute on function public.enrollment_fee_qualifies(public.enrollment_status) from public, anon, authenticated;
revoke execute on function public.finance_overdue_installments(uuid, uuid, uuid, date) from public, anon, authenticated;
revoke execute on function public.finance_summary(uuid, date, date, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.save_fee_plan(uuid, text, numeric, text, numeric, text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.log_fee_reminder(uuid, text, text, uuid) from public, anon, authenticated;
revoke execute on function public.record_gateway_payment(text, text, bigint, text, timestamptz, text) from public, anon, authenticated;

grant execute on function public.org_today(uuid) to authenticated, service_role;
grant execute on function public.next_receipt_number(uuid, integer) to service_role;
grant execute on function public.seed_expense_categories(uuid) to service_role;
grant execute on function public.fee_plan_allocation(uuid) to authenticated, service_role;
grant execute on function public.fee_plan_schedule(uuid, date) to authenticated, service_role;
grant execute on function public.enrollment_fee_qualifies(public.enrollment_status) to authenticated, service_role;
grant execute on function public.finance_overdue_installments(uuid, uuid, uuid, date) to authenticated, service_role;
grant execute on function public.finance_summary(uuid, date, date, uuid, uuid) to authenticated, service_role;
grant execute on function public.save_fee_plan(uuid, text, numeric, text, numeric, text, text, jsonb) to authenticated;
grant execute on function public.log_fee_reminder(uuid, text, text, uuid) to authenticated;
grant execute on function public.record_gateway_payment(text, text, bigint, text, timestamptz, text) to service_role;
