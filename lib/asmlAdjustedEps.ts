import { ASML_CIK, listAsmlEarningsFilings, secFetch, type FinancialFiling } from "@/lib/edgar";
import { DAY_MS, isFiscalQuarterGap } from "@/lib/fiscalQuarter";
import { loadUsdFlowRates } from "@/lib/fundamentalsFx";
import { insertAdjustedEps, readAdjustedEps, type AdjustedEpsRecord } from "@/lib/stockStore";

const SEC_ORIGIN = "https://www.sec.gov";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DATE_HEADER = /three months ended,? ((?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.? \d{1,2},? ){5})((?:20\d{2} ){5})?\([^)]*(?:€|EUR)[^)]*\) ((?:20\d{2} ){5})?net system sales\b/gi;
const CELL = /^(?:\(\s*[\d,.]+\s*\)|-?[\d,.]+|[—–-])(?=\s|$)/;

function exhibitText(html: string) {
  return html.replace(/<sup\b[^>]*>[\s\S]*?<\/sup>/gi, "").replace(/<[^>]*>/g, " ").replace(/&#160;|&nbsp;/gi, " ")
    .replace(/&#8364;|&#x20ac;|&euro;/gi, "€").replace(/&#58;|&#x3a;/gi, ":")
    .replace(/&#821[12];|&#x201[34];|&[mn]dash;/gi, " — ").replace(/\s+/g, " ");
}

function rowNumbers(table: string, label: RegExp) {
  const match = label.exec(table);
  if (!match) return [];
  let rest = table.slice(match.index + match[0].length).trimStart();
  const values: number[] = [];
  for (let cell = CELL.exec(rest); cell; cell = CELL.exec(rest)) {
    const raw = cell[0];
    values.push(/^[—–-]$/.test(raw) ? 0 : Number(raw.replace(/[,\s]/g, "").replace(/^\(/, "-").replace(/\)$/, "")));
    rest = rest.slice(raw.length).trimStart();
  }
  return values.every(Number.isFinite) ? values : [];
}

function parseQuarters(html: string, filedOn: string) {
  const text = exhibitText(html);
  for (const header of text.matchAll(DATE_HEADER)) {
    const years = (header[2] ?? header[3])?.trim().split(" ");
    if (!years) continue;
    const dates = [...header[1].matchAll(/([A-Za-z]{3})[a-z]*\.? (\d{1,2})/gi)].map((match, index) => {
      const month = MONTHS.indexOf(match[1]) + 1;
      return `${years[index]}-${String(month).padStart(2, "0")}-${match[2].padStart(2, "0")}`;
    });
    const lastDate = dates.at(-1)!;
    const filingLag = (Date.parse(filedOn) - Date.parse(lastDate)) / DAY_MS;
    if (!(filingLag >= 0 && filingLag <= 60) ||
      !dates.slice(1).every((date, index) => isFiscalQuarterGap((Date.parse(date) - Date.parse(dates[index])) / DAY_MS))) continue;

    const table = text.slice(header.index + header[0].length, header.index + header[0].length + 4200);
    const operating = rowNumbers(table, /income from operations/i);
    const pretax = rowNumbers(table, /income before income taxes/i);
    const tax = rowNumbers(table, /(?:income tax (?:expense|benefit)|(?:benefit from \(provision for\)|provision for) income taxes)/i);
    const interest = rowNumbers(table, /interest and other, net/i);
    const gainLabel = /(?:gain(?: \(loss\))?|loss(?: \(gain\))?) on equity investments/i;
    const gains = rowNumbers(table, gainLabel);
    const eps = rowNumbers(table, /diluted net income per ordinary share/i);
    const netIncome = rowNumbers(table, /\bnet income (?=[(\d—–-])/i);
    const shares = rowNumbers(table, /weighted average number of ordinary shares[^:]+:\s*basic\s+(?:[\d,.]+\s+){5}diluted/i);
    if ([operating, pretax, tax, interest, eps, netIncome, shares].some((row) => row.length !== 5) ||
      (gainLabel.test(table) && gains.length !== 5)) continue;

    const quarters = dates.map((date, index) => {
      const equityGains = gains[index] ?? null;
      const taxRate = -tax[index] / pretax[index];
      const reported = eps[index];
      const dilutedShares = shares[index];
      // When there is no separate row, require the published pretax total to reconcile.
      if ((equityGains && !(taxRate >= 0 && taxRate <= 1)) || !(dilutedShares > 0) ||
        Math.abs(operating[index] + interest[index] + (equityGains ?? 0) - pretax[index]) > 0.25 ||
        Math.abs(netIncome[index] / dilutedShares - reported) > 0.012) return null;
      return { date, reported, adjusted: equityGains ? reported - equityGains * (1 - taxRate) / dilutedShares : reported,
        equityGains, taxRate: Number.isFinite(taxRate) ? taxRate : null, dilutedShares };
    });
    if (quarters.slice(1).some((quarter) => !quarter)) continue;
    return { previousEnd: dates[0], quarters: quarters.slice(1).filter((quarter) => quarter !== null) };
  }
  return null;
}

export async function buildAsmlAdjustedEps(filing: FinancialFiling): Promise<AdjustedEpsRecord | null> {
  if (!filing.filed || !/^\d{10}-\d{2}-\d{6}$/.test(filing.accession)) return null;
  const directory = `/Archives/edgar/data/${ASML_CIK}/${filing.accession.replaceAll("-", "")}/`;
  const index = await (await secFetch(SEC_ORIGIN + directory + filing.accession + "-index.html")).text();
  const exhibits = [...index.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].flatMap(([, row]) => {
    const path = row.match(/href="([^"]+)"/i)?.[1];
    if (!path?.startsWith(directory) || !/^[\w.-]+\.html?$/i.test(path.slice(directory.length))) return [];
    if (!/EX-99\./i.test(row) || /release|presentation|ifrs/i.test(path.slice(directory.length))) return [];
    return [path];
  }).sort((a, b) => Number(/financ|gaap/i.test(b.slice(directory.length))) - Number(/financ|gaap/i.test(a.slice(directory.length))));

  for (const exhibit of exhibits) {
    const source = SEC_ORIGIN + exhibit;
    const parsed = parseQuarters(await (await secFetch(source)).text(), filing.filed);
    if (!parsed) continue;
    const { quarters, previousEnd } = parsed;
    const dates = quarters.map(({ date }) => date);
    const usdPerEuro = await loadUsdFlowRates("EUR", [previousEnd, ...dates]);
    const converted = quarters.map((quarter) => {
      const rate = usdPerEuro?.(Date.parse(quarter.date) / DAY_MS);
      return rate == null ? null : { ...quarter, rate };
    });
    if (converted.some((quarter) => quarter === null)) throw new Error("Missing EUR/USD history for ASML " + filing.accession);
    const points = converted.filter((quarter) => quarter !== null);
    const latest = points.at(-1)!;
    const periodStart = new Date(Date.parse(dates.at(-2)!) + DAY_MS).toISOString().slice(0, 10);
    return {
      ticker: "ASML", source_accession: filing.accession, filed_on: filing.filed,
      source_quarter: latest.date, ttm_quarter: latest.date,
      reported_quarter_eps: latest.reported * latest.rate, adjusted_quarter_eps: latest.adjusted * latest.rate,
      reported_ttm_eps: points.reduce((sum, point) => sum + point.reported * point.rate, 0),
      adjusted_ttm_eps: points.reduce((sum, point) => sum + point.adjusted * point.rate, 0),
      inputs: { periodStart, dilutedShares: latest.dilutedShares * 1_000_000,
        equityGains: latest.equityGains == null ? null : latest.equityGains * 1_000_000,
        taxRate: latest.taxRate, taxRateMethod: latest.taxRate == null ? null : "effective", sharesEstimated: false,
        adjustmentSource: source, annual: false,
        currency: "EUR", quarterFx: Object.fromEntries(points.map(({ date, rate }) => [date, rate])),
      },
    };
  }
  return null;
}

export async function refreshAsmlAdjustedEps(accessions: Set<string>, since: string) {
  const filings = (await listAsmlEarningsFilings(since)).filter(({ accession }) => accessions.has(accession));
  if (!filings.length) return { ticker: "ASML", status: "no-earnings-filing", rows: 0 };
  const saved = new Set((await readAdjustedEps("ASML")).map(({ source_accession }) => source_accession));
  let rows = 0;
  let waiting = false;
  for (const filing of filings) {
    if (saved.has(filing.accession)) continue;
    const record = await buildAsmlAdjustedEps(filing);
    if (!record) { waiting = true; continue; }
    rows += await insertAdjustedEps([record]);
  }
  return { ticker: "ASML", status: rows ? "updated" : waiting ? "awaiting-exhibit" : "unchanged", rows };
}
