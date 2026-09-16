// CASImportModal.jsx - NSDL/CDSL/CAMS/KFintech CAS PDF import wizard
// Steps: intro -> uploading -> password_v2 -> matching (with diff preview) -> importing -> done
// casparser (Smart Parser) is the only active upload path.
// Old parser (lib/parsers.js / /api/import/detect) kept commented out for reference.
//
// Matching step: once every holder is mapped to a member, the modal asks
// /api/holdings/import/preview for a diff (new / changed / unchanged / exited /
// cross-source overlap / legacy rows / already-imported) and shows it before the
// user commits. The commit itself is one atomic server transaction.

import { useRef, useEffect } from "react";
import { Overlay } from "../shared/Overlay.jsx";

export default function CASImportModal({
  casImport,
  members,
  onClose,
  onPriceRefresh,
}) {
  const fileRef = useRef(null);
  // const fileRefV2 = useRef(null);  // old parser had a separate ref — now merged into fileRef
  const {
    casStep, casHoldings, casHolderNames, casHolderPans,
    casHolderMap, setCasHolderMap, casWarnings, casFormat,
    casUploading, casResult, casPanInput, setCasPanInput,
    casSavePan, setCasSavePan,
    // handleCASUpload, retryCASWithPassword,  // old parser — removed
    executeCASImport, resetCASDownloader,
    handleCASUploadV2, retryCASWithPasswordV2,
    casDepository, casStatementDate,
    casPreview, casPreviewing, previewCASImport,
    casDupAction, setCasDupAction,
    casRetireLegacy, setCasRetireLegacy,
  } = casImport;

  function handleFile(file) {
    if (file) handleCASUploadV2(file, members);
  }

  const isDone       = casStep === "done";
  const isImporting  = casStep === "importing";
  const isMatching   = casStep === "matching";
  // const isPassword = casStep === "password";  // old parser step — removed
  const isPasswordV2 = casStep === "password_v2";
  const isUploading  = casStep === "uploading" || casUploading;

  const title = isDone       ? "CAS Imported"
    : isImporting  ? "Importing..."
    : isPasswordV2 ? "Unlock CAS PDF"
    : isMatching   ? "Import CAS"
    : "Import CAS";

  const hasMultiHolder = casHolderNames.length > 1 && members.length > 1;

  // Is every holder resolved to a member? (drives both the preview and the Import button)
  // Multi-holder: only holders that actually own rows must be mapped (a joint holder
  // named in the PDF but owning nothing in this statement doesn't block the import).
  const owningHolders = new Set(casHoldings.map(h => h._holder_name).filter(Boolean));
  const needsMemberPick = hasMultiHolder
    ? casHolderNames.some(n => owningHolders.has(n) && !casHolderMap[n])
    : (casHolderNames.length <= 1 && members.length > 1 && !(casHolderMap[casHolderNames[0]] || casHolderMap["__default__"]));

  // Re-run the diff preview whenever the mapping settles or changes.
  const mapKey = JSON.stringify(casHolderMap);
  useEffect(() => {
    if (isMatching && !needsMemberPick && casHoldings.length > 0) previewCASImport(members);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMatching, needsMemberPick, mapKey, casHoldings.length, casRetireLegacy]);

  // Per-row status lookup from the preview (member|isin → row)
  const previewRows = {};
  for (const r of casPreview?.rows || []) previewRows[`${r.member_id}|${r.isin}`] = r;
  const rowStatusFor = (h) => {
    const memberId = hasMultiHolder
      ? casHolderMap[h._holder_name]
      : (casHolderMap[casHolderNames[0]] || casHolderMap["__default__"] || (members.length === 1 ? members[0]?.id : undefined));
    const isin = (h.isin || h.ticker || h.scheme_code || "").toUpperCase();
    return previewRows[`${memberId}|${isin}`] || null;
  };
  const STATUS_STYLE = {
    new:       { bg: "rgba(76,175,154,.15)",  fg: "#4caf9a", label: "New" },
    reentered: { bg: "rgba(76,175,154,.15)",  fg: "#4caf9a", label: "Back" },
    changed:   { bg: "rgba(90,156,224,.15)",  fg: "#5a9ce0", label: "Changed" },
    unchanged: { bg: "rgba(128,128,128,.12)", fg: "var(--text)", label: "Same" },
    older:     { bg: "rgba(224,124,90,.15)",  fg: "#e07c5a", label: "Older" },
  };
  const skippedCount = Object.values(casDupAction).filter(v => v === "skip").length;
  const importCount = casHoldings.length - skippedCount;
  const fmtInr = (v) => `₹${Number(v || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

  return (
    <Overlay onClose={() => { resetCASDownloader(); onClose(); }} wide>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.2rem" }}>
        <div className="modtitle" style={{ margin: 0 }}>{title}</div>
      </div>

      {/* Loading spinner */}
      {isUploading && (
        <div style={{ textAlign: "center", padding: "2.5rem 1rem" }}>
          <div style={{ width: 38, height: 38, margin: "0 auto 1rem", border: "3px solid rgba(201,168,76,.2)", borderTopColor: "#c9a84c", borderRadius: "50%", animation: "spin 1s linear infinite" }} />
          <div style={{ fontSize: ".85rem", color: "var(--text)" }}>Parsing CAS statement...</div>
          <div style={{ fontSize: ".7rem", color: "var(--text)", marginTop: ".4rem" }}>Fetching live prices for demat holdings</div>
        </div>
      )}

      {/* OLD password unlock step (old parser) — kept for reference
      {!isUploading && isPassword && (
        <div style={{ maxWidth: 400, margin: "0 auto" }}>
          ...retryCASWithPassword(members)...
        </div>
      )} */}

      {/* Intro / upload step */}
      {!isUploading && (casStep === "intro" || casStep === "upload") && (
        <>
          <div
            style={{ border: "2px dashed var(--border)", borderRadius: 12, padding: "2.5rem 1.5rem", textAlign: "center", cursor: "pointer", background: "var(--bg-muted)", marginBottom: ".75rem" }}
            onClick={() => fileRef.current?.click()}
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}>
            <div style={{ fontSize: "2.2rem", marginBottom: ".6rem" }}>📄</div>
            <div style={{ fontSize: ".85rem", color: "var(--text)", fontWeight: 500 }}>Drag &amp; drop your CAS PDF here</div>
            <div style={{ fontSize: ".72rem", color: "var(--text)", marginTop: ".4rem" }}>NSDL · CDSL · CAMS / KFintech (detailed CAS adds XIRR &amp; tax lots) · Password = your PAN</div>
            <button className="btns" style={{ marginTop: "1rem", fontSize: ".75rem" }}>Browse File</button>
          </div>
          <input ref={fileRef} type="file" accept=".pdf" style={{ display: "none" }}
            onChange={e => { const f = e.target.files[0]; if (f) handleFile(f); e.target.value = ""; }} />

          {/* OLD: secondary "Try Smart Parser" card — removed now that casparser is the default.
          <div style={{ border: "1px solid rgba(76,175,154,.25)", ... }}>
            <button onClick={() => fileRefV2.current?.click()}>📂 Choose PDF (Smart)</button>
          </div>
          <input ref={fileRefV2} ... onChange={e => handleCASUploadV2(f, members)} /> */}

          {casWarnings.length > 0 && (
            <div style={{ background: "rgba(224,124,90,.1)", border: "1px solid rgba(224,124,90,.25)", borderRadius: 8, padding: ".7rem .9rem" }}>
              {casWarnings.map((w, i) => <div key={i} style={{ fontSize: ".73rem", color: "#e07c5a", marginBottom: i < casWarnings.length - 1 ? ".3rem" : 0 }}>⚠ {w}</div>)}
            </div>
          )}
        </>
      )}

      {/* Smart Parser password unlock step */}
      {!isUploading && isPasswordV2 && (
        <div style={{ maxWidth: 400, margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: "1.2rem" }}>
            <div style={{ fontSize: "2rem", marginBottom: ".5rem" }}>🔐</div>
            <div style={{ fontSize: ".85rem", color: "var(--text)", marginBottom: ".3rem" }}>This PDF is password-protected</div>
            <div style={{ fontSize: ".72rem", color: "var(--text)" }}>NSDL/CDSL CAS password is your PAN number (uppercase)</div>
            <div style={{ fontSize: ".68rem", color: "#4caf9a", marginTop: ".3rem" }}>Powered by casparser · supports NSDL, CDSL, CAMS &amp; Kfintech</div>
          </div>
          {casWarnings.length > 0 && (
            <div style={{ background: "rgba(224,124,90,.1)", border: "1px solid rgba(224,124,90,.25)", borderRadius: 8, padding: ".55rem .75rem", marginBottom: ".8rem" }}>
              {casWarnings.map((w, i) => <div key={i} style={{ fontSize: ".73rem", color: "#e07c5a" }}>⚠ {w}</div>)}
            </div>
          )}
          <div style={{ marginBottom: ".8rem" }}>
            <label style={{ fontSize: ".68rem", color: "var(--text)", letterSpacing: ".05em", textTransform: "uppercase", display: "block", marginBottom: ".3rem" }}>PAN Number</label>
            <input className="fi" value={casPanInput} onChange={e => setCasPanInput(e.target.value.toUpperCase())}
              placeholder="ABCDE1234F" maxLength={10}
              style={{ fontFamily: "'DM Mono',monospace", textTransform: "uppercase", letterSpacing: ".1em" }}
              onKeyDown={e => e.key === "Enter" && casPanInput.length === 10 && retryCASWithPasswordV2(members)} />
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: ".5rem", fontSize: ".73rem", color: "var(--text)", marginBottom: "1.2rem", cursor: "pointer" }}>
            <input type="checkbox" checked={casSavePan} onChange={e => setCasSavePan(e.target.checked)} style={{ accentColor: "#c9a84c" }} />
            Remember PAN for future imports (encrypted)
          </label>
          <div style={{ display: "flex", gap: ".7rem" }}>
            <button className="btnc" onClick={() => { resetCASDownloader(); onClose(); }}>Cancel</button>
            <button className="btns" disabled={casPanInput.length !== 10} onClick={() => retryCASWithPasswordV2(members)}>
              Unlock &amp; Parse (Smart)
            </button>
          </div>
        </div>
      )}

      {/* Matching / preview step */}
      {!isUploading && isMatching && (
        <>
          {casWarnings.length > 0 && (
            <div style={{ background: "rgba(201,168,76,.06)", border: "1px solid rgba(201,168,76,.15)", borderRadius: 8, padding: ".55rem .75rem", marginBottom: ".8rem" }}>
              {casWarnings.map((w, i) => <div key={i} style={{ fontSize: ".7rem", color: "#c9a84c" }}>⚠ {w}</div>)}
            </div>
          )}
          <div style={{ display: "flex", gap: ".5rem", flexWrap: "wrap", marginBottom: ".8rem" }}>
            {casFormat && (
              <span style={{ fontSize: ".68rem", padding: ".2rem .55rem", borderRadius: 4, background: "rgba(201,168,76,.12)", color: "#c9a84c", border: "1px solid rgba(201,168,76,.2)", fontWeight: 600 }}>
                {casFormat}
              </span>
            )}
            {casHolderPans.map(pan => (
              <span key={pan} style={{ fontSize: ".68rem", padding: ".2rem .55rem", borderRadius: 4, background: "rgba(90,156,224,.1)", color: "#5a9ce0", border: "1px solid rgba(90,156,224,.2)", fontFamily: "'DM Mono',monospace" }}>
                PAN: {pan}
              </span>
            ))}
            {casDepository && (
              <span style={{ fontSize: ".68rem", padding: ".2rem .55rem", borderRadius: 4, background: "rgba(160,132,202,.12)", color: "#a084ca", border: "1px solid rgba(160,132,202,.25)", fontWeight: 600 }}>
                {casDepository}{casStatementDate ? ` · as of ${casStatementDate}` : ""}
              </span>
            )}
            <span style={{ fontSize: ".72rem", color: "var(--text)" }}>
              {casHoldings.length} holding{casHoldings.length !== 1 ? "s" : ""} found
            </span>
          </div>

          {/* Already-imported banner (same PDF bytes seen before) */}
          {casPreview?.already_imported && (
            <div style={{ background: "rgba(90,156,224,.08)", border: "1px solid rgba(90,156,224,.25)", borderRadius: 8, padding: ".55rem .75rem", marginBottom: ".8rem", fontSize: ".72rem", color: "#5a9ce0" }}>
              ℹ This exact statement was already imported on {new Date(casPreview.already_imported.at).toLocaleDateString("en-IN")}. Importing again is safe — it will only refresh values.
            </div>
          )}

          {/* Diff summary */}
          {!needsMemberPick && (
            <div style={{ display: "flex", gap: ".45rem", flexWrap: "wrap", alignItems: "center", marginBottom: ".8rem", minHeight: 24 }}>
              {casPreviewing && !casPreview && <span style={{ fontSize: ".7rem", color: "var(--text)" }}>Comparing with your portfolio…</span>}
              {casPreview?.error && <span style={{ fontSize: ".7rem", color: "#e07c5a" }}>⚠ Preview unavailable: {casPreview.error}</span>}
              {casPreview?.summary && (() => {
                const sm = casPreview.summary;
                const chip = (n, label, fg, bg) => n > 0 && (
                  <span key={label} style={{ fontSize: ".68rem", padding: ".18rem .5rem", borderRadius: 4, background: bg, color: fg, fontWeight: 600 }}>{n} {label}</span>
                );
                return <>
                  {chip(sm.new, "new", "#4caf9a", "rgba(76,175,154,.15)")}
                  {chip(sm.changed, "changed", "#5a9ce0", "rgba(90,156,224,.15)")}
                  {chip(sm.unchanged, "unchanged", "var(--text)", "rgba(128,128,128,.12)")}
                  {chip(sm.exited, "exited", "#e07c5a", "rgba(224,124,90,.15)")}
                  {chip(sm.older, "older than stored", "#e07c5a", "rgba(224,124,90,.15)")}
                  {chip(sm.overlap, "also in another statement", "#c9a84c", "rgba(201,168,76,.15)")}
                  {chip(sm.transactions, "ledger transactions", "#a084ca", "rgba(160,132,202,.15)")}
                  {sm.new + sm.changed + sm.unchanged + sm.exited === 0 && <span style={{ fontSize: ".7rem", color: "var(--text)" }}>Nothing to compare yet.</span>}
                  {casPreviewing && <span style={{ fontSize: ".65rem", color: "var(--text)", opacity: .6 }}>refreshing…</span>}
                </>;
              })()}
            </div>
          )}

          {/* Ledger notes (Phase 3) */}
          {casPreview?.summary && (casDepository === "CAMS" || casDepository === "KFINTECH") && casPreview.summary.transactions === 0 && (
            <div style={{ fontSize: ".66rem", color: "var(--text)", opacity: .8, marginBottom: ".6rem" }}>
              ℹ This is a <b>summary</b> CAS — holdings only. For XIRR and tax lots, request the <b>detailed</b> CAS (with transactions, ideally since inception) from CAMS/KFintech and import that instead.
            </div>
          )}
          {casPreview?.summary?.approx_cost > 0 && (
            <div style={{ fontSize: ".66rem", color: "#c9a84c", marginBottom: ".6rem" }}>
              ≈ {casPreview.summary.approx_cost} scheme{casPreview.summary.approx_cost > 1 ? "s" : ""} already had units before this statement's start date — their opening cost is approximated. A since-inception detailed CAS replaces the approximation with exact lots.
            </div>
          )}

          {/* Exits: holdings in these accounts that the statement no longer lists */}
          {casPreview?.exited?.length > 0 && (
            <div style={{ background: "rgba(224,124,90,.06)", border: "1px solid rgba(224,124,90,.2)", borderRadius: 8, padding: ".55rem .75rem", marginBottom: ".8rem" }}>
              <div style={{ fontSize: ".68rem", color: "#e07c5a", fontWeight: 600, marginBottom: ".25rem" }}>
                {casPreview.exited.length} holding{casPreview.exited.length > 1 ? "s" : ""} no longer in this {casDepository} statement — will be marked exited
              </div>
              <div style={{ fontSize: ".68rem", color: "var(--text)", display: "flex", flexWrap: "wrap", gap: ".3rem .8rem" }}>
                {casPreview.exited.slice(0, 12).map(e => <span key={e.id}>{e.name} <span className="mono dim">({Number(e.units).toLocaleString("en-IN", { maximumFractionDigits: 3 })} · {fmtInr(e.current_value)})</span></span>)}
                {casPreview.exited.length > 12 && <span>+{casPreview.exited.length - 12} more</span>}
              </div>
              <div style={{ fontSize: ".64rem", color: "var(--text)", opacity: .75, marginTop: ".3rem" }}>Their transactions and documents are kept. They reappear automatically if a later statement lists them again.</div>
            </div>
          )}

          {/* Cross-source overlap: same ISIN for the same member from another depository/RTA */}
          {casPreview?.overlaps?.length > 0 && (
            <div style={{ background: "rgba(201,168,76,.06)", border: "1px solid rgba(201,168,76,.2)", borderRadius: 8, padding: ".55rem .75rem", marginBottom: ".8rem" }}>
              <div style={{ fontSize: ".68rem", color: "#c9a84c", fontWeight: 600, marginBottom: ".3rem" }}>
                {casPreview.overlaps.length} holding{casPreview.overlaps.length > 1 ? "s" : ""} already tracked from another statement
              </div>
              <div style={{ fontSize: ".64rem", color: "var(--text)", marginBottom: ".4rem" }}>
                A stock held in two demat accounts is normal — keep both. A mutual fund listed in both an RTA (CAMS/KFintech) CAS and a depository CAS is the <em>same</em> folio — keep it in one place to avoid double counting.
              </div>
              {casPreview.overlaps.map(o => {
                const k = `${o.member_id}|${o.isin}`;
                const skip = casDupAction[k] === "skip";
                return (
                  <label key={k} style={{ display: "flex", alignItems: "center", gap: ".5rem", fontSize: ".7rem", color: "var(--text)", marginBottom: ".2rem", cursor: "pointer" }}>
                    <input type="checkbox" checked={!skip} style={{ accentColor: "#c9a84c" }}
                      onChange={e => setCasDupAction(prev => ({ ...prev, [k]: e.target.checked ? "update" : "skip" }))} />
                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.name}</span>
                    <span className="mono dim" style={{ fontSize: ".64rem" }}>also in {o.with.map(w => `${w.depository} (${w.units} u)`).join(", ")}</span>
                    <span style={{ fontSize: ".62rem", color: skip ? "#e07c5a" : "#4caf9a", minWidth: 70, textAlign: "right" }}>{skip ? "skip here" : "import here"}</span>
                  </label>
                );
              })}
              {casPreview.overlaps.some(o => o.type === "MF") && (
                <button className="btnc" style={{ fontSize: ".64rem", marginTop: ".3rem", padding: ".2rem .5rem" }}
                  onClick={() => setCasDupAction(prev => { const n = { ...prev }; for (const o of casPreview.overlaps) if (o.type === "MF") n[`${o.member_id}|${o.isin}`] = "skip"; return n; })}>
                  Skip all overlapping mutual funds
                </button>
              )}
            </div>
          )}

          {/* Legacy rows from before the keyed-import upgrade */}
          {casPreview?.legacy?.length > 0 && (
            <label style={{ display: "flex", alignItems: "flex-start", gap: ".5rem", fontSize: ".7rem", color: "var(--text)", marginBottom: ".8rem", cursor: "pointer", background: "var(--bg-muted)", borderRadius: 8, padding: ".5rem .7rem" }}>
              <input type="checkbox" checked={casRetireLegacy} onChange={e => setCasRetireLegacy(e.target.checked)} style={{ accentColor: "#c9a84c", marginTop: 2 }} />
              <span>
                Replace {casPreview.legacy.reduce((a, l) => a + l.count, 0)} holding{casPreview.legacy.reduce((a, l) => a + l.count, 0) > 1 ? "s" : ""} imported before the upgrade for {casPreview.legacy.length > 1 ? "these members" : "this member"}.
                <span style={{ opacity: .7 }}> Recommended if this is the same statement family you imported previously; untick if those came from a different depository and you will re-import that one too.</span>
              </span>
            </label>
          )}

          {/* Unmatched rows (no ISIN / no member) */}
          {casPreview?.unmatched?.length > 0 && (
            <div style={{ fontSize: ".66rem", color: "#e07c5a", marginBottom: ".6rem" }}>
              ⚠ {casPreview.unmatched.length} row{casPreview.unmatched.length > 1 ? "s" : ""} will be skipped ({casPreview.unmatched.slice(0, 3).map(u => u.name).join(", ")}{casPreview.unmatched.length > 3 ? "…" : ""}) — {casPreview.unmatched.some(u => u.reason === "no_member") ? "no member mapped" : "no ISIN in the statement"}.
            </div>
          )}

          {hasMultiHolder && (
            <div style={{ marginBottom: ".9rem" }}>
              <div style={{ fontSize: ".65rem", letterSpacing: ".06em", textTransform: "uppercase", color: "var(--text)", marginBottom: ".45rem" }}>Map CAS holders to family members</div>
              {casHolderNames.map(name => (
                <div key={name} style={{ display: "flex", gap: ".6rem", alignItems: "center", marginBottom: ".35rem" }}>
                  <span style={{ fontSize: ".72rem", color: "var(--text)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
                  <span style={{ fontSize: ".65rem", color: "var(--text)" }}>{"->"}</span>
                  <select className="fi fs"
                    style={{ padding: ".22rem .5rem", fontSize: ".7rem", width: "auto", minWidth: 130,
                      borderColor: casHolderMap[name] ? undefined : "rgba(224,124,90,.6)" }}
                    value={casHolderMap[name] || ""}
                    onChange={e => setCasHolderMap(prev => ({ ...prev, [name]: e.target.value || null }))}>
                    <option value="">— Select member —</option>
                    {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                </div>
              ))}
            </div>
          )}

          {!hasMultiHolder && casHolderNames.length <= 1 && members.length > 1 && (() => {
            const resolvedId = casHolderMap[casHolderNames[0]] || casHolderMap["__default__"] || "";
            const autoMatched = !!(casHolderMap[casHolderNames[0]]);
            return (
              <div style={{ marginBottom: ".9rem" }}>
                <div style={{ display: "flex", gap: ".6rem", alignItems: "center" }}>
                  <span style={{ fontSize: ".72rem", color: "var(--text)" }}>Assign holdings to:</span>
                  <select className="fi fs" style={{ padding: ".25rem .5rem", fontSize: ".72rem", width: "auto",
                    borderColor: resolvedId ? undefined : "rgba(224,124,90,.6)" }}
                    value={resolvedId}
                    onChange={e => setCasHolderMap(prev => ({ ...prev, [casHolderNames[0] || "__default__"]: e.target.value || null }))}>
                    <option value="">— Select member —</option>
                    {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                  {autoMatched && <span style={{ fontSize: ".65rem", color: "#4caf9a" }}>✓ auto-matched</span>}
                </div>
                {!resolvedId && (
                  <div style={{ fontSize: ".68rem", color: "#e07c5a", marginTop: ".3rem" }}>
                    ⚠ No member auto-matched for "{casHolderNames[0] || "this CAS"}". Please select one above.
                  </div>
                )}
              </div>
            );
          })()}

          {casHoldings.length > 0 && (
            <div style={{ overflowX: "auto", maxHeight: 320, overflowY: "auto", borderRadius: 8, border: "1px solid var(--border)", marginBottom: ".9rem" }}>
              <table className="ht" style={{ fontSize: ".72rem" }}>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Type</th>
                    <th>ISIN</th>
                    <th>Account</th>
                    <th className="r">Units</th>
                    <th className="r">Curr Value</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {casHoldings.map((h, i) => (
                    <tr key={i}>
                      <td style={{ fontWeight: 500 }}>{h.name}</td>
                      <td>
                        <span style={{ fontSize: ".65rem", padding: ".1rem .35rem", borderRadius: 3,
                          background: h.type === "MF" ? "rgba(160,132,202,.15)" : "rgba(224,124,90,.12)",
                          color: h.type === "MF" ? "#a084ca" : "#e07c5a" }}>
                          {h.type === "MF" ? "MF" : h.type === "IN_STOCK" ? "Stock" : h.type}
                        </span>
                      </td>
                      <td className="mono dim" style={{ fontSize: ".68rem" }}>{h.isin || h.ticker || h.scheme_code || "-"}</td>
                      <td className="mono dim" style={{ fontSize: ".64rem" }}>{h.account_id || "-"}</td>
                      <td className="r mono">{h.units != null ? Number(h.units).toLocaleString("en-IN", { maximumFractionDigits: 4 }) : "-"}</td>
                      <td className="r mono">{h.current_value ? fmtInr(h.current_value) : (h.purchase_value ? fmtInr(h.purchase_value) : "-")}</td>
                      <td>{(() => {
                        const pr = rowStatusFor(h);
                        if (!pr) return <span style={{ fontSize: ".62rem", opacity: .5 }}>…</span>;
                        const st = STATUS_STYLE[pr.status] || STATUS_STYLE.unchanged;
                        const skip = casDupAction[`${pr.member_id}|${pr.isin}`] === "skip";
                        return (
                          <span style={{ display: "inline-flex", gap: ".3rem", alignItems: "center" }}>
                            <span style={{ fontSize: ".62rem", padding: ".08rem .35rem", borderRadius: 3, background: skip ? "rgba(128,128,128,.12)" : st.bg, color: skip ? "var(--text)" : st.fg, textDecoration: skip ? "line-through" : "none" }}>{skip ? "Skip" : st.label}</span>
                            {!skip && pr.status === "changed" && pr.delta && (
                              <span className="mono" style={{ fontSize: ".6rem", color: pr.delta.units >= 0 ? "#4caf9a" : "#e07c5a" }}>
                                {pr.delta.units > 0 ? "+" : ""}{Number(pr.delta.units).toLocaleString("en-IN", { maximumFractionDigits: 3 })}u
                              </span>
                            )}
                          </span>
                        );
                      })()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {casHoldings.length === 0 && (
            <div style={{ textAlign: "center", padding: "1.5rem", color: "var(--text)", fontSize: ".8rem", marginBottom: ".9rem" }}>
              No holdings could be parsed from this statement.
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: ".6rem" }}>
            <button className="btnc" onClick={() => { resetCASDownloader(); onClose(); }}>Cancel</button>
            <div style={{ display: "flex", alignItems: "center", gap: ".6rem" }}>
              {casPreview?.summary?.older > 0 && <span style={{ fontSize: ".64rem", color: "#e07c5a" }}>Older rows won't overwrite newer data</span>}
              <button className="btns"
                disabled={casHoldings.length === 0 || needsMemberPick || casPreviewing}
                title={needsMemberPick ? "Select a family member above before importing" : undefined}
                onClick={() => executeCASImport(members, onPriceRefresh)}>
                Import {importCount} Holding{importCount !== 1 ? "s" : ""}
              </button>
            </div>
          </div>
        </>
      )}

      {/* Importing spinner */}
      {!isUploading && isImporting && (
        <div style={{ textAlign: "center", padding: "2.5rem 1rem" }}>
          <div style={{ width: 38, height: 38, margin: "0 auto 1rem", border: "3px solid rgba(201,168,76,.2)", borderTopColor: "#c9a84c", borderRadius: "50%", animation: "spin 1s linear infinite" }} />
          <div style={{ fontSize: ".85rem", color: "var(--text)" }}>Importing {casHoldings.length} holdings...</div>
        </div>
      )}

      {/* Done step */}
      {!isUploading && isDone && casResult && (
        <div style={{ padding: ".5rem 0" }}>
          <div style={{ background: "rgba(76,175,154,.08)", border: "1px solid rgba(76,175,154,.2)", borderRadius: 10, padding: "1rem 1.2rem", marginBottom: ".8rem" }}>
            <div style={{ fontSize: "1.1rem", fontWeight: 600, color: "#4caf9a", marginBottom: ".3rem" }}>
              {(casResult.inserted_count || 0) + (casResult.updated_count || 0)} holdings imported
            </div>
            {casResult.inserted_count > 0 && <div style={{ fontSize: ".75rem", color: "var(--text)" }}>+ {casResult.inserted_count} new</div>}
            {casResult.updated_count > 0 && <div style={{ fontSize: ".75rem", color: "#5a9ce0" }}>refreshed {casResult.updated_count}</div>}
            {casResult.exited_count > 0 && <div style={{ fontSize: ".75rem", color: "#e07c5a" }}>{casResult.exited_count} marked exited</div>}
            {casResult.inferred_count > 0 && (
              <div style={{ fontSize: ".75rem", color: "#c9a84c" }}>
                {casResult.inferred_count} purchase{casResult.inferred_count > 1 ? "s" : ""} inferred from unit changes since your last detailed statement
                {casResult.inferred?.length > 0 && <span style={{ opacity: .8 }}> ({casResult.inferred.slice(0, 3).map(i => `${i.name.split(" ").slice(0, 3).join(" ")} ${i.units}u on ${i.txn_date}`).join("; ")}{casResult.inferred.length > 3 ? "…" : ""})</span>}
              </div>
            )}
            {casResult.manual_superseded > 0 && <div style={{ fontSize: ".72rem", color: "var(--text)", opacity: .8 }}>{casResult.manual_superseded} hand-entered transaction{casResult.manual_superseded > 1 ? "s" : ""} replaced by statement rows (originals kept, greyed out)</div>}
            {casResult.inferred_replaced > 0 && <div style={{ fontSize: ".72rem", color: "var(--text)", opacity: .8 }}>{casResult.inferred_replaced} inferred row{casResult.inferred_replaced > 1 ? "s" : ""} replaced by exact statement rows</div>}
            {(casResult.txns_inserted > 0 || casResult.txns_existing > 0) && (
              <div style={{ fontSize: ".75rem", color: "#a084ca" }}>
                ledger: {casResult.txns_inserted} new transaction{casResult.txns_inserted !== 1 ? "s" : ""}{casResult.txns_existing > 0 ? `, ${casResult.txns_existing} already recorded` : ""} — XIRR and tax lots are now available per holding
              </div>
            )}
            {casResult.skipped_older > 0 && <div style={{ fontSize: ".75rem", color: "#e07c5a" }}>{casResult.skipped_older} skipped (newer data already stored)</div>}
            {casResult.legacy_retired > 0 && <div style={{ fontSize: ".72rem", color: "var(--text)", opacity: .8 }}>{casResult.legacy_retired} pre-upgrade row{casResult.legacy_retired > 1 ? "s" : ""} replaced</div>}
            {casResult.depository && <div style={{ fontSize: ".68rem", color: "var(--text)", opacity: .7, marginTop: ".3rem" }}>{casResult.depository} · other statements for this member were left untouched</div>}
            {casResult.error_count > 0 && <div style={{ fontSize: ".75rem", color: "#e07c5a", marginTop: ".3rem" }}>{casResult.error_count} error{casResult.error_count > 1 ? "s" : ""}</div>}
          </div>
          {casResult.errors?.length > 0 && (
            <div style={{ background: "rgba(224,124,90,.08)", borderRadius: 8, padding: ".6rem .8rem", marginBottom: ".7rem" }}>
              {casResult.errors.map((e, i) => <div key={i} style={{ fontSize: ".7rem", color: "#e07c5a" }}>• {e}</div>)}
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: ".5rem" }}>
            <button className="btns" onClick={() => { resetCASDownloader(); onClose(); }}>Done</button>
          </div>
        </div>
      )}
    </Overlay>
  );
}
