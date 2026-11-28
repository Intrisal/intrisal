const NICE_STEP_MULTIPLIERS = [1, 2, 2.5, 5, 10];

/** Fit the chart domain to round, evenly spaced ticks. */
export function fittedChartAxis(low: number, high: number, maxIntervals = 6) {
  const floorHigh = Math.max(high, low, 1e-6);
  const floorLow = Math.min(low, floorHigh);
  const span = Math.max(floorHigh - floorLow, floorHigh * 0.04, 1e-6);
  // Long-horizon charts that start near $0 should keep a true zero baseline.
  const baseline = floorLow > 0 && floorLow <= span * 0.12 ? 0 : floorLow;

  let best: { min: number; max: number; step: number; score: number } | null = null;
  for (const tickCount of [3, 4, 5]) {
    const rough = (floorHigh - baseline) / tickCount;
    const magnitude = 10 ** Math.floor(Math.log10(Math.max(rough, 1e-9)));
    for (const factor of [-1, 0, 1]) {
      const base = magnitude * 10 ** factor;
      for (const mult of NICE_STEP_MULTIPLIERS) {
        const step = mult * base;
        if (step <= 0) continue;
        const min = baseline === 0 ? 0 : Math.floor(baseline / step) * step;
        let max = Math.ceil(floorHigh / step) * step;
        // Keep a hair of headroom when the series lands exactly on a grid line.
        if (max <= floorHigh) max += step;
        if (max <= min) continue;
        const ticks = Math.round((max - min) / step);
        if (ticks < 3 || ticks > maxIntervals) continue;
        const waste = (max - floorHigh) / (max - min);
        const score = waste * 12 + Math.abs(ticks - 4) * 0.1;
        if (!best || score < best.score) best = { min, max, step, score };
      }
    }
  }

  if (best) return { min: best.min, max: best.max, step: best.step };

  const fallbackStep = Math.max(1, 10 ** Math.floor(Math.log10(span)));
  const min = baseline === 0 ? 0 : Math.floor(baseline / fallbackStep) * fallbackStep;
  let max = Math.ceil(floorHigh / fallbackStep) * fallbackStep;
  if (max <= floorHigh) max += fallbackStep;
  return { min, max, step: fallbackStep };
}
