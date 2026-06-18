// Manual & Guide Search — client API. Calls the search_manuals RPC, which is
// SECURITY INVOKER, so results are already RLS-scoped to the caller.
import { supabase } from "@/lib/supabase";

export interface ManualSearchHit {
  chunk_id: string;
  manual_id: string;
  manual_title: string;
  section_path: string | null;
  version_label: string;
  snippet: string; // ts_headline output: matches wrapped in <mark>…</mark>
  rank: number;
}

export async function searchManuals(
  q: string,
  manualId: string | null = null,
  maxResults = 20,
): Promise<ManualSearchHit[]> {
  const { data, error } = await supabase.rpc("search_manuals", {
    q,
    manual_id: manualId,
    max_results: maxResults,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as ManualSearchHit[];
}

// ── Admin (RVP+/admin) ────────────────────────────────────────────────────────
export type ManualScope = "company" | "region" | "area" | "district" | "store";

export interface Manual {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  scope: ManualScope;
  scope_ref: string | null;
  created_at: string;
}
export interface DocVersion {
  id: string;
  manual_id: string;
  version_label: string;
  storage_path: string;
  is_active: boolean;
  uploaded_by: string | null;
  uploaded_at: string;
  indexed_at: string | null;
}

export async function listManualsAdmin(): Promise<{ manuals: Manual[]; versions: DocVersion[] }> {
  const [m, v] = await Promise.all([
    supabase.from("manuals").select("*").order("title"),
    supabase.from("doc_versions").select("*").order("uploaded_at", { ascending: false }),
  ]);
  if (m.error) throw new Error(m.error.message);
  if (v.error) throw new Error(v.error.message);
  return { manuals: (m.data ?? []) as Manual[], versions: (v.data ?? []) as DocVersion[] };
}

const slugify = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "manual";

export async function createManual(input: {
  title: string;
  description?: string;
  scope: ManualScope;
  scope_ref?: string | null;
}): Promise<Manual> {
  const slug = `${slugify(input.title)}-${Math.random().toString(36).slice(2, 6)}`;
  const { data, error } = await supabase
    .from("manuals")
    .insert({
      title: input.title.trim(),
      slug,
      description: input.description?.trim() || null,
      scope: input.scope,
      scope_ref: input.scope === "company" ? null : (input.scope_ref?.trim() || null),
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as Manual;
}

// Resumable (TUS) upload to Supabase Storage — required for large files
// (operations manuals can be ~100MB; the standard one-shot upload is
// unreliable at that size). Reports progress 0..1.
async function resumableUpload(path: string, file: File, onProgress?: (frac: number) => void): Promise<void> {
  const { Upload } = await import("tus-js-client");
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in");
  const projectUrl = import.meta.env.VITE_SUPABASE_URL as string;
  await new Promise<void>((resolve, reject) => {
    const upload = new Upload(file, {
      endpoint: `${projectUrl}/storage/v1/upload/resumable`,
      retryDelays: [0, 3000, 5000, 10000, 20000],
      headers: { authorization: `Bearer ${token}`, "x-upsert": "false" },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      chunkSize: 6 * 1024 * 1024, // Supabase requires 6MB chunks
      metadata: {
        bucketName: "manuals",
        objectName: path,
        contentType: file.type || "application/pdf",
        cacheControl: "3600",
      },
      onError: (e) => reject(e instanceof Error ? e : new Error(String(e))),
      onProgress: (sent, total) => onProgress?.(total ? sent / total : 0),
      onSuccess: () => resolve(),
    });
    upload.findPreviousUploads().then((prev) => {
      if (prev.length) upload.resumeFromPreviousUpload(prev[0]);
      upload.start();
    });
  });
}

// Upload a file to the `manuals` bucket, insert the doc_version row, then index
// it (chunks). Does NOT activate — that's a separate explicit step.
export async function uploadVersion(
  manualId: string,
  versionLabel: string,
  file: File,
  onProgress?: (frac: number) => void,
): Promise<DocVersion> {
  const ext = (file.name.split(".").pop() || "pdf").toLowerCase();
  const path = `${manualId}/${crypto.randomUUID()}.${ext}`;
  await resumableUpload(path, file, onProgress);

  const { data: userRes } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("doc_versions")
    .insert({
      manual_id: manualId,
      version_label: versionLabel.trim(),
      storage_path: path,
      uploaded_by: userRes?.user?.id ?? null,
    })
    .select()
    .single();
  if (error) throw new Error(error.message);

  await ingestVersion(data.id);
  return data as DocVersion;
}

// ── ingest-manual Netlify function ────────────────────────────────────────────
async function fnPost<T>(action: "activate", body: Record<string, unknown>): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in");
  const res = await fetch(`/.netlify/functions/ingest-manual?action=${action}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try { const b = await res.json(); if (b?.error) message = b.error; } catch { /* ignore */ }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Indexing runs in a Netlify *background* function (15-min budget) so large
// manuals don't hit the ~10s synchronous timeout (→ 502). We kick it off, then
// poll the version's index_status until it flips to done/error. The mutation
// stays pending for the duration, so the existing "Indexing…" UI just works.
export async function ingestVersion(docVersionId: string): Promise<{ ok: true; chunks: number }> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in");

  // Fire the background job (returns 202 immediately). Non-2xx = auth/role
  // failure we should surface now rather than poll on.
  const res = await fetch(`/.netlify/functions/ingest-manual-background?action=ingest`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ doc_version_id: docVersionId }),
  });
  if (!res.ok && res.status !== 202) {
    throw new Error(res.status === 403 ? "Manuals are managed by RVP and above." : `Couldn't start indexing (${res.status}).`);
  }

  // Poll for up to ~6 minutes; large PDFs take a while but well under the
  // function's 15-min budget.
  const deadline = Date.now() + 6 * 60_000;
  while (Date.now() < deadline) {
    await sleep(3000);
    const { data: row } = await supabase
      .from("doc_versions")
      .select("index_status, index_error, index_chunks")
      .eq("id", docVersionId)
      .maybeSingle();
    if (row?.index_status === "done") return { ok: true, chunks: row.index_chunks ?? 0 };
    if (row?.index_status === "error") throw new Error(row.index_error || "Indexing failed.");
  }
  throw new Error("Indexing is still running in the background — refresh in a minute to check its status.");
}

export const activateVersion = (docVersionId: string) =>
  fnPost<{ ok: true }>("activate", { doc_version_id: docVersionId });
