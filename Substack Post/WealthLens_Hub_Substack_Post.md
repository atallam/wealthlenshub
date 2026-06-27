# I Built a Cross-Border Portfolio Tracker in 10,000 Lines of Code. Here's What I Learned About Security, Parsing, and Trusting AI with Real Money.

### A PM's side project that grew into a platform handling Indian stocks, US ETFs, mutual funds, and 14 bank statement formats — with 4 layers of security.

---

We've all been there. You check your Zerodha holdings, then switch to Fidelity for the 401(k), open Kuvera for mutual funds, fire up a spreadsheet for the FDs and PPF, and maybe a crypto app for good measure. Five apps, two currencies, and a nagging feeling you've forgotten something.

What if you could see everything — every Indian stock, every US ETF, every mutual fund and fixed deposit — on one screen, in the right currency, with live prices?

That was the question I asked myself one weekend. Several months and 10,000 lines of code later, **WealthLens Hub** was live at [wealthlens.pro](https://wealthlens.pro).

This post is a transparent look at how it works, what I built, and — most importantly — the security architecture that makes it safe enough for strangers to trust with their actual financial data.

---

## The Problem: Cross-Border Portfolios Are a Mess

If you're an Indian professional with international investments, your financial picture is scattered across ecosystems that don't talk to each other.

Indian brokerages export CSVs with DD/MM/YYYY dates. US brokerages use MM/DD/YYYY. Your mutual fund NAVs come from AMFI, stock prices from Yahoo Finance, and the USD/INR rate from yet another API. No single tool handles all of this.

I spent years tracking my portfolio in spreadsheets. The breaking point came when I realised I'd been double-counting a mutual fund because Zerodha and Kuvera report slightly different scheme names for the same fund.

WealthLens Hub exists because that spreadsheet finally broke me.

---

## What I Built: The Three Pillars

<!-- IMAGE: 01_hero_architecture.png -->
**[Insert Image: 01_hero_architecture.png — Three-pillar architecture overview]**

### Pillar 1: Import Everything, Automatically

The hardest part of any portfolio tracker isn't the dashboard — it's getting data in without making the user type numbers into boxes.

**28+ CSV/Excel formats auto-detected.** Drop a file from Zerodha, Groww, ICICI Direct, Fidelity, Schwab, Robinhood, or 22 other brokerages. The server identifies the format from column headers and maps everything to a unified schema. No dropdown menus, no format selectors — just drag and drop.

**NSDL/CDSL CAS PDF parsing.** This was the hardest technical challenge. Indian Consolidated Account Statements have notoriously inconsistent formatting. Rather than relying on column positions (which break across banks), I wrote a cross-validation parser: for each mutual fund ISIN, it extracts all numbers from the surrounding text, then tests every permutation of number pairs to find Units × NAV ≈ Value within 3% tolerance. It works regardless of which bank generated the PDF.

**SnapTrade integration for 25+ US brokerages.** One OAuth flow and your Fidelity, Schwab, Vanguard, or Robinhood holdings sync automatically — stocks, ETFs, bonds, even cash balances.

**14 bank statement parsers.** Upload CSV, Excel, or PDF statements from Chase, Bank of America, Wells Fargo, Citi, Capital One, Amex, Discover, US Bank, HDFC, ICICI, Axis, SBI, and Kotak. Each bank gets its own parser with region-specific date handling — no more ambiguity about whether 03/04 means March 4th or April 3rd.

### Pillar 2: Intelligence That Actually Helps

**Native dual-currency display.** Your Nippon India Flexi Cap shows ₹97,855. Your NVIDIA position shows $8,377. The portfolio total shows $67.6K with ≈₹64.1L underneath. No currency toggle needed — each holding displays in its native currency, exactly how you think about your money.

**Financial goals linked to asset types.** Set a goal — Retirement, Education, Emergency Fund — and link *asset types* to it. "Retirement = all equity." "Emergency Fund = FD + PPF." The platform tracks progress using your actual portfolio data. If you link the same asset type to two goals, it warns you about double-counting.

**AI fulfillment plans.** An Anthropic Claude integration analyses your portfolio, goals, and timeline, then suggests specific monthly SIP amounts per asset type to reach each goal on time.

**Budget analytics.** Transactions are auto-categorised using keyword matching and encrypted before storage. Monthly analytics show spending by category with trends over time.

### Pillar 3: Security You Can Actually Verify

This is where most side projects hand-wave. "Your data is safe" isn't a security model. Here's what an actual security model looks like.

---

## The Part That Actually Matters: Security

Building a portfolio tracker is straightforward. Building one that *strangers* should trust with their real financial data is a fundamentally different problem.

<!-- IMAGE: 02_security_layers.png -->
**[Insert Image: 02_security_layers.png — 4-layer security model]**

#### Layer 1: Authentication

Every user signs in via Google OAuth or email/password through Supabase Auth. Every API request carries a JWT that the server verifies against the Supabase service key. No JWT means a 401. Tampered JWT means a 401. There's no guest mode, no demo data leaking into real accounts.

#### Layer 2: Row-Level Security (The Most Important Decision)

This is the single most important architectural choice in the entire system.

Every table in the database has Row-Level Security (RLS) enabled. The policy is simple: `auth.uid() = user_id`. This is enforced at the **PostgreSQL engine level** by Supabase — not by my application code.

What this means in practice: even if there's a bug in my Express server that accidentally omits a `WHERE user_id = ?` clause, Supabase returns zero rows. The database itself refuses to serve data that doesn't belong to the authenticated user. User A cannot see User B's data. Period. The database engine won't allow it, regardless of what the application code does.

All 13 tables have RLS policies. No exceptions.

#### Layer 3: Application-Layer Filters

Despite having RLS as the safety net, every API endpoint also includes `.eq("user_id", req.user.id)` in its query. Belt and suspenders. During development, I discovered and fixed 7 budget endpoints that were missing this filter — RLS would have caught the data leakage anyway, but the principle is defense-in-depth.

I also audit ownership on delete operations. Before deleting an artifact, the server verifies the parent holding belongs to the requesting user.

#### Layer 4: Encryption at Rest

Budget transaction descriptions and balances are encrypted with AES-256-GCM before they touch the database. The encryption key lives in a server-side environment variable and never reaches the browser. Even with direct database access, budget data is unreadable without the key.

#### What WealthLens Hub Does NOT Store

**No bank passwords.** SnapTrade and Plaid use OAuth — you authenticate directly with your brokerage. WealthLens Hub never sees your login credentials.

**No credit card numbers.** The budget module stores transaction descriptions and amounts, not account numbers.

**No PAN numbers.** CAS parsing uses PAN as the file password but encrypts it with AES-256-GCM before storage. The plaintext PAN is never logged.

---

## The Technical Stack (For the Curious)

<!-- IMAGE: 03_tech_stack.png -->
**[Insert Image: 03_tech_stack.png — Full technology stack breakdown]**

The stack is intentionally boring:

**Frontend:** React 18 + Vite, single App.jsx (5,216 lines), 9 tab views, dark theme. No component library — every element is hand-styled for the financial dashboard aesthetic.

**Backend:** Node.js 20 + Express, single server.js (4,467 lines), 74 REST API endpoints across 8 modules: Auth, Holdings, SnapTrade, Plaid, Setu AA, Budget, Import, and AI.

**Database:** Supabase (PostgreSQL 15), 13 tables with RLS, JSONB for goals/members/alerts.

**Hosting:** Render (Singapore region), auto-deploy from GitHub.

Two files. Under 10,000 lines total. No microservices, no Kubernetes, no GraphQL. Just Express routes that do exactly one thing each and a React component that renders the right tab.

The CAS PDF parser alone took longer than the rest of the import system combined. pdfjs-dist extracts text using Y-coordinate grouping to preserve the page's spatial layout — without this, columnar data (date | description | amount | balance) collapses into an unparseable string.

Live prices come from a three-tier fallback chain: Yahoo Finance → AMFI/MFAPI → Twelve Data. FX rates use exchangerate-api with a 10-minute cache and Yahoo as fallback.

---

## What's Coming Next

**Setu Account Aggregator.** India's RBI-regulated AA framework for consent-based auto-sync. The backend code is written (7 endpoints) and feature-flagged — waiting on production access.

**Tax Harvesting Suggestions.** Surface holdings with unrealised losses that could be sold to offset capital gains.

**Performance Benchmarking.** Compare your portfolio's XIRR against Nifty 50 and S&P 500 over matching time periods.

---

## Try It

**[wealthlens.pro](https://wealthlens.pro)** — sign up with Google or email (10 seconds), import your holdings, and see your complete portfolio in one place.

It's free. There are no ads. I don't sell your data. The code runs on Render, the database on Supabase, and the only third-party API calls are for live prices and AI features.

If you find bugs, have feature requests, or just want to tell me the CAS parser mangled your mutual fund name — I want to hear it. Reply to this post or reach out directly.

---

*Built by Avinash Tallam, Senior PM at Dell Technologies, Hyderabad. WealthLens Hub is a side project born from the frustration of managing a cross-border portfolio across too many apps.*
