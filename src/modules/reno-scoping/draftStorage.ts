// Per-scope localStorage draft store for checklist answers. Mirrors the
// pattern from src/modules/workspaces/SubmissionFormPage.tsx: cache the
// in-progress map locally so a reload (or signal blip) doesn't lose
// in-flight work. Server is still the source of truth; this is just a
// shock absorber.

import type { ScopeItemStatus } from "./types";

const KEY_PREFIX = "reno-scope-draft:";

export interface DraftItem {
  template_item_id: string;
  status?: ScopeItemStatus | null;
  notes?: string | null;
  estimated_cost?: number | null;
  recommend_for_plus_up?: boolean | null;
}

export interface DraftSnapshot {
  scope_id: string;
  client_updated_at: string;
  items: Record<string, DraftItem>;
}

export function loadDraft(scopeId: string): DraftSnapshot | null {
  try {
    const raw = localStorage.getItem(KEY_PREFIX + scopeId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DraftSnapshot;
    if (!parsed || typeof parsed !== "object" || parsed.scope_id !== scopeId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveDraft(snapshot: DraftSnapshot): void {
  try {
    localStorage.setItem(KEY_PREFIX + snapshot.scope_id, JSON.stringify(snapshot));
  } catch {
    // quota / private mode — non-fatal. The server save will still run.
  }
}

export function clearDraft(scopeId: string): void {
  try {
    localStorage.removeItem(KEY_PREFIX + scopeId);
  } catch {
    /* ignore */
  }
}

export function mergeDraftItem(
  prev: DraftSnapshot | null,
  scopeId: string,
  templateItemId: string,
  patch: Partial<Omit<DraftItem, "template_item_id">>,
): DraftSnapshot {
  const items = { ...(prev?.items ?? {}) };
  const existing: DraftItem = items[templateItemId] ?? { template_item_id: templateItemId };
  items[templateItemId] = { ...existing, ...patch, template_item_id: templateItemId };
  return {
    scope_id: scopeId,
    client_updated_at: new Date().toISOString(),
    items,
  };
}
