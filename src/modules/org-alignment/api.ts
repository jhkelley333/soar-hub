// Org Alignment tool — client for netlify/functions/org-alignments. Stage a
// dated org restructure (new regions/areas/districts + reparent existing
// stores/districts/areas) that goes live on its effective date.
import { supabase } from "@/lib/supabase";

const FN = "/.netlify/functions/org-alignments";

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in");
  const res = await fetch(path, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string })?.error || `Request failed (${res.status})`);
  return body as T;
}

export type AlignmentStatus = "draft" | "scheduled" | "applied" | "canceled";
export type NodeKind = "region" | "area" | "district";
export type MoveKind = "store" | "district" | "area";

export interface AlignmentNode {
  id: string; alignment_id: string; ref: string; kind: NodeKind;
  name: string; code: string; parent_id: string | null; parent_ref: string | null; created_real_id: string | null;
}
export interface AlignmentMove {
  id: string; alignment_id: string; kind: MoveKind; node_id: string;
  new_parent_id: string | null; new_parent_ref: string | null; prior_parent_id: string | null;
}
export type LeaderScope = "area" | "district";
export interface AlignmentLeaderMove {
  id: string; alignment_id: string; user_id: string; scope_type: LeaderScope;
  from_scope_id: string | null; to_scope_id: string | null; to_scope_ref: string | null;
  prior_scope_id: string | null; applied: boolean;
}
export interface OrgAlignment {
  id: string; name: string; effective_date: string; status: AlignmentStatus; notes: string | null;
  created_at: string; applied_at: string | null;
  change_count?: { nodes: number; moves: number; leaders: number };
  nodes?: AlignmentNode[]; moves?: AlignmentMove[]; leader_moves?: AlignmentLeaderMove[];
}

export interface OrgTree {
  regions: { id: string; code: string; name: string }[];
  areas: { id: string; code: string; name: string; region_id: string }[];
  districts: { id: string; code: string; name: string; area_id: string }[];
  stores: { id: string; number: number; name: string; district_id: string }[];
}

export const fetchAlignments = () => req<{ ok: true; alignments: OrgAlignment[] }>(`${FN}?action=list`);
export const fetchAlignment = (id: string) => req<{ ok: true; alignment: OrgAlignment }>(`${FN}?action=get&id=${encodeURIComponent(id)}`);
export const fetchOrgTree = () => req<{ ok: true } & OrgTree>(`${FN}?action=org-tree`);

export const createAlignment = (b: { name: string; effective_date: string; notes?: string }) =>
  req<{ ok: true; alignment: OrgAlignment }>(`${FN}?action=create`, { method: "POST", body: JSON.stringify(b) });
export const updateAlignment = (b: { id: string; name?: string; effective_date?: string; notes?: string; status?: AlignmentStatus }) =>
  req<{ ok: true; alignment: OrgAlignment }>(`${FN}?action=update`, { method: "POST", body: JSON.stringify(b) });
export const deleteAlignment = (id: string) => req<{ ok: true }>(`${FN}?action=delete`, { method: "POST", body: JSON.stringify({ id }) });

export const addNode = (b: { alignment_id: string; ref: string; kind: NodeKind; name: string; code: string; parent_id?: string; parent_ref?: string }) =>
  req<{ ok: true; node: AlignmentNode }>(`${FN}?action=add-node`, { method: "POST", body: JSON.stringify(b) });
export const addMove = (b: { alignment_id: string; kind: MoveKind; node_id: string; new_parent_id?: string; new_parent_ref?: string }) =>
  req<{ ok: true; move: AlignmentMove }>(`${FN}?action=add-move`, { method: "POST", body: JSON.stringify(b) });
export const removeNode = (id: string) => req<{ ok: true }>(`${FN}?action=remove-node`, { method: "POST", body: JSON.stringify({ id }) });
export const removeMove = (id: string) => req<{ ok: true }>(`${FN}?action=remove-move`, { method: "POST", body: JSON.stringify({ id }) });

export const addLeaderMove = (b: { alignment_id: string; user_id: string; scope_type: LeaderScope; from_scope_id?: string; to_scope_id?: string; to_scope_ref?: string }) =>
  req<{ ok: true; leader_move: AlignmentLeaderMove }>(`${FN}?action=add-leader-move`, { method: "POST", body: JSON.stringify(b) });
export const removeLeaderMove = (id: string) => req<{ ok: true }>(`${FN}?action=remove-leader-move`, { method: "POST", body: JSON.stringify({ id }) });

export const applyAlignment = (id: string) => req<{ ok: true; created: number; moved: number }>(`${FN}?action=apply`, { method: "POST", body: JSON.stringify({ id }) });
export const rollbackAlignment = (id: string) => req<{ ok: true }>(`${FN}?action=rollback`, { method: "POST", body: JSON.stringify({ id }) });
