// AlertFormModal.jsx — the "Add Alert" modal, extracted out of App.jsx (P3-5, step 3).
//
// Pure lift-and-shift, same convention as GoalFormModal.jsx / HoldingFormModal.jsx:
// state ownership (alertForm, modal) stays in App.jsx and is passed in as props.

import { BA } from '../../constants.js';

export default function AlertFormModal({
  modal, setModal,
  alertForm, setAlertForm,
  AT,
  addAlert,
  Overlay, FG, MA,
}) {
  if (modal !== 'alert') return null;

  const close = () => { setModal(null); setAlertForm(BA); };

  return (
    <Overlay onClose={close} narrow>
      <div className="modtitle">New Alert</div>
      <FG label="Alert Type">
        <select className="fi fs" value={alertForm.type} onChange={e => setAlertForm(p => ({ ...p, type: e.target.value }))}>
          <option value="ALLOCATION_DRIFT">Allocation over threshold</option>
          <option value="CONCENTRATION">Allocation under threshold</option>
          <option value="RETURN_TARGET">Return below target %</option>
          <option value="USD_INR_RATE">USD/INR rate above ₹</option>
        </select>
      </FG>
      {alertForm.type !== 'RETURN_TARGET' && alertForm.type !== 'USD_INR_RATE' && (
        <FG label="Asset Type">
          <select className="fi fs" value={alertForm.assetType} onChange={e => setAlertForm(p => ({ ...p, assetType: e.target.value }))}>
            {Object.entries(AT).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
          </select>
        </FG>
      )}
      <FG label={alertForm.type === 'USD_INR_RATE' ? 'Rate threshold (₹ per USD)' : 'Threshold %'}>
        <input type="number" className="fi"
          placeholder={alertForm.type === 'USD_INR_RATE' ? 'e.g. 90' : 'e.g. 60'}
          value={alertForm.threshold}
          onChange={e => setAlertForm(p => ({ ...p, threshold: e.target.value }))}/>
      </FG>
      <FG label="Label">
        <input className="fi" placeholder="Alert description" value={alertForm.label}
          onChange={e => setAlertForm(p => ({ ...p, label: e.target.value }))}/>
      </FG>
      <MA>
        <button className="btnc" onClick={close}>Cancel</button>
        <button className="btns" onClick={() => { addAlert(alertForm); close(); }}>Save Alert</button>
      </MA>
    </Overlay>
  );
}
