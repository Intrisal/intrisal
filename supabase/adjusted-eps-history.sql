create table if not exists public.adjusted_eps_history (
  ticker text not null references public.tickers(ticker),
  source_accession text not null,
  filed_on date not null,
  source_quarter date not null,
  ttm_quarter date not null,
  reported_quarter_eps double precision,
  adjusted_quarter_eps double precision,
  reported_ttm_eps double precision,
  adjusted_ttm_eps double precision,
  inputs jsonb,
  primary key (ticker, source_accession),
  check (filed_on >= source_quarter and filed_on >= ttm_quarter),
  check (inputs is null or jsonb_typeof(inputs) = 'object')
);

create index if not exists adjusted_eps_history_ticker_filed
  on public.adjusted_eps_history (ticker, filed_on, source_accession);

alter table public.adjusted_eps_history enable row level security;
revoke all on public.adjusted_eps_history from public, anon, authenticated, service_role;
grant select, insert, update on public.adjusted_eps_history to service_role;
notify pgrst, 'reload schema';
