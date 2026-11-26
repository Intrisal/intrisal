create table if not exists public.valuation_history_review (
  ticker text primary key references public.tickers(ticker),
  points jsonb not null check (jsonb_typeof(points) = 'array' and jsonb_array_length(points) <= 40)
);

alter table public.valuation_history_review enable row level security;
revoke all on public.valuation_history_review from public, anon, authenticated;
grant select, insert, update on public.valuation_history_review to service_role;
notify pgrst, 'reload schema';
