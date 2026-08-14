// NSO plans persist to localStorage — no backend/migration needed, so the tool
// is self-contained and safe to hand off. Plans are keyed by id in a single
// list; the "active" plan id is remembered separately. If we later want plans
// shared across devices/users, this is the seam to swap for a Netlify function.

import type { NsoPlan } from "./plan";
import { newPlan } from "./plan";

const LIST_KEY = "nso.plans.v1";
const ACTIVE_KEY = "nso.activePlanId.v1";

export function loadPlans(): NsoPlan[] {
  try {
    const raw = localStorage.getItem(LIST_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as NsoPlan[]) : [];
  } catch {
    return [];
  }
}

export function savePlans(plans: NsoPlan[]): void {
  try {
    localStorage.setItem(LIST_KEY, JSON.stringify(plans));
  } catch {
    /* quota / private mode — non-fatal */
  }
}

export function getActiveId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
}

export function setActiveId(id: string): void {
  try {
    localStorage.setItem(ACTIVE_KEY, id);
  } catch {
    /* non-fatal */
  }
}

/** Load plans, seeding a first empty plan on a fresh browser. Returns the list
 *  plus the resolved active id. */
export function bootstrap(): { plans: NsoPlan[]; activeId: string } {
  let plans = loadPlans();
  if (!plans.length) {
    const p = newPlan();
    plans = [p];
    savePlans(plans);
    setActiveId(p.id);
    return { plans, activeId: p.id };
  }
  let activeId = getActiveId();
  if (!activeId || !plans.some((p) => p.id === activeId)) {
    activeId = plans[0].id;
    setActiveId(activeId);
  }
  return { plans, activeId };
}
