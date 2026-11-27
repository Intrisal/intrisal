/** @type {Record<string, [string, boolean?]>} */
export const fredSeries = {
  AUD: ["DEXUSAL", true], BRL: ["DEXBZUS"], CAD: ["DEXCAUS"], CHF: ["DEXSZUS"],
  CNY: ["DEXCHUS"], DKK: ["DEXDNUS"], EUR: ["DEXUSEU", true], GBP: ["DEXUSUK", true],
  INR: ["DEXINUS"], JPY: ["DEXJPUS"], KRW: ["DEXKOUS"], MXN: ["DEXMXUS"],
  NOK: ["DEXNOUS"], SEK: ["DEXSDUS"], TWD: ["DEXTAUS"],
};

/** @param {string} series @param {string} start */
export function fredHistoryUrl(series, start) {
  const params = new URLSearchParams({ id: series, cosd: start });
  return "https://fred.stlouisfed.org/graph/fredgraph.csv?" + params;
}

/** @param {string} csv @param {string} series @returns {[string, number][]} */
export function parseFredHistory(csv, series) {
  const [header, ...lines] = csv.trim().split(/\r?\n/);
  if (header !== "observation_date," + series) throw new Error("Unexpected FRED response for " + series);
  return lines.flatMap((line) => {
    const [date, value] = line.split(",");
    const amount = Number(value);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(amount) || amount <= 0) return [];
    return [[date, amount]];
  });
}
