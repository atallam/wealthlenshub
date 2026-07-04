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

On error: exits with code 1 and writes {"error": "..."} to stdout.

Requires:
    pip install casparser casparser-isin pymupdf --break-system-packages
"""

import sys
import json
import re
from pathlib import Path


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
    seen_isins = set()

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

        broker = acc.get("name", "")
        dp_id  = acc.get("dp_id", "")
        folio  = f"{dp_id}/{acc.get('client_id', '')}"

        pan = holder_pans[0] if holder_pans else ""

        # Primary owner of this account (used for multi-holder account_map lookup)
        acc_owner_name = (acc.get("owners") or [{}])[0].get("name", "").strip() if acc.get("owners") else ""
        acc_owner_pan  = (acc.get("owners") or [{}])[0].get("PAN",  "").strip().upper() if acc.get("owners") else ""
        if not acc_owner_name and holder_names:
            acc_owner_name = holder_names[0]  # Fall back to first holder

        # ── Equities ───────────────────────────────────────────────────────
        for eq in (acc.get("equities") or []):
            isin = eq.get("isin", "")
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
                "_folio":         folio,
                "_pan":           acc_owner_pan or pan,
                "_holder_name":   acc_owner_name,
            })

        # ── Mutual Funds ───────────────────────────────────────────────────
        for mf in (acc.get("mutual_funds") or []):
            isin = mf.get("isin", "")
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
                "_folio":         folio,
                "_pan":           acc_owner_pan or pan,
                "_holder_name":   acc_owner_name,
            })

    return holdings, warnings, holder_names, holder_pans, period_from, period_to, "NSDL"


# ── CAMS / Kfintech CAS (CASData → folios with schemes) ─────────────────────

def parse_cams(d: dict) -> tuple:
    holdings, warnings = [], []

    inv = d.get("investor_info") or {}
    inv_name = (inv.get("name") or "").strip()
    inv_pan  = (inv.get("PAN") or inv.get("pan") or "").strip().upper()

    holder_names = [inv_name] if inv_name else []
    holder_pans  = [inv_pan]  if inv_pan  else []

    sp = d.get("statement_period") or {}
    period_from = fmt_date(sp.get("from_") or sp.get("from") or "")
    period_to   = fmt_date(sp.get("to") or "")

    for folio in (d.get("folios") or []):
        folio_num = folio.get("folio", "")
        amc       = folio.get("amc", "")
        pan       = (folio.get("PAN") or inv_pan or "").strip().upper()
        if pan and pan not in holder_pans:
            holder_pans.append(pan)

        for scheme in (folio.get("schemes") or []):
            val      = scheme.get("valuation") or {}
            close    = f(scheme.get("close"))
            cur_nav  = f(val.get("nav"))
            cur_val  = f(val.get("value"))
            cost     = f(val.get("cost"))
            cost_nav = (cost / close) if (cost and close) else None

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
                "_holder_name":   inv_name,  # CAMS is always single-holder
            })

    cas_type = str(d.get("cas_type", "CAMS"))
    return holdings, warnings, holder_names, holder_pans, period_from, period_to, cas_type


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    if len(sys.argv) < 3:
        out = {"error": "Usage: cas_casparser_service.py <pdf_path> <password>"}
        print(json.dumps(out))
        sys.exit(1)

    pdf_path = sys.argv[1]
    password = sys.argv[2]

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
        data = casparser.read_cas_pdf(pdf_path, password, output="dict")
    except Exception as e:
        err_msg = str(e)
        # Surface password errors clearly so the Node route can detect them
        if "password" in err_msg.lower() or "incorrect" in err_msg.lower() or "encrypted" in err_msg.lower():
            out = {"error": "password_incorrect"}
        elif "not a pdf" in err_msg.lower() or "invalid" in err_msg.lower():
            out = {"error": f"Invalid PDF: {err_msg}"}
        else:
            out = {"error": f"casparser failed: {err_msg}"}
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
        "holder_member_map": {},
        "_parser":           "casparser",
        "_version":          getattr(casparser, "__version__", "unknown"),
    }

    print(json.dumps(response, default=str, ensure_ascii=False))


if __name__ == "__main__":
    main()
