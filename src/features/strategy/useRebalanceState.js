import { useState } from "react";

/**
 * useRebalanceState — Strategy tab rebalancing inputs: target allocation
 * percentages, which member's portfolio to rebalance, and extra cash to
 * factor in. Extracted from App.jsx (P3-5); passed straight through to
 * StrategyTab, same as before.
 */
export function useRebalanceState() {
  const [targetAlloc, setTargetAlloc] = useState({
    IN_STOCK: 35, MF: 25, IN_ETF: 5, US_STOCK: 10, US_ETF: 5, US_BOND: 0,
    CRYPTO: 3, CASH: 0, FD: 5, PPF: 5, EPF: 5, REAL_ESTATE: 2, INSURANCE: 0, OTHER: 0,
  });
  const [rebalMember, setRebalMember] = useState('all');
  const [rebalCash, setRebalCash] = useState('');

  return {
    targetAlloc, setTargetAlloc,
    rebalMember, setRebalMember,
    rebalCash, setRebalCash,
  };
}
