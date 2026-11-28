import { unstable_cache } from "next/cache";
import { listFinancialFilings, listIndexedEarnings, loadCompanyFacts, publishedEarningsIndexDates, splitAdjustedEps, type FactPoint, type FinancialFiling } from "@/lib/edgar";
import { DAY_MS, isFiscalQuarterGap } from "@/lib/fiscalQuarter";
import { insertAdjustedEps, readAdjustedEps, readAdjustedEpsAccessionsSince, readAdjustedEpsIssuers, readPrices, type AdjustedEpsRecord } from "@/lib/stockStore";
import { priceSplits } from "@/lib/valuationReview";

const GOOGLE_SPLIT = "2022-07-18";
const AMAZON_SPLIT = "2022-06-06";

const FALLBACK_TAX_RATE = 0.21;
const GOOGLE_Q1_2018_RELEASE = "https://www.sec.gov/Archives/edgar/data/1652044/000165204418000011/googexhibit991q12018.htm";

export type AdjustedPeDay = {
  date: string;
  quarter: string;
  close: number;
  adjustedEps: number | null;
  reportedEps: number | null;
  pe: number | null;
};

type EpsPeriod = {
  quarter: string;
  reported: number | null;
  adjusted: number | null;
  fiscalYearReported?: number | null;
  fiscalYearAdjusted?: number | null;
};

const day = (date: string) => Date.parse(date) / DAY_MS;
const duration = ({ start, end }: FactPoint) => start ? day(end) - day(start) + 1 : 0;
const annual = (point: FactPoint) => duration(point) >= 350 && duration(point) <= 380;
function buildAdjustedEps(ticker: string, filings: FinancialFiling[], facts: Awaited<ReturnType<typeof loadCompanyFacts>>) {
  // Share classes of the same issuer use the same consolidated earnings.
  const alphabet = ticker === "GOOG" || ticker === "GOOGL";
  const amazon = ticker === "AMZN";
  const pilot = amazon || alphabet;
  const gaap = facts.facts?.["us-gaap"];
  const ifrs = facts.facts?.["ifrs-full"];
  const eps = [...(gaap?.EarningsPerShareDiluted?.units?.["USD/shares"] ?? [])];
  if (!pilot) {
    const keys = new Set(eps.map(({ accn, start, end }) => `${accn}:${start}:${end}`));
    const alternate = [
      ifrs?.DilutedEarningsLossPerShare, gaap?.EarningsPerShareBasicAndDiluted,
      gaap?.NetIncomeLossNetOfTaxPerOutstandingLimitedPartnershipUnitDiluted,
      ticker === "ABNB" ? gaap?.IncomeLossFromContinuingOperationsPerDilutedShare : undefined,
    ];
    for (const tag of alternate) for (const point of tag?.units?.["USD/shares"] ?? []) {
      const key = `${point.accn}:${point.start}:${point.end}`;
      if (!keys.has(key)) {
        eps.push(point);
        keys.add(key);
      }
    }
  }
  const factorAtFiling = splitAdjustedEps(facts, eps).factorAtFiling;
  const shares = gaap?.WeightedAverageNumberOfDilutedSharesOutstanding?.units?.shares ??
    ifrs?.DilutedWeightedAverageNumberOfOrdinarySharesOutstanding?.units?.shares ?? [];
  const gains = gaap?.EquitySecuritiesFvNiGainLoss?.units?.USD ?? [];
  const marketable = gaap?.MarketableSecuritiesUnrealizedGainLoss?.units?.USD ?? [];
  const privateEquity = gaap?.EquitySecuritiesWithoutReadilyDeterminableFairValueUpwardPriceAdjustmentAnnualAmount?.units?.USD ?? [];
  const netIncome = gaap?.NetIncomeLoss?.units?.USD ?? ifrs?.ProfitLossAttributableToOwnersOfParent?.units?.USD ?? [];
  const taxes = gaap?.IncomeTaxExpenseBenefit?.units?.USD ?? ifrs?.IncomeTaxExpenseContinuingOperations?.units?.USD ?? [];
  const pretax = gaap?.IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest?.units?.USD ??
    ifrs?.ProfitLossBeforeTax?.units?.USD ?? [];
  const disclosures = filings.filter((filing): filing is FinancialFiling & { filed: string } => Boolean(filing.filed))
    .sort((a, b) => a.filed.localeCompare(b.filed) || a.date.localeCompare(b.date) || a.accession.localeCompare(b.accession));
  const availableQuarters = new Map<string, EpsPeriod>();
  const records: AdjustedEpsRecord[] = [];
  const fact = (points: FactPoint[], accn: string, start: string, end: string) =>
    points.find((point) => point.accn === accn && point.end === end && point.start === start && Number.isFinite(point.val))?.val;

  function disclosedGains(accession: string, start: string, end: string) {
    if (amazon && end >= "2021-01-01") {
      const publicGain = fact(marketable, accession, start, end);
      const privateGain = fact(privateEquity, accession, start, end);
      return publicGain != null && privateGain != null ? publicGain + privateGain : undefined;
    }
    if (alphabet && start === "2018-01-01" && end === "2018-03-31") return 3_031_000_000;
    return fact(gains, accession, start, end) ?? (!pilot ? fact(marketable, accession, start, end) : undefined);
  }

  function readPeriod(filing: FinancialFiling & { filed: string }, reported: FactPoint, annualFact?: FactPoint) {
    const { accession, date: quarter, filed } = filing;
    const start = reported.start!;
    const samePeriod = (points: FactPoint[]) => fact(points, accession, start, quarter);
    const earnings = samePeriod(netIncome);
    const reportedShares = samePeriod(shares);
    const inferredShares = !amazon && earnings != null && reported.val !== 0 && earnings / reported.val > 0
      ? earnings / reported.val : undefined;
    const dilutedShares = reportedShares ?? inferredShares;
    let equityGains = disclosedGains(accession, start, quarter);
    if (equityGains == null && !annual(reported) && annualFact?.start) {
      const fiscalStart = annualFact.start;
      const prior = disclosures.findLast((item) => item.date >= fiscalStart &&
        isFiscalQuarterGap(day(quarter) - day(item.date)) && item.filed <= filed &&
        disclosedGains(item.accession, fiscalStart, item.date) != null);
      const yearGains = disclosedGains(accession, fiscalStart, quarter);
      const nineMonthGains = prior ? disclosedGains(prior.accession, fiscalStart, prior.date) : undefined;
      if (yearGains != null && nineMonthGains != null) equityGains = yearGains - nineMonthGains;
    }
    const pretaxIncome = samePeriod(pretax);
    const taxExpense = samePeriod(taxes);
    const effectiveRate = pretaxIncome != null && pretaxIncome > 0 && taxExpense != null ? taxExpense / pretaxIncome : NaN;
    const hasEffectiveRate = effectiveRate >= 0 && effectiveRate <= 1;
    const taxRate = hasEffectiveRate ? effectiveRate : FALLBACK_TAX_RATE;
    const knownSplit = amazon ? AMAZON_SPLIT : alphabet ? GOOGLE_SPLIT : undefined;
    // Keep the established pilot split basis when SEC tags for that split are absent.
    const detectedFactor = factorAtFiling(filed);
    const factor = detectedFactor === 1 && knownSplit && filed < knownSplit ? 20 : detectedFactor;
    const reportedEps = reported.val / factor;
    const normalizedShares = dilutedShares != null && dilutedShares > 0 ? dilutedShares * factor : null;
    return {
      reported: reportedEps,
      adjusted: equityGains === 0 || (equityGains == null && !pilot) ? reportedEps
        : normalizedShares != null && equityGains != null
          ? reportedEps - equityGains * (1 - taxRate) / normalizedShares : null,
      inputs: {
        periodStart: start, dilutedShares: normalizedShares, equityGains: equityGains ?? null,
        taxRate, taxRateMethod: hasEffectiveRate ? "effective" as const : "fallback" as const,
        sharesEstimated: reportedShares == null && normalizedShares != null,
        adjustmentSource: alphabet && start === "2018-01-01" && quarter === "2018-03-31"
          ? GOOGLE_Q1_2018_RELEASE : undefined,
        annual: annual(reported),
      },
    };
  }

  const trailingTotal = (quarters: EpsPeriod[], key: "reported" | "adjusted") =>
    quarters.length === 4 && quarters.every((period, i) => period[key] != null &&
      (i === 0 || isFiscalQuarterGap(day(period.quarter) - day(quarters[i - 1].quarter))))
      ? quarters.reduce((sum, period) => sum + period[key]!, 0) : null;

  for (const filing of disclosures) {
    const { accession, date: quarter, filed, amendment } = filing;
    const filingEps = eps.filter((point) => point.accn === accession && point.end === quarter &&
      point.start && Number.isFinite(point.val));
    const annualFact = filingEps.find(annual);
    const quarterFact = filingEps.find((point) => isFiscalQuarterGap(duration(point)));
    if (!annualFact && !quarterFact) continue;
    const fullYear = annualFact ? readPeriod(filing, annualFact) : null;
    const quarterValues = quarterFact ? readPeriod(filing, quarterFact, annualFact) : null;
    const prior = annualFact ? [...availableQuarters.values()].filter((period) =>
      period.quarter >= annualFact.start! && period.quarter < quarter) : [];
    const subtractPrior = (key: "reported" | "adjusted") =>
      fullYear?.[key] != null && prior.length === 3 && prior.every((item) => item[key] != null)
        ? fullYear[key] - prior.reduce((sum, item) => sum + item[key]!, 0) : null;
    const period = {
      quarter,
      reported: quarterValues?.reported ?? subtractPrior("reported"),
      adjusted: quarterValues?.adjusted ?? subtractPrior("adjusted"),
      fiscalYearReported: fullYear?.reported,
      fiscalYearAdjusted: fullYear?.adjusted,
    };
    // Amendments without replacement EPS and investment inputs leave the prior filing intact.
    if (!amendment || period.adjusted != null || period.fiscalYearAdjusted != null) {
      availableQuarters.set(quarter, period);
    }
    const window = [...availableQuarters.values()].sort((a, b) => a.quarter.localeCompare(b.quarter)).slice(-4);
    const latest = window.at(-1);
    if (!latest) continue;
    records.push({
      ticker, source_accession: accession, filed_on: filed, source_quarter: quarter, ttm_quarter: latest.quarter,
      reported_quarter_eps: period.reported, adjusted_quarter_eps: period.adjusted,
      reported_ttm_eps: latest.fiscalYearReported ?? trailingTotal(window, "reported"),
      adjusted_ttm_eps: latest.fiscalYearAdjusted ?? trailingTotal(window, "adjusted"),
      inputs: (quarterValues?.adjusted != null ? quarterValues.inputs : fullYear?.inputs ?? quarterValues?.inputs) ?? null,
    });
  }
  return records;
}

async function refreshAdjustedEps(cik: number, targets: { ticker: string; accessions: Set<string> }[], since: string) {
  const filings = await listFinancialFilings(cik, since, true, { includeForeignAnnual: true, recentOnly: true });
  const pending = new Set(filings.filter(({ filed, accession }) =>
    filed && targets.some(({ accessions }) => accessions.has(accession))).map(({ accession }) => accession));
  if (!pending.size) return targets.map(({ ticker }) => ({ ticker, status: "awaiting-submissions", rows: 0 }));

  const facts = await loadCompanyFacts(cik, true);
  return Promise.all(targets.map(async ({ ticker, accessions }) => {
    const records = buildAdjustedEps(ticker, filings, facts).filter((record) => accessions.has(record.source_accession) &&
      (record.reported_quarter_eps != null || record.reported_ttm_eps != null));
    const rows = await insertAdjustedEps(records);
    return { ticker, status: records.length < accessions.size ? "awaiting-facts" : rows ? "updated" : "unchanged", rows };
  }));
}

export async function refreshBackfilledAdjustedEps(startedAt: number) {
  // Recheck recent indexes so delayed Company Facts and interrupted runs can recover.
  const dates = Array.from({ length: 14 }, (_, index) =>
    new Date(startedAt - (14 - index) * DAY_MS).toISOString().slice(0, 10));
  const [issuers, seen, indexDates] = await Promise.all([
    readAdjustedEpsIssuers(),
    readAdjustedEpsAccessionsSince(dates[0]),
    publishedEarningsIndexDates(dates),
  ]);
  const indexes = await Promise.allSettled(indexDates.map(listIndexedEarnings));
  const tickersByCik = new Map<number, string[]>();
  for (const { cik, ticker } of issuers) {
    const tickers = tickersByCik.get(cik) ?? [];
    tickers.push(ticker);
    tickersByCik.set(cik, tickers);
  }
  const pending = new Map<number, Map<string, Set<string>>>();
  const indexErrors: string[] = [];
  for (const [index, result] of indexes.entries()) {
    if (result.status === "rejected") {
      indexErrors.push(indexDates[index]);
      console.error("Adjusted EPS could not read SEC index for " + indexDates[index], result.reason);
      continue;
    }
    for (const { cik, accession } of result.value) {
      for (const ticker of tickersByCik.get(cik) ?? []) {
        if (seen.has(ticker + ":" + accession)) continue;
        const byTicker = pending.get(cik) ?? new Map<string, Set<string>>();
        const accessions = byTicker.get(ticker) ?? new Set<string>();
        accessions.add(accession);
        byTicker.set(ticker, accessions);
        pending.set(cik, byTicker);
      }
    }
  }

  const since = new Date(startedAt - 730 * DAY_MS).toISOString().slice(0, 10);
  const results: { ticker: string; status: string; rows: number }[] = [];
  // Leave room for SEC requests and the Supabase write before the cron's 60-second limit.
  const deadline = startedAt + 28_000;
  const candidates = [...pending];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, candidates.length) }, async () => {
    while (next < candidates.length && Date.now() < deadline) {
      const [cik, byTicker] = candidates[next++];
      const targets = Array.from(byTicker, ([ticker, accessions]) => ({ ticker, accessions }));
      try {
        results.push(...await refreshAdjustedEps(cik, targets, since));
      } catch (error) {
        console.error("Cron adjusted EPS refresh failed for SEC issuer " + cik, error);
        results.push(...targets.map(({ ticker }) => ({ ticker, status: "error", rows: 0 })));
      }
    }
  }));
  return { results, indexErrors, enrolled: issuers.length, deferredIssuers: candidates.length - next };
}

export const loadAdjustedPe = unstable_cache(async (ticker: string): Promise<AdjustedPeDay[]> => {
  const [history, periods] = await Promise.all([readPrices(ticker), readAdjustedEps(ticker)]);
  if (!history || !periods.length) return [];

  // Stored EPS is on the latest share basis. Only adjust closes for splits
  // that are still present in the raw price series, excluding dividends.
  const marketSplits = priceSplits(history);
  const cutoff = new Date(history.asOf);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 10);
  const startDate = cutoff.toISOString().slice(0, 10);

  let active: typeof periods[number] | undefined;
  let next = 0;
  return history.dates.flatMap((date, index) => {
    if (date < startDate) return [];
    // Use the next trading close so after-hours filings never change an earlier close.
    while (periods[next] && periods[next].filed_on < date) active = periods[next++];
    const close = history.rawCloses?.[index];
    if (!active || close == null || !Number.isFinite(close) || close <= 0) return [];
    const fresh = day(date) - day(active.ttm_quarter) <= 225;
    const adjustedEps = fresh ? active.adjusted_ttm_eps : null;
    const factor = marketSplits.reduce((product, split) => date < split.date ? product * split.factor : product, 1);
    const normalizedClose = close / factor;
    const pe = adjustedEps != null && adjustedEps > 0 ? normalizedClose / adjustedEps : null;
    return [{ date, quarter: active.ttm_quarter, close: normalizedClose, adjustedEps,
      reportedEps: active.reported_ttm_eps,
      pe: pe != null && Number.isFinite(pe) ? pe : null }];
  });
}, ["adjusted-pe-stored-eps-v2"], { revalidate: 300 });
