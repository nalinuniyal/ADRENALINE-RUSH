-- =============================================================================
-- Adrenaline Rush: UPI / bank transfer payment details, candidate pay pages and
-- "I've paid" submissions that the owner verifies. Safe to re-run.
--
--   * payment_settings     one row per organization: UPI ID, payee name, own QR
--                          image, bank account details, instructions, where to
--                          show them and the confirmation email text.
--   * fee_pay_links        public /pay/<token> links per fee plan. Only the
--                          sha256 of the token is stored; the token itself is an
--                          HMAC the server can re-create (so it can be copied
--                          again) but a database copy alone cannot.
--   * payment_submissions  what a candidate reports on the pay page (UTR, amount,
--                          date, optional screenshot). ALWAYS pending until a
--                          finance manager approves it; approval records one
--                          real payment (with a receipt) through public.payments.
--
-- Visibility: anon reaches pay data only through get_fee_pay_page() and
-- submit_fee_payment_proof() with a valid token hash. Submissions are read with
-- finance.view and decided with finance.manage. The full bank account number is
-- not column-granted to app users: finance viewers read it through
-- payment_settings_account_number(); everyone else sees the last four digits.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------

create table if not exists public.payment_settings (
  organization_id       uuid primary key references public.organizations (id) on delete cascade,
  -- UPI ID (VPA), e.g. yourname@okhdfcbank. Stored in lower case.
  upi_vpa               text check (upi_vpa is null or (char_length(upi_vpa) <= 100 and upi_vpa ~ '^[a-z0-9][a-z0-9._-]{1,63}@[a-z][a-z0-9]{1,35}$')),
  upi_payee_name        text check (upi_payee_name is null or char_length(btrim(upi_payee_name)) between 1 and 80),
  -- Optional own QR image (media_assets, served publicly by /media/<id>).
  upi_qr_media_id       uuid references public.media_assets (id) on delete set null,
  bank_account_holder   text check (bank_account_holder is null or char_length(btrim(bank_account_holder)) between 1 and 100),
  bank_account_number   text check (bank_account_number is null or bank_account_number ~ '^[0-9]{9,18}$'),
  bank_account_last4    text generated always as (right(bank_account_number, 4)) stored,
  bank_ifsc             text check (bank_ifsc is null or bank_ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$'),
  bank_name             text check (bank_name is null or char_length(btrim(bank_name)) between 1 and 100),
  bank_branch           text check (bank_branch is null or char_length(btrim(bank_branch)) between 1 and 100),
  bank_account_type     text check (bank_account_type is null or bank_account_type in ('savings', 'current', 'other')),
  instructions          text check (instructions is null or char_length(instructions) <= 1000),
  show_on_pay_page      boolean not null default true,
  show_in_reminders     boolean not null default true,
  show_on_course_pages  boolean not null default false,
  confirm_email_enabled boolean not null default true,
  confirm_email_subject text not null default 'Payment received: {{course}}'
                        check (char_length(btrim(confirm_email_subject)) between 3 and 200),
  confirm_email_body    text not null default E'Hi {{first_name}},\n\nThank you! We have received your payment of {{amount}} for {{course}}.\nReceipt number: {{receipt_number}}\nStill payable: {{outstanding}}\n\n{{business_name}}'
                        check (char_length(btrim(confirm_email_body)) between 3 and 4000),
  updated_by            uuid references public.user_profiles (id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create table if not exists public.fee_pay_links (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  fee_plan_id      uuid not null references public.fee_plans (id) on delete cascade,
  -- What the page asks for, computed live on every visit.
  amount_mode      text not null check (amount_mode in ('next_installment', 'balance')),
  -- Random per-link input to the server's HMAC (useless without the server secret).
  token_nonce      text not null check (token_nonce ~ '^[A-Za-z0-9_-]{16,64}$'),
  token_hash       text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  status           text not null default 'active' check (status in ('active', 'revoked')),
  revoked_at       timestamptz,
  revoked_by       uuid references public.user_profiles (id) on delete set null,
  open_count       integer not null default 0 check (open_count >= 0),
  last_opened_at   timestamptz,
  created_by       uuid references public.user_profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (status <> 'revoked' or revoked_at is not null)
);
create index if not exists fee_pay_links_plan_idx on public.fee_pay_links (fee_plan_id, created_at desc);
-- One live link per fee plan; making a new one revokes the old one.
create unique index if not exists fee_pay_links_one_active on public.fee_pay_links (fee_plan_id) where status = 'active';

create table if not exists public.payment_submissions (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  pay_link_id      uuid not null references public.fee_pay_links (id) on delete restrict,
  fee_plan_id      uuid not null references public.fee_plans (id) on delete restrict,
  installment_id   uuid references public.fee_installments (id) on delete set null,
  candidate_id     uuid not null references public.candidates (id) on delete restrict,
  amount           numeric(12, 2) not null check (amount > 0),
  currency         char(3) not null check (currency ~ '^[A-Z]{3}$'),
  paid_on          date not null,
  method           text not null check (method in ('upi', 'bank_transfer')),
  -- UTR / UPI reference / transaction id, upper case without spaces.
  utr              text not null check (utr ~ '^[A-Z0-9]{6,35}$'),
  note             text check (note is null or char_length(note) <= 500),
  screenshot       bytea check (screenshot is null or octet_length(screenshot) between 1 and 2097152),
  screenshot_type  text check (screenshot_type is null or screenshot_type in ('image/png', 'image/jpeg', 'image/webp')),
  has_screenshot   boolean generated always as (screenshot is not null) stored,
  status           text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reject_reason    text check (reject_reason is null or char_length(btrim(reject_reason)) between 3 and 500),
  payment_id       uuid references public.payments (id) on delete restrict,
  reviewed_by      uuid references public.user_profiles (id) on delete set null,
  reviewed_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check ((status = 'approved') = (payment_id is not null)),
  check (status <> 'rejected' or reject_reason is not null),
  check ((screenshot is null) = (screenshot_type is null))
);
create index if not exists payment_submissions_org_idx on public.payment_submissions (organization_id, status, created_at desc);
create index if not exists payment_submissions_plan_idx on public.payment_submissions (fee_plan_id, created_at desc);
create index if not exists payment_submissions_link_idx on public.payment_submissions (pay_link_id, created_at desc);
-- The same UTR can only be waiting for, or used by, one submission.
create unique index if not exists payment_submissions_utr_key on public.payment_submissions (organization_id, utr) where status <> 'rejected';

-- -----------------------------------------------------------------------------
-- Defaults: one settings row per organization
-- -----------------------------------------------------------------------------

create or replace function public.organizations_seed_payment_settings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.payment_settings (organization_id) values (new.id) on conflict do nothing;
  return new;
end;
$$;
drop trigger if exists organizations_seed_payment_settings on public.organizations;
create trigger organizations_seed_payment_settings after insert on public.organizations
  for each row execute function public.organizations_seed_payment_settings();

insert into public.payment_settings (organization_id)
select o.id from public.organizations o
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- Triggers
-- -----------------------------------------------------------------------------

drop trigger if exists payment_settings_updated_at on public.payment_settings;
create trigger payment_settings_updated_at before update on public.payment_settings
  for each row execute function public.set_updated_at();
drop trigger if exists fee_pay_links_updated_at on public.fee_pay_links;
create trigger fee_pay_links_updated_at before update on public.fee_pay_links
  for each row execute function public.set_updated_at();
drop trigger if exists payment_submissions_updated_at on public.payment_submissions;
create trigger payment_submissions_updated_at before update on public.payment_submissions
  for each row execute function public.set_updated_at();

create or replace function public.payment_settings_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.organization_id <> old.organization_id then
    raise exception 'Payment settings cannot move to another organization' using errcode = 'ARFIN';
  end if;
  new.upi_vpa := nullif(lower(btrim(coalesce(new.upi_vpa, ''))), '');
  new.bank_ifsc := nullif(upper(btrim(coalesce(new.bank_ifsc, ''))), '');
  new.bank_account_number := nullif(regexp_replace(coalesce(new.bank_account_number, ''), '\s', '', 'g'), '');
  if new.upi_qr_media_id is not null and (tg_op = 'INSERT' or new.upi_qr_media_id is distinct from old.upi_qr_media_id)
     and not exists (select 1 from public.media_assets m where m.id = new.upi_qr_media_id and m.organization_id = new.organization_id
                     and m.content_type in ('image/png', 'image/jpeg')) then
    raise exception 'Upload the QR image again (PNG or JPG)' using errcode = 'ARFIN';
  end if;
  if tg_op = 'UPDATE' then
    new.updated_by := coalesce(auth.uid(), new.updated_by);
  end if;
  return new;
end;
$$;
drop trigger if exists payment_settings_before_write on public.payment_settings;
create trigger payment_settings_before_write before insert or update on public.payment_settings
  for each row execute function public.payment_settings_before_write();

create or replace function public.fee_pay_links_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if not exists (select 1 from public.fee_plans f where f.id = new.fee_plan_id and f.organization_id = new.organization_id) then
      raise exception 'Fee plan belongs to another organization' using errcode = '23503';
    end if;
    if new.status <> 'active' then
      raise exception 'A new pay link starts active' using errcode = 'ARFIN';
    end if;
    new.revoked_at := null;
    new.revoked_by := null;
    new.open_count := 0;
    new.last_opened_at := null;
    return new;
  end if;
  if new.organization_id <> old.organization_id or new.fee_plan_id <> old.fee_plan_id or new.token_hash <> old.token_hash
     or new.token_nonce <> old.token_nonce or new.amount_mode <> old.amount_mode or new.created_by is distinct from old.created_by then
    raise exception 'Pay links cannot be edited. Make a new one instead.' using errcode = 'ARFIN';
  end if;
  if old.status = 'revoked' and new.status <> 'revoked' then
    raise exception 'A revoked pay link cannot be switched back on. Make a new one.' using errcode = 'ARFIN';
  end if;
  if new.status = 'revoked' and old.status = 'active' then
    new.revoked_at := now();
    new.revoked_by := auth.uid();
  elsif new.status = old.status then
    new.revoked_at := old.revoked_at;
    new.revoked_by := old.revoked_by;
  end if;
  return new;
end;
$$;
drop trigger if exists fee_pay_links_before_write on public.fee_pay_links;
create trigger fee_pay_links_before_write before insert or update on public.fee_pay_links
  for each row execute function public.fee_pay_links_before_write();

-- -----------------------------------------------------------------------------
-- Audit (bank account numbers are masked; page opens are not logged)
-- -----------------------------------------------------------------------------

create or replace function public.upi_payments_audit()
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
  det jsonb;
  ent_id uuid;
begin
  if entity = 'payment_settings' then
    if tg_op <> 'UPDATE' then
      return coalesce(new, old);
    end if;
    select coalesce(jsonb_object_agg(n.key, case
             when n.key = 'bank_account_number' then to_jsonb(case when n.value = 'null'::jsonb then null else '••••' || right(n.value #>> '{}', 4) end)
             else n.value end), '{}'::jsonb)
      into changed
    from jsonb_each(to_jsonb(new)) n
    join jsonb_each(to_jsonb(old)) o using (key)
    where n.value is distinct from o.value and n.key not in ('updated_at', 'updated_by', 'bank_account_last4');
    if changed = '{}'::jsonb then
      return new;
    end if;
    act := 'payment_settings.updated';
    det := jsonb_build_object('changed', changed);
    ent_id := new.organization_id;
  elsif entity = 'pay_link' then
    if tg_op = 'INSERT' then
      act := 'pay_link.created';
    elsif tg_op = 'UPDATE' and new.status = 'revoked' and old.status <> 'revoked' then
      act := 'pay_link.revoked';
    else
      return coalesce(new, old);
    end if;
    det := jsonb_build_object('fee_plan_id', rec -> 'fee_plan_id', 'amount_mode', rec -> 'amount_mode');
    ent_id := (rec ->> 'id')::uuid;
  else
    if tg_op = 'INSERT' then
      act := 'payment_submission.created';
    elsif tg_op = 'UPDATE' and new.status <> old.status then
      act := 'payment_submission.' || new.status;
    else
      return coalesce(new, old);
    end if;
    det := jsonb_strip_nulls(jsonb_build_object('fee_plan_id', rec -> 'fee_plan_id', 'amount', rec -> 'amount', 'currency', rec -> 'currency',
             'method', rec -> 'method', 'utr', rec -> 'utr', 'payment_id', rec -> 'payment_id', 'reason', rec -> 'reject_reason'));
    ent_id := (rec ->> 'id')::uuid;
  end if;
  insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, details)
  values ((rec ->> 'organization_id')::uuid, auth.uid(), act, entity, ent_id, det);
  return coalesce(new, old);
end;
$$;

drop trigger if exists payment_settings_audit on public.payment_settings;
create trigger payment_settings_audit after update on public.payment_settings
  for each row execute function public.upi_payments_audit('payment_settings');
drop trigger if exists fee_pay_links_audit on public.fee_pay_links;
create trigger fee_pay_links_audit after insert or update on public.fee_pay_links
  for each row execute function public.upi_payments_audit('pay_link');
drop trigger if exists payment_submissions_audit on public.payment_submissions;
create trigger payment_submissions_audit after insert or update on public.payment_submissions
  for each row execute function public.upi_payments_audit('payment_submission');

-- -----------------------------------------------------------------------------
-- Staff-side functions
-- -----------------------------------------------------------------------------

-- Full account number for finance viewers; null for everyone else.
create or replace function public.payment_settings_account_number(p_org uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select s.bank_account_number from public.payment_settings s
  where s.organization_id = p_org and public.has_permission(p_org, 'finance.view');
$$;

-- Makes the plan's pay link (revoking any live one) in one step. SECURITY
-- INVOKER: Row Level Security (finance.manage) applies to the caller.
create or replace function public.create_fee_pay_link(p_plan uuid, p_mode text, p_id uuid, p_nonce text, p_token_hash text)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  org uuid;
  new_id uuid;
begin
  select f.organization_id into org from public.fee_plans f where f.id = p_plan;
  if org is null or not public.has_permission(org, 'finance.manage') then
    raise exception 'You do not have permission to manage fees' using errcode = '42501';
  end if;
  update public.fee_pay_links set status = 'revoked' where fee_plan_id = p_plan and status = 'active';
  insert into public.fee_pay_links (id, organization_id, fee_plan_id, amount_mode, token_nonce, token_hash, created_by)
  values (p_id, org, p_plan, p_mode, p_nonce, p_token_hash, auth.uid())
  returning id into new_id;
  return new_id;
end;
$$;

-- Fee reference used in UPI notes and on the pay page, e.g. FEE-3F2A9C1B.
create or replace function public.fee_plan_reference(p_plan uuid)
returns text
language sql
immutable
set search_path = ''
as $$
  select 'FEE-' || upper(left(replace(p_plan::text, '-', ''), 8));
$$;

-- What a pay link asks for right now: (amount, installment, label, due date, outstanding).
create or replace function public.fee_pay_amount(p_plan uuid, p_mode text)
returns table (amount numeric, installment_id uuid, label text, due_date date, outstanding numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  owed numeric;
  s record;
begin
  select b.outstanding into owed from public.fee_plan_balances b where b.fee_plan_id = p_plan;
  owed := coalesce(owed, 0);
  outstanding := owed;
  amount := owed;
  installment_id := null;
  label := null;
  due_date := null;
  if p_mode = 'next_installment' then
    select x.installment_id, x.seq, x.label, x.due_date, x.remaining into s
    from public.fee_plan_schedule(p_plan) x where x.remaining > 0 order by x.seq limit 1;
    if found then
      installment_id := s.installment_id;
      label := coalesce(s.label, 'Installment ' || s.seq);
      due_date := s.due_date;
      amount := least(s.remaining, owed);
    end if;
  end if;
  return next;
end;
$$;

-- Approve: records exactly one received payment (method upi / bank transfer,
-- reference = UTR) and links it to the submission. Raises for people (ARFIN).
create or replace function public.approve_payment_submission(p_submission uuid, p_amount numeric default null, p_paid_on date default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  sub public.payment_submissions;
  pay_id uuid;
  receipt text;
begin
  select * into sub from public.payment_submissions s where s.id = p_submission for update;
  if not found or not public.has_permission(sub.organization_id, 'finance.manage') then
    raise exception 'You do not have permission to approve payments' using errcode = '42501';
  end if;
  if sub.status <> 'pending' then
    raise exception 'This payment was already %', case sub.status when 'approved' then 'approved' else 'rejected' end using errcode = 'ARFIN';
  end if;
  if p_amount is not null and p_amount <= 0 then
    raise exception 'Enter the amount you received' using errcode = 'ARFIN';
  end if;
  if exists (select 1 from public.payments p where p.organization_id = sub.organization_id and p.status in ('completed', 'pending')
             and upper(regexp_replace(coalesce(p.reference, ''), '\s', '', 'g')) = sub.utr) then
    raise exception 'A payment with reference % is already recorded. Reject this one as a duplicate.', sub.utr using errcode = 'ARFIN';
  end if;

  insert into public.payments (organization_id, fee_plan_id, enrollment_id, candidate_id, installment_id, amount, currency, paid_on,
                               method, reference, notes, status, recorded_by)
  select sub.organization_id, sub.fee_plan_id, f.enrollment_id, f.candidate_id, sub.installment_id, coalesce(p_amount, sub.amount), sub.currency,
         coalesce(p_paid_on, sub.paid_on), sub.method::public.finance_payment_method, sub.utr,
         left('Reported by the candidate on the pay page and checked against the bank/UPI statement.'
              || case when sub.note is not null then E'\nCandidate note: ' || sub.note else '' end, 2000),
         'completed', auth.uid()
  from public.fee_plans f where f.id = sub.fee_plan_id
  returning id, receipt_number into pay_id, receipt;

  update public.payment_submissions
  set status = 'approved', payment_id = pay_id, reviewed_by = auth.uid(), reviewed_at = now()
  where id = sub.id;
  return jsonb_build_object('payment_id', pay_id, 'receipt_number', receipt);
end;
$$;

create or replace function public.reject_payment_submission(p_submission uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  sub public.payment_submissions;
  reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  select * into sub from public.payment_submissions s where s.id = p_submission for update;
  if not found or not public.has_permission(sub.organization_id, 'finance.manage') then
    raise exception 'You do not have permission to reject payments' using errcode = '42501';
  end if;
  if sub.status <> 'pending' then
    raise exception 'This payment was already %', case sub.status when 'approved' then 'approved' else 'rejected' end using errcode = 'ARFIN';
  end if;
  if reason is null or char_length(reason) < 3 then
    raise exception 'Give a reason (at least 3 characters)' using errcode = 'ARFIN';
  end if;
  update public.payment_submissions
  set status = 'rejected', reject_reason = left(reason, 500), reviewed_by = auth.uid(), reviewed_at = now()
  where id = sub.id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Public side: only through a token hash. Callable by anon (the app calls it
-- from the server after its own rate limit); a 256-bit token cannot be guessed.
-- -----------------------------------------------------------------------------

create or replace function public.get_fee_pay_page(p_token_hash text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  link public.fee_pay_links;
  plan record;
  st public.payment_settings;
  amt record;
  v_show boolean;
  pending_count integer;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('status', 'not_found');
  end if;
  select * into link from public.fee_pay_links l where l.token_hash = p_token_hash;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  select o.name as business_name, f.currency, f.course_id, c.full_name, co.title as course_title, e.status as enrollment_status
    into plan
  from public.fee_plans f
  join public.organizations o on o.id = f.organization_id
  join public.candidates c on c.id = f.candidate_id
  join public.enrollments e on e.id = f.enrollment_id
  left join public.courses co on co.id = f.course_id
  where f.id = link.fee_plan_id;
  if link.status <> 'active' then
    return jsonb_build_object('status', 'revoked', 'business_name', plan.business_name);
  end if;
  if not public.enrollment_fee_qualifies(plan.enrollment_status) then
    return jsonb_build_object('status', 'closed', 'business_name', plan.business_name);
  end if;

  update public.fee_pay_links set open_count = open_count + 1, last_opened_at = now() where id = link.id;
  select * into st from public.payment_settings s where s.organization_id = link.organization_id;
  select * into amt from public.fee_pay_amount(link.fee_plan_id, link.amount_mode);
  select count(*) into pending_count from public.payment_submissions s where s.pay_link_id = link.id and s.status = 'pending';
  v_show := coalesce(st.show_on_pay_page, false);

  return jsonb_build_object(
    'status', case when amt.outstanding <= 0 then 'paid' else 'ok' end,
    'business_name', plan.business_name,
    'first_name', nullif(split_part(btrim(plan.full_name), ' ', 1), ''),
    'course_title', plan.course_title,
    'currency', plan.currency,
    'amount_mode', link.amount_mode,
    'amount_due', amt.amount,
    'installment_label', amt.label,
    'due_date', amt.due_date,
    'outstanding', amt.outstanding,
    'reference', public.fee_plan_reference(link.fee_plan_id),
    'pending_submissions', pending_count,
    'details_shown', v_show,
    'upi_vpa', case when v_show then st.upi_vpa end,
    'upi_payee_name', case when v_show then st.upi_payee_name end,
    'upi_qr_media_id', case when v_show then st.upi_qr_media_id end,
    'bank', case when v_show and st.bank_account_number is not null then jsonb_build_object(
      'account_holder', st.bank_account_holder, 'account_number', st.bank_account_number, 'ifsc', st.bank_ifsc,
      'bank_name', st.bank_name, 'branch', st.bank_branch, 'account_type', st.bank_account_type) end,
    'instructions', st.instructions
  );
end;
$$;

-- Result codes: ok | not_found | revoked | closed | paid | invalid_amount |
-- invalid_date | invalid_utr | invalid_method | invalid_screenshot | duplicate_utr | too_many
create or replace function public.submit_fee_payment_proof(
  p_token_hash text,
  p_amount numeric,
  p_paid_on date,
  p_method text,
  p_utr text,
  p_note text default null,
  p_screenshot bytea default null,
  p_screenshot_type text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  link public.fee_pay_links;
  plan record;
  amt record;
  today date;
  v_utr text := upper(regexp_replace(coalesce(p_utr, ''), '[\s-]', '', 'g'));
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  new_id uuid;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('result', 'not_found');
  end if;
  select * into link from public.fee_pay_links l where l.token_hash = p_token_hash for update;
  if not found then
    return jsonb_build_object('result', 'not_found');
  end if;
  if link.status <> 'active' then
    return jsonb_build_object('result', 'revoked');
  end if;
  select f.currency, f.candidate_id, e.status as enrollment_status into plan
  from public.fee_plans f join public.enrollments e on e.id = f.enrollment_id where f.id = link.fee_plan_id;
  if not public.enrollment_fee_qualifies(plan.enrollment_status) then
    return jsonb_build_object('result', 'closed');
  end if;
  select * into amt from public.fee_pay_amount(link.fee_plan_id, link.amount_mode);
  if amt.outstanding <= 0 then
    return jsonb_build_object('result', 'paid');
  end if;
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) or p_amount > amt.outstanding then
    return jsonb_build_object('result', 'invalid_amount', 'max', amt.outstanding);
  end if;
  today := public.org_today(link.organization_id);
  if p_paid_on is null or p_paid_on > today + 1 or p_paid_on < today - 90 then
    return jsonb_build_object('result', 'invalid_date');
  end if;
  if p_method is null or p_method not in ('upi', 'bank_transfer') then
    return jsonb_build_object('result', 'invalid_method');
  end if;
  if v_utr !~ '^[A-Z0-9]{6,35}$' then
    return jsonb_build_object('result', 'invalid_utr');
  end if;
  if (p_screenshot is null) <> (p_screenshot_type is null)
     or (p_screenshot is not null and (octet_length(p_screenshot) > 2097152 or p_screenshot_type not in ('image/png', 'image/jpeg', 'image/webp'))) then
    return jsonb_build_object('result', 'invalid_screenshot');
  end if;
  -- Throttle per link: at most 3 waiting and 10 per day.
  if (select count(*) from public.payment_submissions s where s.pay_link_id = link.id and s.status = 'pending') >= 3
     or (select count(*) from public.payment_submissions s where s.pay_link_id = link.id and s.created_at > now() - interval '1 day') >= 10 then
    return jsonb_build_object('result', 'too_many');
  end if;
  if exists (select 1 from public.payment_submissions s where s.organization_id = link.organization_id and s.utr = v_utr and s.status <> 'rejected')
     or exists (select 1 from public.payments p where p.organization_id = link.organization_id and p.status in ('completed', 'pending')
                and upper(regexp_replace(coalesce(p.reference, ''), '\s', '', 'g')) = v_utr) then
    return jsonb_build_object('result', 'duplicate_utr');
  end if;

  begin
    insert into public.payment_submissions (organization_id, pay_link_id, fee_plan_id, installment_id, candidate_id, amount, currency,
                                            paid_on, method, utr, note, screenshot, screenshot_type)
    values (link.organization_id, link.id, link.fee_plan_id, amt.installment_id, plan.candidate_id, p_amount, plan.currency,
            p_paid_on, p_method, v_utr, left(v_note, 500), p_screenshot, p_screenshot_type)
    returning id into new_id;
  exception when unique_violation then
    return jsonb_build_object('result', 'duplicate_utr');
  end;
  return jsonb_build_object('result', 'ok', 'id', new_id);
end;
$$;

-- Payment details for the public course pages (only when switched on).
create or replace function public.get_public_payment_details()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when s.show_on_course_pages and (s.upi_vpa is not null or s.bank_account_number is not null) then jsonb_build_object(
    'upi_vpa', s.upi_vpa,
    'upi_payee_name', s.upi_payee_name,
    'upi_qr_media_id', s.upi_qr_media_id,
    'bank', case when s.bank_account_number is not null then jsonb_build_object(
      'account_holder', s.bank_account_holder, 'account_number', s.bank_account_number, 'ifsc', s.bank_ifsc,
      'bank_name', s.bank_name, 'branch', s.bank_branch, 'account_type', s.bank_account_type) end,
    'instructions', s.instructions) end
  from public.payment_settings s
  where s.organization_id = public.primary_organization_id();
$$;

-- -----------------------------------------------------------------------------
-- Email log: allow payment confirmation emails
-- -----------------------------------------------------------------------------

alter table public.email_log drop constraint if exists email_log_kind_check;
alter table public.email_log add constraint email_log_kind_check
  check (kind in ('automation', 'test', 'share', 'fee_reminder', 'payment_confirmation'));

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------

alter table public.payment_settings    enable row level security;
alter table public.fee_pay_links       enable row level security;
alter table public.payment_submissions enable row level security;

drop policy if exists "payment detail editors read payment settings" on public.payment_settings;
create policy "payment detail editors read payment settings" on public.payment_settings for select to authenticated
  using (public.has_permission(organization_id, 'finance.view') or public.has_permission(organization_id, 'settings.manage'));
drop policy if exists "payment detail editors update payment settings" on public.payment_settings;
create policy "payment detail editors update payment settings" on public.payment_settings for update to authenticated
  using (public.has_permission(organization_id, 'finance.manage') or public.has_permission(organization_id, 'settings.manage'))
  with check (public.has_permission(organization_id, 'finance.manage') or public.has_permission(organization_id, 'settings.manage'));

drop policy if exists "finance viewers read pay links" on public.fee_pay_links;
create policy "finance viewers read pay links" on public.fee_pay_links for select to authenticated
  using (public.has_permission(organization_id, 'finance.view'));
drop policy if exists "finance managers create pay links" on public.fee_pay_links;
create policy "finance managers create pay links" on public.fee_pay_links for insert to authenticated
  with check (public.has_permission(organization_id, 'finance.manage') and created_by = (select auth.uid()));
drop policy if exists "finance managers revoke pay links" on public.fee_pay_links;
create policy "finance managers revoke pay links" on public.fee_pay_links for update to authenticated
  using (public.has_permission(organization_id, 'finance.manage'))
  with check (public.has_permission(organization_id, 'finance.manage'));

drop policy if exists "finance viewers read payment submissions" on public.payment_submissions;
create policy "finance viewers read payment submissions" on public.payment_submissions for select to authenticated
  using (public.has_permission(organization_id, 'finance.view'));
-- No insert/update policies: submissions are written only by the functions above.

-- Payment-detail editors may upload their own QR image.
drop policy if exists "payment detail editors upload media" on public.media_assets;
create policy "payment detail editors upload media" on public.media_assets for insert to authenticated
  with check ((public.has_permission(organization_id, 'finance.manage') or public.has_permission(organization_id, 'settings.manage'))
              and created_by = (select auth.uid()));

-- -----------------------------------------------------------------------------
-- Table grants
-- -----------------------------------------------------------------------------

revoke all on public.payment_settings, public.fee_pay_links, public.payment_submissions from anon, authenticated;

-- Everything except the full account number (read via payment_settings_account_number()).
grant select (organization_id, upi_vpa, upi_payee_name, upi_qr_media_id, bank_account_holder, bank_account_last4, bank_ifsc,
              bank_name, bank_branch, bank_account_type, instructions, show_on_pay_page, show_in_reminders, show_on_course_pages,
              confirm_email_enabled, confirm_email_subject, confirm_email_body, updated_by, created_at, updated_at)
  on public.payment_settings to authenticated;
grant update (upi_vpa, upi_payee_name, upi_qr_media_id, bank_account_holder, bank_account_number, bank_ifsc, bank_name, bank_branch,
              bank_account_type, instructions, show_on_pay_page, show_in_reminders, show_on_course_pages,
              confirm_email_enabled, confirm_email_subject, confirm_email_body)
  on public.payment_settings to authenticated;

-- token_hash and token_nonce are write-only for app users.
grant select (id, organization_id, fee_plan_id, amount_mode, status, revoked_at, revoked_by, open_count, last_opened_at, created_by, created_at, updated_at)
  on public.fee_pay_links to authenticated;
grant insert (id, organization_id, fee_plan_id, amount_mode, token_nonce, token_hash, created_by) on public.fee_pay_links to authenticated;
grant update (status) on public.fee_pay_links to authenticated;

-- Screenshot bytes are not granted (served by an authenticated route).
grant select (id, organization_id, pay_link_id, fee_plan_id, installment_id, candidate_id, amount, currency, paid_on, method, utr, note,
              screenshot_type, has_screenshot, status, reject_reason, payment_id, reviewed_by, reviewed_at, created_at, updated_at)
  on public.payment_submissions to authenticated;

grant all on public.payment_settings, public.fee_pay_links, public.payment_submissions to service_role;

-- -----------------------------------------------------------------------------
-- Function grants: only this migration's functions
-- -----------------------------------------------------------------------------

revoke execute on function public.organizations_seed_payment_settings() from public, anon, authenticated;
revoke execute on function public.payment_settings_before_write() from public, anon, authenticated;
revoke execute on function public.fee_pay_links_before_write() from public, anon, authenticated;
revoke execute on function public.upi_payments_audit() from public, anon, authenticated;
revoke execute on function public.payment_settings_account_number(uuid) from public, anon, authenticated;
revoke execute on function public.create_fee_pay_link(uuid, text, uuid, text, text) from public, anon, authenticated;
revoke execute on function public.fee_plan_reference(uuid) from public, anon, authenticated;
revoke execute on function public.fee_pay_amount(uuid, text) from public, anon, authenticated;
revoke execute on function public.approve_payment_submission(uuid, numeric, date) from public, anon, authenticated;
revoke execute on function public.reject_payment_submission(uuid, text) from public, anon, authenticated;
revoke execute on function public.get_fee_pay_page(text) from public, anon, authenticated;
revoke execute on function public.submit_fee_payment_proof(text, numeric, date, text, text, text, bytea, text) from public, anon, authenticated;
revoke execute on function public.get_public_payment_details() from public, anon, authenticated;

grant execute on function public.payment_settings_account_number(uuid) to authenticated, service_role;
grant execute on function public.create_fee_pay_link(uuid, text, uuid, text, text) to authenticated;
grant execute on function public.fee_plan_reference(uuid) to authenticated, service_role;
grant execute on function public.fee_pay_amount(uuid, text) to service_role;
grant execute on function public.approve_payment_submission(uuid, numeric, date) to authenticated;
grant execute on function public.reject_payment_submission(uuid, text) to authenticated;
grant execute on function public.get_fee_pay_page(text) to anon, authenticated, service_role;
grant execute on function public.submit_fee_payment_proof(text, numeric, date, text, text, text, bytea, text) to anon, authenticated, service_role;
grant execute on function public.get_public_payment_details() to anon, authenticated, service_role;
