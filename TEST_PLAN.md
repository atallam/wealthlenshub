# WealthLens Hub — Comprehensive E2E Test Plan

**Version:** 1.0 | **Last Updated:** March 2026
**Platform:** wealthlens.pro | **Repo:** github.com/atallam/wealthlenshub

---

## How to Use This Document

Each test case has a **Priority** (P0 = critical path, P1 = important, P2 = nice-to-have), a **Precondition**, numbered **Steps**, and an **Expected Result**. Mark the Status column as you test: ✅ Pass, ❌ Fail, ⏭️ Skipped, 🔄 In Progress.

---

## 1. Authentication & Onboarding

### 1.1 Email Signup (P0)

| # | Step | Expected | Status |
|---|------|----------|--------|
| 1 | Go to wealthlens.pro | Landing page renders with login card on right | |
| 2 | Click "Create Account" tab | Sign Up form with Name, Email, Password fields | |
| 3 | Submit with valid details | "Check email for confirmation link" message | |
| 4 | Click confirmation link in email | Redirected to app, signed in | |
| 5 | Verify profile seeded | `/api/profile` returns user profile, `/api/asset-types` returns 13 default types, `/api/budget/categories` returns default categories | |

### 1.2 Google OAuth (P0)

| # | Step | Expected | Status |
|---|------|----------|--------|
| 1 | Click "Google" button | Google OAuth popup opens | |
| 2 | Select Google account | Redirected back, signed in | |
| 3 | Profile auto-created | display_name from Google, default currency INR | |

### 1.3 GitHub OAuth (P1)

| # | Step | Expected | Status |
|---|------|----------|--------|
| 1 | Click "GitHub" button | GitHub OAuth popup opens | |
| 2 | Authorize app | Redirected back, signed in | |

### 1.4 Forgot Password (P1)

| # | Step | Expected | Status |
|---|------|----------|--------|
| 1 | Click "Forgot password?" on login | Reset form appears | |
| 2 | Enter registered email, submit | "Reset email sent" message | |
| 3 | Click link in email | Password reset page loads | |
| 4 | Set new password, sign in | Successful login with new password | |

### 1.5 Onboarding Empty State (P1)

| # | Step | Expected | Status |
|---|------|----------|--------|
| 1 | Sign in with new account (0 holdings) | Welcome Card with 3-step checklist appears on Overview | |
| 2 | Verify step 1 shows "✓" (account created) | Green checkmark, text struck through | |
| 3 | Verify step 2 shows action buttons | "Add your first investment", "Import CSV / Connect broker" buttons visible | |
| 4 | Verify locked tabs | Goals, Alerts, Members, Calendar, Rebalance, Advisor tabs are dimmed and unclickable | |
| 5 | Verify import guide cards | 4 cards shown: US Brokerages, US Broker CSV, CDSL/NSDL CAS, Indian Broker CSV (in that order) | |
| 6 | Click "Load sample portfolio" | Demo data loads, all tabs unlock, demo banner shows | |
| 7 | Click "✕ Exit Demo" | Demo data cleared, welcome card returns | |

### 1.6 Quick-Add Wizard (P1)

| # | Step | Expected | Status |
|---|------|----------|--------|
| 1 | Click "Add your first investment" from welcome card | Quick-add modal opens with type picker grid | |
| 2 | Verify type order | US Stock, US ETF, Crypto first row; Indian Stock, MF, Indian ETF second row | |
| 3 | Select "US Stock", enter name "NVIDIA", ticker "NVDA", member | Form accepts all fields, step dots update | |
| 4 | Enter buy details: date, price $130, units 10 | Total shows "$1,300.00 ≈ ₹1,23,165" | |
| 5 | Click "Save holding + transaction" | Holding created, transaction recorded, modal closes, Overview shows data | |
| 6 | Verify holding in Holdings tab | NVDA appears in US Assets group with correct values | |
| 7 | Verify transaction via 📋 button | Transaction panel shows 1 BUY transaction with correct data | |

---

## 2. Holdings Management

### 2.1 Add Holding Manually (P0)

| # | Step | Expected | Status |
|---|------|----------|--------|
| 1 | Click "+ Add" → "Add holding" | Holding modal opens, default type = US Stock | |
| 2 | Select member, type = Indian Stock, name = "Reliance", ticker = "RELIANCE" | Stock search shows results | |
| 3 | Select from search results | Name/ticker auto-populated, live price shown | |
| 4 | Save | Holding appears in Holdings tab under "₹ Indian Assets" | |
| 5 | Add Transaction modal auto-opens | Transaction form pre-selects the new holding | |

### 2.2 Add Holding — All Types (P1)

Test each asset type creates correctly:

| Type | Key Fields | Expected |
|------|-----------|----------|
| US_STOCK | ticker, usd_inr_rate | Shows in US Assets group, $ price display |
| US_ETF | ticker | Shows in US Assets, live price via Yahoo |
| CRYPTO | ticker (BTC-USD) | Shows in US Assets, $ display |
| US_BOND | ticker | Shows in US Assets |
| IN_STOCK | ticker (RELIANCE) | Shows in Indian Assets, ₹ price |
| IN_ETF | ticker (NIFTYBEES) | Shows in Indian Assets |
| MF | scheme_code | Shows in Indian Assets, NAV from AMFI |
| FD | principal, interest_rate, start/maturity dates | Auto-calc current value, shows in Other |
| PPF | principal, start_date | Auto-calc at 7.1% CAGR |
| EPF | principal, start_date | Auto-calc at 8.15% CAGR |
| REAL_ESTATE | purchase_value, current_value | Manual values, shows in Other |

### 2.3 Edit Holding (P1)

| # | Step | Expected | Status |
|---|------|----------|--------|
| 1 | Click ✎ on any holding row | Edit modal opens with pre-filled data | |
| 2 | Change name, save | Holdings list updates immediately | |
| 3 | Verify no transaction auto-open on edit | Transaction modal does NOT open after edit save | |

### 2.4 Delete Holding (P1)

| # | Step | Expected | Status |
|---|------|----------|--------|
| 1 | Click ✕ on a holding row | Confirmation prompt appears | |
| 2 | Confirm | Holding removed, totals update, transactions cascade-deleted | |

### 2.5 Holdings Table (P0)

| # | Step | Expected | Status |
|---|------|----------|--------|
| 1 | Verify grouping | US Assets ($), Indian Assets (₹), Other Assets (📦) sections | |
| 2 | Verify column tooltips | Hover ? on Units, Avg Price, Cur. Price, Value, P&L shows tooltip text | |
| 3 | Click column header to sort | Sorting toggles asc/desc, arrow indicator changes | |
| 4 | Verify filter chips | "All" + each asset type as chip, US types listed first | |
| 5 | Click a filter chip | Table filters to show only that type | |
| 6 | Verify totals footer row | Shows correct sum of Invested, Current Value, Gain, Return % | |
| 7 | Verify dual-currency | US holdings show $ amounts, Indian show ₹, group headers show $ with ₹ subtitle | |

---

## 3. Transactions

### 3.1 Add Buy Transaction (P0)

| # | Step | Expected | Status |
|---|------|----------|--------|
| 1 | Click 📋 on a stock holding | Transaction panel opens | |
| 2 | Enter BUY: units=10, price=₹2500, date | "Add Transaction" button enables | |
| 3 | Submit | Transaction appears in list, net_units and avg_cost update | |
| 4 | Verify holding row updates | Units, Avg Price, Value, P&L recalculated | |

### 3.2 Add Sell Transaction (P1)

| # | Step | Expected | Status |
|---|------|----------|--------|
| 1 | Select SELL type | Form switches to SELL mode | |
| 2 | Enter units to sell (< net_units) | Transaction saves | |
| 3 | Verify net_units reduced | Holdings table shows updated units | |

### 3.3 US Stock Transaction (P0)

| # | Step | Expected | Status |
|---|------|----------|--------|
| 1 | Click 📋 on a US stock | Transaction panel shows "$ USD input" indicator | |
| 2 | Enter price in USD | INR equivalent auto-calculated using usd_inr_rate | |
| 3 | Verify FX rate fetch | "⟳ Rate" button fetches live USD/INR | |

### 3.4 Mutual Fund Transaction — Amount-First Flow (P0)

| # | Step | Expected | Status |
|---|------|----------|--------|
| 1 | Click 📋 on an MF holding with scheme_code | "Amount Invested ₹" field appears (not price/units) | |
| 2 | Enter amount ₹10000, select date | "Fetch NAV" button appears | |
| 3 | Click Fetch NAV | NAV fetched, units auto-calculated (amount / NAV) | |
| 4 | Submit | Transaction saved with correct units and NAV as price | |

### 3.5 SIP Bulk Import (P1)

| # | Step | Expected | Status |
|---|------|----------|--------|
| 1 | Click "📅 Add SIP History" on MF holding | SIP form appears with amount, day, start/end month | |
| 2 | Enter SIP ₹10000 on 5th, 12 months | Preview table shows 12 rows with NAVs | |
| 3 | Click Import | All 12 transactions created | |

### 3.6 Global Transaction Modal (P1)

| # | Step | Expected | Status |
|---|------|----------|--------|
| 1 | Click "+ Add" → "Log transaction" | Global transaction modal opens | |
| 2 | Filter by member and type | Holdings dropdown updates | |
| 3 | Select holding, enter details, submit | Transaction saved to correct holding | |

### 3.7 Delete Transaction (P1)

| # | Step | Expected | Status |
|---|------|----------|--------|
| 1 | Click ✕ on a transaction row | Confirmation prompt | |
| 2 | Confirm | Transaction removed, net_units and avg_cost recalculated | |

### 3.8 XIRR Calculation (P1)

| # | Step | Expected | Status |
|---|------|----------|--------|
| 1 | Add 3+ buy transactions over different dates on one holding | XIRR value appears in holding row (method: "xirr") | |
| 2 | Holding with only 1 transaction < 30 days old | Falls back to CAGR or simple return | |
| 3 | FD/PPF with start_date | CAGR calculated from accrual formula | |

---

## 4. Import

### 4.1 CSV Auto-Detection (P0)

| # | Step | Expected | Status |
|---|------|----------|--------|
| 1 | Click "+ Add" → "Import file" | Import modal opens | |
| 2 | Upload a Zerodha Console CSV | Format auto-detected, preview shows parsed holdings | |
| 3 | Verify column mapping | Name, ticker, type, units, price correctly mapped | |
| 4 | Click "Import All" | Holdings created, duplicates handled by upsert | |

### 4.2 Test Each Broker Format (P2)

| Broker | Format | Region | Status |
|--------|--------|--------|--------|
| Zerodha Console | CSV | IN | |
| Zerodha Tradebook | CSV | IN | |
| Groww | CSV | IN | |
| ICICI Direct | CSV | IN | |
| HDFC Securities | CSV | IN | |
| Upstox | CSV | IN | |
| Fidelity | CSV | US | |
| Schwab | CSV | US | |
| Robinhood | CSV | US | |
| Vanguard | CSV | US | |
| IBKR | CSV | US | |
| E*TRADE | CSV | US | |
| Generic CSV | CSV | AUTO | |
| Excel/XLSX | XLSX | AUTO | |

### 4.3 CDSL/NSDL CAS PDF Import (P0)

| # | Step | Expected | Status |
|---|------|----------|--------|
| 1 | Upload CAS PDF | Password prompt appears | |
| 2 | Enter PAN as password | PDF parsed, mutual funds listed in preview | |
| 3 | Verify cross-validation | Units × NAV ≈ Value within 3% tolerance | |
| 4 | Import | Holdings created with scheme_code, purchase_nav, cost basis | |
| 5 | Verify clean names | MFXXXX prefixes stripped, .NSE codes removed | |

### 4.4 SnapTrade Connect (P0)

| # | Step | Expected | Status |
|---|------|----------|--------|
| 1 | Click "+ Add" → "SnapTrade Import" | SnapTrade panel opens | |
| 2 | Click "Connect New Brokerage" | OAuth popup for brokerage (e.g., Robinhood) | |
| 3 | Complete OAuth flow | Connection appears in list with brokerage name | |
| 4 | Click "Sync Holdings" | Holdings fetched and displayed for review | |
| 5 | Click "Import" | Holdings created in DB with source="snaptrade" | |
| 6 | Verify CASH detection | SPAXX/cash treated as USD CASH type | |
| 7 | Disconnect single brokerage | Connection removed, holdings remain | |

---

## 5. Live Prices

### 5.1 Price Refresh (P0)

| # | Step | Expected | Status |
|---|------|----------|--------|
| 1 | Add holdings with tickers (RELIANCE, NVDA, scheme_code) | Holdings show "Manual" price source | |
| 2 | Click "⟳ Live Prices" button | Spinner shows, then prices update | |
| 3 | Verify Indian stocks | Price from Yahoo Finance (.NS suffix), "● Live" badge | |
| 4 | Verify MF NAV | NAV from AMFI/MFAPI (scheme_code lookup) | |
| 5 | Verify US stocks | Price from Yahoo Finance, $ display | |
| 6 | FD/PPF/EPF | "Auto-calc" badge (no external price fetch) | |
| 7 | Verify price_fetched_at timestamp | "Xm ago" shown on each live-priced holding | |

### 5.2 FX Rates (P1)

| # | Step | Expected | Status |
|---|------|----------|--------|
| 1 | On app load | `/api/forex/usdinr` called, _liveUsdInr updated | |
| 2 | Portfolio totals | $ primary with ≈₹ equivalent using live rate | |
| 3 | US holding values | Converted to ₹ for total using live FX | |

---

## 6. Overview Dashboard

### 6.1 KPI Cards (P0)

| # | Step | Expected | Status |
|---|------|----------|--------|
| 1 | With holdings loaded | 4 KPI cards: Portfolio Value, Amount Invested, Total Gains, Return | |
| 2 | Verify $ primary display | Values shown in $ with ≈₹ secondary line | |
| 3 | Verify color coding | Gains green if positive, red if negative | |

### 6.2 Asset Allocation Chart (P0)

| # | Step | Expected | Status |
|---|------|----------|--------|
| 1 | Multiple asset types present | Donut chart + allocation rows by type | |
| 2 | Verify percentages sum to 100% | Each type shows % and absolute value | |

### 6.3 Member Breakdown (P1)

| # | Step | Expected | Status |
|---|------|----------|--------|
| 1 | Multiple members with holdings | Each member shows portfolio share %, value, gain | |
| 2 | Member filter chips | Click member chip → filters all views to that member | |

### 6.4 Net Worth Timeline (P1)

| # | Step | Expected | Status |
|---|------|----------|--------|
| 1 | Holdings with start dates | Timeline chart renders investment vs current value | |
| 2 | Member filter | Timeline updates when member selected | |

---

## 7. Financial Goals

### 7.1 Create Goal (P0)

| # | Step | Expected | Status |
|---|------|----------|--------|
| 1 | Go to Goals tab, click "+" | Goal form opens | |
| 2 | Enter: name, target ₹30L, date, category=Retirement | Form validates | |
| 3 | Link asset types: IN_STOCK, US_STOCK | Types selected as pills | |
| 4 | Save | Goal card appears with progress ring | |

### 7.2 Goal Progress Tracking (P0)

| # | Step | Expected | Status |
|---|------|----------|--------|
| 1 | Goal linked to types with holdings | Progress % = sum of linked holdings' value / target | |
| 2 | Verify smart status | "On Track" / "Behind" / "Achieved" based on timeline | |

### 7.3 Double-Counting Detection (P1)

| # | Step | Expected | Status |
|---|------|----------|--------|
| 1 | Link IN_STOCK to Goal A | Works fine | |
| 2 | Link IN_STOCK to Goal B | Warning appears about double-counting | |

### 7.4 AI Fulfillment Plan (P1)

| # | Step | Expected | Status |
|---|------|----------|--------|
| 1 | Click "✦ Goal Plan" button | AI generates analysis via Claude API | |
| 2 | Verify plan content | Feasibility assessment, SIP recommendations, action items | |

---

## 8. Budget & Spending

### 8.1 Upload CSV Statement (P0)

| # | Step | Expected | Status |
|---|------|----------|--------|
| 1 | Go to Budget → Import | Upload form visible | |
| 2 | Select bank, upload CSV (e.g., Chase) | Processing spinner | |
| 3 | Verify success | "✓ Imported N transactions (date to date)" message | |
| 4 | Switch to Transactions sub-tab | Transactions listed with date, description, amount, category | |

### 8.2 Upload PDF Statement (P1)

| # | Step | Expected | Status |
|---|------|----------|--------|
| 1 | Upload PDF statement (e.g., Bank of America) | PDF parsed via pdfjs-dist | |
| 2 | Verify transactions extracted | Success message with count | |
| 3 | Verify transactions visible | Switch to Transactions → data shows | |

### 8.3 Test Each Bank Parser (P2)

| Bank | Format | Region | Status |
|------|--------|--------|--------|
| Chase | CSV | US | |
| Bank of America | CSV/PDF | US | |
| Wells Fargo | CSV | US | |
| Citi | CSV | US | |
| Capital One | CSV | US | |
| Amex | CSV | US | |
| Discover | CSV | US | |
| US Bank | CSV | US | |
| HDFC | CSV | IN | |
| ICICI | CSV | IN | |
| Axis | CSV | IN | |
| SBI | CSV | IN | |
| Kotak | CSV | IN | |

### 8.4 Month Selector (P0)

| # | Step | Expected | Status |
|---|------|----------|--------|
| 1 | With transactions imported | Month picker visible in Budget header | |
| 2 | Select a specific month | Overview analytics + transaction list auto-reload for that month | |
| 3 | Click ✕ to clear month | Reloads all-time data immediately | |
| 4 | Verify while on Transactions sub-tab | Transaction list filters in real-time on month change | |

### 8.5 Transaction Management (P1)

| # | Step | Expected | Status |
|---|------|----------|--------|
| 1 | View Transactions sub-tab | Columns: Date, Description, Amount, Type (DEBIT/CREDIT), Category | |
| 2 | Change category on a transaction | Dropdown changes, saves immediately via PATCH | |
| 3 | Select multiple via checkboxes | Bulk action bar appears | |
| 4 | Bulk re-categorize | All selected transactions update | |
| 5 | Filter by statement, category, search | Transaction list filters correctly | |

### 8.6 Analytics Overview (P1)

| # | Step | Expected | Status |
|---|------|----------|--------|
| 1 | Budget → Overview with data | KPI row: total spend, income, net, txn count | |
| 2 | Category breakdown chart | Donut/bar showing spend by category | |
| 3 | Monthly trend | Bar chart for last 6 months | |

### 8.7 Category Management (P1)

| # | Step | Expected | Status |
|---|------|----------|--------|
| 1 | Budget → Categories | Default categories listed with icons, colors, keywords | |
| 2 | Create new category with keywords | New category appears | |
| 3 | Edit existing category | Changes saved | |
| 4 | Delete a category | Category removed (transactions keep old category name) | |
| 5 | Verify auto-categorization | New upload matches keywords to categories | |

### 8.8 Encryption Verification (P1)

| # | Step | Expected | Status |
|---|------|----------|--------|
| 1 | Upload a statement | "✓ Imported N transactions" | |
| 2 | Query budget_transactions in Supabase SQL Editor | `description` and `balance` columns show encrypted hex strings, NOT plaintext | |
| 3 | View in app UI | Descriptions show decrypted plaintext | |

---

## 9. Alerts

### 9.1 Create Alert Rule (P1)

| # | Step | Expected | Status |
|---|------|----------|--------|
| 1 | Go to Alerts tab, click "+" | Alert form: type (Over-weight/Under-weight/Return target), threshold | |
| 2 | Create: IN_STOCK over 60% | Alert saved | |
| 3 | If IN_STOCK allocation > 60% | Alert triggers, badge shows on Alerts tab | |

---

## 10. Members & Portfolio Sharing

### 10.1 Add Family Member (P0)

| # | Step | Expected | Status |
|---|------|----------|--------|
| 1 | Go to Members tab, click "+" | Member form: name, relation | |
| 2 | Add "Priya" as "Spouse" | Member appears in list and member chips | |
| 3 | Add holding assigned to Priya | Holding shows under Priya's member filter | |

### 10.2 Portfolio Sharing (P1)

| # | Step | Expected | Status |
|---|------|----------|--------|
| 1 | Share portfolio with another email | Share record created in portfolio_shares | |
| 2 | Sign in as the other user | Shared portfolio visible with 👁 prefix on member chip | |
| 3 | Verify view-only enforcement | Cannot edit/delete shared holdings | |

---

## 11. AI Advisor (Ask Tab)

### 11.1 Chat Interaction (P1)

| # | Step | Expected | Status |
|---|------|----------|--------|
| 1 | Go to Advisor tab | Chat interface with input, suggested questions | |
| 2 | Ask "Which holding has the best return?" | AI responds with holdings context, specific answer | |
| 3 | Ask follow-up "Should I rebalance?" | Context maintained across messages | |
| 4 | Verify portfolio context sent | AI knows about your actual holdings, members, goals | |

---

## 12. Asset Allocation & Rebalancing

### 12.1 Rebalance Tab (P1)

| # | Step | Expected | Status |
|---|------|----------|--------|
| 1 | Go to Asset Allocation tab | Target allocation sliders per type, current vs target table | |
| 2 | Select preset "Balanced" | Sliders update to preset values | |
| 3 | Verify trade plan | Shows Buy/Sell recommendations per type with amounts | |
| 4 | Enter available cash | Recommendations include cash deployment | |

---

## 13. Settings

### 13.1 Currency Selection (P1)

| # | Step | Expected | Status |
|---|------|----------|--------|
| 1 | Open ⚙️ Settings | Currency grid: INR, USD, EUR, GBP, SGD, AED, AUD, JPY, CAD, CHF | |
| 2 | Select USD | All display values switch to $ primary | |
| 3 | Select INR | All values switch to ₹ primary | |

### 13.2 Asset Types Management (P1)

| # | Step | Expected | Status |
|---|------|----------|--------|
| 1 | View asset types in Settings | 13 default types listed | |
| 2 | Add custom type "REITs" | Type appears in list and in holding form dropdown | |
| 3 | Edit a default type (change icon) | Change persists | |
| 4 | Delete custom type | Type removed (default types cannot be deleted) | |

---

## 14. Document Attachments

### 14.1 Upload & View (P1)

| # | Step | Expected | Status |
|---|------|----------|--------|
| 1 | Click 📎 on a holding | Artifact panel opens with drag-and-drop zone | |
| 2 | Upload a PDF file (< 15MB) | File appears in list with name, size, timestamp | |
| 3 | Click "↓ View" | File opens in new tab (Supabase signed URL, 5-min expiry) | |
| 4 | Delete artifact | Confirmation → file removed | |

---

## 15. Security & Data Isolation

### 15.1 RLS Enforcement (P0)

| # | Step | Expected | Status |
|---|------|----------|--------|
| 1 | Sign in as User A, add holdings | Holdings visible | |
| 2 | Sign in as User B | User A's holdings NOT visible (0 results) | |
| 3 | User B calls `/api/holdings` | Returns only User B's holdings (RLS enforced) | |
| 4 | User B tries `GET /api/holdings?user_id=<A's ID>` | Still returns only B's data (RLS ignores parameter) | |

### 15.2 JWT Verification (P0)

| # | Step | Expected | Status |
|---|------|----------|--------|
| 1 | Call `/api/holdings` without Authorization header | 401 Unauthorized | |
| 2 | Call with tampered/expired JWT | 401 Unauthorized | |
| 3 | Call with valid JWT | 200 OK with data | |

### 15.3 Ownership Audit on Delete (P1)

| # | Step | Expected | Status |
|---|------|----------|--------|
| 1 | User A creates holding H1 | H1 has user_id = A | |
| 2 | User B tries `DELETE /api/holdings/H1` | Fails — ownership check blocks | |

### 15.4 Budget Encryption (P1)

| # | Step | Expected | Status |
|---|------|----------|--------|
| 1 | Upload budget statement | Transactions saved | |
| 2 | Direct DB query: `SELECT description FROM budget_transactions LIMIT 5` | Returns encrypted hex, not plaintext | |
| 3 | API response `/api/budget/transactions` | Returns decrypted plaintext | |

---

## 16. Cross-Browser & Responsive

### 16.1 Browser Compatibility (P2)

| Browser | Version | Status |
|---------|---------|--------|
| Chrome (latest) | | |
| Firefox (latest) | | |
| Safari (latest) | | |
| Edge (latest) | | |

### 16.2 Mobile Responsiveness (P2)

| # | Step | Expected | Status |
|---|------|----------|--------|
| 1 | Load on iPhone Safari | Layout renders, tabs scroll horizontally | |
| 2 | Holdings table | Horizontal scroll enabled, no layout break | |
| 3 | Budget upload on mobile | File picker works | |

---

## 17. Edge Cases & Error Handling

### 17.1 Empty States (P1)

| Scenario | Expected |
|----------|----------|
| 0 holdings, not demo | Welcome card with guided steps |
| 0 holdings, demo mode | Demo banner + sample data |
| 0 holdings, shared data exists | "You're viewing shared portfolios" message |
| 0 transactions on a holding | "No transactions yet" in panel |
| 0 budget statements | "Import a statement" prompt |
| 0 goals | "Add a goal" prompt |

### 17.2 Large Data (P2)

| Scenario | Expected |
|----------|----------|
| 200+ holdings | Table renders, totals correct, no browser freeze |
| 1000+ budget transactions | Pagination note "Showing 200 of N", filters work |
| Import CSV with 500 rows | Bulk import completes, progress shown |

### 17.3 Network / API Failures (P2)

| Scenario | Expected |
|----------|----------|
| Render cold start (15s delay) | Loading spinner, no crash |
| Yahoo Finance API down | Price refresh shows error, existing prices preserved |
| Supabase rate limit | Graceful error message, no data loss |

---

## 18. Progressive Tab Disclosure

### 18.1 Tab Locking (P1)

| # | Step | Expected | Status |
|---|------|----------|--------|
| 1 | New user, 0 holdings, not demo | Goals, Alerts, Members, Calendar, Rebalance, Advisor tabs dimmed (opacity 0.35) | |
| 2 | Click a locked tab | Nothing happens (pointer-events: none) | |
| 3 | Add 1 holding | All tabs unlock immediately | |
| 4 | Delete all holdings | Tabs lock again | |
| 5 | Load demo data | All tabs unlock (demoMode bypasses lock) | |

---

## 19. Calendar View

### 19.1 Investment Calendar (P2)

| # | Step | Expected | Status |
|---|------|----------|--------|
| 1 | Go to Calendar tab | Monthly calendar grid renders | |
| 2 | Days with transactions | Highlighted with count badge | |
| 3 | Month navigation | Previous/next month works | |

---

## 20. Regression Checklist

Run after every deploy. All P0 tests must pass.

| # | Quick Check | Status |
|---|------------|--------|
| 1 | Sign in with Google → lands on Overview | |
| 2 | KPI cards show values (not NaN or $0) | |
| 3 | Holdings table renders with correct grouping | |
| 4 | Add a holding → appears immediately | |
| 5 | Add a transaction → holding values update | |
| 6 | Import a CSV → preview + import works | |
| 7 | Live Prices button → prices update | |
| 8 | Budget upload CSV → transactions visible | |
| 9 | Budget month selector → data reloads | |
| 10 | Goals tab → progress rings render | |
| 11 | AI Advisor → responds with portfolio context | |
| 12 | Settings → currency change reflects everywhere | |
| 13 | Sign out → sign in as different user → no data leak | |
| 14 | Demo mode → load/exit works cleanly | |

---

## Appendix: Test Data Recommendations

**Indian Holdings:**
- Reliance Industries (RELIANCE) — IN_STOCK
- Mirae Asset Large Cap Fund (scheme_code: 118834) — MF
- Nippon India Nifty 50 BeES (NIFTYBEES) — IN_ETF
- HDFC Bank FD 7.25% — FD
- PPF Account — PPF

**US Holdings:**
- NVIDIA (NVDA) — US_STOCK
- Vanguard S&P 500 (VOO) — US_ETF
- Bitcoin (BTC-USD) — CRYPTO
- Apple (AAPL) — US_STOCK

**Budget Statements:**
- Chase checking CSV (US format MM/DD/YYYY)
- HDFC savings CSV (IN format DD/MM/YYYY)
- Bank of America PDF
