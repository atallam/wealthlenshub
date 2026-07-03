// CASImportModal.jsx - NSDL/CDSL CAS PDF import wizard
// Steps: intro -> uploading -> password -> matching -> importing -> done
// V2 step: password_v2 (casparser Smart Parser path)

import { useRef } from "react";
import { Overlay } from "../shared/Overlay.jsx";

export default function CASImportModal({
  casImport,
  members,
  onClose,
  onPriceRefresh,
}) {
  const fileRef   = useRef(null);
  const fileRefV2 = useRef(null);
  const {
    casStep, casHoldings, casHolderNames, casHolderPans,
    casHolderMap, setCasHolderMap, casWarnings, casFormat,
    casUploading, casResult, casPanInput, setCasPanInput,
    casSavePan, setCasSavePan,
    handleCASUpload, executeCASImport, retryCASWithPassword, resetCASDownloader,
    handleCASUploadV2, retryCASWithPasswordV2,
  } = casImport;

  function handleFile(file) {
    if (file) handleCASUpload(file, members);
  }

  const isDone        = casStep === "done";
  const isImporting   = casStep === "importing";
  const isMatching    = casStep === "matching";
  const isPassword    = casStep === "password";
  const isPasswordV2  = casStep === "password_v2";
  const isUploading   = casStep === "uploading" || casUploading;

  const title = isDone       ? "CAS Imported"
    : isImporting  ? "Importing..."
    : isPassword   ? "Unlock CAS PDF"
    : isPasswordV2 ? "Unlock CAS PDF (Smart Parser)"
    : isMatching   ? "Import CAS (NSDL/CDSL)"
    : "Import CAS (NSDL/CDSL)";

  const hasMultiHolder = casHolderNames.length > 1 && members.length > 1;

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

      {/* Password unlock step */}
      {!isUploading && isPassword && (
        <div style={{ maxWidth: 400, margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: "1.2rem" }}>
            <div style={{ fontSize: "2rem", marginBottom: ".5rem" }}>🔐</div>
            <div style={{ fontSize: ".85rem", color: "var(--text)", marginBottom: ".3rem" }}>This PDF is password-protected</div>
            <div style={{ fontSize: ".72rem", color: "var(--text)" }}>NSDL/CDSL CAS password is your PAN number (uppercase)</div>
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
              onKeyDown={e => e.key === "Enter" && casPanInput.length === 10 && retryCASWithPassword(members)} />
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: ".5rem", fontSize: ".73rem", color: "var(--text)", marginBottom: "1.2rem", cursor: "pointer" }}>
            <input type="checkbox" checked={casSavePan} onChange={e => setCasSavePan(e.target.checked)} style={{ accentColor: "#c9a84c" }} />
            Remember PAN for future imports (encrypted)
          </label>
          <div style={{ display: "flex", gap: ".7rem" }}>
            <button className="btnc" onClick={() => { resetCASDownloader(); onClose(); }}>Cancel</button>
            <button className="btns" disabled={casPanInput.length !== 10} onClick={() => retryCASWithPassword(members)}>
              Unlock &amp; Parse
            </button>
          </div>
        </div>
      )}

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
            <div style={{ fontSize: ".72rem", color: "var(--text)", marginTop: ".4rem" }}>NSDL or CDSL · Password = your PAN</div>
            <button className="btns" style={{ marginTop: "1rem", fontSize: ".75rem" }}>Browse File</button>
          </div>
          <input ref={fileRef} type="file" accept=".pdf" style={{ display: "none" }}
            onChange={e => { const f = e.target.files[0]; if (f) handleFile(f); e.target.value = ""; }} />

          {/* Smart Parser alternative */}
          <div style={{ border: "1px solid rgba(76,175,154,.25)", borderRadius: 10, padding: "1rem 1.2rem", background: "rgba(76,175,154,.04)", marginBottom: ".9rem", display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 180 }}>
              <div style={{ fontSize: ".78rem", fontWeight: 600, color: "var(--text)", marginBottom: ".2rem" }}>
                Try Smart Parser
                <span style={{ fontSize: ".6rem", padding: ".15rem .4rem", borderRadius: 3, background: "rgba(76,175,154,.15)", color: "#4caf9a", border: "1px solid rgba(76,175,154,.25)", fontWeight: 600, marginLeft: ".4rem", verticalAlign: "middle" }}>Beta</span>
              </div>
              <div style={{ fontSize: ".7rem", color: "var(--text)" }}>Uses casparser library · better equity values · supports CAMS &amp; NSDL</div>
            </div>
            <button
              className="btnc"
              style={{ fontSize: ".73rem", borderColor: "rgba(76,175,154,.4)", color: "#4caf9a", whiteSpace: "nowrap" }}
              onClick={() => fileRefV2.current?.click()}>
              📂 Choose PDF (Smart)
            </button>
          </div>
          <input ref={fileRefV2} type="file" accept=".pdf" style={{ display: "none" }}
            onChange={e => { const f = e.target.files[0]; if (f) { handleCASUploadV2(f, members); } e.target.value = ""; }} />

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
            <div style={{ fontSize: ".68rem", color: "#4caf9a", marginTop: ".3rem" }}>Using Smart Parser (casparser)</div>
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
            <span style={{ fontSize: ".72rem", color: "var(--text)" }}>
              {casHoldings.length} holding{casHoldings.length !== 1 ? "s" : ""} found
            </span>
          </div>

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
                    <th>Ticker / ISIN</th>
                    <th className="r">Units</th>
                    <th className="r">Curr Value</th>
                  </tr>
                </thead>
                <tbody>
                  {casHoldings.map((h, i) => (
                    <tr key={i}>
                      <td style={{ fontWeight: 500 }}>{h.name}</td>
                      <td>
                        <span style={{ fontSize: ".62rem", padding: ".1rem .35rem", borderRadius: 3,
                          background: h.type === "MF" ? "rgba(160,132,202,.15)" : "rgba(224,124,90,.12)",
                          color: h.type === "MF" ? "#a084ca" : "#e07c5a" }}>
                          {h.type === "MF" ? "MF" : h.type === "IN_STOCK" ? "Stock" : h.type}
                        </span>
                      </td>
                      <td className="mono dim" style={{ fontSize: ".68rem" }}>{h.ticker || h.scheme_code || "-"}</td>
                      <td className="r mono">{h.units != null ? Number(h.units).toLocaleString("en-IN", { maximumFractionDigits: 4 }) : "-"}</td>
                      <td className="r mono">{h.purchase_value ? `₹${Number(h.purchase_value).toLocaleString("en-IN", { maximumFractionDigits: 0 })}` : "-"}</td>
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

          {(() => {
            // Block import if multi-member and single-holder CAS has no member selected.
            const needsMemberPick = !hasMultiHolder && casHolderNames.length <= 1 && members.length > 1
              && !(casHolderMap[casHolderNames[0]] || casHolderMap["__default__"]);
            return (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: ".6rem" }}>
                <button className="btnc" onClick={() => { resetCASDownloader(); onClose(); }}>Cancel</button>
                <button className="btns"
                  disabled={casHoldings.length === 0 || needsMemberPick}
                  title={needsMemberPick ? "Select a family member above before importing" : undefined}
                  onClick={() => executeCASImport(members, onPriceRefresh)}>
                  Import {casHoldings.length} Holding{casHoldings.length !== 1 ? "s" : ""}
                </button>
              </div>
            );
          })()}
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
