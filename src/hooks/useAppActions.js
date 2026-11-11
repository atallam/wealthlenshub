
// Holding/member form openers and the Import Hub dispatcher, extracted from App.jsx.
// Every dependency is passed in, so behaviour is identical to the inline versions.
export function useAppActions({ setForm, setEditHolding, setNewMember, setEditingMemberId, casImport, setModal, setShowSnapTrade, setShowSetuAA, setShowTradebook, members }) {
function openMemberModal(memberId) {
    if (memberId) {
      const m = members.find(x => x.id === memberId);
      setNewMember({
        name: m?.name || '', relation: m?.relation || '',
        pan: '', pan_masked: m?.pan_masked || '',
        dob: m?.dob || '', email: m?.email || '',
        nominee_name: m?.nominee_name || '', nominee_relation: m?.nominee_relation || '',
      });
      setEditingMemberId(memberId);
    } else {
      setNewMember({ name: '', relation: '', dob: '', email: '', nominee_name: '', nominee_relation: '' });
      setEditingMemberId(null);
    }
    setModal('member');
  }

  function editH(h) {
    setForm({
      member_id:      h.member_id      || '',
      type:           h.type           || 'US_STOCK',
      name:           h.name           || '',
      ticker:         h.ticker         || '',
      scheme_code:    h.scheme_code    || '',
      interest_rate:  h.interest_rate  || '',
      start_date:     h.start_date     || '',
      maturity_date:  h.maturity_date  || '',
      maturity_amount: h.maturity_amount || '',
      purchase_value: h.purchase_value || '',
      current_value:  h.current_value  || '',
      principal:          h.principal          || '',
      usd_inr_rate:       h.usd_inr_rate       || '',
      currency:           h.currency           || 'INR',
      policy_type:        h.policy_type        || 'TERM',
      sum_assured:        h.sum_assured        || '',
      premium:            h.premium            || '',
      premium_frequency:  h.premium_frequency  || 'ANNUAL',
    });
    setEditHolding(h);
    setModal('add');
  }

  // Renew a matured FD: same row, next term. Proceeds become the new principal,
  // the old maturity date becomes the new start date; user fills rate + new maturity.
  function renewFD(h, maturityValue) {
    editH(h);
    setForm(p => ({
      ...p,
      principal:       String(Math.round(maturityValue || h.principal || 0)),
      start_date:      h.maturity_date || p.start_date,
      maturity_date:   '',
      maturity_amount: '',
      maturity_status: 'active',
    }));
  }

  // ── Broker search handlers ────────────────────────────────────
  // Broker-search handlers now provided by useBrokerSearch().

  // Map an ImportHub selection to the matching flow.
  function handleImportSelect(key) {
    switch (key) {
      case 'cas':       casImport.setCasModal(true); break;
      case 'tradebook': setShowTradebook(true); break;
      case 'fd':        setForm(p => ({ ...p, type: 'FD' })); setModal('add'); break;
      case 'snaptrade': setShowSnapTrade(true); break;
      case 'csv':       setModal('import'); break;
      case 'manual':    setModal('add'); break;
      case 'setu':      setShowSetuAA(true); break;
      default: break;
    }
  }

  return { openMemberModal, editH, renewFD, handleImportSelect };
}
