begin;

-- Per-account watchlist (MRU order preserved in tickers[]).
-- Run once in the Supabase SQL editor after auth-schema.sql.

create table if not exists public.user_watchlists (
  user_id uuid primary key references public.app_users (id) on delete cascade,
  tickers text[] not null default '{}'::text[],
  updated_at timestamptz not null default now()
);

alter table public.user_watchlists enable row level security;
revoke all on public.user_watchlists from anon, authenticated;
grant select, insert, update, delete on public.user_watchlists to service_role;

notify pgrst, 'reload schema';
commit;
