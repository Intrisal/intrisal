"use client";

import { fmt } from "@/lib/market";
import { overallValuationGap } from "@/lib/valuationSignal";

export function ValuationOverallSignal({
  evGap,
  peGap,
}: {
  evGap: number | null;
  peGap: number | null;
}) {
  if (evGap == null || peGap == null || !Number.isFinite(evGap) || !Number.isFinite(peGap)) return null;

  const { gap, side, label } = overallValuationGap(evGap, peGap);
  const glow = side !== "fair";

  return (
    <div className="valuation-overall" data-side={side} role="status" aria-live="polite">
      <p className="valuation-overall-kicker">Overall valuation</p>
      <div className="valuation-overall-row">
        {glow ? (
          <span className="valuation-overall-label stock-status-glow">
            {label}
            <span className="stock-status-shimmer" aria-hidden="true">{label}</span>
          </span>
        ) : (
          <span className="valuation-overall-label">{label}</span>
        )}
        <span className="valuation-badge valuation-overall-badge">
          {gap > 0 ? "+" : ""}
          {fmt(gap, 1)}%
        </span>
      </div>
    </div>
  );
}
