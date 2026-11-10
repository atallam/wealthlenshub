"""
Unit tests for services/cas_casparser_service.py — no PDFs needed (synthetic
casparser-shaped dicts), so nothing personal is committed.

    python3 -m unittest tests/test_cas_casparser_service.py -v
"""
import importlib.util
import pathlib
import re
import unittest

SVC = pathlib.Path(__file__).resolve().parent.parent / "services" / "cas_casparser_service.py"
_spec = importlib.util.spec_from_file_location("cas_svc", SVC)
svc = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(svc)


def _statement():
    """Shape of casparser's NSDLCASData.model_dump() for an Oct-2026 e-CAS."""
    return {
        "file_type": "NSDL",
        "investor_info": {"name": "TALLAM AVINASH"},
        "statement_period": {"from_": "01-Oct-2026", "to": "31-Oct-2026"},
        "parse_warnings": [],
        "accounts": [
            {   # corporate bond held at an NSDL DP
                "type": "NSDL Demat Account", "name": "WINT SECURITIES PRIVATE LIMITED",
                "dp_id": "IN304633", "client_id": "21000163", "owners": [], "balance": 246950.00,
                "equities": [], "mutual_funds": [],
                "bonds": [{"name": "UGRO CAPITAL LIMITED", "isin": "INE583D07687",
                           "num_bonds": 25, "face_value": 10000, "value": 246950.00}],
            },
            {   # one live folio + one fully redeemed folio
                "type": "Mutual Fund Folios", "name": "Mutual Fund Folios",
                "dp_id": "", "client_id": "", "owners": [], "balance": 104675.25,
                "equities": [], "bonds": [],
                "mutual_funds": [
                    {"name": "HDFC Mid Cap Fund - Regular Plan - Growth", "isin": "INF179K01CR2",
                     "balance": 537.847, "nav": 194.619, "value": 104675.25, "type": "Equity"},
                    {"name": "Invesco India Small Cap Fund - Regular Plan Growth", "isin": "INF205K011T7",
                     "balance": 0, "nav": 0, "value": 0, "type": "Equity"},
                ],
            },
        ],
    }


class NsdlParsing(unittest.TestCase):
    def setUp(self):
        self.holdings, self.warnings, *_ = svc.parse_nsdl(_statement())

    def test_bond_becomes_in_bond(self):
        bond = next(h for h in self.holdings if h["isin"] == "INE583D07687")
        self.assertEqual(bond["type"], "IN_BOND")
        self.assertEqual(bond["units"], 25)
        self.assertAlmostEqual(bond["current_value"], 246950.00)
        self.assertAlmostEqual(bond["current_price"], 9878.00)

    def test_closed_folio_is_not_a_holding(self):
        self.assertNotIn("INF205K011T7", [h["isin"] for h in self.holdings])
        self.assertTrue(any("fully redeemed" in w for w in self.warnings))

    def test_live_folio_kept(self):
        self.assertIn("INF179K01CR2", [h["isin"] for h in self.holdings])


class Reconciliation(unittest.TestCase):
    def test_ok_when_everything_parsed(self):
        d = _statement()
        holdings, *_ = svc.parse_nsdl(d)
        r = svc.reconcile_nsdl(d, holdings)
        self.assertTrue(r["ok"])
        self.assertAlmostEqual(r["statement_total"], 351625.25)
        self.assertAlmostEqual(r["diff"], 0)

    def test_flags_a_dropped_account(self):
        d = _statement()
        holdings, *_ = svc.parse_nsdl(d)
        partial = [h for h in holdings if h["account_id"] == "MF-FOLIOS"]   # demat account lost
        r = svc.reconcile_nsdl(d, partial)
        self.assertFalse(r["ok"])
        bad = [a for a in r["accounts"] if not a["ok"]]
        self.assertEqual([a["account_id"] for a in bad], ["IN304633/21000163"])
        self.assertAlmostEqual(r["diff"], 246950.00)

    def test_catches_accounts_casparser_never_detected(self):
        """The real NSDL-2026 failure: demat accounts missing from casparser's roster, so
        per-account values alone look fine. The statement's headline total exposes it."""
        d = _statement()
        d["accounts"] = [a for a in d["accounts"] if a["type"] == "Mutual Fund Folios"]
        holdings, *_ = svc.parse_nsdl(d)
        r = svc.reconcile_nsdl(d, holdings, stated_total=351625.25)
        self.assertFalse(r["ok"])
        self.assertAlmostEqual(r["statement_total"], 351625.25)
        bad = [a for a in r["accounts"] if not a["ok"]]
        self.assertEqual([a["account_id"] for a in bad], ["__undetected__"])
        self.assertAlmostEqual(bad[0]["statement_value"], 246950.00)

    def test_stated_total_matching_everything_is_ok(self):
        d = _statement()
        holdings, *_ = svc.parse_nsdl(d)
        self.assertTrue(svc.reconcile_nsdl(d, holdings, stated_total=351625.25)["ok"])

    def test_nps_is_accounted_for_but_not_imported(self):
        d = _statement()
        d["nps"] = {"pran": "x", "nps_sp": "y", "value": 50000.00, "schemes": []}
        holdings, *_ = svc.parse_nsdl(d)
        r = svc.reconcile_nsdl(d, holdings, stated_total=401625.25)
        self.assertTrue(r["ok"])
        self.assertAlmostEqual(r["nps_not_imported"], 50000.00)


class Tolerance(unittest.TestCase):
    def test_a_missed_thousand_rupees_is_flagged_on_a_large_account(self):
        d = {"accounts": [{"type": "CDSL Demat Account", "name": "BIG", "dp_id": "1", "client_id": "2",
                           "balance": 2354636.25}]}
        h = [{"account_id": "1/2", "current_value": 2354636.25 - 1000.0}]
        self.assertFalse(svc.reconcile_nsdl(d, h, stated_total=2354636.25)["ok"])

    def test_rounding_noise_is_tolerated(self):
        d = {"accounts": [{"type": "CDSL Demat Account", "name": "BIG", "dp_id": "1", "client_id": "2",
                           "balance": 2354636.25}]}
        h = [{"account_id": "1/2", "current_value": 2354636.25 - 0.40}]
        self.assertTrue(svc.reconcile_nsdl(d, h, stated_total=2354636.25)["ok"])


class EtfClassification(unittest.TestCase):
    def _run(self, names):
        d = {"file_type": "NSDL", "investor_info": {"name": "X"}, "statement_period": {"from_": "01-Oct-2026", "to": "31-Oct-2026"},
             "accounts": [{"type": "NSDL Demat Account", "name": "ICICI", "dp_id": "IN303028", "client_id": "1",
                           "owners": [], "balance": 0, "equities": [], "bonds": [],
                           "mutual_funds": [{"name": n, "isin": f"INF00000000{i}", "balance": 10, "nav": 100.0,
                                             "value": 1000.0, "type": ""} for i, n in enumerate(names)]}]}
        holdings, *_ = svc.parse_nsdl(d)
        return {h["isin"]: h for h in holdings}

    def test_gold_etf_becomes_in_etf_with_clean_name(self):
        out = self._run(["ICICI PRUDENTIAL MUTUAL FUND GOLD EXCHANGE TRADED FUND OPEN ENDED--"])
        h = next(iter(out.values()))
        self.assertEqual(h["type"], "IN_ETF")
        self.assertEqual(h["name"], "ICICI PRUDENTIAL GOLD EXCHANGE TRADED FUND")

    def test_plain_and_fund_of_fund_stay_mf(self):
        out = self._run(["HDFC MUTUAL FUND", "XYZ Gold ETF Fund of Fund - Direct Plan"])
        self.assertEqual({h["type"] for h in out.values()}, {"MF"})

    def test_bees_and_etf_names(self):
        self.assertTrue(svc.is_exchange_traded_fund("NIPPON INDIA ETF NIFTY BEES"))
        self.assertTrue(svc.is_exchange_traded_fund("Mirae Asset Nifty 50 ETF"))
        self.assertFalse(svc.is_exchange_traded_fund("Parag Parikh Flexi Cap Fund - Regular Plan Growth"))


class Dates(unittest.TestCase):
    def test_dd_mon_yyyy_to_iso(self):
        self.assertEqual(svc.fmt_date("31-Oct-2026"), "2026-10-31")
        self.assertEqual(svc.fmt_date("01-Oct-2026"), "2026-10-01")

    def test_existing_formats_unchanged(self):
        self.assertEqual(svc.fmt_date("2026-10-31"), "2026-10-31")
        self.assertEqual(svc.fmt_date("31-10-2026"), "2026-10-31")
        self.assertIsNone(svc.fmt_date(None))

    def test_statement_period_is_iso(self):
        _, _, _, _, p_from, p_to, _ = svc.parse_nsdl(_statement())
        self.assertEqual((p_from, p_to), ("2026-10-01", "2026-10-31"))


class CasparserCompat(unittest.TestCase):
    def test_duplicated_account_type_label_is_accepted(self):
        try:
            from casparser.parsers import nsdl
        except Exception:
            self.skipTest("casparser not installed")
        svc._patch_casparser_for_nsdl_2026()
        label = "NSDL Demat Account\nNSDL Demat Account"        # NSDL 2026 e-CAS page-2 cell
        self.assertTrue(nsdl.DEMAT_TYPE_RE.match(label))
        self.assertTrue(nsdl.DEMAT_TYPE_RE.match("CDSL Demat Account"))
        self.assertFalse(nsdl.DEMAT_TYPE_RE.match("Your Demat Account and Mutual Fund Folios"))


if __name__ == "__main__":
    unittest.main()
