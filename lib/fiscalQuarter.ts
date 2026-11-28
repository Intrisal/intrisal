export const DAY_MS = 86_400_000;

/** Compare the latest trailing 12 months with the same reporting period a year earlier. */
export function trailingGrowth(values: number[], dates: string[] = []) {
  if (!dates.length || dates.length !== values.length) return null;
  const end = Date.parse(dates[dates.length - 1]);
  const prior = dates.findIndex(date => Math.abs((end - Date.parse(date)) / DAY_MS - 365.25) <= 16);
  if (prior < 0 || values[prior] <= 0) return null;
  const growth = (values[values.length - 1] / values[prior] - 1) * 100;
  return Number.isFinite(growth) ? growth : null;
}

// Covers 16- and 17-week fiscal fourth quarters, including 53-week years.
export function isFiscalQuarterGap(days: number) {
  return Number.isFinite(days) && days >= 70 && days <= 120;
}
