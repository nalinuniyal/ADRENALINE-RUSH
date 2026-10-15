-- =============================================================================
-- Fixed-window rate limiter for login, first-admin setup and (from Phase 2)
-- public registration forms. Works on Vercel's serverless runtime because the
-- counter lives in Postgres, not in process memory.
-- Keys are hashed by the app (never raw IPs or emails).
-- =============================================================================

create table if not exists public.rate_limit_buckets (
  key           text primary key check (char_length(key) <= 200),
  window_start  timestamptz not null,
  hits          integer not null check (hits >= 0)
);

create index if not exists rate_limit_buckets_window_idx on public.rate_limit_buckets (window_start);

alter table public.rate_limit_buckets enable row level security;
-- No policies: only the service role (which bypasses RLS) may touch it.
revoke all on public.rate_limit_buckets from anon, authenticated;

-- Returns true when the call is allowed, false when the limit is exceeded.
create or replace function public.consume_rate_limit(p_key text, p_limit integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_window timestamptz :=
    to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  new_hits integer;
begin
  if p_limit < 1 or p_window_seconds < 1 then
    raise exception 'Invalid rate limit configuration' using errcode = '22023';
  end if;

  insert into public.rate_limit_buckets as b (key, window_start, hits)
  values (p_key, current_window, 1)
  on conflict (key) do update
    set hits = case when b.window_start = excluded.window_start then b.hits + 1 else 1 end,
        window_start = excluded.window_start
  returning hits into new_hits;

  -- Opportunistic cleanup of stale buckets (cheap thanks to the index).
  if random() < 0.01 then
    delete from public.rate_limit_buckets where window_start < now() - interval '1 day';
  end if;

  return new_hits <= p_limit;
end;
$$;

revoke execute on function public.consume_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, integer, integer) to service_role;
grant all on public.rate_limit_buckets to service_role;
