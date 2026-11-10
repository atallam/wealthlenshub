import { describe, it, expect } from "vitest";
import { enrichHoldings } from "../lib/holdings-utils.js";

describe("enrichHoldings — IN_BOND cost basis", () => {
  it("flags a bond with no purchase cost as unknown so 'Set cost' is offered", () => {
    const [h] = enrichHoldings([{ type: "IN_BOND", units: 10, current_price: 98000, purchase_price: null, purchase_value: null }]);
    expect(h.cost_basis).toBe("unknown");
  });
  it("treats a bond with a stored cost as exact", () => {
    const [h] = enrichHoldings([{ type: "IN_BOND", units: 10, purchase_price: 100000 }]);
    expect(h.cost_basis).toBe("exact");
  });
});
