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
