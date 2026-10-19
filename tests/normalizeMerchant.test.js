import { describe, it, expect, vi } from "vitest";
vi.mock("../lib/db.js", () => ({ supabase: {}, describeDbError: () => ({}) }));
const { normalizeMerchant } = await import("../services/budget.service.js");

describe("normalizeMerchant", () => {
  it.each([
    ["UPI/CR/123456789012/SWIGGY FOOD", "Swiggy Food"],
    ["UPI/DR/412345678901/SWIGGY", "Swiggy"],               // short last segment must not be dropped as a ref code
    ["UPI/DR/412345678901/ZOMATO/okaxis", "Zomato"],
    ["NEFT/HDFC123/AMAZON PAY", "Amazon Pay"],
    ["POS/TXN/BIGBASKET", "Bigbasket"],
    ["POS 4567XXXX1234 NETFLIX.COM 07-08", "Netflix.com"],
    ["UPI-ZEPTO-ZEPTO@YBL-1234567890", "Zepto"],
    ["IMPS/P2A/123456789012/RAHUL SHARMA", "Rahul Sharma"],
    ["AMAZON PAY INDIA", "Amazon Pay India"],
    ["", "Unknown"],
    [null, "Unknown"],
  ])("%s -> %s", (input, expected) => expect(normalizeMerchant(input)).toBe(expected));

  it("groups different UPI refs of the same merchant together", () => {
    expect(normalizeMerchant("UPI/DR/111111111111/NETFLIX")).toBe(normalizeMerchant("UPI/DR/222222222222/NETFLIX"));
  });
});
