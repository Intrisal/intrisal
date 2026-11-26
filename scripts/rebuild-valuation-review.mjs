import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Run from the repository root with Node 24+.
if (existsSync(".env.local")) process.loadEnvFile(".env.local");
registerHooks({
  resolve(specifier, context, next) {
    const target = specifier.startsWith("@/")
      ? pathToFileURL(resolve(specifier.slice(2) + ".ts")).href
      : specifier;
    return next(target, context);
  },
});

const { readPrices, saveValuationReview, valuationReviewTickers } = await import("../lib/stockStore.ts");
const { canReviewValuation, prepareValuationReview } = await import("../lib/valuationReview.ts");
const snapshots = (await valuationReviewTickers())
  .filter(({ ticker, edgar_snapshot }) => canReviewValuation(ticker, edgar_snapshot));
let pointsWritten = 0;
let withPoints = 0;
const failed = [];

for (let offset = 0; offset < snapshots.length; offset += 6) {
  await Promise.all(snapshots.slice(offset, offset + 6).map(async ({ ticker, edgar_snapshot }) => {
    try {
      const points = prepareValuationReview(ticker, edgar_snapshot).history(await readPrices(ticker));
      await saveValuationReview(ticker, points);
      pointsWritten += points.length;
      if (points.length) withPoints += 1;
    } catch (error) {
      failed.push(ticker);
      console.error(ticker, error instanceof Error ? error.message : error);
    }
  }));
}

console.log(JSON.stringify({ eligible: snapshots.length, withPoints, pointsWritten, failed }));
if (failed.length) process.exitCode = 1;
