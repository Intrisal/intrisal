import { mkdir, writeFile } from "node:fs/promises";
import { fredHistoryUrl, fredSeries, parseFredHistory } from "../lib/fredExchangeRates.mjs";

const start = "2000-01-01";
const dayMs = 86_400_000;
const history = {};
for (const [currency, [series]] of Object.entries(fredSeries)) {
  const response = await fetch(fredHistoryUrl(series, start), { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(currency + " HTTP " + response.status);
  const rows = parseFredHistory(await response.text(), series);
  if (rows.length < 5_000) throw new Error("Incomplete historical exchange-rate series for " + currency);
  const firstDay = Date.parse(start);
  const rates = Array((Date.parse(rows.at(-1)[0]) - firstDay) / dayMs + 1).fill(null);
  for (const [date, value] of rows) rates[(Date.parse(date) - firstDay) / dayMs] = value;
  history[currency] = rates;
  console.log(currency, rows.length, rows.at(-1)[0]);
}
await mkdir(new URL("../data/", import.meta.url), { recursive: true });
await writeFile(new URL("../data/fundamentals-fx.json", import.meta.url), JSON.stringify({ start, history }) + "\n");
