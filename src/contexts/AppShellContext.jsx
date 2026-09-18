/**
 * AppShellContext.jsx — React context for the two truly cross-cutting pieces
 * of UI state: which tab is active, and which family member is selected.
 *
 * Same "dumb provider" pattern as PortfolioContext.jsx: state ownership stays
 * in App.jsx (tab/selMember are still plain useStates there); this context
 * just makes them reachable via useAppShell() from any nested component,
 * without threading them through props. Extracted from App.jsx (P3-5, step 2).
 *
 * Provider: wrap the tab-rendering section in App.jsx with <AppShellProvider>.
 * Consumer: call useAppShell() inside any tab or component.
 */

import { createContext, useContext } from 'react';

const AppShellContext = createContext(null);

/**
 * Consume shared app-shell state inside any tab or child component.
 * Throws if used outside an <AppShellProvider>.
 */
export function useAppShell() {
  const ctx = useContext(AppShellContext);
  if (!ctx) throw new Error('useAppShell must be used inside <AppShellProvider>');
  return ctx;
}

/**
 * AppShellProvider — place this around the tab-rendering block in App.jsx.
 *
 * @param {object} props.value  Pass { tab, setTab, selMember, setSelMember }.
 * @param {React.ReactNode} props.children
 */
export function AppShellProvider({ value, children }) {
  return (
    <AppShellContext.Provider value={value}>
      {children}
    </AppShellContext.Provider>
  );
}

export default AppShellContext;
