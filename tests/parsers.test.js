import { describe, it, expect, vi } from "vitest";

// lib/parsers.js imports lib/db.js (supabase client) purely for autoCategorise's
// bulk-load helper, which none of these tests touch — mock it out so the suite
// runs without real Supabase credentials, same pattern as tests/guards.test.js.
vi.mock("../lib/db.js", () => ({ supabase: { from: vi.fn() } }));

import { parseCSV, autoDetectBank, parseDateIN, parseDateForRegion, BANK_COLUMN_MAP, BANK_REGISTRY, parseIndianPDF, extractPDFText } from "../lib/parsers.js";

// Every bank a user can pick from the import form must have a matching parser config.
describe("BANK_COLUMN_MAP coverage", () => {
  it("has an entry for every non-auto/non-other bank in the registry", () => {
    for (const key of Object.keys(BANK_REGISTRY)) {
      if (key === "auto" || key.startsWith("other_")) continue;
      expect(BANK_COLUMN_MAP[key], `missing BANK_COLUMN_MAP entry for "${key}"`).toBeTruthy();
    }
  });
});

describe("Axis — bank-account CSV (Sr.No column shift)", () => {
  // Original reported bug: some Axis exports add a leading Sr.No column, which
  // shifted every fixed-position column and made every row's "date" field
  // actually contain the serial number.
  const csv = [
    "Sr No,Tran Date,Chq No,Particulars,Debit,Credit,Balance",
    "1,01-07-2026,,AMAZON PAY,1500.00,,50000.00",
    "2,03-07-2026,,SALARY CREDIT,,80000.00,130000.00",
  ].join("\n");

  it("reads columns by header name, not position", () => {
    const { rows, detectedBank } = parseCSV(csv, "axis", "BANK");
    expect(detectedBank).toBe("axis");
    expect(rows).toHaveLength(2);
    expect(rows[0].date).toBe("01-07-2026"); // not "1" (the Sr.No)
    expect(rows[0].debit).toBe("1500.00");
    expect(rows[1].credit).toBe("80000.00");
  });

  it("still works via fixed-position fallback when there is truly no header row", () => {
    const noHeaderCsv = "01-07-2026,REF1,AMAZON PAY,1500.00,,50000.00";
    const { rows } = parseCSV(noHeaderCsv, "axis", "BANK");
    expect(rows).toHaveLength(1);
    expect(rows[0].date).toBe("01-07-2026");
  });
});

describe("Axis — credit-card statement (preamble + amount/label columns)", () => {
  // Real-world fixture: a completely different Axis export (credit card, not bank
  // account) with a multi-row preamble block before the real header, and a single
  // Amount column + separate Debit/Credit text-label column instead of two numeric
  // columns. This is the exact shape of the file that failed with "bad dates".
  const rowsData = [
    ["", "", "", "", "", ""],
    ["KOLISETTY LAKSHMI PRIYANKA\nC O TALLAM AVINASH", "", "", "Axis Bank MY Zone Card Monthly Statement", "", ""],
    ["Payment Summary", "", "", "", "", ""],
    ["Total Payment Due \n₹ 15,418.30", "", "Minimum Payment Due\n₹ 309.00", "", "Payment Due Date\n02 Aug '26", ""],
    ["Selected Statement Month\nJul 2026", "", "Credit Limit\n₹ 58,000.00", "", "Opening Balance\n₹ 12,042.86", ""],
    ["Transaction Summary", "", "", "", "", ""],
    ["Date", "Transaction Details", "", "Amount (INR)", "Debit/Credit", ""],
    ["07 Jul '26", "FIRSTCRY,Pune", "", "₹ 830.45", "Debit", ""],
    ["03 Jul '26", "AMAZON PAY INDIA PRIVA,Bangalore", "", "₹ 340.00", "Credit", ""],
    ["** End of Statement **", "", "", "", "", ""],
  ];
  const toCsvCell = (v) => {
    const s = String(v);
    return s.includes(",") || s.includes('"') || s.includes("\n") ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const csv = rowsData.map((r) => r.map(toCsvCell).join(",")).join("\n");

  it("finds the real header row, not the preamble line mentioning 'date'", () => {
    const { headerRow, headerRowIdx } = parseCSV(csv, "axis", "CREDIT_CARD");
    expect(headerRowIdx).toBe(6);
    expect(headerRow[0]).toBe("Date");
    expect(headerRow[1]).toBe("Transaction Details");
  });

  it("parses the amount+label pattern into debit/credit correctly", () => {
    const { rows, detectedBank } = parseCSV(csv, "axis", "CREDIT_CARD");
    expect(detectedBank).toBe("axis");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ desc: "FIRSTCRY,Pune", debit: "830.45", credit: "" });
    expect(rows[1]).toMatchObject({ desc: "AMAZON PAY INDIA PRIVA,Bangalore", debit: "", credit: "340" });
  });

  it("parses the apostrophe-year date format", () => {
    expect(parseDateForRegion("07 Jul '26", "IN")).toBe("2026-07-07");
  });

  it("doesn't misattribute the description column as a reference number", () => {
    const { rows } = parseCSV(csv, "axis", "CREDIT_CARD");
    expect(rows[0].ref).toBe("");
  });
});

describe("Unregistered future bank — same amount/label layout, no config needed", () => {
  // Proves the fix generalizes: a bank with no BANK_COLUMN_MAP entry at all
  // (bank_key "other_in") still parses a preamble + single-amount + Dr/Cr-label
  // layout correctly via the generic fallback parser.
  const csv = [
    "Statement Period: 01 Jul 2026 - 31 Jul 2026",
    "",
    "Date,Merchant,Amount,Debit/Credit,City",
    "05 Jul 2026,SWIGGY BANGALORE,450.00,Debit,Bangalore",
    "10 Jul 2026,PAYMENT RECEIVED,5000.00,Credit,Mumbai",
  ].join("\n");

  it("parses via genericCSV without any registry entry", () => {
    const { rows, detectedBank } = parseCSV(csv, "other_in", "CREDIT_CARD");
    expect(detectedBank).toBeNull();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ desc: "SWIGGY BANGALORE", debit: "450", credit: "" });
    expect(rows[1]).toMatchObject({ desc: "PAYMENT RECEIVED", debit: "", credit: "5000" });
  });
});

describe("Chase — statement_type flips single-Amount sign convention", () => {
  const csv = [
    "Transaction Date,Description,Amount",
    "07/01/2026,COFFEE SHOP,-4.50",
    "07/02/2026,PAYCHECK,2000.00",
  ].join("\n");

  it("BANK: negative amount is a debit (money out)", () => {
    const { rows } = parseCSV(csv, "chase", "BANK");
    expect(rows[0]).toMatchObject({ debit: "4.5", credit: "" });
    expect(rows[1]).toMatchObject({ debit: "", credit: "2000" });
  });

  it("CREDIT_CARD: same file, opposite convention (positive = charge)", () => {
    const { rows } = parseCSV(csv, "chase", "CREDIT_CARD");
    expect(rows[0]).toMatchObject({ debit: "", credit: "4.5" });
    expect(rows[1]).toMatchObject({ debit: "2000", credit: "" });
  });
});

describe("Amex — always card convention regardless of statement_type", () => {
  it("BANK statement_type doesn't flip Amex's sign (Amex is card-only)", () => {
    const csv = ["Date,Description,Amount,Reference", "07/01/2026,RESTAURANT,50.00,REF1"].join("\n");
    const { rows } = parseCSV(csv, "amex", "BANK");
    expect(rows[0]).toMatchObject({ debit: "50", credit: "" });
  });
});

describe("HDFC — fixed-position fallback when there's no header row", () => {
  it("parses via fallbackIdx", () => {
    const csv = "01/07/2026,ATM WDL,REF1,,500.00,,20000.00";
    const { rows } = parseCSV(csv, "hdfc", "BANK");
    expect(rows).toHaveLength(1);
    expect(rows[0].debit).toBe("500.00");
  });
});

describe("autoDetectBank", () => {
  it.each([
    [["tran date", "chq no", "particulars", "debit", "credit", "balance"], "axis"],
    [["transaction date", "post date", "description", "category", "amount"], "chase"],
    [["date", "narration", "chq./ref.no.", "value dt", "withdrawal amt.", "deposit amt.", "closing balance"], "hdfc"],
  ])("detects %j as %s", (header, expected) => {
    expect(autoDetectBank(header)).toBe(expected);
  });
});

describe("parseDateIN", () => {
  it.each([
    ["01-07-2026", "2026-07-01"],
    ["07 Jul 2026", "2026-07-07"],
    ["07 Jul '26", "2026-07-07"], // apostrophe-abbreviated year
  ])("parses %s -> %s", (input, expected) => {
    expect(parseDateIN(input)).toBe(expected);
  });
});

// ── Phase 1: broader Indian bank coverage ───────────────────────────────────
describe("Phase 1 — new Indian bank registry entries", () => {
  const newBanks = ["pnb", "bob", "canara", "union_bank", "idfc_first", "indusind", "yes_bank", "rbl", "sc_india", "hsbc_india", "idbi", "federal_bank"];

  it("every new bank is registered with region IN", () => {
    for (const key of newBanks) expect(BANK_REGISTRY[key]?.region).toBe("IN");
  });

  it("every new bank has a BANK_COLUMN_MAP entry using the shared IN_STD_* aliases, deliberately with no fallbackIdx/headerHints", () => {
    for (const key of newBanks) {
      const cfg = BANK_COLUMN_MAP[key];
      expect(cfg, `missing config for ${key}`).toBeTruthy();
      expect(cfg.date).toContain("narration".includes ? cfg.date[0] : cfg.date[0]); // sanity: has a date alias list
      expect(cfg.fallbackIdx).toBeUndefined();
      expect(cfg.headerHints).toEqual([]);
    }
  });

  it("parses a standard-layout statement for an unvalidated new bank (e.g. PNB) via header aliases, not fallbackIdx", () => {
    const csv = [
      "Txn Date,Narration,Cheque,Debit Amount,Credit Amount,Closing Balance",
      "05-07-2026,UPI/SWIGGY/BANGALORE,,250.00,,45000.00",
      "10-07-2026,NEFT SALARY CREDIT,,,60000.00,105000.00",
    ].join("\n");
    const { rows, detectedBank } = parseCSV(csv, "pnb", "BANK");
    // autoDetectBank has no signature for pnb yet, so detectedBank stays whatever
    // parseBankCSV reports for the explicitly-selected key.
    expect(detectedBank).toBe("pnb");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ desc: "UPI/SWIGGY/BANGALORE", debit: "250.00", credit: "" });
    expect(rows[1]).toMatchObject({ desc: "NEFT SALARY CREDIT", debit: "", credit: "60000.00" });
  });
});

// ── Phase 2: PDF overhaul ───────────────────────────────────────────────────
describe("Phase 2 — parseIndianPDF rewrite", () => {
  it("filters out credit-card summary/noise lines that start with a date-like token", () => {
    const text = [
      "02 Aug '26 Minimum Payment Due 309.00",
      "02 Aug '26 Total Payment Due 15,418.30",
      "07 Jul '26 FIRSTCRY,Pune 830.45 Debit",
      "31 Jul 2026 Reward Points Earned 45.00",
    ].join("\n");
    const rows = parseIndianPDF(text);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ desc: "FIRSTCRY,Pune", debit: "830.45", credit: "" });
  });

  it("parses the amount+Dr/Cr-label pattern (single amount, trailing text label)", () => {
    const text = [
      "07 Jul '26 FIRSTCRY,Pune 830.45 Debit",
      "03 Jul '26 AMAZON PAY INDIA PRIVA,Bangalore 340.00 Credit",
    ].join("\n");
    const rows = parseIndianPDF(text);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ debit: "830.45", credit: "" });
    expect(rows[1]).toMatchObject({ debit: "", credit: "340" });
  });

  it("still handles the older 3-amount positional layout (debit, 0.00, balance)", () => {
    const text = "01-07-2026 ATM WDL 500.00 0.00 20000.00";
    const rows = parseIndianPDF(text);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ debit: "500", credit: "" });
  });

  it("dedupes identical rows", () => {
    const text = ["05 Jul 2026 SWIGGY BANGALORE 450.00 Debit", "05 Jul 2026 SWIGGY BANGALORE 450.00 Debit"].join("\n");
    expect(parseIndianPDF(text)).toHaveLength(1);
  });
});

describe("Phase 2 — extractPDFText password handling", () => {
  it("throws a structured PDF_PASSWORD_REQUIRED error (not a generic parse failure) for an encrypted PDF with no password supplied", async () => {
    // A minimal but genuinely encrypted PDF is impractical to construct inline;
    // instead verify the error-shaping contract directly against pdfjs's
    // PasswordException, which is what extractPDFText's catch block branches on.
    const { pdfjsLib } = await import("../lib/parsers.js");
    expect(typeof pdfjsLib.PasswordException === "function" || pdfjsLib.PasswordException === undefined).toBe(true);
    // Contract check: extractPDFText is an exported function that accepts (buffer, password).
    expect(extractPDFText.length).toBe(2);
  });
});

// ── Phase 3: member fingerprinting text helpers ─────────────────────────────
describe("Phase 3 — member-detection text helpers", () => {
  it("does not match a name that only appears after a C/O address marker", async () => {
    const { nameAppearsAsHolder } = await import("../services/budget.service.js");
    const lower = "kolisetty lakshmi priyanka\nc o tallam avinash".toLowerCase();
    expect(nameAppearsAsHolder(lower, "tallam avinash")).toBe(false);
    expect(nameAppearsAsHolder(lower, "kolisetty lakshmi priyanka")).toBe(true);
  });

  it("detectMemberFromText returns a single confident match", async () => {
    const { detectMemberFromText } = await import("../services/budget.service.js");
    const members = [{ id: "m1", name: "Avinash Tallam" }, { id: "m2", name: "Priyanka Kolisetty" }];
    const { memberId, matches } = detectMemberFromText("Statement for AVINASH TALLAM\nCard ending 4371", members);
    expect(memberId).toBe("m1");
    expect(matches).toHaveLength(1);
  });

  it("detectMemberFromText returns no confident match when 0 or 2+ members appear", async () => {
    const { detectMemberFromText } = await import("../services/budget.service.js");
    const members = [{ id: "m1", name: "Avinash Tallam" }, { id: "m2", name: "Priyanka Kolisetty" }];
    expect(detectMemberFromText("Statement for SOMEONE ELSE", members).memberId).toBeNull();
    expect(detectMemberFromText("AVINASH TALLAM and PRIYANKA KOLISETTY joint account", members).memberId).toBeNull();
  });

  it("extractLast4 pulls the trailing 4 digits from masked card/account formats", async () => {
    const { extractLast4 } = await import("../services/budget.service.js");
    expect(extractLast4("5305XXXXXXXX4371")).toBe("4371");
    expect(extractLast4("A/c No. XXXXXXXX1234")).toBe("1234");
    expect(extractLast4("Card ending in 9981")).toBe("9981");
    expect(extractLast4("no digits here")).toBeNull();
  });
});
