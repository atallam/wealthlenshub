"""
cas_diff.py
-----------
Compare outputs from Method A (existing Node.js parser) and
Method B (casparser Python library) and print a side-by-side report.

Usage:
    python tools/cas_diff.py cas_method_a.json cas_method_b.json

Produces:
    - Summary table
    - Per-holding diff (matched by ISIN / scheme name)
    - Verdict and recommendation
"""

import sys
import json
from typing import Optional


# ─── Helpers ─────────────────────────────────────────────────────────────────

def load(path: str) -> dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f)

def famt(v: Optional[float], currency="₹") -> str:
    if v is None:
        return "—"
    return f"{currency}{v:,.2f}"

def funits(v: Optional[float]) -> str:
    if v is None:
        return "—"
    return f"{v:,.4f}"

def pct_diff(a: Optional[float], b: Optional[float]) -> str:
    if a is None or b is None or b == 0:
        return "—"
    return f"{abs(a - b) / abs(b) * 100:.2f}%"

def match_key(h: dict) -> str:
    return (h.get("ticker") or "").strip() or (h.get("name") or "").strip().lower()


# ─── Build index ─────────────────────────────────────────────────────────────

def index_holdings(holdings: list) -> dict:
    idx = {}
    for h in holdings:
        k = match_key(h)
        if k:
            idx[k] = h
    return idx


# ─── Diff ────────────────────────────────────────────────────────────────────

def compare_holding(ha: dict, hb: dict) -> dict:
    """Return a diff dict for two matched holdings."""
    fields = [
        ("units",          "Units",          funits),
        ("purchase_nav",   "Purchase NAV",   famt),
        ("current_nav",    "Current NAV",    famt),
        ("purchase_value", "Invested (₹)",   famt),
        ("current_value",  "Current Val (₹)",famt),
    ]
    diffs = {}
    for key, label, fmt in fields:
        va, vb = ha.get(key), hb.get(key)
        match = (va is None and vb is None) or (va is not None and vb is not None and abs(va - vb) < max(0.01, abs(va or vb) * 0.01))
        diffs[key] = {
            "label": label,
            "method_a": fmt(va),
            "method_b": fmt(vb),
            "pct_diff": pct_diff(va, vb),
            "match": match,
        }
    return diffs


# ─── Print report ─────────────────────────────────────────────────────────────

COL = 28

def hr(char="-", width=120):
    print(char * width)

def row(*cols, widths=None):
    widths = widths or [COL] * len(cols)
    print("  ".join(str(c).ljust(w) for c, w in zip(cols, widths)))


def print_report(a: dict, b: dict):
    idx_a = index_holdings(a["holdings"])
    idx_b = index_holdings(b["holdings"])

    all_keys = sorted(set(idx_a.keys()) | set(idx_b.keys()))
    only_a   = [k for k in all_keys if k in idx_a and k not in idx_b]
    only_b   = [k for k in all_keys if k in idx_b and k not in idx_a]
    common   = [k for k in all_keys if k in idx_a and k in idx_b]

    print()
    hr("=")
    print("  CAS PARSER COMPARISON REPORT")
    hr("=")

    # ── Meta summary ─────────────────────────────────────────────────────────
    print()
    row("Field", "Method A  (existing Node.js)", "Method B  (casparser Python)", widths=[32, 35, 35])
    hr()
    row("Parser",        a.get("method",""),          b.get("method",""),          widths=[32,35,35])
    row("CAS type",      a.get("depository",""),       b.get("cas_type",""),        widths=[32,35,35])
    row("Period start",  a.get("period_start",""),     b.get("statement_period",{}).get("from",""), widths=[32,35,35])
    row("Period end",    a.get("period_end",""),       b.get("statement_period",{}).get("to",""),   widths=[32,35,35])
    row("Holder name",   (a.get("holder_names") or ["—"])[0], b.get("investor_info",{}).get("name","—"), widths=[32,35,35])
    row("PAN",           (a.get("holder_pans")  or ["—"])[0], b.get("investor_info",{}).get("name","—"), widths=[32,35,35])
    row("Holdings count",str(len(a["holdings"])),      str(b.get("total_schemes",len(b["holdings"]))), widths=[32,35,35])

    # ── Match summary ─────────────────────────────────────────────────────────
    print()
    hr("=")
    print("  HOLDINGS MATCH SUMMARY")
    hr("=")
    print(f"  Common  (in both)   : {len(common)}")
    print(f"  Only in Method A    : {len(only_a)}  {only_a[:5]}")
    print(f"  Only in Method B    : {len(only_b)}  {only_b[:5]}")
    match_rate = (len(common) / max(len(all_keys), 1)) * 100
    print(f"  Match rate          : {match_rate:.1f}%")

    # ── Per-holding diff ──────────────────────────────────────────────────────
    discrepancies = []
    for k in common:
        ha, hb = idx_a[k], idx_b[k]
        diffs = compare_holding(ha, hb)
        any_mismatch = any(not d["match"] for d in diffs.values())
        if any_mismatch:
            discrepancies.append((k, ha, hb, diffs))

    print()
    hr("=")
    print(f"  FIELD-LEVEL DIFFS  ({len(discrepancies)} holding(s) with discrepancies)")
    hr("=")

    for k, ha, hb, diffs in discrepancies[:20]:  # cap at 20 for readability
        print()
        print(f"  ▶ {(ha.get('name') or k)[:80]}")
        print(f"    ISIN: {k}")
        row("  Field", "Method A", "Method B", "Δ%", widths=[22, 20, 20, 10])
        hr("-", 80)
        for field, d in diffs.items():
            flag = "  " if d["match"] else "⚠ "
            print(f"  {flag}{d['label']:<20} {d['method_a']:<20} {d['method_b']:<20} {d['pct_diff']}")

    if not discrepancies:
        print()
        print("  ✅ All common holdings match within 1% tolerance!")

    # ── Only-in-A / only-in-B ─────────────────────────────────────────────────
    if only_a:
        print()
        hr("=")
        print("  HOLDINGS ONLY IN METHOD A (existing parser)")
        hr("=")
        for k in only_a:
            h = idx_a[k]
            print(f"  {h.get('name','?')[:60]}  |  {k}  |  units={funits(h.get('units'))}  |  val={famt(h.get('current_value'))}")

    if only_b:
        print()
        hr("=")
        print("  HOLDINGS ONLY IN METHOD B (casparser)")
        hr("=")
        for k in only_b:
            h = idx_b[k]
            print(f"  {h.get('name','?')[:60]}  |  {k}  |  units={funits(h.get('units'))}  |  val={famt(h.get('current_value'))}")

    # ── Capability matrix ──────────────────────────────────────────────────────
    print()
    hr("=")
    print("  CAPABILITY MATRIX")
    hr("=")
    caps = [
        ("MF holdings (CAMS/Kfintech)",   "✅", "✅"),
        ("MF holdings (NSDL/CDSL CAS)",   "✅", "❌  (CAMS/Kfintech only)"),
        ("Demat equity holdings (INE…)",  "✅", "❌  (MF folios only)"),
        ("Transaction history",            "❌  (snapshot only)", "✅  (full txn list)"),
        ("Investor email / mobile",        "❌", "✅"),
        ("Folio number",                   "✅  (best-effort)", "✅  (exact)"),
        ("AMFI scheme code",               "✅  (via AMFI API lookup)", "✅  (from PDF)"),
        ("ISIN → scheme name",             "✅", "✅"),
        ("PAN extraction",                 "✅", "✅"),
        ("Password auto-try (multi-PAN)",  "✅", "❌  (single password)"),
        ("Language",                       "Node.js (inline)", "Python (subprocess)"),
        ("Offline (no API calls)",         "❌  (calls AMFI/Yahoo)", "✅"),
    ]
    row("Feature", "Method A  (existing)", "Method B  (casparser)", widths=[40, 30, 35])
    hr("-", 110)
    for feat, a_val, b_val in caps:
        row(feat, a_val, b_val, widths=[40, 30, 35])

    # ── Verdict ───────────────────────────────────────────────────────────────
    print()
    hr("=")
    print("  RECOMMENDATION")
    hr("=")
    print("""
  Use casparser AS A COMPLEMENT for CAMS/Kfintech CAS files:
    • Better transaction history (for XIRR calculation)
    • Accurate folio numbers and AMFI codes straight from PDF
    • More investor metadata (email, mobile)

  Keep existing parser AS PRIMARY for:
    • NSDL/CDSL demat CAS (equities + bonds in demat form)
    • Multi-PAN auto-unlock flow
    • Integrated AMFI/Yahoo live price enrichment

  Integration path (if you confirm):
    1. Detect CAS type on upload (CAMS/Kfintech vs NSDL/CDSL)
    2. Route CAMS/Kfintech PDFs through casparser via Python subprocess
    3. Route NSDL/CDSL PDFs through existing parseNSDLCASStatement
    4. Merge outputs into single WealthLens holdings array
""")
    hr("=")


# ─── Entry point ─────────────────────────────────────────────────────────────

def main():
    if len(sys.argv) < 3:
        print("Usage: python cas_diff.py cas_method_a.json cas_method_b.json", file=sys.stderr)
        sys.exit(1)

    a = load(sys.argv[1])
    b = load(sys.argv[2])
    print_report(a, b)


if __name__ == "__main__":
    main()
