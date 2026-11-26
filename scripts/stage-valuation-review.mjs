import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
registerHooks({
  resolve(specifier, context, next) {
    return next(specifier.startsWith("@/")
      ? pathToFileURL(resolve(specifier.slice(2) + ".ts")).href : specifier, context);
  },
});

const { fetchEdgarFundamentals, latestFinancialFiling, listFinancialFilings, readMetaCashPoolDebt, readMetaFilingBalances, resolveCik } = await import("../lib/edgar.ts");
const { DAY_MS, isFiscalQuarterGap } = await import("../lib/fiscalQuarter.ts");
const { readPrices, readQuarterlyValuationInputs, readValuationReview, valuationAuditTickers } = await import("../lib/stockStore.ts");
const { canReviewValuation, prepareValuationReview, valuationBenchmark } = await import("../lib/valuationReview.ts");

const only = new Set(process.argv.slice(2).map((ticker) => ticker.toUpperCase()));
const candidates = (await valuationAuditTickers()).filter(({ ticker }) => !only.size || only.has(ticker));
const output = only.size ? ".cache/valuation-stage-check.json" : ".cache/valuation-stage.json";
const results = {};
const metrics = { operatingIncome: "operating_income", revenue: "revenue", tax: "tax", pretax: "pretax" };
// Verified against NVIDIA’s November 17, 2026 Form 8-K, Exhibit 99.1.
// Use in local staging until the periodic filing supplies the same quarter.
const nvidiaOctoberRelease = {
  quarter: "2026-10-25",
  url: "https://www.sec.gov/Archives/edgar/data/1045810/000104581026000088/q3fy27pr.htm",
  income: { revenue: 115.844, operatingIncome: 77.520, pretax: 79.017, tax: 13.730 },
  balance: {
    cash: 29.089, debt: 32.371, sti: (24_423 + 44_219) / 1000,
    // Reported weighted-average basic shares, used as an estimate of quarter-end shares.
    shares: 24.106, sharesEstimated: true,
  },
};

function mergeSeries(series, additions, replace = false) {
  const values = new Map(series.ends.map((date, index) => [date, series.values[index]]));
  for (const [date, number] of additions) {
    if (Number.isFinite(number) && (replace || !values.has(date))) values.set(date, number);
  }
  const ends = [...values.keys()].sort();
  return { ends, values: ends.map((date) => values.get(date)) };
}

function entries(series) {
  return series.ends.map((date, index) => [date, series.values[index]]);
}

function comparison(points, current) {
  const benchmark = valuationBenchmark(points);
  return {
    count: benchmark.length, current: current?.ev_nopat ?? null, priceAsOf: current?.priceAsOf ?? null,
    quarter: points.at(-1)?.quarter ?? null, quarterMultiple: points.at(-1)?.ev_nopat ?? null,
    average: benchmark.length ? benchmark.reduce((sum, point) => sum + point.ev_nopat, 0) / benchmark.length : null,
  };
}

async function stage({ ticker, cik, edgar_snapshot: previous, edgar_fetched_at: filingsChecked }) {
  const before = await readValuationReview(ticker);
  if (!canReviewValuation(ticker, previous) || previous.reportingCurrency === "EUR") {
    return { before: comparison(before.points, before.current), reason: previous ? "ineligible filing or currency" : "no stored filings" };
  }

  const [rows, history] = await Promise.all([readQuarterlyValuationInputs(ticker), readPrices(ticker)]);
  const snapshot = structuredClone(previous);
  const checks = [];
  const reconciled = {};
  const compatible = rows.filter((row) => (row.reporting_currency ?? "USD") === (snapshot.reportingCurrency ?? "USD"));
  for (const [metric, column] of Object.entries(metrics)) {
    const size = snapshot[metric].ends.length;
    snapshot[metric] = mergeSeries(snapshot[metric], compatible.map((row) => [row.quarter, row[column]]));
    const added = snapshot[metric].ends.length - size;
    if (added) reconciled[metric] = added;
  }
  for (const row of compatible) {
    const balance = snapshot.balances[row.quarter] ??= { cash: null, debt: null, shares: null };
    for (const field of ["cash", "debt", "shares", "sti"]) {
      if (balance[field] == null && row[field] != null) balance[field] = Number(row[field]);
    }
  }

  const window = valuationBenchmark(snapshot.operatingIncome.ends.map((quarter) => ({ quarter }))).map(({ quarter }) => quarter);
  const hasSti = Object.values(snapshot.balances).some(({ sti }) => sti != null);
  const pretax = new Set(snapshot.pretax.ends);
  const tax = new Set(snapshot.tax.ends);
  const missingInput = window.some((date) => {
    const balance = snapshot.balances[date];
    return balance?.cash == null || balance.debt == null || balance.shares == null ||
      (hasSti && balance.sti == null) || !pretax.has(date) || !tax.has(date);
  });
  const hasFiscalGap = window.slice(1).some((date, index) => !isFiscalQuarterGap((Date.parse(date) - Date.parse(window[index])) / DAY_MS));
  let fresh = null;
  if (ticker === "NVDA" || missingInput || hasFiscalGap || !hasSti || !window.length) {
    try {
      cik = snapshot.cik ?? cik ?? await resolveCik(ticker);
      const accession = ticker === "NVDA" && cik != null ? await latestFinancialFiling(cik) : undefined;
      fresh = await fetchEdgarFundamentals(ticker, ticker === "NVDA", cik == null ? undefined : { cik, accession });
      if (fresh && accession && fresh.operatingIncome.ends.at(-1) <= previous.operatingIncome.ends.at(-1)) {
        checks.push("Latest indexed SEC periodic filing " + accession + " did not add a newer operating quarter");
      }
    } catch (error) {
      checks.push("SEC snapshot: " + error.message);
    }
  }

  if (fresh && (fresh.reportingCurrency ?? "USD") === (snapshot.reportingCurrency ?? "USD")) {
    for (const metric of Object.keys(metrics)) {
      snapshot[metric] = mergeSeries(snapshot[metric], entries(fresh[metric]));
    }
    for (const [date, freshBalance] of Object.entries(fresh.balances)) {
      const balance = snapshot.balances[date] ??= { cash: null, debt: null, shares: null };
      for (const field of ["cash", "debt", "sti"]) {
        if (balance[field] == null && freshBalance[field] != null) balance[field] = freshBalance[field];
      }
      if (balance.shares == null && freshBalance.shares != null) {
        balance.shares = freshBalance.shares;
        balance.sharesEstimated = freshBalance.sharesEstimated === true;
      }
    }
    if (fresh.lastReportEnd && (!snapshot.lastReportEnd || fresh.lastReportEnd > snapshot.lastReportEnd)) {
      snapshot.lastReportEnd = fresh.lastReportEnd;
    }
  }

  const release = ticker === "NVDA" && snapshot.operatingIncome.ends.at(-1) === "2026-07-26"
    ? nvidiaOctoberRelease : null;
  if (release) {
    for (const [metric, value] of Object.entries(release.income)) {
      snapshot[metric] = mergeSeries(snapshot[metric], [[release.quarter, value]]);
    }
    snapshot.balances[release.quarter] = release.balance;
    snapshot.lastReportEnd = release.quarter;
    checks.push("Used unaudited October earnings release: " + release.url);
  }

  const metaSources = {};
  if (ticker === "META" && window.length) {
    try {
      const filings = await listFinancialFilings(snapshot.cik ?? cik ?? 1326801, window[0]);
      const byDate = new Map(filings.reverse().map((filing) => [filing.date, filing]));
      for (const date of window) {
        const filing = byDate.get(date);
        if (!filing) continue;
        try {
          const report = await readMetaFilingBalances(filing);
          const balance = snapshot.balances[date] ??= { cash: null, debt: null, shares: null };
          if (balance.debt == null && report.debt != null) balance.debt = report.debt;
          if (report.shares != null) balance.reportedShares = report.shares;
          else if (fresh?.balances[date]?.sharesEstimated) balance.sharesEstimated = true;
          if (report.debt != null || report.shares != null) metaSources[date] = report;
        } catch (error) {
          checks.push(date + " META filing: " + error.message);
        }
      }
      const verified2019 = metaSources["2019-12-31"];
      if (verified2019?.debt != null) {
        for (const [date, debt] of await readMetaCashPoolDebt(verified2019.debt)) {
          const balance = snapshot.balances[date];
          if (balance?.cash != null && balance.debt == null) {
            balance.debt = debt;
            metaSources[date] = { ...metaSources[date], debt, reconciliationFiling: verified2019.url };
          }
        }
      }
    } catch (error) {
      checks.push("META submissions: " + error.message);
    }
  }

  const calculator = prepareValuationReview(ticker, snapshot, history);
  const points = calculator.history();
  const current = calculator.atLatestClose();
  for (const point of [...points, current]) {
    if (release && point?.quarter === release.quarter) point.earningsRelease = true;
  }
  return {
    points, current, snapshot, checks, filingsChecked, reconciled, metaSources,
    before: comparison(before.points, before.current), after: comparison(points, current),
    quarters: calculator.quarterlyResults().map(({ quarter, reason, rate, estimatedShares }) => ({ quarter, reason, rate, estimatedShares })),
    reason: !snapshot.operatingIncome.ends.length ? "no consolidated operating income" :
      !history ? "no stored prices" : undefined,
  };
}

for (let offset = 0; offset < candidates.length; offset += 5) {
  // Fetch stored data concurrently in each small batch. The SEC client spaces its requests.
  await Promise.all(candidates.slice(offset, offset + 5).map(async (candidate) => {
    try {
      results[candidate.ticker] = await stage(candidate);
      console.log(candidate.ticker, results[candidate.ticker].before.count, "→", results[candidate.ticker].after?.count ?? 0);
    } catch (error) {
      results[candidate.ticker] = { error: error.message };
      console.error(candidate.ticker, error.message);
    }
  }));
  mkdirSync(".cache", { recursive: true });
  writeFileSync(output + ".tmp", JSON.stringify(results));
  renameSync(output + ".tmp", output);
}

const ordered = Object.entries(results).sort(([a], [b]) => a.localeCompare(b));
const failed = ordered.filter(([, result]) => result.error).map(([ticker]) => ticker);
console.log(JSON.stringify({
  output, tickers: ordered.length, failed,
  withPoints: ordered.filter(([, result]) => result.after?.count).length,
}));
if (failed.length) process.exitCode = 1;
if (only.size && existsSync(".cache/valuation-stage.json")) {
  const stagePath = ".cache/valuation-stage.json";
  const saved = JSON.parse(readFileSync(stagePath, "utf8"));
  for (const [ticker, result] of ordered) {
    if (!result.error) saved[ticker] = result;
  }
  writeFileSync(stagePath + ".tmp", JSON.stringify(saved));
  renameSync(stagePath + ".tmp", stagePath);
}
