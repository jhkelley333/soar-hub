// Walkthrough assignments — DO-side. Create + list assignments for GMs.
// Client-direct: walkthrough_assignments RLS (0120) lets DO+ insert/read for
// stores they can see. Stores + assignees come from the existing scoped
// org tree (fetchMyTree); active templates from walkthrough_templates.

import { supabase } from "@/lib/supabase";
import { fetchMyTree } from "@/modules/my-stores/api";

// ---- active templates ------------------------------------------------------

export interface ActiveTemplate {
  id: string;
  name: string;
  version: string;
  type: string;
}

export async function listActiveTemplates(): Promise<ActiveTemplate[]> {
  const { data, error } = await supabase
    .from("walkthrough_templates")
    .select("id, name, version, type")
    .eq("is_active", true)
    .order("name");
  if (error) throw error;
  return (data ?? []) as ActiveTemplate[];
}

// ---- scoped stores + candidate assignees (from the org tree) ---------------

export interface AssignStore {
  id: string;
  number: string;
  name: string;
  /** Candidate assignees for this store (GM + team), de-duped. */
  assignees: AssignPerson[];
}
export interface AssignPerson {
  id: string;
  name: string;
  role: string;
}

function personName(p: { preferred_name?: string | null; full_name?: string | null; email?: string }): string {
  return p.preferred_name || p.full_name || p.email || "—";
}

// Leadership (DOs / SDOs) the caller manages — sourced from the scoped org
// tree's per-store leadership, de-duped, excluding the caller themselves.
// Valid assignees for a store-less walk: they choose the store when they run
// it. Mirrors the RLS manageable_users() gate on store-less inserts.
export async function loadAssignLeaders(): Promise<AssignPerson[]> {
  const { data: auth } = await supabase.auth.getUser();
  const meId = auth.user?.id ?? null;
  const tree = await fetchMyTree();
  const byId = new Map<string, AssignPerson>();
  for (const lead of Object.values(tree.leadership)) {
    for (const p of [lead.do, lead.sdo]) {
      if (p && p.id !== meId) {
        byId.set(p.id, { id: p.id, name: personName(p), role: p.role });
      }
    }
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export async function loadAssignStores(): Promise<AssignStore[]> {
  const tree = await fetchMyTree();
  const out: AssignStore[] = [];
  for (const region of tree.regions) {
    for (const area of region.areas) {
      for (const district of area.districts) {
        for (const store of district.stores) {
          const byId = new Map<string, AssignPerson>();
          const gm = tree.leadership[store.id]?.gm;
          if (gm) byId.set(gm.id, { id: gm.id, name: personName(gm), role: gm.role });
          for (const m of store.team_members) {
            if (!m.is_active) continue;
            byId.set(m.id, { id: m.id, name: personName(m), role: m.role });
          }
          out.push({
            id: store.id,
            number: store.number,
            name: store.name ?? "",
            assignees: [...byId.values()].sort((a, b) => a.name.localeCompare(b.name)),
          });
        }
      }
    }
  }
  return out.sort((a, b) => a.number.localeCompare(b.number));
}

// ---- assignments list ------------------------------------------------------

export interface AssignmentRow {
  id: string;
  /** True when no store was set — the assignee picks one when they run it. */
  selfPickStore: boolean;
  /** True for an open/self-serve walk anyone in scope can pick up. */
  isPublic: boolean;
  storeNumber: string;
  storeName: string;
  templateName: string;
  templateVersion: string;
  assigneeName: string;
  dueAt: string | null;
  status: "not_started" | "in_progress" | "submitted";
  createdAt: string;
}

export async function listAssignments(): Promise<AssignmentRow[]> {
  const { data, error } = await supabase
    .from("walkthrough_assignments")
    .select(
      "id, template_version, due_at, status, created_at, is_public, " +
        "store:stores!store_id(number, name), template:walkthrough_templates(name), " +
        "assignee:profiles!assignee_id(full_name, preferred_name)",
    )
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  const rows = (data ?? []) as unknown as Record<string, unknown>[];
  return rows.map((r) => {
    const store = r.store as { number?: string; name?: string } | null;
    const tmpl = r.template as { name?: string } | null;
    const assignee = r.assignee as { full_name?: string | null; preferred_name?: string | null } | null;
    const isPublic = !!r.is_public;
    return {
      id: r.id as string,
      selfPickStore: !store,
      isPublic,
      storeNumber: store?.number ?? "—",
      storeName: store?.name ?? "—",
      templateName: tmpl?.name ?? "—",
      templateVersion: r.template_version as string,
      assigneeName: isPublic
        ? "Public — anyone in scope"
        : assignee?.preferred_name || assignee?.full_name || "—",
      dueAt: (r.due_at as string) ?? null,
      status: r.status as AssignmentRow["status"],
      createdAt: r.created_at as string,
    };
  });
}

// ---- create ----------------------------------------------------------------

export interface NewAssignment {
  templateId: string;
  templateVersion: string;
  /** null = store-less (the assignee picks a store when they run it). */
  storeId: string | null;
  /** Empty when public (no specific assignee). */
  assigneeId: string;
  /** Open/self-serve walk anyone in scope can pick up. */
  isPublic?: boolean;
  dueAt: string | null;
}

export async function createAssignment(a: NewAssignment): Promise<string> {
  const { data: auth } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("walkthrough_assignments")
    .insert({
      template_id: a.templateId,
      template_version: a.templateVersion,
      store_id: a.storeId || null,
      assignee_id: a.isPublic ? null : a.assigneeId,
      is_public: !!a.isPublic,
      due_at: a.dueAt,
      assigned_by: auth.user?.id ?? null,
      status: "not_started",
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}
