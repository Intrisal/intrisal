begin;

alter table public.fundamentals_quarterly
  add column if not exists reporting_currency text not null default 'USD',
  add column if not exists sti double precision;

create schema if not exists intrisal_private;
revoke all on schema intrisal_private from public;
grant usage on schema intrisal_private to service_role;

create or replace function intrisal_private.quarter_points(series jsonb)
returns table (period_end date, amount double precision)
language sql immutable set search_path = '' as $$
  select e.value::date, n.value::text::double precision
  from jsonb_array_elements_text(case when jsonb_typeof(series -> 'ends') = 'array' then series -> 'ends' end) with ordinality as e(value, pos)
  join jsonb_array_elements(case when jsonb_typeof(series -> 'values') = 'array' then series -> 'values' end) with ordinality as n(value, pos) using (pos)
  where jsonb_typeof(n.value) = 'number';
$$;

create or replace function intrisal_private.merge_quarters(previous jsonb, incoming jsonb)
returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'ends', coalesce(jsonb_agg(period_end order by period_end), '[]'::jsonb),
    'values', coalesce(jsonb_agg(amount order by period_end), '[]'::jsonb)
  )
  from (
    select distinct on (period_end) period_end, amount
    from (
      select *, 0 as priority from intrisal_private.quarter_points(previous)
      union all
      select *, 1 as priority from intrisal_private.quarter_points(incoming)
    ) as points
    order by period_end, priority desc
  ) as chosen;
$$;

create or replace function intrisal_private.preserve_edgar_history()
returns trigger
language plpgsql set search_path = '' as $$
declare
  previous jsonb;
  incoming jsonb := new.edgar_snapshot;
  metric text;
  previous_version integer;
  incoming_version integer;
  same_eps_basis boolean;
  merged_balances jsonb;
begin
  if tg_op = 'UPDATE' then previous := old.edgar_snapshot; end if;
  if previous is null then return new; end if;
  if incoming is null then
    new.edgar_snapshot := previous;
    return new;
  end if;

  -- Raw monetary values in different currencies cannot share a series.
  if coalesce(previous ->> 'reportingCurrency', 'USD') <> coalesce(incoming ->> 'reportingCurrency', 'USD') then
    return new;
  end if;

  foreach metric in array array['revenue','operatingIncome','freeCashFlow','tax','pretax'] loop
    incoming := jsonb_set(incoming, array[metric], intrisal_private.merge_quarters(previous -> metric, incoming -> metric));
  end loop;

  previous_version := coalesce((previous ->> 'epsSplitBasisVersion')::integer, 0);
  incoming_version := coalesce((incoming ->> 'epsSplitBasisVersion')::integer, 0);
  same_eps_basis := previous_version = incoming_version
    and previous ->> 'epsSplitBasis' = incoming ->> 'epsSplitBasis';

  if incoming_version < previous_version
     or (incoming_version = previous_version and incoming ->> 'epsSplitBasis' is null) then
    -- The legacy writer can continue running while the new application deploys.
    incoming := incoming || jsonb_build_object(
      'dilutedEps', previous -> 'dilutedEps',
      'epsSplitBasisVersion', previous -> 'epsSplitBasisVersion',
      'epsSplitBasis', previous -> 'epsSplitBasis'
    );
  elsif same_eps_basis then
    incoming := jsonb_set(incoming, '{dilutedEps}', intrisal_private.merge_quarters(previous -> 'dilutedEps', incoming -> 'dilutedEps'));
  end if;

  select coalesce(jsonb_object_agg(
    quarter,
    '{"shares":null,"debt":null,"cash":null}'::jsonb
      || coalesce(previous -> 'balances' -> quarter, '{}'::jsonb)
      || jsonb_strip_nulls(coalesce(incoming -> 'balances' -> quarter, '{}'::jsonb))
  ), '{}'::jsonb)
  into merged_balances
  from (
    select jsonb_object_keys(coalesce(nullif(previous -> 'balances', 'null'::jsonb), '{}'::jsonb)) as quarter
    union
    select jsonb_object_keys(coalesce(nullif(incoming -> 'balances', 'null'::jsonb), '{}'::jsonb))
  ) as dates;

  new.edgar_snapshot := jsonb_set(incoming, '{balances}', merged_balances);
  return new;
end;
$$;

create or replace function intrisal_private.sync_edgar_quarters()
returns trigger
language plpgsql set search_path = '' as $$
declare
  snapshot jsonb := new.edgar_snapshot;
  previous jsonb;
  currency text := coalesce(snapshot ->> 'reportingCurrency', 'USD');
begin
  if snapshot is null then return new; end if;
  if tg_op = 'UPDATE' then previous := old.edgar_snapshot; end if;

  insert into public.fundamentals_quarterly as stored
    (ticker, quarter, reporting_currency, revenue, operating_income, diluted_eps, free_cash_flow, tax, pretax, debt, cash, shares, sti)
  with metrics as (
    select point.period_end, key, point.amount
    from unnest(array['revenue','operatingIncome','dilutedEps','freeCashFlow','tax','pretax']) as metric(key)
    cross join lateral intrisal_private.quarter_points(snapshot -> key) as point
  ), dates as (
    select period_end from metrics
    union
    select key::date from jsonb_each(coalesce(nullif(snapshot -> 'balances', 'null'::jsonb), '{}'::jsonb))
    union
    -- Clear old per-share values omitted from a rebuilt series on a different split basis.
    select period_end from intrisal_private.quarter_points(previous -> 'dilutedEps')
    where coalesce(previous ->> 'reportingCurrency', 'USD') = currency
  )
  select new.ticker, dates.period_end, currency,
    max(amount) filter (where key = 'revenue'),
    max(amount) filter (where key = 'operatingIncome'),
    max(amount) filter (where key = 'dilutedEps'),
    max(amount) filter (where key = 'freeCashFlow'),
    max(amount) filter (where key = 'tax'),
    max(amount) filter (where key = 'pretax'),
    (snapshot -> 'balances' -> (dates.period_end::text) ->> 'debt')::double precision,
    (snapshot -> 'balances' -> (dates.period_end::text) ->> 'cash')::double precision,
    (snapshot -> 'balances' -> (dates.period_end::text) ->> 'shares')::double precision,
    (snapshot -> 'balances' -> (dates.period_end::text) ->> 'sti')::double precision
  from dates left join metrics using (period_end)
  group by dates.period_end
  on conflict (ticker, quarter) do update set
    reporting_currency = excluded.reporting_currency,
    revenue = excluded.revenue,
    operating_income = excluded.operating_income,
    diluted_eps = excluded.diluted_eps,
    free_cash_flow = excluded.free_cash_flow,
    tax = excluded.tax,
    pretax = excluded.pretax,
    debt = excluded.debt,
    cash = excluded.cash,
    shares = excluded.shares,
    sti = coalesce(excluded.sti, case when stored.reporting_currency = excluded.reporting_currency then stored.sti end);

  return new;
end;
$$;

revoke execute on all functions in schema intrisal_private from public;
grant execute on all functions in schema intrisal_private to service_role;

create trigger preserve_edgar_history before insert or update of edgar_snapshot
on public.tickers for each row execute function intrisal_private.preserve_edgar_history();

create trigger sync_edgar_quarters after insert or update of edgar_snapshot
on public.tickers for each row execute function intrisal_private.sync_edgar_quarters();

notify pgrst, 'reload schema';
commit;
