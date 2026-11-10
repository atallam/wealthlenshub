/**
 * lib/casEnrich.js — post-parse enrichment for CAS rows.
 *
 * Mutual funds held in a demat account appear in an NSDL/CDSL CAS under the AMC only
 * ("HDFC MUTUAL FUND", "BANDHAN MUTUAL FUND"), never the scheme. The legacy /detect route
 * fixed that with an AMFI ISIN lookup; the casparser route did not. This restores it.
 */

/** True for names that identify only the fund house, e.g. "JIO BLACKROCK MUTUAL FUND". */
export const isAmcLevelName = (name) => /\bmutual\s+fund\s*$/i.test(String(name || "").trim());

/**
 * Fill in scheme name / AMFI scheme_code for MF rows by ISIN. Mutates `holdings`.
 * Folio-held funds already carry full scheme names, so only AMC-level names are replaced;
 * scheme_code is filled in when empty. Returns how many rows changed.
 *
 * @param holdings  parsed CAS rows ({ type, isin|ticker, name, scheme_code })
 * @param amfiList  getAmfiList() output: [{ scheme_code, isin1, isin2, name }]
 */
export function enrichMfFromAmfi(holdings, amfiList) {
  if (!Array.isArray(holdings) || !Array.isArray(amfiList) || !amfiList.length) return 0;
  const byIsin = new Map();
  for (const f of amfiList) {
    if (f.isin1) byIsin.set(f.isin1, f);
    if (f.isin2) byIsin.set(f.isin2, f);
  }
  let changed = 0;
  for (const h of holdings) {
    if (h.type !== "MF") continue;
    const entry = byIsin.get(String(h.isin || h.ticker || "").toUpperCase());
    if (!entry) continue;
    let touched = false;
    if (isAmcLevelName(h.name) && entry.name) { h.name = entry.name; touched = true; }
    if (!h.scheme_code && entry.scheme_code) { h.scheme_code = entry.scheme_code; touched = true; }
    if (touched) changed++;
  }
  return changed;
}

/**
 * ISINs known to be exchange-traded funds even though a demat CAS lists them under the
 * "Mutual Funds" section with only an AMC-level name ("HDFC MUTUAL FUND"). Used when neither
 * the statement name nor the AMFI list carries an ETF marker. Add to this as you find more.
 */
export const KNOWN_ETF_ISINS = new Set([
  "INF179KC1981", // HDFC Gold ETF (AMFI scheme 113049) — AMFI also names it "…ETF", so the name rule catches it too
]);

/** True when a scheme name marks an exchange-traded fund (ETF / Exchange Traded Fund / BeES). */
export const isEtfName = (name) =>
  /\b(etf|exchange\s*traded|bees)\b/i.test(String(name || ""));

/**
 * Demat CAS files list ETFs under "Mutual Funds", so the parser types them MF and the app prices
 * them by AMFI NAV. Re-type them IN_ETF so they price by exchange ticker (ISIN is kept as the
 * ticker; the ISIN→symbol backfill resolves it after import). Runs with or without an AMFI list.
 * Mutates `holdings`; returns how many rows changed.
 */
export function reclassifyDematEtfs(holdings, amfiList) {
  if (!Array.isArray(holdings)) return 0;
  const byIsin = new Map();
  for (const f of Array.isArray(amfiList) ? amfiList : []) {
    if (f.isin1) byIsin.set(f.isin1, f);
    if (f.isin2) byIsin.set(f.isin2, f);
  }
  let changed = 0;
  for (const h of holdings) {
    if (h.type !== "MF") continue;
    const isin = String(h.isin || h.ticker || "").toUpperCase();
    if (!isin.startsWith("INF")) continue;
    const entry = byIsin.get(isin);
    if (!(KNOWN_ETF_ISINS.has(isin) || isEtfName(h.name) || isEtfName(entry?.name))) continue;
    h.type = "IN_ETF";
    h.ticker = isin;
    h.scheme_code = ""; // an ETF has no AMFI scheme_code to price by
    if (isAmcLevelName(h.name) && entry?.name) h.name = entry.name;
    changed++;
  }
  return changed;
}
