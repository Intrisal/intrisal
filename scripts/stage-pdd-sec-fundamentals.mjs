import { readdir, readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";

const directory = process.argv[2] ?? ".cache/edgar-backfill";
const releases = (await readdir(directory)).filter((file) => /^pdd-release-.*\.html$/.test(file)).sort();
const quarterEnds = { first: "03-31", second: "06-30", third: "09-30", fourth: "12-31" };
const quarters = {};

function clean(html) {
  return html.replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;|&#8239;/gi, " ").replace(/\s+/g, " ").trim();
}

function values(row) {
  return row.slice(1).flatMap((cell) => {
    if (/^(?:[-–—]|&#15[01];|&mdash;|&ndash;)$/.test(cell)) return [0];
    const value = cell.replace(/[,\s$)]/g, "").replace(/^\(/, "-");
    return /^-?\d+(?:\.\d+)?$/.test(value) ? [Number(value)] : [];
  });
}

for (const file of releases) {
  const html = await readFile(directory + "/" + file, "utf8");
  const text = clean(html);
  const heading = text.match(/(?:PDD Holdings|Pinduoduo) Announces (First|Second|Third|Fourth) Quarter (?:20\d{2}|and Fiscal Year)/i);
  if (!heading) continue;
  const end = quarterEnds[heading[1].toLowerCase()];
  const date = (Number(file.slice(12, 16)) - Number(end === "12-31")) + "-" + end;
  const units = text.match(/CONSOLIDATED STATEMENTS OF (?:INCOME|LOSS|OPERATIONS)(?:\/\s*\(LOSS\))?\s*\(Amounts in (millions|thousands)(?: of)? RMB/i);
  if (!units) continue;
  const divisor = units[1].toLowerCase() === "millions" ? 1_000 : 1_000_000;
  const rows = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((row) =>
    [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) => clean(cell[1])).filter(Boolean));
  const row = (label) => rows.find((entry) => label.test(entry[0]) && values(entry).length >= 3);
  const ordinaryStart = rows.findIndex((entry) => / per ordinary share\s*:\s*$/i.test(entry[0]));
  const adsStart = rows.findIndex((entry, index) => index > ordinaryStart && / per ADS \(4 (?:Class A )?ordinary shares? equals? 1 ADS/i.test(entry[0]));
  if (adsStart < 0) continue;
  const diluted = (i) => rows.slice(i + 1, i + 5).find((entry) => /^(?:-|&#15[01];|&mdash;|&ndash;)\s*(?:basic and )?diluted$/i.test(entry[0]));
  const ordinary = ordinaryStart >= 0 ? diluted(ordinaryStart) : undefined;
  const ads = diluted(adsStart);
  const revenue = row(/^(?:total )?revenues$/i);
  const operating = row(/^operating (?:profit|loss|income|profit\s*\/?\s*\(loss\)|\(loss\)\s*\/\s*profit)$/i);
  const pretax = row(/^(?:profit|income|loss|profit \(loss\)|loss \(profit\)) before income tax/i);
  const tax = row(/^income tax (?:expenses?|benefits?)$/i);
  if (!revenue || !operating || !ads) continue;
  const current = (entry) => entry ? values(entry)[1] : undefined;
  const eps = current(ordinary) ?? current(ads) / 4;
  assert.ok(Math.abs(eps * 4 - current(ads)) <= 0.031, date + " ADS reconciliation");
  const data = {
    revenue: current(revenue) / divisor, operating_income: current(operating) / divisor, diluted_eps: eps,
    pretax: pretax ? current(pretax) / divisor : null, tax: tax ? -current(tax) / divisor : null,
    filing: file.slice(23, -5),
  };
  assert.ok(Number.isFinite(data.revenue) && data.revenue > 0 && Number.isFinite(data.operating_income), date);
  if (quarters[date]) assert.equal(quarters[date].diluted_eps, eps, date + " duplicate EPS");
  quarters[date] = data;
  if (date === "2023-09-30" && !quarters["2022-09-30"] && ordinary) {
    // The comparative column in the 2023 third-quarter release supplies this quarter.
    assert.ok(Math.abs(values(ordinary)[0] * 4 - values(ads)[0]) <= 0.031);
    quarters["2022-09-30"] = {
      revenue: values(revenue)[0] / divisor, operating_income: values(operating)[0] / divisor,
      diluted_eps: values(ordinary)[0], pretax: pretax ? values(pretax)[0] / divisor : null,
      tax: tax ? -values(tax)[0] / divisor : null, filing: data.filing,
    };
  }
}

assert.equal(quarters["2026-09-30"].revenue, 108.341);
assert.equal(quarters["2026-09-30"].operating_income, 31.164);
assert.equal(quarters["2026-09-30"].diluted_eps, 5.01);
const dates = Object.keys(quarters).sort();
await writeFile(directory + "/pdd-staged.json", JSON.stringify(quarters));
console.log(JSON.stringify({ count: dates.length, first: dates.at(0), last: dates.at(-1), dates }));
