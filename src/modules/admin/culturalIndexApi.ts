// Typed client for netlify/functions/cultural-index — the Cultural Index
// results importer. Mirrors the team/api auth pattern (Bearer JWT).

import { supabase } from "@/lib/supabase";
import type { UserRole } from "@/types/database";

const FN = "/.netlify/functions/cultural-index";

export interface CiRowInput {
  first_name: string;
  last_name: string;
  email: string;
  trait: string;
  job_title: string;
}

export interface CiCandidate {
  id: string;
  name: string;
  role: UserRole;
  email: string | null;
  current_trait: string | null;
  has_trait: boolean;
  score: number;
}

export type CiMatchType =
  | "email"
  | "name"
  | "fuzzy"
  | "ambiguous"
  | "none"
  | "no_trait";

export interface CiRowAnnotated {
  row: number;
  first_name: string;
  last_name: string;
  email: string;
  trait: string;
  job_title: string;
  match_type: CiMatchType;
  needs_confirm: boolean;
  profile: CiCandidate | null;
  candidates: CiCandidate[];
}

export interface CiPreviewResponse {
  rows: CiRowAnnotated[];
  summary: {
    total: number;
    email: number;
    name: number;
    fuzzy: number;
    ambiguous: number;
    none: number;
    no_trait: number;
  };
}

export interface CiCommitResponse {
  updated: number;
  results: { profile_id: string; trait: string; status: string; message?: string }[];
}

async function authHeaders(): Promise<HeadersInit> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in");
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

async function request<T>(path: string, init: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { ...(await authHeaders()), ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

export function ciPreview(rows: CiRowInput[]): Promise<CiPreviewResponse> {
  return request<CiPreviewResponse>(`${FN}?action=preview`, {
    method: "POST",
    body: JSON.stringify({ rows }),
  });
}

export function ciCommit(
  assignments: { profile_id: string; trait: string }[],
): Promise<CiCommitResponse> {
  return request<CiCommitResponse>(`${FN}?action=commit`, {
    method: "POST",
    body: JSON.stringify({ assignments }),
  });
}
