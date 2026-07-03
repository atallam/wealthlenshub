import { useState, useRef } from "react";
import { api } from "../lib/api.js";
import { setLiveUsdInr } from "../utils.js";

/**
 * useBrokerSearch — all instrument-search state used by the "add holding" form
 * (mutual funds, stocks, ETFs, US stocks) plus the USD/INR rate fetch.
 * Extracted from App.jsx to shrink the god-component; behavior is unchanged.
 */
export function useBrokerSearch() {
  const [mfSearch, setMfSearch]       = useState("");
  const [mfResults, setMfResults]     = useState([]);
  const [mfSearching, setMfSearching] = useState(false);
  const [mfNav, setMfNav]             = useState(null);
  const [stockSearch, setStockSearch]       = useState("");
  const [stockResults, setStockResults]     = useState([]);
  const [stockSearching, setStockSearching] = useState(false);
  const [stockInfo, setStockInfo]           = useState(null);
  const [stockLooking, setStockLooking]     = useState(false);
  const [etfSearch, setEtfSearch]       = useState("");
  const [etfResults, setEtfResults]     = useState([]);
  const [etfSearching, setEtfSearching] = useState(false);
  const [etfInfo, setEtfInfo]           = useState(null);
  const [usSearch, setUsSearch]         = useState("");
  const [usResults, setUsResults]       = useState([]);
  const [usSearching, setUsSearching]   = useState(false);
  const [usdInrRate, setUsdInrRate]     = useState(94.5);
  const [usdInrLoading, setUsdInrLoading] = useState(false);

  const stockSearchTimer = useRef();
  const usSearchTimer    = useRef();
  const mfSearchTimer    = useRef();
  const etfSearchTimer   = useRef();

  function handleMfSearch(v) {
    setMfSearch(v); setMfNav(null);
    clearTimeout(mfSearchTimer.current);
    if (!v.trim()) { setMfResults([]); return; }
    setMfSearching(true);
    mfSearchTimer.current = setTimeout(async () => {
      try { const d = await api(`/api/mf/search?q=${encodeURIComponent(v)}`); setMfResults(d?.funds || []); }
      catch { setMfResults([]); }
      setMfSearching(false);
    }, 350);
  }

  function handleStockSearch(v) {
    setStockSearch(v); setStockInfo(null);
    clearTimeout(stockSearchTimer.current);
    if (!v.trim()) { setStockResults([]); return; }
    setStockSearching(true);
    stockSearchTimer.current = setTimeout(async () => {
      try { const d = await api(`/api/stocks/search?q=${encodeURIComponent(v)}&exchange=NSE`); setStockResults(d?.results || []); }
      catch { setStockResults([]); }
      setStockSearching(false);
    }, 350);
  }

  function handleEtfSearch(v) {
    setEtfSearch(v); setEtfInfo(null);
    clearTimeout(etfSearchTimer.current);
    if (!v.trim()) { setEtfResults([]); return; }
    setEtfSearching(true);
    etfSearchTimer.current = setTimeout(async () => {
      try { const d = await api(`/api/stocks/search?q=${encodeURIComponent(v)}&exchange=NSE`); setEtfResults(d?.results || []); }
      catch { setEtfResults([]); }
      setEtfSearching(false);
    }, 350);
  }

  function handleUsSearch(v) {
    setUsSearch(v);
    clearTimeout(usSearchTimer.current);
    if (!v.trim()) { setUsResults([]); return; }
    setUsSearching(true);
    usSearchTimer.current = setTimeout(async () => {
      try { const d = await api(`/api/stocks/search?q=${encodeURIComponent(v)}&exchange=US`); setUsResults(d?.results || []); }
      catch { setUsResults([]); }
      setUsSearching(false);
    }, 350);
  }

  async function fetchUsdInr() {
    setUsdInrLoading(true);
    try { const d = await api("/api/forex/usdinr"); if (d?.rate) { setUsdInrRate(d.rate); setLiveUsdInr(d.rate); } }
    catch { /* ignore */ }
    setUsdInrLoading(false);
  }

  return {
    mfSearch, setMfSearch, mfResults, setMfResults, mfSearching, setMfSearching, mfNav, setMfNav,
    stockSearch, setStockSearch, stockResults, setStockResults, stockSearching, setStockSearching,
    stockInfo, setStockInfo, stockLooking, setStockLooking,
    etfSearch, setEtfSearch, etfResults, setEtfResults, etfSearching, setEtfSearching, etfInfo, setEtfInfo,
    usSearch, setUsSearch, usResults, setUsResults, usSearching, setUsSearching,
    usdInrRate, setUsdInrRate, usdInrLoading, setUsdInrLoading,
    handleMfSearch, handleStockSearch, handleEtfSearch, handleUsSearch, fetchUsdInr,
  };
}
