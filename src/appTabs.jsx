import { BarChart2, CalendarDays, Compass, LayoutDashboard, MessageSquare, Newspaper, Target, TrendingUp, Users } from 'lucide-react';
import LoadingSkeleton from './components/shared/LoadingSkeleton.jsx';
import { Suspense, lazy } from 'react';

// ── Code-splitting ────────────────────────────────────────────────────────────
// Tabs and modals are loaded on first use instead of shipping in the first bundle (the Overview
// tab and the shell stay eager so first paint is fast). Each one is wrapped in its own
// <Suspense> so a chunk loading never blanks the rest of the page; a failed chunk load throws
// into the surrounding ErrorBoundary like any render error. After the first load the chunks are
// pre-fetched when the browser is idle, so switching tabs does not flash a skeleton.
const split = (loader, fallback = null) => {
  const C = lazy(loader);
  const Wrapped = (props) => <Suspense fallback={fallback}><C {...props} /></Suspense>;
  Wrapped.preload = loader;
  return Wrapped;
};
export const HoldingsTab = split(() => import('./features/holdings/HoldingsTab.jsx'), <LoadingSkeleton />);
export const GoalsTab = split(() => import('./features/goals/GoalsTab.jsx'), <LoadingSkeleton />);
export const StrategyTab = split(() => import('./features/strategy/StrategyTab.jsx'), <LoadingSkeleton />);
export const MembersTab = split(() => import('./features/members/MembersTab.jsx'), <LoadingSkeleton />);
export const FamilyBudgetTab = split(() => import('./features/budget/FamilyBudgetTab.jsx'), <LoadingSkeleton />);
export const CalendarTab = split(() => import('./features/calendar/CalendarTab.jsx'), <LoadingSkeleton />);
export const AdvisorTab = split(() => import('./features/AdvisorTab.jsx'), <LoadingSkeleton />);
export const NewsTab = split(() => import('./features/NewsTab.jsx'), <LoadingSkeleton />);
export const AuditLogPanel = split(() => import('./features/AuditLogPanel.jsx'));
export const CASImportModal = split(() => import('./components/modals/CASImportModal.jsx'));
export const ImportModal = split(() => import('./components/modals/ImportModal.jsx'));
export const ImportHub = split(() => import('./components/modals/ImportHub.jsx'));
export const TradebookImportModal = split(() => import('./features/holdings/TradebookImportModal.jsx'));
export const GoalPlanModal = split(() => import('./components/modals/GoalPlanModal.jsx'));
export const TransactionPanel = split(() => import('./components/shared/TransactionPanel.jsx'));
export const ArtifactPanel = split(() => import('./components/shared/ArtifactPanel.jsx'));
export const PRELOAD = [HoldingsTab, GoalsTab, StrategyTab, MembersTab, FamilyBudgetTab, CalendarTab, AdvisorTab, NewsTab];

// ── API helper imported from lib/api.js (see top imports) ────────

export const TABS = [
  { key: 'overview',  label: 'Overview',  Icon: LayoutDashboard },
  { key: 'holdings',  label: 'Holdings',  Icon: BarChart2 },
  { key: 'goals',     label: 'Goals',     Icon: Target },
  { key: 'strategy',  label: 'Strategy',  Icon: Compass },
  { key: 'members',   label: 'Family',    Icon: Users },
  { key: 'familybudget', label: 'Family Budget', Icon: TrendingUp },
  { key: 'calendar',  label: 'Calendar',  Icon: CalendarDays },
  { key: 'advisor',   label: 'Advisor',   Icon: MessageSquare },
  { key: 'news',      label: 'News',      Icon: Newspaper },
];

// Mobile bottom nav: 4 highest-value tabs — rest go into ··· more sheet
export const BOTTOM_NAV_KEYS = ['overview', 'holdings', 'familybudget', 'advisor'];
export const BOTTOM_NAV_TABS = BOTTOM_NAV_KEYS.map(k => TABS.find(t => t.key === k));
export const MORE_SHEET_TABS = TABS.filter(t => !BOTTOM_NAV_KEYS.includes(t.key));
