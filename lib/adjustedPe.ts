import { unstable_cache } from "next/cache";
import { listFinancialFilings, loadCompanyFacts, type FactPoint, type FinancialFiling } from "@/lib/edgar";
import { DAY_MS, isFiscalQuarterGap } from "@/lib/fiscalQuarter";
import { readAdjustedEps, readPrices, saveAdjustedEps, type AdjustedEpsRecord } from "@/lib/stockStore";
import { priceSplits } from "@/lib/valuationReview";

const ISSUERS = {
  AMZN: { cik: 1018724, splitDate: "2022-06-06" },
  GOOG: { cik: 1652044, splitDate: "2022-07-18" },
};
export const ADJUSTED_EPS_TICKERS = ["AMZN", "GOOG"] as const;
type AdjustedTicker = (typeof ADJUSTED_EPS_TICKERS)[number];

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
const splitFactor = (ticker: AdjustedTicker, date: string) => date < ISSUERS[ticker].splitDate ? 20 : 1;

function buildAdjustedEps(ticker: AdjustedTicker, filings: FinancialFiling[], facts: Awaited<ReturnType<typeof loadCompanyFacts>>) {
  const gaap = facts.facts?.["us-gaap"];
  const eps = gaap?.EarningsPerShareDiluted?.units?.["USD/shares"] ?? [];
  const shares = gaap?.WeightedAverageNumberOfDilutedSharesOutstanding?.units?.shares ?? [];
  const gains = gaap?.EquitySecuritiesFvNiGainLoss?.units?.USD ?? [];
  const marketable = gaap?.MarketableSecuritiesUnrealizedGainLoss?.units?.USD ?? [];
  const privateEquity = gaap?.EquitySecuritiesWithoutReadilyDeterminableFairValueUpwardPriceAdjustmentAnnualAmount?.units?.USD ?? [];
  const netIncome = gaap?.NetIncomeLoss?.units?.USD ?? [];
  const taxes = gaap?.IncomeTaxExpenseBenefit?.units?.USD ?? [];
  const pretax = gaap?.IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest?.units?.USD ?? [];
  const disclosures = filings.filter((filing): filing is FinancialFiling & { filed: string } => Boolean(filing.filed))
    .sort((a, b) => a.filed.localeCompare(b.filed) || a.date.localeCompare(b.date) || a.accession.localeCompare(b.accession));
  const availableQuarters = new Map<string, EpsPeriod>();
  const records: AdjustedEpsRecord[] = [];
  const fact = (points: FactPoint[], accn: string, start: string, end: string) =>
    points.find((point) => point.accn === accn && point.end === end && point.start === start && Number.isFinite(point.val))?.val;

  function disclosedGains(accession: string, start: string, end: string) {
    if (ticker === "AMZN" && end >= "2021-01-01") {
      const publicGain = fact(marketable, accession, start, end);
      const privateGain = fact(privateEquity, accession, start, end);
      return publicGain != null && privateGain != null ? publicGain + privateGain : undefined;
    }
    if (ticker === "GOOG" && start === "2018-01-01" && end === "2018-03-31") return 3_031_000_000;
    return fact(gains, accession, start, end);
  }

  function readPeriod(filing: FinancialFiling & { filed: string }, reported: FactPoint, annualFact?: FactPoint) {
    const { accession, date: quarter, filed } = filing;
    const start = reported.start!;
    const samePeriod = (points: FactPoint[]) => fact(points, accession, start, quarter);
    const earnings = samePeriod(netIncome);
    const reportedShares = samePeriod(shares);
    const inferredShares = ticker === "GOOG" && earnings != null && earnings > 0 && reported.val > 0
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
    const factor = splitFactor(ticker, filed);
    const reportedEps = reported.val / factor;
    const normalizedShares = dilutedShares != null && dilutedShares > 0 ? dilutedShares * factor : null;
    return {
      reported: reportedEps,
      adjusted: normalizedShares != null && equityGains != null
        ? reportedEps - equityGains * (1 - taxRate) / normalizedShares : null,
      inputs: {
        periodStart: start, dilutedShares: normalizedShares, equityGains: equityGains ?? null,
        taxRate, taxRateMethod: hasEffectiveRate ? "effective" as const : "fallback" as const,
        sharesEstimated: reportedShares == null && normalizedShares != null,
        adjustmentSource: ticker === "GOOG" && start === "2018-01-01" && quarter === "2018-03-31"
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

export async function refreshAdjustedEps(ticker: AdjustedTicker, force = false) {
  const { cik } = ISSUERS[ticker];
  const [stored, filings] = await Promise.all([readAdjustedEps(ticker), listFinancialFilings(cik, "2014-01-01", true)]);
  const seen = new Set(stored.map((period) => period.source_accession));
  const pending = filings.filter(({ accession, filed }) => filed && !seen.has(accession));
  if (!force && !pending.length) return { status: "unchanged", rows: 0 };
  if (!filings.length) return { status: "unavailable", rows: 0 };

  const facts = await loadCompanyFacts(cik, true);
  const accessionsWithFacts = new Set<string>();
  for (const concept of Object.values(facts.facts?.["us-gaap"] ?? {})) {
    for (const points of Object.values(concept.units ?? {})) {
      for (const point of points) if (point.accn) accessionsWithFacts.add(point.accn);
    }
  }
  const awaitingFacts = new Set(pending.filter(({ accession, filed }) => filed &&
    Date.now() - Date.parse(filed) < 14 * DAY_MS && !accessionsWithFacts.has(accession)).map(({ accession }) => accession));
  const records = buildAdjustedEps(ticker, filings.filter(({ accession }) => !awaitingFacts.has(accession)), facts);
  const firstNew = records.find((record) => !seen.has(record.source_accession));
  const rows = records.filter((record) => force || (firstNew != null && record.filed_on >= firstNew.filed_on));
  await saveAdjustedEps(rows);
  return { status: awaitingFacts.size ? "awaiting-facts" : rows.length ? "updated" : "unavailable", rows: rows.length };
}

export const loadAdjustedPe = unstable_cache(async (ticker: AdjustedTicker): Promise<AdjustedPeDay[]> => {
  const { splitDate } = ISSUERS[ticker];
  const [history, periods] = await Promise.all([readPrices(ticker), readAdjustedEps(ticker)]);
  if (!history || !periods.length) return [];

  const marketSplits = priceSplits(history);
  if (marketSplits.some(({ date, factor }) => date !== splitDate || factor !== 20) ||
      (history.dates[0] < splitDate && history.asOf >= splitDate && !marketSplits.length)) return [];
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
    const normalizedClose = close / splitFactor(ticker, date);
    return [{ date, quarter: active.ttm_quarter, close: normalizedClose, adjustedEps,
      reportedEps: active.reported_ttm_eps,
      pe: adjustedEps != null && adjustedEps > 0 ? normalizedClose / adjustedEps : null }];
  });
}, ["adjusted-pe-stored-eps"], { revalidate: 300 });
