// CASQueuePanel.jsx — import several CAS statements (NSDL / CDSL / CAMS / KFintech) at once.
//
// Rules shown to the user (all enforced by the hook + server, nothing is flushed):
//   • each statement only touches its own depository + accounts
//   • statements are applied oldest → newest
//   • for every account the newest statement wins; an older file never overwrites newer numbers
//   • a mutual fund listed by two depositories is kept from the newest statement

import { useRef } from "react";
import { queueItemNeedsMember } from "../../hooks/useCASImport.js";

const STATUS = {
  parsing:   { label: "Reading…",        fg: "#c9a84c" },
  ready:     { label: "Ready",           fg: "#4caf9a" },
  password:  { label: "Password needed", fg: "#e07c5a" },
  error:     { label: "Can't import",    fg: "#e07c5a" },
  importing: { label: "Importing…",      fg: "#5a9ce0" },
  done:      { label: "Imported",        fg: "#4caf9a" },
  failed:    { label: "Failed",          fg: "#e07c5a" },
};

const chip = (n, label, fg, bg) => n > 0 && (
  <span key={label} style={{ fontSize: ".64rem", padding: ".12rem .4rem", borderRadius: 4, background: bg, color: fg, fontWeight: 600 }}>{n} {label}</span>
);

export default function CASQueuePanel({ casImport, members, onClose, onPriceRefresh }) {
  const addRef = useRef(null);
  const {
    casQueue, casQueueRunning, casQueueDone,
    handleCASFiles, setQueuePan, retryQueueItem, setQueueHolder, removeQueueItem, runCASQueue, retireOlderCopies,
    resetCASDownloader,
  } = casImport;

  const busy = casQueueRunning || casQueue.some(i => i.status === "parsing" || i.status === "importing");
  const importable = casQueue.filter(i => i.status === "ready" && !queueItemNeedsMember(i.src, members));
  const waiting = casQueue.filter(i => i.status === "ready" && queueItemNeedsMember(i.src, members)).length;

  // "NSDL as of 2026-09-30 · CDSL as of 2026-10-31" when the files are from different months.
  const readyItems = casQueue.filter(i => i.src && (i.status === "ready" || i.status === "done" || i.status === "importing"));
  const months = new Set(readyItems.map(i => (i.src.statementDate || "").slice(0, 7)));
  const mixedMonths = months.size > 1;
  const fmtInr = (v) => `₹${Number(v || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

  function holderPickers(it) {
    const { holderNames, holderMap, holdings } = it.src;
    const owning = new Set(holdings.map(h => h._holder_name).filter(Boolean));
    const multi = holderNames.length > 1 && members.length > 1;
    const names = multi ? holderNames.filter(n => owning.has(n)) : [holderNames[0] || "__default__"];
    return names.map(n => (
      <div key={n} style={{ display: "flex", gap: ".5rem", alignItems: "center", marginTop: ".3rem" }}>
        <span style={{ fontSize: ".7rem", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {n === "__default__" ? "Assign holdings to" : n}
        </span>
        <select className="fi fs" style={{ padding: ".2rem .45rem", fontSize: ".7rem", width: "auto", minWidth: 130, borderColor: holderMap[n] || holderMap["__default__"] ? undefined : "rgba(224,124,90,.6)" }}
          value={holderMap[n] || ""} onChange={e => setQueueHolder(it.id, n, e.target.value, members)}>
          <option value="">— Select member —</option>
          {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      </div>
    ));
  }

  function previewChips(it) {
    const sm = it.preview?.summary;
    if (it.preview?.error) return <span style={{ fontSize: ".64rem", color: "#e07c5a" }}>Preview unavailable: {it.preview.error}</span>;
    if (!sm) return null;
    return (
      <div style={{ display: "flex", gap: ".35rem", flexWrap: "wrap", marginTop: ".35rem", alignItems: "center" }}>
        {chip(sm.new, "new", "#4caf9a", "rgba(76,175,154,.15)")}
        {chip(sm.changed, "changed", "#5a9ce0", "rgba(90,156,224,.15)")}
        {chip(sm.unchanged, "unchanged", "var(--text)", "rgba(128,128,128,.12)")}
        {chip(sm.exited, "exited", "#e07c5a", "rgba(224,124,90,.15)")}
        {chip(sm.older, "older than stored (kept as is)", "#e07c5a", "rgba(224,124,90,.15)")}
        {chip(sm.overlap, "also in another statement", "#c9a84c", "rgba(201,168,76,.15)")}
        {chip(sm.transactions, "ledger transactions", "#a084ca", "rgba(160,132,202,.15)")}
        <span style={{ fontSize: ".6rem", opacity: .55 }}>vs. what is stored now</span>
      </div>
    );
  }

  function resultLine(r) {
    const parts = [];
    if (r.inserted_count) parts.push(`+${r.inserted_count} new`);
    if (r.updated_count) parts.push(`${r.updated_count} refreshed`);
    if (r.exited_count) parts.push(`${r.exited_count} exited`);
    if (r.txns_inserted) parts.push(`${r.txns_inserted} ledger rows`);
    if (r.skipped_older) parts.push(`${r.skipped_older} kept (newer data stored)`);
    if (r.skipped_overlap) parts.push(`${r.skipped_overlap} fund${r.skipped_overlap > 1 ? "s" : ""} kept from a newer statement`);
    return parts.join(" · ") || "No changes";
  }

  return (
    <>
      {mixedMonths && (
        <div style={{ background: "rgba(201,168,76,.06)", border: "1px solid rgba(201,168,76,.2)", borderRadius: 8, padding: ".55rem .75rem", marginBottom: ".8rem" }}>
          <div style={{ fontSize: ".7rem", color: "#c9a84c", fontWeight: 600, marginBottom: ".2rem" }}>These statements are from different months</div>
          <div style={{ fontSize: ".66rem", color: "var(--text)" }}>
            {readyItems.map(i => `${i.src.depository || "CAS"} as of ${i.src.statementDate}`).join(" · ")}
          </div>
          <div style={{ fontSize: ".64rem", color: "var(--text)", opacity: .8, marginTop: ".25rem" }}>
            They are applied oldest first. For each account the newest statement wins, an older file never overwrites newer numbers, and a mutual fund listed in two statements is kept from the newest one. Refresh prices afterwards to bring every account to today's value.
          </div>
        </div>
      )}

      <div style={{ maxHeight: 380, overflowY: "auto", marginBottom: ".9rem", display: "flex", flexDirection: "column", gap: ".5rem" }}>
        {casQueue.map(it => {
          const st = STATUS[it.status] || STATUS.ready;
          const needs = it.status === "ready" && queueItemNeedsMember(it.src, members);
          return (
            <div key={it.id} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: ".6rem .75rem", background: "var(--bg-muted)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: ".5rem" }}>
                <span style={{ flex: 1, minWidth: 0, fontSize: ".76rem", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={it.name}>📄 {it.name}</span>
                {it.src?.depository && <span style={{ fontSize: ".64rem", padding: ".1rem .4rem", borderRadius: 4, background: "rgba(160,132,202,.12)", color: "#a084ca", fontWeight: 600 }}>{it.src.depository} · as of {it.src.statementDate}</span>}
                <span style={{ fontSize: ".66rem", color: needs ? "#e07c5a" : st.fg, fontWeight: 600 }}>{needs ? "Pick member" : st.label}</span>
                {!busy && <button className="btnc" style={{ padding: ".1rem .4rem", fontSize: ".7rem" }} title="Remove from batch" onClick={() => removeQueueItem(it.id)}>✕</button>}
              </div>

              {it.src && <div style={{ fontSize: ".66rem", opacity: .75, marginTop: ".2rem" }}>
                {it.src.holdings.length} holding{it.src.holdings.length !== 1 ? "s" : ""}{it.src.holderNames.length ? ` · ${it.src.holderNames.join(", ")}` : ""}
                {it.src.holdings.length > 0 && ` · ${fmtInr(it.src.holdings.reduce((a, h) => a + (Number(h.current_value) || 0), 0))}`}
              </div>}

              {it.status === "password" && (
                <div style={{ display: "flex", gap: ".5rem", alignItems: "center", marginTop: ".4rem" }}>
                  <input className="fi" value={it.pan} maxLength={10} placeholder="Holder PAN (ABCDE1234F)"
                    onChange={e => setQueuePan(it.id, e.target.value)}
                    onKeyDown={e => e.key === "Enter" && retryQueueItem(it.id, members)}
                    style={{ fontFamily: "'DM Mono',monospace", letterSpacing: ".08em", fontSize: ".72rem", padding: ".25rem .5rem" }} />
                  <button className="btns" style={{ fontSize: ".7rem", padding: ".25rem .7rem" }} disabled={it.pan.length !== 10} onClick={() => retryQueueItem(it.id, members)}>Unlock</button>
                </div>
              )}
              {(it.status === "password" || it.status === "error" || it.status === "failed") && it.error && (
                <div style={{ fontSize: ".68rem", color: "#e07c5a", marginTop: ".3rem" }}>⚠ {it.error}</div>
              )}
              {it.status === "ready" && needs && holderPickers(it)}
              {it.status === "ready" && !needs && previewChips(it)}
              {it.status === "done" && it.result && (
                <div style={{ fontSize: ".7rem", marginTop: ".3rem" }}>
                  <span style={{ color: "#4caf9a" }}>{resultLine(it.result)}</span>
                  {it.result.retired_older > 0 && (
                    <div style={{ color: "#4caf9a", marginTop: ".15rem" }}>✓ Removed {it.result.retired_older} older cop{it.result.retired_older > 1 ? "ies" : "y"} — each fund now counts once, from the newest statement.</div>
                  )}
                  {it.result.doubles?.length > 0 && (
                    <div style={{ marginTop: ".3rem", background: "rgba(201,168,76,.07)", border: "1px solid rgba(201,168,76,.25)", borderRadius: 6, padding: ".45rem .6rem" }}>
                      <div style={{ color: "#c9a84c", fontWeight: 600, marginBottom: ".2rem" }}>
                        {it.result.doubles.length} fund{it.result.doubles.length > 1 ? "s are" : " is"} also listed in an older statement — likely counted twice
                      </div>
                      {it.result.doubles.slice(0, 8).map(d => (
                        <div key={d.isin} style={{ fontSize: ".66rem", color: "var(--text)", display: "flex", gap: ".5rem" }}>
                          <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.name}</span>
                          <span className="mono dim">{Number(d.units ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 3 })}u here · {d.older.map(o => `${Number(o.units).toLocaleString("en-IN", { maximumFractionDigits: 3 })}u in ${o.depository}${o.source_date ? ` (${o.source_date})` : ""}`).join(", ")}</span>
                        </div>
                      ))}
                      {it.result.doubles.length > 8 && <div style={{ fontSize: ".64rem", opacity: .7 }}>+{it.result.doubles.length - 8} more</div>}
                      <div style={{ fontSize: ".64rem", color: "var(--text)", opacity: .75, margin: ".3rem 0" }}>
                        If these are the same folio, keep only the newest copy. If you hold the fund separately in both places (e.g. a demat and a folio), leave them as they are. Removed copies keep their transactions and can be re-imported.
                      </div>
                      <button className="btns" style={{ fontSize: ".68rem", padding: ".25rem .7rem" }} disabled={it.retiring} onClick={() => retireOlderCopies(it.id)}>
                        {it.retiring ? "Removing…" : "Keep newest only"}
                      </button>
                      {it.retireError && <span style={{ fontSize: ".66rem", color: "#e07c5a", marginLeft: ".5rem" }}>⚠ {it.retireError}</span>}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: ".6rem" }}>
        <div style={{ display: "flex", gap: ".5rem" }}>
          {!casQueueDone && <button className="btnc" onClick={() => { resetCASDownloader(); onClose(); }}>Cancel</button>}
          {!casQueueDone && !busy && (
            <>
              <button className="btnc" onClick={() => addRef.current?.click()}>+ Add files</button>
              <input ref={addRef} type="file" accept=".pdf" multiple style={{ display: "none" }}
                onChange={e => { handleCASFiles(e.target.files, members); e.target.value = ""; }} />
            </>
          )}
        </div>
        {casQueueDone ? (
          <button className="btns" onClick={() => { resetCASDownloader(); onClose(); }}>Done</button>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: ".6rem" }}>
            {waiting > 0 && <span style={{ fontSize: ".64rem", color: "#e07c5a" }}>{waiting} statement{waiting > 1 ? "s" : ""} need a member</span>}
            <button className="btns" disabled={busy || importable.length === 0}
              onClick={() => runCASQueue(members, onPriceRefresh)}>
              {casQueueRunning ? "Importing…" : `Import ${importable.length} statement${importable.length !== 1 ? "s" : ""}`}
            </button>
          </div>
        )}
      </div>
    </>
  );
}
