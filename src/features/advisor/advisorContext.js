import { AT } from '../../constants.js';
import { fmtCrINR } from '../../utils.js';

// Advisor prompt helpers extracted from App.jsx. Pure functions of the portfolio state they are given.
export function advisorPortfolioContext({ goals, allHoldings, allMembers, valINRCache, invINRCache, xirrCache, allCur, allInv, totPct, byType, trigAlerts }) {
    const sorted = [...allHoldings]
      .sort((a, b) => (valINRCache.get(b.id) || 0) - (valINRCache.get(a.id) || 0));
    const topH  = sorted.slice(0, 20);
    const restH = sorted.slice(20);          // all holdings beyond top-20
    const memberNames = Object.fromEntries(allMembers.map(m => [m.id, m.name]));

    // Top-20: full detail including XIRR
    const holdingsText = topH.map(h => {
      const cur = valINRCache.get(h.id) || 0;
      const inv = invINRCache.get(h.id) || 0;
      const xi  = xirrCache.get(h.id);
      const pct = inv > 0 ? (((cur - inv) / inv) * 100).toFixed(1) : '0';
      const xirrStr = xi?.value != null ? ` | XIRR: ${xi.value.toFixed(1)}% (${xi.method})` : '';
      return `  - ${h.name} (${AT[h.type]?.label || h.type}): current=${fmtCrINR(cur)}, invested=${fmtCrINR(inv)}, gain=${pct}%${xirrStr} [${memberNames[h.member_id] || 'Unassigned'}]`;
    }).join('\n');

    // Holdings 21+: compact one-liner per holding so AI is aware they exist
    const restText = restH.length > 0
      ? '\n\nADDITIONAL HOLDINGS (compact — use get_holdings tool for detail):\n' +
        restH.map(h => {
          const cur = valINRCache.get(h.id) || 0;
          const inv = invINRCache.get(h.id) || 0;
          const pct = inv > 0 ? (((cur - inv) / inv) * 100).toFixed(1) : '?';
          const ticker = h.ticker || h.scheme_code || '';
          return `  ${h.name}${ticker ? ` [${ticker}]` : ''} | ${AT[h.type]?.label || h.type} | ${fmtCrINR(cur)} | ${pct}% gain | ${memberNames[h.member_id] || 'Unassigned'}`;
        }).join('\n')
      : '';

    const byTypeText = byType
      .map(row => `  ${AT[row.t]?.label || row.t}: ${fmtCrINR(row.v)} (${allCur > 0 ? ((row.v / allCur) * 100).toFixed(1) : 0}%)`)
      .join('\n');
    const goalsText = goals.map(g => `  - ${g.name}: target=${fmtCrINR(g.targetAmount)}, by ${g.targetDate}`).join('\n');
    const alertsText = trigAlerts.length > 0
      ? trigAlerts.map(a => `  - ${a.label || a.type}: threshold=${a.threshold}%`).join('\n')
      : '  None triggered';

    return `PORTFOLIO SUMMARY (${new Date().toLocaleDateString('en-IN')})
Total Value: ${fmtCrINR(allCur)} | Invested: ${fmtCrINR(allInv)} | Gain: ${totPct.toFixed(1)}%
Members: ${allMembers.map(m => m.name).join(', ')} | Total holdings: ${allHoldings.length}

HOLDINGS — top 20 by value (full detail):
${holdingsText}${restText}

ALLOCATION BY TYPE:
${byTypeText}

GOALS:
${goalsText || '  None set'}

TRIGGERED ALERTS:
${alertsText}`;
  }

export function advisorSuggestedQuestions({ goals, allHoldings, allMembers, valINRCache, invINRCache, allCur, byType, trigAlerts }) {
    const questions = [];

    // ── Always-on anchors ──────────────────────────────────────────────────────
    questions.push("What is my total portfolio value and overall return?");
    questions.push("Which is my largest single holding?");

    // ── Triggered alerts ───────────────────────────────────────────────────────
    if (trigAlerts.length > 0) {
      questions.push(`I have ${trigAlerts.length} triggered alert${trigAlerts.length > 1 ? 's' : ''} — what should I do?`);
    }

    // ── Goals ─────────────────────────────────────────────────────────────────
    if (goals.length > 0) {
      // Find the goal closest to its deadline
      const upcoming = [...goals]
        .filter(g => g.targetDate)
        .sort((a, b) => new Date(a.targetDate) - new Date(b.targetDate))[0];
      if (upcoming) {
        questions.push(`How far am I from my "${upcoming.name}" goal?`);
      } else {
        questions.push("How far am I from my financial goals?");
      }
    }

    // ── Family members ────────────────────────────────────────────────────────
    if (allMembers.length >= 2) {
      const [m1, m2] = allMembers;
      questions.push(`Compare ${m1.name}'s and ${m2.name}'s portfolios.`);
    }

    // ── Allocation insights ───────────────────────────────────────────────────
    const equityTypes = new Set(["IN_STOCK", "IN_ETF", "US_STOCK", "US_ETF", "MF"]);
    const equityVal   = byType.filter(r => equityTypes.has(r.t)).reduce((s, r) => s + r.v, 0);
    const equityPct   = allCur > 0 ? (equityVal / allCur) * 100 : 0;
    if (equityPct > 75) {
      questions.push(`${equityPct.toFixed(0)}% of my portfolio is in equity — am I over-exposed?`);
    } else if (equityPct < 30 && allCur > 0) {
      questions.push("My equity exposure seems low — should I rebalance?");
    }

    // ── Underperformers ───────────────────────────────────────────────────────
    const losers = allHoldings.filter(h => {
      const cur = valINRCache.get(h.id) || 0;
      const inv = invINRCache.get(h.id) || 0;
      return inv > 0 && cur < inv;
    });
    if (losers.length > 0) {
      const biggest = losers.sort((a, b) => {
        const ga = (valINRCache.get(a.id) || 0) - (invINRCache.get(a.id) || 0);
        const gb = (valINRCache.get(b.id) || 0) - (invINRCache.get(b.id) || 0);
        return ga - gb;
      })[0];
      questions.push(`Should I exit or hold ${biggest.name} which is at a loss?`);
    }

    // ── Asset-type specific ───────────────────────────────────────────────────
    const hasFD     = allHoldings.some(h => h.type === "FD");
    const hasCrypto = allHoldings.some(h => h.type === "CRYPTO");
    const hasMF     = allHoldings.some(h => h.type === "MF");
    const hasUS     = allHoldings.some(h => ["US_STOCK", "US_ETF"].includes(h.type));

    if (hasFD)     questions.push("When do my FDs mature and should I reinvest them?");
    if (hasCrypto) questions.push("What percentage of my portfolio is in crypto and is it too much?");
    if (hasMF)     questions.push("Which mutual fund has the best XIRR?");
    if (hasUS)     questions.push("How is my US portfolio performing vs my Indian holdings?");

    // ── Tax window (Jan–Mar is tax harvesting season) ────────────────────────
    const month = new Date().getMonth() + 1;
    if (month >= 1 && month <= 3) {
      questions.push("It's tax season — which holdings should I sell to harvest losses?");
    }

    // Return up to 8, prioritising the dynamic ones over static fallbacks
    return questions.slice(0, 8);
  }
