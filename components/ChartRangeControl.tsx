import type { CSSProperties } from "react";

export const RANGE_MONTHS = { "3M": 3, "6M": 6, "1Y": 12, "5Y": 60, "10Y": 120 };
export type Range = keyof typeof RANGE_MONTHS;
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

export function ChartRangeControl({ range, onChange, label = "Chart range", unavailable = [] }: {
  range: Range;
  onChange: (range: Range) => void;
  label?: string;
  unavailable?: Range[];
}) {
  return (
    <div className="stock-ranges" role="group" aria-label={label}
      style={{ "--range-index": RANGE_OPTIONS.indexOf(range) } as CSSProperties}>
      {RANGE_OPTIONS.map((item) => (
        <button type="button" key={item} aria-pressed={item === range}
          disabled={unavailable.includes(item)}
          onClick={() => { if (item !== range) onChange(item); }}>
          {item}
        </button>
      ))}
    </div>
  );
}
