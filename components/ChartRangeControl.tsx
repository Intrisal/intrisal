import type { CSSProperties } from "react";
import { DAY_MS } from "@/lib/fiscalQuarter";

export const RANGE_MONTHS = { "3M": 3, "6M": 6, "1Y": 12, "5Y": 60, "10Y": 120 };
export type Range = keyof typeof RANGE_MONTHS;
export type ChartRange = Range | "MAX";
export const RANGE_OPTIONS = Object.keys(RANGE_MONTHS) as Range[];

export function monthsBefore(date: Date, months: number) {
  const target = new Date(date);
  target.setUTCDate(1);
  target.setUTCMonth(target.getUTCMonth() - months);
  const end = new Date(target);
  end.setUTCMonth(end.getUTCMonth() + 1, 0);
  target.setUTCDate(Math.min(date.getUTCDate(), end.getUTCDate()));
  return target;
}

export function availableChartRanges<T extends string | number>(
  dates: readonly string[], presets: readonly T[], months: (preset: T) => number,
  toleranceDays = 4, earlyDays = 0,
) {
  const ranges: { range: T | "MAX"; start: number }[] = [];
  if (dates.length < 2) return ranges;

  const first = Date.parse(dates[0]);
  const last = new Date(dates.at(-1)! + "T00:00:00Z");
  for (const preset of presets) {
    const cutoff = monthsBefore(last, months(preset)).getTime();
    if (first > cutoff + toleranceDays * DAY_MS) continue;
    const start = dates.findIndex((date) => Date.parse(date) >= cutoff - earlyDays * DAY_MS);
    if (start >= 0 && dates.length - start >= 2) ranges.push({ range: preset, start });
  }

  // MAX is useful only when it adds points beyond the longest preset.
  if (ranges.at(-1)?.start !== 0) ranges.push({ range: "MAX", start: 0 });
  return ranges;
}

export function ChartRangeControl<T extends ChartRange>({ range, options, onChange, label = "Chart range" }: {
  range: T;
  options: readonly T[];
  onChange: (range: T) => void;
  label?: string;
}) {
  return (
    <div className="stock-ranges" role="group" aria-label={label}
      style={{ "--range-index": options.indexOf(range) } as CSSProperties}>
      {options.map((item) => (
        <button type="button" key={item} aria-pressed={item === range}
          onClick={() => { if (item !== range) onChange(item); }}>
          {item}
        </button>
      ))}
    </div>
  );
}
