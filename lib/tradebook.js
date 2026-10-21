/**
 * lib/tradebook.js — broker tradebook parsing + import planning (pure, no DB).
 *
 * A tradebook is the one document that carries what a depository CAS lacks: the
 * date, quantity and PRICE of every trade. Importing it turns a demat stock's
 * unknown cost basis into real FIFO lots (lib/lots.js), flagged "exact".
 *
 * Pipeline
 *   parseTradebook(csv)     -> normalized fills  (header-alias detection, any broker)
 *   aggregateFills(fills)   -> one order per (instrument, day, side, order id)
 *   planTradebookImport()   -> what to insert / what estimates to retire, plus a
 *                              per-holding reconciliation against the CAS units
 *
 * Idempotency: every order gets a stable external_key, so re-importing overlapping
 * months (or the same file twice) never double-books.
 */
import Papa from "papaparse";
import { createHash } from "crypto";
import { buildLots } from "./lots.js";

const EPS = 1e-6;

// ── Header aliases (lower-cased, punctuation-normalised) ─────────────────────
// Order matters inside each list: earlier aliases win.
const ALIASES = {
  isin:    ["isin"],
  symbol:  ["symbol", "scrip symbol", "stock symbol", "trading symbol", "ticker", "scrip code", "instrument", "scrip", "scrip name", "stock name", "security name", "company name", "name"],
  date:    ["trade date", "executed date and time", "execution date", "executed on", "transaction date", "order execution time", "date", "order date"],
  side:    ["trade type", "buy sell", "buy sell indicator", "transaction type", "side", "action", "type", "b s"],
  qty:     ["quantity", "qty", "traded qty", "units", "shares", "no of shares"],
  price:   ["price", "trade price", "transaction price", "traded price", "avg price", "average price", "net rate", "rate"],
  value:   ["trade value", "net amount", "gross amount", "value", "amount"],
  tradeId: ["trade id", "trade no", "trade number", "exchange trade id"],
  orderId: ["order id", "exchange order id", "order no", "order number"],
  segment: ["segment", "series"],
  exchange:["exchange"],
  status:  ["order status", "status"],
};

const norm = (s) => String(s ?? "").toLowerCase().replace(/[_/\\-]+/g, " ").replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();

function mapColumns(headerRow) {
  const h = headerRow.map(norm);
  const col = {};
  for (const [field, aliases] of Object.entries(ALIASES)) {
    for (const a of aliases) {
      const i = h.indexOf(a);
      if (i >= 0 && !Object.values(col).includes(i)) { col[field] = i; break; }
    }
  }
  return col;
}

/** First row that looks like the trade table header (brokers add preamble rows). */
function findHeaderRow(rows) {
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const c = mapColumns(rows[i] || []);
    if (c.symbol !== undefined && c.date !== undefined && c.side !== undefined && c.qty !== undefined && (c.price !== undefined || c.value !== undefined)) return { idx: i, col: c };
  }
  return null;
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const pad = (n) => String(n).padStart(2, "0");

/** Indian broker dates → ISO yyyy-mm-dd. Day-first for numeric forms. Returns null if unreadable. */
export function parseTradeDate(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  let m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/))) return validISO(m[3], m[2], m[1]);
  if ((m = s.match(/^(\d{1,2})[-/ ]([A-Za-z]{3})[a-z]*[-/ ,]*(\d{4})/))) { const mo = MONTHS[m[2].toLowerCase()]; return mo ? validISO(m[3], mo, m[1]) : null; }
  return null;
}
function validISO(y, mo, d) {
  const iso = `${y}-${pad(mo)}-${pad(d)}`;
  const dt = new Date(iso + "T00:00:00Z");
  return Number.isNaN(dt.getTime()) || dt.getUTCMonth() + 1 !== Number(mo) ? null : iso;
}

const num = (v) => {
  const n = parseFloat(String(v ?? "").replace(/[₹$,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

function parseSide(raw) {
  const s = String(raw ?? "").trim().toUpperCase();
  if (!s) return null;
  if (s.startsWith("SELL") || s === "S") return "SELL";
  if (s.startsWith("BUY") || s === "B") return "BUY";
  return null;
}

/** Strip exchange suffixes/series so TCS, TCS-EQ, TCS.NS and NSE:TCS all compare equal. */
export function cleanSymbol(sym) {
  return String(sym ?? "").toUpperCase().trim()
    .replace(/^(NSE|BSE)[:\s-]+/, "")
    .replace(/[-.](EQ|BE|BZ|SM|N1|NS|BO)$/, "")
    .replace(/\s+/g, "");
}

function detectBroker(col, headerRow) {
  const h = headerRow.map(norm);
  if (col.tradeId !== undefined && col.isin !== undefined && col.segment !== undefined) return "Zerodha";
  if (h.includes("stock name") && h.includes("executed date and time")) return "Groww";
  return "Generic";
}

/**
 * @param {string} csvText   CSV text (xlsx must already be converted with xlsxBufferToCSV)
 * @returns {{ broker:string, fills:Array, warnings:string[], skipped:number }}
 */
export function parseTradebook(csvText) {
  const rows = Papa.parse(String(csvText || "").trim(), { header: false, skipEmptyLines: true }).data;
  const hdr = findHeaderRow(rows);
  if (!hdr) {
    return { broker: "Unknown", fills: [], skipped: 0, warnings: ["Couldn't find a trade table. Expected columns like Symbol, Trade Date, Buy/Sell, Quantity and Price."] };
  }
  const { idx, col } = hdr;
  const broker = detectBroker(col, rows[idx]);
  const fills = [];
  const warnings = [];
  let skipped = 0;

  for (const r of rows.slice(idx + 1)) {
    const symbolRaw = String(r[col.symbol] ?? "").trim();
    if (!symbolRaw || /^total/i.test(symbolRaw)) continue;

    // Equity delivery only: ignore derivatives rows some brokers mix into one file.
    const seg = norm(r[col.segment]);
    if (seg && /^(fo|fno|cd|com|mcx|nfo|cds|fut|opt)/.test(seg)) { skipped++; continue; }

    // Order-history exports (e.g. Groww) include rejected / cancelled orders — only executed ones are trades.
    if (col.status !== undefined) {
      const st = norm(r[col.status]);
      if (st && !/(executed|complete|traded|filled|success)/.test(st)) { skipped++; continue; }
    }

    const side = parseSide(r[col.side]);
    const date = parseTradeDate(r[col.date]);
    const qty = Math.abs(num(r[col.qty]));
    let price = col.price !== undefined ? num(r[col.price]) : 0;
    if (!(price > 0) && col.value !== undefined && qty > 0) price = Math.abs(num(r[col.value])) / qty;

    if (!side) { skipped++; continue; }
    if (!date) { warnings.push(`Skipped ${symbolRaw}: unreadable date "${r[col.date]}"`); skipped++; continue; }
    if (!(qty > 0) || !(price > 0)) { warnings.push(`Skipped ${symbolRaw} on ${date}: missing quantity or price`); skipped++; continue; }

    fills.push({
      symbol: cleanSymbol(symbolRaw),
      rawSymbol: symbolRaw,
      isin: col.isin !== undefined ? String(r[col.isin] ?? "").trim().toUpperCase() : "",
      date, side, qty, price,
      tradeId: col.tradeId !== undefined ? String(r[col.tradeId] ?? "").trim() : "",
      orderId: col.orderId !== undefined ? String(r[col.orderId] ?? "").trim() : "",
      exchange: col.exchange !== undefined ? String(r[col.exchange] ?? "").trim().toUpperCase() : "",
    });
  }
  return { broker, fills, warnings, skipped };
}

/** Group fills of the same order into one weighted-average order. */
export function aggregateFills(fills) {
  const map = new Map();
  for (const f of fills) {
    const inst = f.isin || f.symbol;
    // Same order id → same order; without ids, same-day same-price fills merge.
    const orderKey = f.orderId || `p${f.price.toFixed(4)}`;
    const k = [inst, f.date, f.side, orderKey].join("|");
    const o = map.get(k) || { inst, symbol: f.symbol, isin: f.isin, date: f.date, side: f.side, orderKey, qty: 0, cost: 0, fills: 0 };
    o.qty += f.qty; o.cost += f.qty * f.price; o.fills++;
    map.set(k, o);
  }
  return [...map.values()].map((o) => ({ ...o, price: o.cost / o.qty }));
}

/** Stable idempotency key for an aggregated order. */
export function orderKey(o) {
  const raw = ["TB", o.inst, o.date, o.side, o.orderKey, o.qty.toFixed(4)].join("|");
  return "TB|" + createHash("sha1").update(raw).digest("hex").slice(0, 24);
}

// ── Matching trades to holdings ──────────────────────────────────────────────
const holdingSymbol = (h) => cleanSymbol(h.ticker);

/**
 * Candidate holdings for an order (equity types only). Match by ISIN first, then
 * cleaned symbol. No fuzzy name matching — a wrong match would corrupt a ledger.
 */
export function matchHoldings(order, holdings) {
  const byIsin = order.isin
    ? holdings.filter((h) => [h.isin, h.scheme_code, h.ticker].some((v) => String(v || "").toUpperCase() === order.isin))
    : [];
  if (byIsin.length) return byIsin;
  return holdings.filter((h) => holdingSymbol(h) === order.symbol);
}

const isPlaceholder = (t) => String(t.external_key || "").startsWith("OPENING|") || String(t.source_type || "").toUpperCase() === "INFERRED";

/**
 * Plan an import without touching the DB.
 *
 * @param {object} p
 * @param {Array}  p.orders        aggregateFills() output
 * @param {Array}  p.holdings      candidate holdings: {id,name,type,ticker,isin,scheme_code,units,member_id}
 * @param {Array}  p.existingTxns  ledger rows of those holdings: {id,holding_id,txn_type,units,txn_date,source_type,external_key}
 * @param {string} [p.memberId]    restrict matching to one family member
 * @returns {{ symbols:Array, inserts:Array, deletes:string[], totals:object }}
 */
export function planTradebookImport({ orders, holdings, existingTxns, memberId = null }) {
  const pool = memberId ? holdings.filter((h) => h.member_id === memberId) : holdings;
  const txnsByHolding = new Map();
  for (const t of existingTxns || []) {
    if (!txnsByHolding.has(t.holding_id)) txnsByHolding.set(t.holding_id, []);
    txnsByHolding.get(t.holding_id).push(t);
  }

  const groups = new Map();       // instrument -> { holding|null, status, orders[] }
  const unmatched = [];
  for (const o of orders) {
    const cands = matchHoldings(o, pool);
    const g = groups.get(o.inst) || { inst: o.inst, symbol: o.symbol, isin: o.isin, cands, orders: [] };
    g.orders.push(o);
    groups.set(o.inst, g);
    if (!cands.length && !unmatched.includes(o.inst)) unmatched.push(o.inst);
  }

  const inserts = [];
  const deletes = [];
  const symbols = [];
  const totals = { orders: orders.length, new_orders: 0, duplicate_orders: 0, unmatched_orders: 0, ambiguous_orders: 0 };

  for (const g of groups.values()) {
    const base = { symbol: g.symbol, isin: g.isin, orders: g.orders.length };
    if (g.cands.length === 0) {
      totals.unmatched_orders += g.orders.length;
      symbols.push({ ...base, status: "unmatched", holding: null });
      continue;
    }
    if (g.cands.length > 1) {
      totals.ambiguous_orders += g.orders.length;
      symbols.push({ ...base, status: "ambiguous", holding: null, candidates: g.cands.map((h) => ({ id: h.id, member_id: h.member_id, name: h.name })) });
      continue;
    }

    const h = g.cands[0];
    const existing = txnsByHolding.get(h.id) || [];
    const haveKeys = new Set(existing.map((t) => t.external_key).filter(Boolean));
    // Trades keyed in by hand / the older CSV path have no external_key: same day+side+units = same trade.
    const looksSame = (o) => existing.some((t) => !t.external_key && t.txn_date === o.date && t.txn_type === o.side && Math.abs(Math.abs(Number(t.units) || 0) - o.qty) < EPS);

    const fresh = [];
    let dup = 0;
    for (const o of g.orders) {
      const key = orderKey(o);
      if (haveKeys.has(key) || looksSame(o)) { dup++; continue; }
      haveKeys.add(key);
      fresh.push({ holding_id: h.id, txn_type: o.side, units: o.qty, price: o.price, txn_date: o.date, external_key: key, fills: o.fills });
    }
    totals.new_orders += fresh.length;
    totals.duplicate_orders += dup;

    // Reconcile against the units the depository statement says we hold.
    const held = Number(h.units) || 0;
    const tol = Math.max(0.001, Math.abs(held) * 0.0005);
    const rowsFor = (rows) => rows.map((t) => ({ txn_type: t.txn_type, units: t.units, price: t.price, txn_date: t.txn_date, source_type: t.source_type, external_key: t.external_key }));
    let keep = existing;
    let lots = buildLots([...rowsFor(keep), ...rowsFor(fresh)]);
    let replaces = false;
    // Placeholder estimates (typed-in cost / inferred gap rows) are superseded once real trades over-explain the position.
    if (fresh.length && lots.netUnits > held + tol) {
      const ph = keep.filter(isPlaceholder);
      if (ph.length) {
        const trial = buildLots([...rowsFor(keep.filter((t) => !isPlaceholder(t))), ...rowsFor(fresh)]);
        if (Math.abs(trial.netUnits - held) < Math.abs(lots.netUnits - held)) {
          deletes.push(...ph.map((t) => t.id));
          keep = keep.filter((t) => !isPlaceholder(t));
          lots = trial; replaces = true;
        }
      }
    }

    let reconcile;
    if (lots.shortfall > tol) reconcile = "incomplete";           // sells with no earlier buys in the ledger
    else if (Math.abs(lots.netUnits - held) <= tol) reconcile = "explained";
    else if (lots.netUnits < held) reconcile = "gap";
    else reconcile = "over";

    inserts.push(...fresh);
    symbols.push({
      ...base, status: "ready",
      holding: { id: h.id, name: h.name, member_id: h.member_id, units: held },
      new_orders: fresh.length, duplicate_orders: dup,
      buy_units: g.orders.filter((o) => o.side === "BUY").reduce((s, o) => s + o.qty, 0),
      sell_units: g.orders.filter((o) => o.side === "SELL").reduce((s, o) => s + o.qty, 0),
      ledger_units: lots.netUnits, gap_units: Math.max(0, held - lots.netUnits),
      shortfall_units: lots.shortfall, reconcile, replaces_estimates: replaces,
      cost_basis: lots.costBasis,
    });
  }
  return { symbols, inserts, deletes, totals };
}
