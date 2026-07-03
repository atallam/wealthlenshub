"""
cas_compare_casparser.py
------------------------
Method B: Parse a CAS PDF using the `casparser` library and emit
a normalized JSON file matching the WealthLens holding shape.

Handles both:
  - CASData        (CAMS / Kfintech CAS) → has `folios` with schemes + full transactions
  - NSDLCASData    (NSDL / CDSL CAS)     → has `accounts` with equities + mutual_funds

Usage:
    python tools/cas_compare_casparser.py <path_to_cas.pdf> <password> [output.json]

Requires:
    pip install casparser casparser-isin pymupdf --break-system-packages
"""

import sys
import json
from decimal import Decimal
from pathlib import Path

try:
    import casparser
except ImportError:
    print("ERROR: casparser not installed. Run: pip install casparser casparser-isin pymupdf", file=sys.stderr)
    sys.exit(1)


# ─── Helpers ─────────────────────────────────────────────────────────────────

def f(v):
    """Decimal / None → float / None for JSON."""
    if v is None:
        return None
    try:
        return float(v)
    except Exception:
        return None


def clean_name(raw: str) -> str:
    """Strip trailing share-class noise from equity names like 'XYZ LTD EQ NEW RS. 2/-'."""
    import re
    name = raw.strip()
    name = re.sub(r'\s+EQ\s+NEW\s+RS\..*$', '', name, flags=re.I)
    name = re.sub(r'\s+ORDINARY\s+SHARES?.*$', '', name, flags=re.I)
    name = re.sub(r'\s+EQUITY\s+SHARES?.*$', '', name, flags=re.I)
    name = re.sub(r'\s+#.*$', '', name)
    return name.strip()


# ─── CAMS / Kfintech CAS (CASData with folios) ───────────────────────────────

def parse_cams_cas(d: dict) -> tuple[list, list, dict, dict]:
    """Returns (holdings, warnings, investor_info, period)."""
    holdings, warnings = [], []

    inv = d.get("investor_info") or {}
    investor = {
        "name":    inv.get("name", ""),
        "email":   inv.get("email", ""),
        "mobile":  inv.get("mobile", ""),
        "address": inv.get("address", ""),
    }
    sp = d.get("statement_period") or {}
    period = {"from": sp.get("from_", sp.get("from", "")), "to": sp.get("to", "")}

    for folio in (d.get("folios") or []):
        folio_num = folio.get("folio", "")
        amc       = folio.get("amc", "")
        pan       = folio.get("PAN", "")

        for scheme in (folio.get("schemes") or []):
            val       = scheme.get("valuation") or {}
            close     = f(scheme.get("close"))
            cur_nav   = f(val.get("nav"))
            cur_val   = f(val.get("value"))
            cost      = f(val.get("cost"))
            cost_nav  = (cost / close) if (cost and close) else None

            txns = []
            for t in (scheme.get("transactions") or []):
                txns.append({
                    "txn_date":    str(t.get("date", "")),
                    "description": t.get("description", ""),
                    "txn_type":    str(t.get("type", "")),
                    "units":       f(t.get("units")),
                    "nav":         f(t.get("nav")),
                    "amount":      f(t.get("amount")),
                    "balance":     f(t.get("balance")),
                })

            holdings.append({
                "name":           scheme.get("scheme", ""),
                "type":           "MF",
                "ticker":         scheme.get("isin") or "",
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
                "_folio":         folio_num,
                "_pan":           pan,
                "_rta_code":      scheme.get("rta_code", ""),
                "_rta":           scheme.get("rta", ""),
                "_open_units":    f(scheme.get("open")),
                "_close_calc":    f(scheme.get("close_calculated")),
                "_val_date":      str(val.get("date", "")) if val else None,
                "_transactions":  txns,
            })

    return holdings, warnings, investor, period


# ─── NSDL / CDSL CAS (NSDLCASData with accounts) ────────────────────────────

def parse_nsdl_cas(d: dict) -> tuple[list, list, dict, dict]:
    """Returns (holdings, warnings, investor_info, period)."""
    holdings, warnings = [], []

    inv = d.get("investor_info") or {}
    investor = {
        "name":    inv.get("name", ""),
        "email":   inv.get("email", ""),
        "mobile":  inv.get("mobile", ""),
        "address": inv.get("address", ""),
    }
    sp = d.get("statement_period") or {}
    period = {"from": sp.get("from_", sp.get("from", "")), "to": sp.get("to", "")}

    seen_isins = set()

    for acc in (d.get("accounts") or []):
        broker = acc.get("name", "")
        dp_id  = acc.get("dp_id", "")

        # ── Equities (INE ISINs) ──────────────────────────────────────────────
        for eq in (acc.get("equities") or []):
            isin  = eq.get("isin", "")
            if isin in seen_isins:
                continue
            seen_isins.add(isin)

            units  = f(eq.get("num_shares"))
            price  = f(eq.get("price"))
            value  = f(eq.get("value"))
            name   = clean_name(eq.get("name", ""))

            asset_type = "IN_STOCK"
            import re
            if re.search(r'etf|bees|gold\s*etf|nifty.*etf|sgb|sovereign\s*gold', name, re.I):
                asset_type = "IN_ETF"
            elif re.search(r'bond|debenture|ncd', name, re.I):
                asset_type = "FD"

            holdings.append({
                "name":           name,
                "type":           asset_type,
                "ticker":         isin,          # will be resolved to NSE ticker post-import
                "scheme_code":    isin,
                "units":          units,
                "purchase_nav":   None,          # not available in NSDL CAS
                "current_nav":    price,
                "purchase_price": None,
                "current_price":  price,
                "purchase_value": None,
                "current_value":  value,
                "source":         "cas",
                "brokerage_name": broker,
                "currency":       "INR",
                "_folio":         f"{dp_id}/{acc.get('client_id','')}",
                "_pan":           (acc.get("owners") or [{}])[0].get("PAN", ""),
                "_broker_dp_id":  dp_id,
            })

        # ── Mutual Funds (INF ISINs) ──────────────────────────────────────────
        for mf in (acc.get("mutual_funds") or []):
            isin  = mf.get("isin", "")
            if isin in seen_isins:
                continue
            seen_isins.add(isin)

            units   = f(mf.get("balance"))
            nav     = f(mf.get("nav"))
            value   = f(mf.get("value"))
            name    = mf.get("name", "")      # AMC name in NSDL CAS (not scheme name)

            holdings.append({
                "name":           name,
                "type":           "MF",
                "ticker":         isin,
                "scheme_code":    "",           # no AMFI code in NSDL demat MF row
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
                "_folio":         f"{dp_id}/{acc.get('client_id','')}",
                "_pan":           (acc.get("owners") or [{}])[0].get("PAN", ""),
                "_broker_dp_id":  dp_id,
            })

    return holdings, warnings, investor, period


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    if len(sys.argv) < 3:
        print("Usage: python cas_compare_casparser.py <cas.pdf> <password> [output.json]", file=sys.stderr)
        sys.exit(1)

    pdf_path = sys.argv[1]
    password = sys.argv[2]
    out_path = sys.argv[3] if len(sys.argv) > 3 else "cas_method_b.json"

    print(f"[casparser] Parsing: {pdf_path}")
    try:
        data = casparser.read_cas_pdf(pdf_path, password, output="dict")
    except Exception as e:
        print(f"ERROR: casparser failed — {e}", file=sys.stderr)
        sys.exit(1)

    cls_name = type(data).__name__
    print(f"[casparser] Detected type: {cls_name}")

    d = data.model_dump()

    if "accounts" in d:          # NSDLCASData
        holdings, warnings, investor, period = parse_nsdl_cas(d)
        cas_type  = "NSDL"
        file_type = str(d.get("file_type", "NSDL"))
    else:                         # CASData (CAMS / Kfintech)
        holdings, warnings, investor, period = parse_cams_cas(d)
        cas_type  = str(d.get("cas_type", "CAMS"))
        file_type = str(d.get("file_type", ""))

    output = {
        "method":           "casparser",
        "version":          casparser.__version__,
        "cas_type":         cas_type,
        "file_type":        file_type,
        "investor_info":    investor,
        "statement_period": period,
        "total_holdings":   len(holdings),
        "warnings":         warnings,
        "holdings":         holdings,
    }

    with open(out_path, "w", encoding="utf-8") as f_out:
        json.dump(output, f_out, indent=2, ensure_ascii=False, default=str)

    mf_count  = sum(1 for h in holdings if h["type"] == "MF")
    eq_count  = len(holdings) - mf_count
    print(f"[casparser] Done — {eq_count} equities + {mf_count} MFs = {len(holdings)} total")
    print(f"[casparser] Output → {out_path}")


if __name__ == "__main__":
    main()
