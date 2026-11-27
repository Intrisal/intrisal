import { mkdir, writeFile } from "node:fs/promises";

const cik = "0001046179";
const headers = { "User-Agent": process.env.SEC_USER_AGENT?.trim() || "Intrisal contact@intrisal.com" };
let nextRequest = 0;

async function get(url) {
  const now = Date.now();
  const start = Math.max(now, nextRequest);
  nextRequest = start + 300;
  if (start > now) await new Promise((resolve) => setTimeout(resolve, start - now));
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error("SEC " + response.status + " for " + url);
  return response;
}

const releases = new Map();
for (const [startdt, enddt] of [["2011-01-01", "2022-12-31"], ["2023-01-01", new Date().toISOString().slice(0, 10)]]) {
  const params = new URLSearchParams({ q: '"TSMC Reports"', dateRange: "custom", startdt, enddt, ciks: cik, forms: "6-K" });
  const result = await (await get("https://efts.sec.gov/LATEST/search-index?" + params)).json();
  for (const filing of result.hits.hits) {
    const [accession, document] = filing._id.split(":");
    if (!/^\d{10}-\d{2}-\d{6}$/.test(accession) || !/^[\w.-]+\.html?$/i.test(document)) continue;
    const url = "https://www.sec.gov/Archives/edgar/data/1046179/" + accession.replaceAll("-", "") + "/" + document;
    releases.set(url, filing._source.file_date);
  }
}

const observations = {};
const quarterEnds = { first: "03-31", second: "06-30", third: "09-30", fourth: "12-31" };
const documents = [...releases];
let nextDocument = 0;
await Promise.all(Array.from({length: 4}, async () => {
  while (nextDocument < documents.length) {
    const [url, filed] = documents[nextDocument++];
    const html = await (await get(url)).text();
    const content = html.replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;|&#819[5-9];/gi, " ").replace(/\s+/g, " ");
    const heading = content.match(/TSMC Reports (First|Second|Third|Fourth) Quarter EPS of NT\$\s*([\d.]+)/i);
    const value = content.match(/diluted (?:earnings per share|EPS) (?:of|was) NT\$\s*([\d.]+)\s*\(US\$\s*([\d.]+) per ADR unit\)/i);
    if (!heading || !value || Number(heading[2]) !== Number(value[1])) continue;
    const quarter = quarterEnds[heading[1].toLowerCase()];
    const year = Number(filed.slice(0, 4)) - Number(quarter === "12-31");
    const end = year + "-" + quarter;
    const usd = Number(value[2]);
    if (observations[end] && observations[end].usd !== usd) throw new Error("Conflicting TSMC ADR EPS for " + end);
    observations[end] = { usd, twd: Number(value[1]), source: url };
  }
}));

const history = Object.fromEntries(Object.entries(observations).sort(([a], [b]) => a.localeCompare(b)));
if (Object.keys(history).length < 50) throw new Error("Incomplete TSMC ADR EPS history");
await mkdir(new URL("../data/", import.meta.url), { recursive: true });
await writeFile(new URL("../data/tsm-adr-eps.json", import.meta.url), JSON.stringify(history, null, 2) + "\n");
console.log("Verified TSMC ADR EPS observations:", Object.keys(history).length, Object.keys(history).at(-1));
