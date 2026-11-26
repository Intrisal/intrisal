export const DAY_MS = 86_400_000;

// Covers 16- and 17-week fiscal fourth quarters, including 53-week years.
export function isFiscalQuarterGap(days: number) {
  return Number.isFinite(days) && days >= 70 && days <= 120;
}
