// Shared server-side constants — import in any route that needs them.

// Asset types denominated in USD. Must stay in sync with utils.js USD_TYPES on the client.
export const USD_TYPES = new Set(["US_STOCK", "US_ETF", "US_BOND", "CRYPTO"]);
