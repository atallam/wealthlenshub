"""
cas_casparser_service.py
------------------------
Production service script — called by routes/import_v2.js via child_process.spawn.

Accepts a CAS PDF (NSDL/CDSL or CAMS/Kfintech) + password, parses it with
casparser, and writes a JSON response to stdout matching the shape returned
by the existing /api/import/detect endpoint:

  {
    "holdings":         [...],
    "holder_names":     ["INVESTOR NAME"],
    "holder_pans":      ["ABCDE1234F"],
    "format":           "NSDL CAS (casparser)",
    "warnings":         [...],
    "statement_date":   "YYYY-MM-DD",
    "period_start":     "YYYY-MM-DD",
    "period_end":       "YYYY-MM-DD",
    "depository":       "NSDL",
    "holder_member_map": {}
  }

Usage (called by Node.js subprocess):
    python3 services/cas_casparser_service.py <pdf_path> <password>
    python3 services/cas_casparser_service.py <pdf_path> '["", "ABCDE1234F", ...]'

The second form tries each password in order inside ONE process (the PDF is
opened once per attempt but Python/casparser start-up happens once), and
reports which one worked as "password_index".

Every holding carries the natural-key fields the DB reconcile needs:
    isin        instrument ISIN
    account_id  "dpid/clientid" for demat accounts, folio number for RTA CAS,
                "MF-FOLIOS" for the MF section of a depository CAS
and "depository" is NSDL | CDSL | CAMS | KFINTECH (from casparser file_type).

On error: exits with code 1 and writes {"error": "..."} to stdout.

Requires:
    pip install casparser casparser-isin pymupdf --break-system-packages
"""

import sys
import json
import re
import hashlib
from pathlib import Path


# ── Transaction ledger (detailed CAMS/KFin CAS) ───────────────────────────────
# casparser TransactionType → WealthLens txn_type. Cash-only / bookkeeping rows
# are dropped from the ledger (they carry no units); the raw type is preserved
# in source_type so nothing is lost for audit.
TXN_MAP = {
    "PURCHASE":           "BUY",
    "PURCHASE_SIP":       "BUY",
    "SWITCH_IN":          "BUY",
    "SWITCH_IN_MERGER":   "BUY",
    "DIVIDEND_REINVEST":  "BUY",
    "GIFT_IN":            "BUY",
    "REDEMPTION":         "SELL",
    "SWITCH_OUT":         "SELL",
    "SWITCH_OUT_MERGER":  "SELL",
    "GIFT_OUT":           "SELL",
    "DIVIDEND_PAYOUT":    "DIVIDEND",
}
SKIP_TXN = {"STT_TAX", "STAMP_DUTY_TAX", "TDS_TAX", "SEGREGATION", "MISC", "UNKNOWN", "REVERSAL"}


def classify_scheme(type_str: str, txns: list) -> str:
    """EQUITY | DEBT | HYBRID | UNKNOWN from the CAS scheme-type text, falling
    back to casparser's STT heuristic (equity redemptions attract STT)."""
    t = (type_str or "").lower()
    if re.search(r"equity|elss|index|etf|flexi|multi.?cap|small.?cap|mid.?cap|large.?cap|sector|thematic|focused|value|contra|dividend yield", t):
        return "EQUITY"
    if re.search(r"debt|liquid|gilt|bond|money|overnight|ultra|short|duration|credit|banking.?&.?psu|corporate|floater|income", t):
        return "DEBT"
    if re.search(r"hybrid|balanced|arbitrage|fof|fund of fund|asset allocation|solution|retirement|children", t):
        return "HYBRID"
    types = {str(x.get("type") or "") for x in (txns or [])}
    if "STT_TAX" in types:
        return "EQUITY"
    return "UNKNOWN"


def build_ledger(folio_num: str, isin: str, scheme: dict, period_from: str, warnings: list) -> list:
    """Turn a detailed-CAS scheme's transaction list into ledger rows.

    external_key is a stable hash of (folio, isin, date, type, units, amount)
    so re-importing the same or an overlapping statement is idempotent.
    If the statement does not start at inception (scheme.open > 0) an OPENING
    row is emitted so net units still reconcile to the statement; its cost is
    approximated from the closing cost figure and flagged approx_cost.
    """
    rows = []
    txns = scheme.get("transactions") or []
    open_units = f(scheme.get("open")) or 0.0
    seen = set()

    if open_units > 0.000001:
        val   = scheme.get("valuation") or {}
        cost  = f(val.get("cost")) or 0.0
        # cost of units bought inside the statement window
        in_window_cost = sum((f(x.get("amount")) or 0.0) for x in txns
                             if TXN_MAP.get(str(x.get("type") or "")) == "BUY")
        in_window_units = sum(abs(f(x.get("units")) or 0.0) for x in txns
                              if TXN_MAP.get(str(x.get("type") or "")) == "BUY")
        approx_cost = max(0.0, cost - in_window_cost)
        approx_nav  = (approx_cost / open_units) if approx_cost > 0 else None
        if approx_nav is None:
            first_nav = next((f(x.get("nav")) for x in txns if f(x.get("nav"))), None)
            approx_nav = first_nav or 0.0
        key = hashlib.sha1(f"{folio_num}|{isin}|OPENING|{open_units:.4f}".encode()).hexdigest()[:24]
        rows.append({
            "external_key": key, "txn_type": "BUY", "source_type": "OPENING",
            "txn_date": period_from, "units": open_units, "price": round(approx_nav, 4),
            "amount": round(open_units * approx_nav, 2), "balance_after": open_units,
            "description": "Opening balance (before this statement) — cost approximated; import a since-inception CAS for exact lots",
            "approx_cost": True,
        })
        warnings.append(f"{scheme.get('scheme', isin)}: statement starts with {open_units:g} units already held — cost basis for those is approximate")
        _ = in_window_units

    for x in txns:
        raw_type = str(x.get("type") or "UNKNOWN")
        if raw_type in SKIP_TXN:
            continue
        mapped = TXN_MAP.get(raw_type)
        if not mapped:
            continue
        units  = abs(f(x.get("units")) or 0.0)
        amount = abs(f(x.get("amount")) or 0.0)
        nav    = f(x.get("nav"))
        date   = fmt_date(x.get("date"))
        if mapped != "DIVIDEND" and units <= 0:
            continue
        if nav is None and units > 0 and amount > 0:
            nav = amount / units
        key = hashlib.sha1(f"{folio_num}|{isin}|{date}|{raw_type}|{units:.4f}|{amount:.2f}".encode()).hexdigest()[:24]
        if key in seen:      # identical row twice in one file (rare RTA quirk) — keep once
            continue
        seen.add(key)
        rows.append({
            "external_key": key, "txn_type": mapped, "source_type": raw_type,
            "txn_date": date, "units": units, "price": round(nav or 0.0, 4),
            "amount": round(amount, 2), "balance_after": f(x.get("balance")),
            "description": (x.get("description") or "").strip()[:200],
        })
    return rows


def f(v):
    """Convert Decimal/None → float/None."""
    if v is None:
        return None
    try:
        return float(v)
    except Exception:
        return None


def fmt_date(d):
    """Convert date objects or strings → ISO 'YYYY-MM-DD' string or None."""
    if d is None:
        return None
    s = str(d)
    # Already ISO-ish
    if re.match(r'\d{4}-\d{2}-\d{2}', s):
        return s[:10]
    # DD-MM-YYYY or DD/MM/YYYY
    m = re.match(r'(\d{2})[-/](\d{2})[-/](\d{4})', s)
    if m:
        return f"{m.group(3)}-{m.group(2)}-{m.group(1)}"
    return s or None


def clean_equity_name(raw: str) -> str:
    """Strip trailing share-class noise (e.g. 'XYZ LTD EQ NEW RS. 2/-')."""
    name = raw.strip()
    name = re.sub(r'\s+EQ\s+NEW\s+RS\..*$', '', name, flags=re.I)
    name = re.sub(r'\s+ORDINARY\s+SHARES?.*$', '', name, flags=re.I)
    name = re.sub(r'\s+EQUITY\s+SHARES?.*$', '', name, flags=re.I)
    name = re.sub(r'\s+#.*$', '', name)
    return name.strip()


# ── NSDL / CDSL CAS (NSDLCASData → accounts with equities + mutual_funds) ────

def parse_nsdl(d: dict) -> tuple:
    holdings, warnings = [], []
    depository = str(d.get("file_type") or "NSDL").upper()
    if depository not in ("NSDL", "CDSL"):
        depository = "NSDL"

    holder_names = []
    holder_pans = []
    inv = d.get("investor_info") or {}
    inv_name = (inv.get("name") or "").strip()
    if inv_name:
        holder_names.append(inv_name)

    sp = d.get("statement_period") or {}
    period_from = fmt_date(sp.get("from_") or sp.get("from") or "")
    period_to   = fmt_date(sp.get("to") or "")

    for acc in (d.get("accounts") or []):
        # Collect PANs from account owners
        for owner in (acc.get("owners") or []):
            pan = (owner.get("PAN") or "").strip().upper()
            if pan and pan not in holder_pans:
                holder_pans.append(pan)
            name = (owner.get("name") or "").strip()
            if name and name not in holder_names:
                holder_names.append(name)

        broker    = acc.get("name", "")
        dp_id     = (acc.get("dp_id") or "").strip()
        client_id = (acc.get("client_id") or "").strip()
        acc_type  = str(acc.get("type") or "")
        # Natural-key account id: demat accounts are dpid/clientid; the
        # "Mutual Fund Folios" section of a depository CAS has neither.
        if dp_id or client_id:
            account_id = f"{dp_id}/{client_id}"
        elif "mutual fund" in acc_type.lower():
            account_id = "MF-FOLIOS"
        else:
            account_id = broker or "UNKNOWN"
        folio = account_id
        # ISIN dedup is PER ACCOUNT: the same stock legitimately sits in two
        # demat accounts (e.g. Zerodha + ICICI) and both must be kept.
        seen_isins = set()

        pan = holder_pans[0] if holder_pans else ""

        # Primary owner of this account (used for multi-holder account_map lookup)
        acc_owner_name = (acc.get("owners") or [{}])[0].get("name", "").strip() if acc.get("owners") else ""
        acc_owner_pan  = (acc.get("owners") or [{}])[0].get("PAN",  "").strip().upper() if acc.get("owners") else ""
        if not acc_owner_name and holder_names:
            acc_owner_name = holder_names[0]  # Fall back to first holder

        # ── Equities ───────────────────────────────────────────────────────
        for eq in (acc.get("equities") or []):
            isin = (eq.get("isin") or "").strip().upper()
            if not isin:
                warnings.append(f"Skipped equity without ISIN: {eq.get('name', '?')}")
                continue
            if isin in seen_isins:
                continue
            seen_isins.add(isin)

            units = f(eq.get("num_shares"))
            price = f(eq.get("price"))
            value = f(eq.get("value"))
            name  = clean_equity_name(eq.get("name", ""))

            asset_type = "IN_STOCK"
            if re.search(r'etf|bees|gold\s*etf|nifty.*etf|sgb|sovereign\s*gold', name, re.I):
                asset_type = "IN_ETF"
            elif re.search(r'bond|debenture|ncd', name, re.I):
                asset_type = "FD"

            holdings.append({
                "name":           name,
                "type":           asset_type,
                "ticker":         isin,
                "scheme_code":    isin,
                "units":          units,
                "purchase_nav":   None,
                "current_nav":    price,
                "purchase_price": None,
                "current_price":  price,
                "purchase_value": None,
                "current_value":  value,
                "source":         "cas",
                "brokerage_name": broker,
                "currency":       "INR",
                "isin":           isin,
                "account_id":     account_id,
                "asset_class":    "EQUITY" if asset_type in ("IN_STOCK", "IN_ETF") else "DEBT",
                "transactions":   [],
                "_folio":         folio,
                "_pan":           acc_owner_pan or pan,
                "_holder_name":   acc_owner_name,
            })

        # ── Mutual Funds ───────────────────────────────────────────────────
        for mf in (acc.get("mutual_funds") or []):
            isin = (mf.get("isin") or "").strip().upper()
            if not isin:
                warnings.append(f"Skipped MF without ISIN: {mf.get('name', '?')}")
                continue
            if isin in seen_isins:
                continue
            seen_isins.add(isin)

            units = f(mf.get("balance"))
            nav   = f(mf.get("nav"))
            value = f(mf.get("value"))
            name  = mf.get("name", "")

            holdings.append({
                "name":           name,
                "type":           "MF",
                "ticker":         isin,
                "scheme_code":    "",
                "units":          units,
                "purchase_nav":   None,
                "current_nav":    nav,
                "purchase_price": None,
                "current_price":  nav,
                "purchase_value": None,
                "current_value":  value,
                "source":         "cas",
                "brokerage_name": broker,
                "currency":       "INR",
                "isin":           isin,
                "account_id":     account_id,
                "asset_class":    classify_scheme(mf.get("type"), None),
                "transactions":   [],
                "_folio":         folio,
                "_pan":           acc_owner_pan or pan,
                "_holder_name":   acc_owner_name,
            })

    for w in (d.get("parse_warnings") or []):
        warnings.append(str(w))

    return holdings, warnings, holder_names, holder_pans, period_from, period_to, depository


# ── CAMS / Kfintech CAS (CASData → folios with schemes) ─────────────────────

def parse_cams(d: dict) -> tuple:
    holdings, warnings = [], []
    detailed = str(d.get("cas_type") or "").upper() == "DETAILED"

    inv = d.get("investor_info") or {}
    inv_name = (inv.get("name") or "").strip()
    inv_pan  = (inv.get("PAN") or inv.get("pan") or "").strip().upper()

    holder_names = [inv_name] if inv_name else []
    holder_pans  = [inv_pan]  if inv_pan  else []

    sp = d.get("statement_period") or {}
    period_from = fmt_date(sp.get("from_") or sp.get("from") or "")
    period_to   = fmt_date(sp.get("to") or "")

    for folio in (d.get("folios") or []):
        folio_num = (folio.get("folio") or "").strip()
        amc       = folio.get("amc", "")
        seen_isins = set()
        pan       = (folio.get("PAN") or inv_pan or "").strip().upper()
        if pan and pan not in holder_pans:
            holder_pans.append(pan)

        for scheme in (folio.get("schemes") or []):
            isin = (scheme.get("isin") or "").strip().upper()
            if not isin:
                warnings.append(f"Skipped scheme without ISIN: {scheme.get('scheme', '?')} (folio {folio_num})")
                continue
            if isin in seen_isins:
                # Same ISIN twice in one folio (rare: split by advisor) — merge units/values.
                for h in holdings:
                    if h["_folio"] == folio_num and h["isin"] == isin:
                        h["units"]          = (h["units"] or 0) + (f(scheme.get("close")) or 0)
                        val2 = scheme.get("valuation") or {}
                        h["current_value"]  = (h["current_value"] or 0) + (f(val2.get("value")) or 0)
                        h["purchase_value"] = (h["purchase_value"] or 0) + (f(val2.get("cost")) or 0)
                        break
                continue
            seen_isins.add(isin)
            val      = scheme.get("valuation") or {}
            close    = f(scheme.get("close"))
            cur_nav  = f(val.get("nav"))
            cur_val  = f(val.get("value"))
            cost     = f(val.get("cost"))
            cost_nav = (cost / close) if (cost and close) else None

            ledger = build_ledger(folio_num, isin, scheme, period_from, warnings) if detailed else []
            holdings.append({
                "name":           scheme.get("scheme", ""),
                "type":           "MF",
                "asset_class":    classify_scheme(scheme.get("type"), scheme.get("transactions")),
                "transactions":   ledger,
                "ticker":         isin,
                "scheme_code":    scheme.get("amfi") or "",
                "units":          close,
                "purchase_nav":   cost_nav,
                "current_nav":    cur_nav,
                "purchase_price": cost_nav,
                "current_price":  cur_nav,
                "purchase_value": cost,
                "current_value":  cur_val,
                "source":         "cas",
                "brokerage_name": amc,
                "currency":       "INR",
                "isin":           isin,
                "account_id":     folio_num or "NO-FOLIO",
                "_folio":         folio_num,
                "_pan":           pan,
                "_holder_name":   inv_name,  # CAMS is always single-holder
            })

    # NOTE: casparser's cas_type is SUMMARY|DETAILED — the RTA is file_type.
    depository = str(d.get("file_type") or "CAMS").upper()
    if depository not in ("CAMS", "KFINTECH"):
        depository = "CAMS"
    for w in (d.get("parse_warnings") or []):
        warnings.append(str(w))
    return holdings, warnings, holder_names, holder_pans, period_from, period_to, depository


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    if len(sys.argv) < 3:
        out = {"error": "Usage: cas_casparser_service.py <pdf_path> <password>"}
        print(json.dumps(out))
        sys.exit(1)

    pdf_path = sys.argv[1]
    raw_pw   = sys.argv[2]
    # Either a single password or a JSON list of candidates to try in order.
    passwords = [raw_pw]
    if raw_pw.startswith("["):
        try:
            passwords = [str(p) for p in json.loads(raw_pw)]
        except Exception:
            passwords = [raw_pw]
    if not passwords:
        passwords = [""]

    try:
        import casparser
    except ImportError:
        out = {"error": "casparser not installed. Run: pip install casparser casparser-isin pymupdf --break-system-packages"}
        print(json.dumps(out))
        sys.exit(1)

    if not Path(pdf_path).exists():
        out = {"error": f"PDF not found: {pdf_path}"}
        print(json.dumps(out))
        sys.exit(1)

    try:
        from casparser.exceptions import IncorrectPasswordError
    except Exception:  # very old casparser
        class IncorrectPasswordError(Exception):
            pass

    data = None
    password_index = -1
    last_pw_error = None
    for i, pw in enumerate(passwords):
        try:
            data = casparser.read_cas_pdf(pdf_path, pw, output="dict")
            password_index = i
            break
        except IncorrectPasswordError as e:
            last_pw_error = e
            continue
        except Exception as e:
            err_msg = str(e)
            low = err_msg.lower()
            # Surface password errors clearly so the Node route can detect them
            if "password" in low or "incorrect" in low or "encrypted" in low:
                last_pw_error = e
                continue
            if "not a pdf" in low or "invalid" in low:
                out = {"error": f"Invalid PDF: {err_msg}"}
            else:
                out = {"error": f"casparser failed: {err_msg}"}
            print(json.dumps(out))
            sys.exit(1)

    if data is None:
        # Every candidate failed. "" (no password) always sits first in the
        # list, so a failure here means the PDF is encrypted.
        out = {"error": "password_incorrect" if len(passwords) > 1 or passwords[0] else "password_required",
               "tried": len(passwords)}
        print(json.dumps(out))
        sys.exit(1)

    try:
        d = data.model_dump()
    except Exception:
        try:
            d = dict(data)
        except Exception as e2:
            out = {"error": f"Could not read casparser output: {e2}"}
            print(json.dumps(out))
            sys.exit(1)

    try:
        if "accounts" in d:
            holdings, warnings, holder_names, holder_pans, period_from, period_to, depository = parse_nsdl(d)
            cas_fmt = f"NSDL CAS (casparser v{casparser.__version__})"
        else:
            holdings, warnings, holder_names, holder_pans, period_from, period_to, depository = parse_cams(d)
            cas_fmt = f"CAMS/Kfintech CAS (casparser v{casparser.__version__})"
    except Exception as e:
        out = {"error": f"Parse error: {e}"}
        print(json.dumps(out))
        sys.exit(1)

    # Use period_to as statement_date (most recent date in period)
    statement_date = period_to or period_from
    txn_count = sum(len(h.get("transactions") or []) for h in holdings)
    cas_detail = str(d.get("cas_type") or ("DEMAT" if "accounts" in d else "SUMMARY")).upper()

    response = {
        "holdings":          holdings,
        "holder_names":      holder_names,
        "holder_pans":       holder_pans,
        "format":            cas_fmt,
        "warnings":          warnings,
        "statement_date":    statement_date,
        "period_start":      period_from,
        "period_end":        period_to,
        "depository":        depository,
        "cas_detail":        cas_detail,          # DETAILED | SUMMARY | DEMAT
        "transaction_count": txn_count,
        "holder_member_map": {},
        "password_index":    password_index,
        "_parser":           "casparser",
        "_version":          getattr(casparser, "__version__", "unknown"),
    }

    print(json.dumps(response, default=str, ensure_ascii=False))


if __name__ == "__main__":
    main()
