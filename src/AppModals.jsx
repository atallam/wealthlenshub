import { AuditLogPanel, TradebookImportModal, ImportHub, CASImportModal, ImportModal, GoalPlanModal, TransactionPanel, ArtifactPanel } from './appTabs.jsx';
import { AT, BT } from './constants.js';
import AlertFormModal from './features/strategy/AlertFormModal.jsx';
import FDScanSheet from './components/shared/FDScanSheet.jsx';
import { FG, MA, Overlay } from './components/shared/Overlay.jsx';
import FmtInput from './components/shared/FmtInput.jsx';
import GoalFormModal from './features/goals/GoalFormModal.jsx';
import HoldingFormModal from './features/holdings/HoldingFormModal.jsx';
import HoldingsPicker from './components/shared/HoldingsPicker.jsx';
import MemberFormModal from './features/members/MemberFormModal.jsx';
import SettingsModal from './components/modals/SettingsModal.jsx';
import SetuAAImport from './SetuAAImport.jsx';
import SnapTradeImport from './SnapTradeImport.jsx';
import { api } from './lib/api.js';
import { fmt, getValINR, setEpfRate, setPpfRate } from './utils.js';
import { signOut, supabase } from './supabase.js';

// Every modal / panel App can open (holding, goal, alert, member, settings, imports, plan, transactions, artifacts).
// Extracted from App.jsx; App owns the state and passes it in as props.
export default function AppModals({ toast, theme, setTheme, user, setSelMember, form, setForm, editHolding, setEditHolding, newMember, setNewMember, editingMemberId, setEditingMemberId, goalForm, setGoalForm, editGoalId, setEditGoalId, alertForm, setAlertForm, txnHolding, setTxnHolding, txnForm, setTxnForm, artifactHolding, setArtifactHolding, importFileRef, txnSaving, portfolio, importHook, casImport, mfSearch, setMfSearch, mfResults, setMfResults, mfSearching, setMfNav, stockSearch, setStockSearch, stockResults, setStockResults, stockSearching, setStockInfo, etfSearch, setEtfSearch, etfResults, setEtfResults, etfSearching, setEtfInfo, usSearch, setUsSearch, usResults, setUsResults, usSearching, usdInrRate, usdInrLoading, handleMfSearch, handleStockSearch, handleEtfSearch, handleUsSearch, fetchUsdInr, modal, setModal, fdScanOpen, setFdScanOpen, showSettings, setShowSettings, showImportHub, setShowImportHub, showSnapTrade, setShowSnapTrade, showSetuAA, setShowSetuAA, confirmSignOut, setConfirmSignOut, showTradebook, setShowTradebook, showAuditLog, setShowAuditLog, pushSupported, pushSubscribed, pushLoading, togglePush, setHoldings, members, goals, allHoldings, valINRCache, allCur, allInv, handleImportSelect }) {
  return (
    <>
      {/* ── Add / Edit Holding (+ FD Certificate Scanner) ───────────
          Extracted to features/holdings/HoldingFormModal.jsx (P3-5, step 3).
          State (form, editHolding, broker-search state, fdScanOpen, modal) all
          stays here and is passed in as props — markup-only extraction. */}
      <HoldingFormModal
        modal={modal} setModal={setModal}
        form={form} setForm={setForm} editHolding={editHolding} setEditHolding={setEditHolding}
        members={members} AT={AT}
        mfSearch={mfSearch} setMfSearch={setMfSearch} mfResults={mfResults} setMfResults={setMfResults}
        mfSearching={mfSearching} setMfNav={setMfNav} handleMfSearch={handleMfSearch}
        stockSearch={stockSearch} setStockSearch={setStockSearch} stockResults={stockResults} setStockResults={setStockResults}
        stockSearching={stockSearching} setStockInfo={setStockInfo} handleStockSearch={handleStockSearch}
        etfSearch={etfSearch} setEtfSearch={setEtfSearch} etfResults={etfResults} setEtfResults={setEtfResults}
        etfSearching={etfSearching} setEtfInfo={setEtfInfo} handleEtfSearch={handleEtfSearch}
        usSearch={usSearch} setUsSearch={setUsSearch} usResults={usResults} setUsResults={setUsResults}
        usSearching={usSearching} handleUsSearch={handleUsSearch}
        usdInrRate={usdInrRate} usdInrLoading={usdInrLoading} fetchUsdInr={fetchUsdInr}
        fdScanOpen={fdScanOpen} setFdScanOpen={setFdScanOpen}
        saveHolding={portfolio.saveHolding} api={api}
        Overlay={Overlay} FG={FG} MA={MA} FmtInput={FmtInput} FDScanSheet={FDScanSheet}
      />

      {/* ── Add / Edit Goal ─────────────────────────────────────── */}
      {/* Markup extracted to features/goals/GoalFormModal.jsx (P3-5); form state
          (goalForm, editGoalId) now lives in useGoalForm() (P3-5). `modal` visibility
          stays in useUiState(), shared across all modals. */}
      <GoalFormModal
        modal={modal} setModal={setModal}
        goalForm={goalForm} setGoalForm={setGoalForm}
        editGoalId={editGoalId} setEditGoalId={setEditGoalId}
        members={members} AT={AT} allHoldings={allHoldings} valINRCache={valINRCache} goals={goals}
        addGoal={portfolio.addGoal}
        Overlay={Overlay} FG={FG} MA={MA} FmtInput={FmtInput} HoldingsPicker={HoldingsPicker}
      />

      {/* ── Add Alert ────────────────────────────────────────────
          Extracted to features/strategy/AlertFormModal.jsx (P3-5, step 3). */}
      <AlertFormModal
        modal={modal} setModal={setModal}
        alertForm={alertForm} setAlertForm={setAlertForm}
        AT={AT}
        addAlert={portfolio.addAlert}
        Overlay={Overlay} FG={FG} MA={MA}
      />

      {/* ── Add / Edit Member ────────────────────────────────────
          Extracted to features/members/MemberFormModal.jsx (P3-5, step 3). */}
      <MemberFormModal
        modal={modal} setModal={setModal}
        newMember={newMember} setNewMember={setNewMember}
        editingMemberId={editingMemberId} setEditingMemberId={setEditingMemberId}
        members={members}
        saveMember={portfolio.saveMember}
        Overlay={Overlay} FG={FG} MA={MA}
      />

      {/* ── Audit Log ───────────────────────────────────────────── */}
      {showAuditLog && (
        <AuditLogPanel onClose={() => setShowAuditLog(false)} api={api} />
      )}

      {/* ── Settings ─────────────────────────────────────────────
          Extracted to components/modals/SettingsModal.jsx (P3-5, step 3). */}
      <SettingsModal
        showSettings={showSettings} setShowSettings={setShowSettings}
        user={user} signOut={signOut}
        setShowImportHub={setShowImportHub} setShowAuditLog={setShowAuditLog}
        theme={theme} setTheme={setTheme}
        portfolio={portfolio} api={api} setPpfRate={setPpfRate} setEpfRate={setEpfRate}
        pushSupported={pushSupported} pushSubscribed={pushSubscribed} pushLoading={pushLoading} togglePush={togglePush}
        confirmSignOut={confirmSignOut} setConfirmSignOut={setConfirmSignOut}
        toast={toast}
        Overlay={Overlay}
      />

      {/* ── Broker tradebook import ──────────────────────────────── */}
      {showTradebook && (
        <TradebookImportModal
          members={members}
          api={api}
          onClose={() => setShowTradebook(false)}
          onDone={async () => { const hlds = await api('/api/holdings'); setHoldings(hlds || []); }}
        />
      )}

      {/* ── Import Hub ───────────────────────────────────────────── */}
      {showImportHub && (
        <ImportHub onClose={() => setShowImportHub(false)} onSelect={handleImportSelect} api={api} />
      )}

      {/* ── CAS Import modal ─────────────────────────────────────── */}
      {casImport.casModal && (
        <CASImportModal
          casImport={casImport}
          members={members}
          onClose={() => { casImport.resetCASDownloader(); }}
          onPriceRefresh={() => portfolio.refreshPrices?.()}
        />
      )}

      {/* ── Setu Account Aggregator Import ─────────────────────── */}
      {showSetuAA && (
        <Overlay onClose={() => { portfolio.reloadHoldings(); setShowSetuAA(false); }} wide>
          <SetuAAImport
            mode="wealth"
            members={members}
            api={async (url, opts = {}) => {
              const { data: { session } } = await supabase.auth.getSession();
              const token = session?.access_token;
              const r = await fetch(url, { ...opts, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(opts.headers || {}) } });
              const d = await r.json();
              if (!r.ok) throw new Error(d.error || 'Request failed');
              return d;
            }}
            onClose={() => { portfolio.reloadHoldings(); setShowSetuAA(false); }}
            onImported={() => { portfolio.reloadHoldings(); setShowSetuAA(false); }}
          />
        </Overlay>
      )}

      {/* ── SnapTrade Import ─────────────────────────────────────── */}
      {showSnapTrade && (
        <Overlay onClose={() => { portfolio.reloadHoldings(); setSelMember('all'); setShowSnapTrade(false); }} wide>
          <SnapTradeImport
            onClose={() => { portfolio.reloadHoldings(); setSelMember('all'); setShowSnapTrade(false); }}
            members={members}
          />
        </Overlay>
      )}

      {/* ── Import modal ─────────────────────────────────────────── */}
      {(modal === 'import') && (
        <ImportModal
          importState={importHook.importState}
          setImportState={importHook.setImportState}
          members={members}
          AT={AT}
          handleImportFile={file => importHook.handleImportFile(file, null, members)}
          executeImport={() => importHook.executeImport(members)}
          resetImport={importHook.resetImport}
          importFileRef={importFileRef}
          onClose={() => { importHook.resetImport(); setModal(null); }}
          fmt={fmt}
          submitCASPassword={() => importHook.submitCASPassword(members)}
        />
      )}

      {/* ── Goal Plan modal ─────────────────────────────────────── */}
      {modal === 'goalplan' && (
        <GoalPlanModal
          open
          onClose={() => setModal(null)}
          goals={goals}
          members={members}
          holdings={allHoldings}
          allCur={allCur}
          allInv={allInv}
          AT={AT}
          getValINR={getValINR}
          usdInr={usdInrRate}
        />
      )}

      {/* ── Transaction panel ────────────────────────────────────── */}
      {txnHolding && (
        <TransactionPanel
          holding={txnHolding}
          txnForm={txnForm}
          setTxnForm={setTxnForm}
          onAddTxn={() => portfolio.addTransaction(txnForm, null, null, txnHolding, txnSaving)
            .then(res => { if (res?.hlds) setTxnForm(BT); })}
          onDeleteTxn={(txnId, holdingId) => portfolio.deleteTransaction(txnId, holdingId)}
          onReload={portfolio.reloadHoldings}
          onClose={() => setTxnHolding(null)}
          fxRate={usdInrRate}
          fxLoading={usdInrLoading}
          onFetchFx={fetchUsdInr}
        />
      )}

      {/* ── Artifact panel ───────────────────────────────────────── */}
      {artifactHolding && (
        <ArtifactPanel
          holding={artifactHolding}
          token={null}
          onClose={() => setArtifactHolding(null)}
        />
      )}

      {/* old inline CAS + broker overlays removed — now handled by CASImportModal and Import Hub above */}

      {/* ── Hidden file input for import ─────────────────────────── */}
      <input ref={importFileRef} type="file" style={{display:'none'}} accept=".csv,.xlsx,.xls,.pdf"
        onChange={e => importHook.handleImportFile(e.target.files[0], null, members)}/>
    </>
  );
}
