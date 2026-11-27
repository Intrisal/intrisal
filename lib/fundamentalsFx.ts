import type { EdgarFundamentals, QuarterlySeries } from "@/lib/edgar";
import { DAY_MS, isFiscalQuarterGap } from "@/lib/fiscalQuarter";
import { fredHistoryUrl, fredSeries, parseFredHistory } from "@/lib/fredExchangeRates.mjs";
import exchangeRates from "@/data/fundamentals-fx.json";
import tsmAdrEps from "@/data/tsm-adr-eps.json";

type RateHistory = (number | null)[];
const rateHistory: Partial<Record<string, RateHistory>> = exchangeRates.history;
const reportedTsmEps: Partial<Record<string, { usd: number; twd: number }>> = tsmAdrEps;
const origin = Date.parse(exchangeRates.start) / DAY_MS;

function priorPeriodEnd(end: number, months: number) {
  const date = new Date(end * DAY_MS);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const priorLastDay = new Date(Date.UTC(year, month - months + 1, 0)).getUTCDate();
  return Date.UTC(year, month - months, day === lastDay ? priorLastDay : Math.min(day, priorLastDay)) / DAY_MS;
}

function dayNumber(date: string) {
  return Date.parse(date) / DAY_MS;
}

async function withRecentRates(rates: RateHistory, series: string, through: number) {
  const start = origin + rates.length;
  if (through < start) return rates;
  const date = new Date(start * DAY_MS).toISOString().slice(0, 10);
  try {
    const response = await fetch(fredHistoryUrl(series, date), {
      next: { revalidate: 86_400 }, signal: AbortSignal.timeout(4_000),
    });
    if (!response.ok) return rates;
    const updated = rates.slice();
    for (const [end, rate] of parseFredHistory(await response.text(), series)) {
      const index = dayNumber(end) - origin;
      if (index >= rates.length) updated[index] = rate;
    }
    return updated;
  } catch {
    return rates;
  }
}

export async function translateFundamentalsToUsd(
  edgar: EdgarFundamentals, eps: QuarterlySeries | null, epsIsTrailing: boolean,
) {
  const currency = edgar.reportingCurrency;
  if (!currency || currency === "USD") return null;
  const stored = rateHistory[currency];
  const source = fredSeries[currency];
  if (!source || !stored) return null;

  const metrics = { revenue: edgar.revenue, operatingIncome: edgar.operatingIncome, fcf: edgar.freeCashFlow };
  const ends = [...new Set([
    ...Object.values(metrics).flatMap((series) => series.ends), ...(eps?.ends ?? []),
  ])].map(dayNumber).filter(Number.isFinite).sort((a, b) => a - b);
  if (!ends.length) return null;
  const rates = await withRecentRates(stored, source[0], ends.at(-1)!);
  const previousEnd = new Map(ends.map((end, index) => [end, ends[index - 1]]));
  const averages = new Map<number, number | null>();

  function usdPerLocal(end: number, months = 3) {
    const previous = previousEnd.get(end);
    const start = (months === 3 && previous != null && isFiscalQuarterGap(end - previous)
      ? previous : priorPeriodEnd(end, months)) + 1;
    if (months === 3 && averages.has(end)) return averages.get(end) ?? null;
    let sum = 0;
    let count = 0;
    let first = 0;
    let last = 0;
    for (let day = start; day <= end; day++) {
      const rate = rates[day - origin];
      if (rate == null) continue;
      if (!count) first = day;
      last = day;
      sum += source[1] ? rate : 1 / rate;
      count++;
    }
    const rate = count >= (end - start + 1) / 2 && first - start <= 7 && end - last <= 7 ? sum / count : null;
    if (months === 3) averages.set(end, rate);
    return rate;
  }

  function translate(series: QuarterlySeries, convert: (value: number, end: string) => number | null) {
    const result: QuarterlySeries = { ends: [], values: [] };
    series.ends.forEach((end, index) => {
      const value = convert(series.values[index], end);
      if (value == null || !Number.isFinite(value)) return;
      result.ends.push(end);
      result.values.push(value);
    });
    return result;
  }

  const flow = (value: number, end: string) => {
    const rate = usdPerLocal(dayNumber(end));
    return rate == null ? null : value * rate;
  };
  const tsm = edgar.ticker === "TSM" && currency === "TWD";
  const estimatedEps = new Set<string>();
  const usdEps = eps ? translate(eps, (value, end) => {
    const reported = tsm ? reportedTsmEps[end] : undefined;
    if (reported && Math.abs(reported.twd - value) < 0.005) return reported.usd;
    const rate = usdPerLocal(dayNumber(end), epsIsTrailing ? 12 : 3);
    if (rate == null) return null;
    estimatedEps.add(end);
    return value * rate * (tsm ? 5 : 1);
  }) : { ends: [], values: [] };

  return {
    revenue: translate(metrics.revenue, flow), operatingIncome: translate(metrics.operatingIncome, flow),
    fcf: translate(metrics.fcf, flow), eps: usdEps, estimatedEps, epsPerAdr: tsm,
  };
}
