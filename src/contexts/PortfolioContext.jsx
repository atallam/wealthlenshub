/**
 * PortfolioContext.jsx — React context for shared portfolio state.
 *
 * Replaces the 25+ prop `sharedPortfolioProps` spread that was passed
 * explicitly into every tab. Tabs call usePortfolioCtx() and destructure
 * only what they need — no more long prop lists at call sites.
 *
 * Provider: wrap the tab-rendering section in App.jsx with <PortfolioProvider>.
 * Consumer: call usePortfolioCtx() inside any tab or component.
 *
 * Adding a new field:
 *   1. Add it to PortfolioProvider's value object below.
 *   2. Destructure it in the consuming component.
 *   Done. No other files need to change.
 */

import { createContext, useContext } from 'react';

const PortfolioContext = createContext(null);

/**
 * Consume shared portfolio state inside any tab or child component.
 * Throws if used outside a <PortfolioProvider>.
 */
export function usePortfolioCtx() {
  const ctx = useContext(PortfolioContext);
  if (!ctx) throw new Error('usePortfolioCtx must be used inside <PortfolioProvider>');
  return ctx;
}

/**
 * PortfolioProvider — place this around the tab-rendering block in App.jsx.
 *
 * @param {object} props.value  Pass the full sharedPortfolioProps object here.
 * @param {React.ReactNode} props.children
 */
export function PortfolioProvider({ value, children }) {
  return (
    <PortfolioContext.Provider value={value}>
      {children}
    </PortfolioContext.Provider>
  );
}

export default PortfolioContext;
