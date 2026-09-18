import { useState } from "react";

/**
 * useMemberForm — Members tab "Add/Edit Family Member" form state, plus the
 * `memberAction` flag MembersTab uses for its own row-level actions.
 * Extracted from App.jsx (P3-5). The modal markup and the openMemberModal()
 * helper that populates this state both stay in App.jsx for now — this hook
 * only owns the three underlying useStates.
 */
export function useMemberForm() {
  const [newMember, setNewMember] = useState({
    name: '', relation: '', dob: '', email: '', nominee_name: '', nominee_relation: '',
  });
  const [editingMemberId, setEditingMemberId] = useState(null);
  const [memberAction, setMemberAction] = useState(null);

  return {
    newMember, setNewMember,
    editingMemberId, setEditingMemberId,
    memberAction, setMemberAction,
  };
}
