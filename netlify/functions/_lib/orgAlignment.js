// Shared engine for the Org Alignment tool (migration 0308). Applying an
// alignment creates its new nodes (regions -> areas -> districts, resolving
// parent refs) then reparents the moved nodes, snapshotting each prior parent
// so it can be rolled back. Used by both the admin "Apply now" endpoint and the
// scheduled auto-applier, so the two can't drift.

// New-node kind -> table + parent FK (regions have no parent).
const NODE_TABLE = { region: "regions", area: "areas", district: "districts" };
const NODE_PARENT_FK = { area: "region_id", district: "area_id" };
// Move kind -> table + the parent FK that gets reassigned.
const MOVE_TABLE = { store: "stores", district: "districts", area: "areas" };
const MOVE_PARENT_FK = { store: "district_id", district: "area_id", area: "region_id" };

// Alignments whose effective date has arrived and are still scheduled.
export async function dueAlignments(supa, todayIso) {
  const { data } = await supa.from("org_alignments")
    .select("id, name, effective_date")
    .eq("status", "scheduled").lte("effective_date", todayIso)
    .order("effective_date", { ascending: true });
  return data || [];
}

// Apply an alignment: create its nodes, then its moves. Idempotent-ish — a node
// already created (created_real_id set) or a move already snapshotted is not
// redone, so a retry after a partial failure resumes cleanly.
export async function applyAlignment(supa, alignmentId, actorId) {
  const { data: al } = await supa.from("org_alignments").select("id, status").eq("id", alignmentId).maybeSingle();
  if (!al) return { error: "Alignment not found.", status: 404 };
  if (al.status === "applied") return { error: "This alignment is already applied.", status: 409 };
  if (al.status === "canceled") return { error: "This alignment was canceled.", status: 409 };

  const { data: nodes } = await supa.from("org_alignment_nodes").select("*").eq("alignment_id", alignmentId);
  const { data: moves } = await supa.from("org_alignment_moves").select("*").eq("alignment_id", alignmentId);
  const { data: leaderMoves } = await supa.from("org_alignment_leader_moves").select("*").eq("alignment_id", alignmentId);
  const { data: leaderAdds } = await supa.from("org_alignment_leader_adds").select("*").eq("alignment_id", alignmentId);

  const refMap = {}; // node ref -> real id
  for (const n of nodes || []) if (n.created_real_id) refMap[n.ref] = n.created_real_id;

  // 1. Create new nodes, parents before children.
  for (const kind of ["region", "area", "district"]) {
    for (const n of (nodes || []).filter((x) => x.kind === kind && !x.created_real_id)) {
      const row = { name: n.name, code: n.code };
      if (kind !== "region") {
        const parentId = n.parent_id || refMap[n.parent_ref];
        if (!parentId) return { error: `New ${kind} "${n.name}" has no resolvable parent.`, status: 400 };
        row[NODE_PARENT_FK[kind]] = parentId;
        row.is_active = true;
      }
      const { data: created, error } = await supa.from(NODE_TABLE[kind]).insert(row).select("id").single();
      if (error) return { error: `Couldn't create ${kind} "${n.name}": ${error.message}`, status: 500 };
      refMap[n.ref] = created.id;
      await supa.from("org_alignment_nodes").update({ created_real_id: created.id }).eq("id", n.id);
    }
  }

  // 2. Reparent moved nodes, snapshotting the prior parent for rollback.
  for (const m of moves || []) {
    const table = MOVE_TABLE[m.kind];
    const fk = MOVE_PARENT_FK[m.kind];
    const newParent = m.new_parent_id || refMap[m.new_parent_ref];
    if (!newParent) return { error: `A ${m.kind} move has no resolvable new parent.`, status: 400 };
    if (!m.prior_parent_id) {
      const { data: cur } = await supa.from(table).select(fk).eq("id", m.node_id).maybeSingle();
      await supa.from("org_alignment_moves").update({ prior_parent_id: cur ? cur[fk] : null }).eq("id", m.id);
    }
    const { error } = await supa.from(table).update({ [fk]: newParent }).eq("id", m.node_id);
    if (error) return { error: `Couldn't move ${m.kind}: ${error.message}`, status: 500 };
  }

  // 3. Reassign leaders (DO/SDO), snapshotting the prior scope for rollback.
  for (const lm of leaderMoves || []) {
    if (lm.applied) continue;
    const target = lm.to_scope_id || refMap[lm.to_scope_ref];
    if (!target) return { error: `A leader reassignment has no resolvable destination scope.`, status: 400 };
    if (lm.from_scope_id) {
      const { error } = await supa.from("user_scopes")
        .update({ scope_id: target })
        .eq("user_id", lm.user_id).eq("scope_type", lm.scope_type).eq("scope_id", lm.from_scope_id);
      if (error) return { error: `Couldn't reassign leader: ${error.message}`, status: 500 };
    } else {
      const { error } = await supa.from("user_scopes")
        .insert({ user_id: lm.user_id, scope_type: lm.scope_type, scope_id: target });
      if (error && !/duplicate|unique/i.test(error.message)) return { error: `Couldn't assign leader: ${error.message}`, status: 500 };
    }
    await supa.from("org_alignment_leader_moves").update({ prior_scope_id: lm.from_scope_id, applied: true }).eq("id", lm.id);
  }

  // 4. Add new leaders: invite by email, set role, assign scope.
  const inviteRedirect = (process.env.URL || process.env.DEPLOY_URL || "").replace(/\/$/, "") + "/accept-invite";
  for (const la of leaderAdds || []) {
    if (la.applied) continue;
    const target = la.to_scope_id || refMap[la.to_scope_ref];
    if (!target) return { error: `A new leader has no resolvable destination scope.`, status: 400 };
    const email = String(la.email || "").trim().toLowerCase();
    if (!email) return { error: `A new leader is missing an email.`, status: 400 };
    const { data: invite, error: invErr } = await supa.auth.admin.inviteUserByEmail(email, {
      data: la.full_name ? { full_name: la.full_name } : undefined,
      redirectTo: inviteRedirect || undefined,
    });
    if (invErr) return { error: `Couldn't invite ${email}: ${invErr.message}`, status: 500 };
    const uid = invite?.user?.id;
    if (!uid) return { error: `Invite for ${email} returned no user id.`, status: 500 };
    const { error: profErr } = await supa.from("profiles")
      .update({ full_name: la.full_name || null, role: la.role, is_active: true }).eq("id", uid);
    if (profErr) { await supa.auth.admin.deleteUser(uid).catch(() => {}); return { error: `Profile setup failed for ${email}: ${profErr.message}`, status: 500 }; }
    const { error: scopeErr } = await supa.from("user_scopes").insert({ user_id: uid, scope_type: la.scope_type, scope_id: target });
    if (scopeErr) { await supa.auth.admin.deleteUser(uid).catch(() => {}); return { error: `Scope assignment failed for ${email}: ${scopeErr.message}`, status: 500 }; }
    await supa.from("org_alignment_leader_adds").update({ created_user_id: uid, applied: true }).eq("id", la.id);
  }

  await supa.from("org_alignments").update({
    status: "applied", applied_at: new Date().toISOString(), applied_by: actorId, updated_at: new Date().toISOString(),
  }).eq("id", alignmentId);
  return { ok: true, created: (nodes || []).length, moved: (moves || []).length, leaders: (leaderMoves || []).length, invited: (leaderAdds || []).length };
}

// Undo an applied alignment: revert every move to its prior parent, then delete
// the nodes it created (children first). A new node still in use blocks its own
// delete; those are reported and the alignment stays applied for the rest.
export async function rollbackAlignment(supa, alignmentId, actorId) {
  const { data: al } = await supa.from("org_alignments").select("id, status").eq("id", alignmentId).maybeSingle();
  if (!al) return { error: "Alignment not found.", status: 404 };
  if (al.status !== "applied") return { error: "Only an applied alignment can be rolled back.", status: 409 };

  const { data: nodes } = await supa.from("org_alignment_nodes").select("*").eq("alignment_id", alignmentId);
  const { data: moves } = await supa.from("org_alignment_moves").select("*").eq("alignment_id", alignmentId);
  const { data: leaderMoves } = await supa.from("org_alignment_leader_moves").select("*").eq("alignment_id", alignmentId);
  const { data: leaderAdds } = await supa.from("org_alignment_leader_adds").select("*").eq("alignment_id", alignmentId);

  const refMap = {}; // node ref -> real id (for leader moves that targeted new nodes)
  for (const n of nodes || []) if (n.created_real_id) refMap[n.ref] = n.created_real_id;

  // 0. Remove invited new leaders: deleting the auth user cascades their
  //    profile + user_scopes, so this must run before their scope node is gone.
  for (const la of leaderAdds || []) {
    if (!la.applied || !la.created_user_id) continue;
    await supa.auth.admin.deleteUser(la.created_user_id).catch(() => {});
    await supa.from("org_alignment_leader_adds").update({ created_user_id: null, applied: false }).eq("id", la.id);
  }

  // 1. Revert leader reassignments first (before their destination nodes are
  //    deleted): put each person's scope back, or drop a new assignment.
  for (const lm of leaderMoves || []) {
    if (!lm.applied) continue;
    const target = lm.to_scope_id || refMap[lm.to_scope_ref];
    if (lm.from_scope_id) {
      const { error } = await supa.from("user_scopes").update({ scope_id: lm.from_scope_id })
        .eq("user_id", lm.user_id).eq("scope_type", lm.scope_type).eq("scope_id", target);
      if (error) return { error: `Couldn't revert a leader reassignment: ${error.message}`, status: 500 };
    } else if (target) {
      await supa.from("user_scopes").delete()
        .eq("user_id", lm.user_id).eq("scope_type", lm.scope_type).eq("scope_id", target);
    }
    await supa.from("org_alignment_leader_moves").update({ prior_scope_id: null, applied: false }).eq("id", lm.id);
  }

  // 2. Revert node moves.
  for (const m of moves || []) {
    if (!m.prior_parent_id) continue;
    const { error } = await supa.from(MOVE_TABLE[m.kind]).update({ [MOVE_PARENT_FK[m.kind]]: m.prior_parent_id }).eq("id", m.node_id);
    if (error) return { error: `Couldn't revert a ${m.kind} move: ${error.message}`, status: 500 };
  }

  // 3. Delete created nodes, children first (district -> area -> region).
  const blocked = [];
  for (const kind of ["district", "area", "region"]) {
    for (const n of (nodes || []).filter((x) => x.kind === kind && x.created_real_id)) {
      const { error } = await supa.from(NODE_TABLE[kind]).delete().eq("id", n.created_real_id);
      if (error) blocked.push(`${kind} "${n.name}"`);
      else await supa.from("org_alignment_nodes").update({ created_real_id: null }).eq("id", n.id);
    }
  }
  if (blocked.length) {
    return { error: `Reverted the moves, but these new nodes are still in use and weren't deleted: ${blocked.join(", ")}. Move their children out first, then roll back again.`, status: 409 };
  }

  // 4. Clear snapshots + return to draft (won't auto-apply until re-scheduled).
  for (const m of moves || []) await supa.from("org_alignment_moves").update({ prior_parent_id: null }).eq("id", m.id);
  await supa.from("org_alignments").update({
    status: "draft", applied_at: null, applied_by: null, updated_at: new Date().toISOString(),
  }).eq("id", alignmentId);
  void actorId;
  return { ok: true };
}
