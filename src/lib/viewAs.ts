// Admin "View As" — read-only debugging mode. An admin picks another user
// and the app shows what THAT user would see on the "my ___" queues
// currently wired to honor it (My CAPs, My Assignments, Sign-off Queue —
// see netlify/functions/workspaces.js / workspace-caps.js /
// workspace-submissions.js). No writes are possible while active: those
// functions hard-reject any POST carrying the X-View-As-User-Id header,
// regardless of what the UI does — this module is just the client-side
// half (state + the header on outgoing requests).
//
// State lives in sessionStorage (survives a reload mid-debugging session,
// clears when the tab closes) mirrored into a module-level variable so
// plain async functions (API request helpers, which aren't hooks) can
// read it synchronously without needing a React import.

export interface ViewAsTarget {
  id: string;
  name: string;
  role: string;
}
export interface ViewAsState {
  sessionId: string;
  target: ViewAsTarget;
}

const STORAGE_KEY = "soar.viewAs";
type Listener = (state: ViewAsState | null) => void;
const listeners = new Set<Listener>();

function readStorage(): ViewAsState | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as ViewAsState) : null;
  } catch {
    return null;
  }
}

let current: ViewAsState | null = typeof window !== "undefined" ? readStorage() : null;

export function getViewAsState(): ViewAsState | null {
  return current;
}

export function setViewAsState(state: ViewAsState | null): void {
  current = state;
  try {
    if (state) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage may be disabled (private mode) — state still works in-memory for this tab */
  }
  listeners.forEach((l) => l(current));
}

export function subscribeViewAs(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// The header outgoing requests should carry while a View As session is
// active — merge into whatever headers a request already builds.
export function viewAsHeaders(): Record<string, string> {
  return current ? { "X-View-As-User-Id": current.target.id } : {};
}
