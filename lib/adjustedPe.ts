import { unstable_cache } from "next/cache";
import { listFinancialFilings, loadCompanyFacts, type FactPoint } from "@/lib/edgar";
import { DAY_MS, isFiscalQuarterGap } from "@/lib/fiscalQuarter";
import { readPrices } from "@/lib/stockStore";
import { priceSplits } from "@/lib/valuationReview";

// Both issuers filed 20-for-1 splits. Use their first split-adjusted trading dates.
const ISSUERS: Record<string, { cik: number; splitDate: string }> = {
  AMZN: { cik: 1018724, splitDate: "2022-06-06" },
  GOOG: { cik: 1652044, splitDate: "2022-07-18" },
};
const FALLBACK_TAX_RATE = 0.21;

export type AdjustedPeDay = {
  date: string;
  quarter: string;
  close: number;
  adjustedEps: number | null;
  reportedEps: number | null;
  pe: number | null;
};

export const loadAdjustedPe = unstable_cache(async (ticker: string): Promise<AdjustedPeDay[]> => {
  const issuer = ISSUERS[ticker];
  if (!issuer) return [];
  const { cik, splitDate } = issuer;
  const [history, facts] = await Promise.all([readPrices(ticker), loadCompanyFacts(cik)]);
  if (!history) return [];

  const year = Number(history.asOf.slice(0, 4));
  const cutoff = new Date(history.asOf);
  cutoff.setUTCFullYear(year - 10);
  const startDate = cutoff.toISOString().slice(0, 10);
  const filings = await listFinancialFilings(cik, `${year - 12}-01-01`);
  const gaap = facts.facts?.["us-gaap"];
  const eps = gaap?.EarningsPerShareDiluted?.units?.["USD/shares"] ?? [];
  const shares = gaap?.WeightedAverageNumberOfDilutedSharesOutstanding?.units?.shares ?? [];
  const gains = gaap?.EquitySecuritiesFvNiGainLoss?.units?.USD ?? [];
  const marketable = gaap?.MarketableSecuritiesUnrealizedGainLoss?.units?.USD ?? [];
  const privateEquity = gaap?.EquitySecuritiesWithoutReadilyDeterminableFairValueUpwardPriceAdjustmentAnnualAmount?.units?.USD ?? [];
  const netIncome = gaap?.NetIncomeLoss?.units?.USD ?? [];
  const taxes = gaap?.IncomeTaxExpenseBenefit?.units?.USD ?? [];
  const pretax = gaap?.IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest?.units?.USD ?? [];
  const marketSplits = priceSplits(history);
  if (marketSplits.some(({ date, factor }) => date !== splitDate || factor !== 20) ||
      (history.dates[0] < splitDate && history.asOf >= splitDate && !marketSplits.length)) return [];
  const splitFactorFor = (date: string) => history.asOf >= splitDate && date < splitDate ? 20 : 1;

  const byPeriod = new Map<string, {
    quarter: string; filed: string; adjustedEps: number | null; reportedEps: number | null;
    annualAdjustedEps?: number | null; annualReportedEps?: number | null;
  }>();
  const day = (value: string) => Date.parse(value) / DAY_MS;
  const duration = ({ start, end }: FactPoint) => start ? day(end) - day(start) + 1 : 0;
  const annual = (point: FactPoint) => duration(point) >= 350 && duration(point) <= 380;
  const disclosures = filings.filter(({ filed }) => filed && filed <= history.asOf)
    .sort((a, b) => a.date.localeCompare(b.date) || a.filed!.localeCompare(b.filed!));
  const fact = (points: FactPoint[], accn: string, start: string, end: string) =>
    points.find((point) => point.accn === accn && point.end === end && point.start === start && Number.isFinite(point.val))?.val;
  function disclosedGains(accn: string, start: string, end: string) {
    if (ticker === "AMZN" && end >= "2021-01-01") {
      // Amazon's other-income table separates marketable securities and private equity adjustments.
      const publicGain = fact(marketable, accn, start, end);
      const privateGain = fact(privateEquity, accn, start, end);
      return publicGain != null && privateGain != null ? publicGain + privateGain : undefined;
    }
    return fact(gains, accn, start, end);
  }

  for (const { accession, date: quarter, filed } of disclosures) {
    if (!filed || byPeriod.has(quarter)) continue;
    const filingEps = eps.filter((point) => point.accn === accession && point.end === quarter && Number.isFinite(point.val));
    const reported = filingEps.find((point) => isFiscalQuarterGap(duration(point))) ?? filingEps.find(annual);
    if (!reported?.start) {
      byPeriod.set(quarter, { quarter, filed, adjustedEps: null, reportedEps: null });
      continue;
    }
    const samePeriod = (points: FactPoint[]) => fact(points, accession, reported.start!, quarter);
    const earnings = samePeriod(netIncome);
    // Before Alphabet began publishing consolidated diluted shares in Company Facts,
    // infer the denominator from consolidated income and reported diluted EPS.
    const dilutedShares = samePeriod(shares) ?? (ticker === "GOOG" && earnings != null && earnings > 0 && reported.val > 0
      ? earnings / reported.val : undefined);
    let netGains = disclosedGains(accession, reported.start, quarter);
    const fiscalYearEps = filingEps.find(annual);
    if (netGains == null && !annual(reported) && fiscalYearEps?.start) {
      const fiscalStart = fiscalYearEps.start;
      const priorFiling = disclosures.findLast(({ date, filed: priorFiled }) =>
        date >= fiscalStart && day(quarter) - day(date) >= 70 && day(quarter) - day(date) <= 120 &&
        priorFiled != null && priorFiled <= filed);
      const yearGains = disclosedGains(accession, fiscalStart, quarter);
      const nineMonthGains = priorFiling ? disclosedGains(priorFiling.accession, fiscalStart, priorFiling.date) : undefined;
      if (yearGains != null && nineMonthGains != null) netGains = yearGains - nineMonthGains;
    }
    const pretaxIncome = samePeriod(pretax);
    const taxExpense = samePeriod(taxes);
    const effectiveRate = pretaxIncome != null && pretaxIncome > 0 && taxExpense != null ? taxExpense / pretaxIncome : NaN;
    const taxRate = effectiveRate >= 0 && effectiveRate <= 1 ? effectiveRate : FALLBACK_TAX_RATE;
    const splitFactor = splitFactorFor(filed);
    let reportedEps: number | null = reported.val / splitFactor;
    let adjustedEps = reportedEps != null && dilutedShares != null && dilutedShares > 0 && netGains != null
      ? reportedEps - netGains * (1 - taxRate) / dilutedShares / splitFactor : null;

    // When Q4 EPS is absent, reconcile the annual figures with the three previously filed quarters.
    const annualReportedEps = annual(reported) ? reportedEps : undefined;
    const annualAdjustedEps = annual(reported) ? adjustedEps : undefined;
    if (annual(reported)) {
      const prior = [...byPeriod.values()].filter(({ quarter: end }) => end >= reported.start! && end < quarter);
      reportedEps = prior.length === 3 && prior.every((item) => item.reportedEps != null) && reportedEps != null
        ? reportedEps - prior.reduce((sum, item) => sum + item.reportedEps!, 0) : null;
      adjustedEps = prior.length === 3 && prior.every((item) => item.adjustedEps != null) && adjustedEps != null
        ? adjustedEps - prior.reduce((sum, item) => sum + item.adjustedEps!, 0) : null;
    }
    byPeriod.set(quarter, { quarter, filed, adjustedEps, reportedEps, annualAdjustedEps, annualReportedEps });
  }

  const periods = [...byPeriod.values()].map((period, index, all) => {
    const window = all.slice(Math.max(0, index - 3), index + 1);
    const complete = window.length === 4 && window.slice(1).every(({ quarter }, offset) =>
      isFiscalQuarterGap(day(quarter) - day(window[offset].quarter)));
    const total = (key: "adjustedEps" | "reportedEps") => complete && window.every((item) => item[key] != null)
      ? window.reduce((sum, item) => sum + item[key]!, 0) : null;
    return { ...period,
      filed: window.reduce((latest, item) => item.filed > latest ? item.filed : latest, period.filed),
      adjustedEps: period.annualAdjustedEps ?? total("adjustedEps"),
      reportedEps: period.annualReportedEps ?? total("reportedEps"),
    };
  }).sort((a, b) => a.filed.localeCompare(b.filed));

  let active: typeof periods[number] | undefined;
  let next = 0;
  return history.dates.flatMap((date, index) => {
    if (date < startDate) return [];
    while (periods[next] && periods[next].filed < date) {
      const disclosed = periods[next++];
      if (!active || disclosed.quarter >= active.quarter) active = disclosed;
    }
    const close = history.rawCloses?.[index];
    if (!active || close == null || !Number.isFinite(close) || close <= 0) return [];
    const fresh = day(date) - day(active.filed) <= 185;
    const adjustedEps = fresh ? active.adjustedEps : null;
    const normalizedClose = close / splitFactorFor(date);
    return [{ date, quarter: active.quarter, close: normalizedClose, adjustedEps, reportedEps: active.reportedEps,
      pe: adjustedEps != null && adjustedEps > 0 ? normalizedClose / adjustedEps : null }];
  });
}, ["adjusted-pe-equity-investments"], { revalidate: 3600 });
