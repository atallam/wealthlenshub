import { describe, it, expect } from "vitest";
import { enrichMfFromAmfi, isAmcLevelName } from "../lib/casEnrich.js";

const AMFI = [
  { scheme_code: "118989", isin1: "INF179KC1981", isin2: "", name: "HDFC Flexi Cap Fund - Regular Plan - Growth" },
  { scheme_code: "120503", isin1: "INF179K01CR2", isin2: "", name: "HDFC Mid Cap Fund - Growth Option - Regular Plan" },
];

describe("isAmcLevelName", () => {
  it("flags fund-house-only names", () => {
    expect(isAmcLevelName("HDFC MUTUAL FUND")).toBe(true);
    expect(isAmcLevelName("  JIO BLACKROCK MUTUAL FUND ")).toBe(true);
  });
  it("leaves real scheme names alone", () => {
    expect(isAmcLevelName("HDFC Mid Cap Fund - Regular Plan - Growth")).toBe(false);
    expect(isAmcLevelName("")).toBe(false);
    expect(isAmcLevelName(null)).toBe(false);
  });
});

describe("enrichMfFromAmfi", () => {
  it("replaces an AMC-level demat name with the scheme name and fills scheme_code", () => {
    const rows = [{ type: "MF", isin: "INF179KC1981", ticker: "INF179KC1981", name: "HDFC MUTUAL FUND", scheme_code: "" }];
    expect(enrichMfFromAmfi(rows, AMFI)).toBe(1);
    expect(rows[0].name).toBe("HDFC Flexi Cap Fund - Regular Plan - Growth");
    expect(rows[0].scheme_code).toBe("118989");
  });

  it("keeps the statement's own scheme name for folio-held funds but still fills scheme_code", () => {
    const rows = [{ type: "MF", isin: "INF179K01CR2", name: "HDFC Mid Cap Fund - Regular Plan - Growth", scheme_code: "" }];
    enrichMfFromAmfi(rows, AMFI);
    expect(rows[0].name).toBe("HDFC Mid Cap Fund - Regular Plan - Growth");
    expect(rows[0].scheme_code).toBe("120503");
  });

  it("never touches non-MF rows, unknown ISINs, or an existing scheme_code", () => {
    const rows = [
      { type: "IN_ETF", isin: "INF179KC1981", name: "HDFC MUTUAL FUND", scheme_code: "" },
      { type: "MF", isin: "INF000000000", name: "XYZ MUTUAL FUND", scheme_code: "" },
      { type: "MF", isin: "INF179KC1981", name: "HDFC Flexi Cap", scheme_code: "999" },
    ];
    expect(enrichMfFromAmfi(rows, AMFI)).toBe(0);
    expect(rows.map(r => r.name)).toEqual(["HDFC MUTUAL FUND", "XYZ MUTUAL FUND", "HDFC Flexi Cap"]);
    expect(rows[2].scheme_code).toBe("999");
  });

  it("is a no-op when the AMFI list is unavailable", () => {
    const rows = [{ type: "MF", isin: "INF179KC1981", name: "HDFC MUTUAL FUND", scheme_code: "" }];
    expect(enrichMfFromAmfi(rows, [])).toBe(0);
    expect(enrichMfFromAmfi(rows, undefined)).toBe(0);
    expect(rows[0].name).toBe("HDFC MUTUAL FUND");
  });
});
