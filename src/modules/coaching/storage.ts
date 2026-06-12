// Per-user persistence for the Coaching Tool Kit: favorites, recently-used,
// and Readiness-Walk progress. Stored in localStorage keyed by the user's id
// so it follows them on this device. (A server-backed sync that follows the
// manager across devices is a reasonable later enhancement.)
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/auth/AuthProvider";
import type { ToolId } from "./types";

const RECENT_MAX = 6;

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* quota / private mode */ }
}

export function useCoachingStore() {
  const { profile } = useAuth();
  const uid = profile?.id ?? "anon";
  const favKey = `ctk:${uid}:favorites`;
  const recentKey = `ctk:${uid}:recent`;
  const walkKey = `ctk:${uid}:walk`;

  const [favorites, setFavorites] = useState<ToolId[]>(() => read(favKey, []));
  const [recent, setRecent] = useState<ToolId[]>(() => read(recentKey, []));
  const [walkDone, setWalkDone] = useState<number[]>(() => read(walkKey, []));

  // Re-hydrate when the signed-in user changes.
  useEffect(() => {
    setFavorites(read(favKey, []));
    setRecent(read(recentKey, []));
    setWalkDone(read(walkKey, []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  useEffect(() => write(favKey, favorites), [favKey, favorites]);
  useEffect(() => write(recentKey, recent), [recentKey, recent]);
  useEffect(() => write(walkKey, walkDone), [walkKey, walkDone]);

  const toggleFavorite = useCallback((id: ToolId) => {
    setFavorites((f) => (f.includes(id) ? f.filter((x) => x !== id) : [...f, id]));
  }, []);

  const pushRecent = useCallback((id: ToolId) => {
    setRecent((r) => [id, ...r.filter((x) => x !== id)].slice(0, RECENT_MAX));
  }, []);

  const toggleWalkStep = useCallback((i: number) => {
    setWalkDone((d) => (d.includes(i) ? d.filter((x) => x !== i) : [...d, i]));
  }, []);
  const resetWalk = useCallback(() => setWalkDone([]), []);

  return { favorites, toggleFavorite, recent, pushRecent, walkDone, toggleWalkStep, resetWalk };
}
