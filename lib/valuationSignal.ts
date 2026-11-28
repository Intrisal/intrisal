/** Blended valuation signal from EV/NOPAT and adjusted P/E gaps vs their medians. */

export const VALUATION_FAIR_BAND = 10;

function monthsBefore(date: Date, months: number) {
  const target = new Date(date);
  target.setUTCDate(1);
  target.setUTCMonth(target.getUTCMonth() - months);
  const end = new Date(target);
  end.setUTCMonth(end.getUTCMonth() + 1, 0);
  target.setUTCDate(Math.min(date.getUTCDate(), end.getUTCDate()));
  return target;
}
export const EV_NOPAT_GAP_WEIGHT = 0.7;
export const ADJUSTED_PE_GAP_WEIGHT = 0.3;
export const DEFAULT_SIGNAL_MEDIAN_YEARS = 5;

export type ValuationOverallSide = "below" | "fair" | "above";
export type ValuationOverallLabel = "Undervalued" | "Fair Value" | "Overvalued";

export const VALUATION_OVERALL_STATUS: Record<ValuationOverallSide, ValuationOverallLabel> = {
  below: "Undervalued",
  fair: "Fair Value",
  above: "Overvalued",
};

export function medianOf(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const midpoint = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[midpoint - 1]! + sorted[midpoint]!) / 2
    : sorted[midpoint]!;
}

/** Percent gap of current multiple vs a median sample (same math as valuation badges). */
export function multipleGapPercent(current: number, median: number) {
  return (current / median - 1) * 100;
}

/**
 * Gap of the latest multiple vs the median of points in the trailing window.
 * `inclusiveStart` matches adjusted P/E (≥ start); EV/NOPAT quarterly uses exclusive start.
 */
export function gapVsMedianWindow(
  current: number | null | undefined,
  series: { date: string; value: number | null | undefined }[],
  years = DEFAULT_SIGNAL_MEDIAN_YEARS,
  inclusiveStart = true,
) {
  if (current == null || !Number.isFinite(current) || current <= 0 || series.length < 2) return null;
  const end = Date.parse(series.at(-1)!.date);
  if (!Number.isFinite(end)) return null;
  const start = monthsBefore(new Date(end), years * 12).getTime();
  const sample = series.flatMap(({ date, value }) => {
    const time = Date.parse(date);
    if (!Number.isFinite(time) || !Number.isFinite(value as number) || (value as number) <= 0) return [];
    if (inclusiveStart ? time < start : time <= start) return [];
    return [value as number];
  });
  const median = medianOf(sample);
  if (median == null || median <= 0) return null;
  return multipleGapPercent(current, median);
}

/**
 * Weighted gap: 70% EV/NOPAT badge gap + 30% adjusted P/E badge gap.
 * Same ±10 inclusive Fair Value band as the per-chart signals.
 */
export function overallValuationGap(evNopatGap: number, adjustedPeGap: number) {
  const gap = EV_NOPAT_GAP_WEIGHT * evNopatGap + ADJUSTED_PE_GAP_WEIGHT * adjustedPeGap;
  const comparisonPercent = Number(gap.toFixed(10));
  const side: ValuationOverallSide = comparisonPercent < -VALUATION_FAIR_BAND ? "below"
    : comparisonPercent > VALUATION_FAIR_BAND ? "above" : "fair";
  return { gap, side, label: VALUATION_OVERALL_STATUS[side] };
}

/** Combine optional gaps; returns null when either side is missing. */
export function overallValuationSide(evNopatGap: number | null, adjustedPeGap: number | null): ValuationOverallSide | null {
  if (evNopatGap == null || adjustedPeGap == null) return null;
  if (!Number.isFinite(evNopatGap) || !Number.isFinite(adjustedPeGap)) return null;
  return overallValuationGap(evNopatGap, adjustedPeGap).side;
}

/**
 * Same blended signal as the Valuation tab overall banner:
 * EV/NOPAT gap vs quarterly median (exclusive window start) + adjusted P/E gap vs daily median.
 */
export function overallValuationFromSeries(opts: {
  evCurrent: number | null | undefined;
  evQuarters: { date: string; value: number | null | undefined }[];
  peDays: { date: string; pe: number | null | undefined }[];
  years?: number;
}) {
  const years = opts.years ?? DEFAULT_SIGNAL_MEDIAN_YEARS;
  const evGap = gapVsMedianWindow(opts.evCurrent, opts.evQuarters, years, false);
  const peGap = gapVsMedianWindow(
    opts.peDays.at(-1)?.pe,
    opts.peDays.map(({ date, pe }) => ({ date, value: pe })),
    years,
    true,
  );
  if (evGap == null || peGap == null) return null;
  return overallValuationGap(evGap, peGap);
}
