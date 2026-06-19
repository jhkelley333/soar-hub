// Manual & Guide Search — client API. Calls the search_manuals RPC, which is
// SECURITY INVOKER, so results are already RLS-scoped to the caller.
import { supabase } from "@/lib/supabase";
import { chunkSections } from "./chunker";
import { extractPdfText } from "./pdfText";

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

  await ingestVersion(data.id, file);
  return data as DocVersion;
}

// ── Activation (client-side) ─────────────────────────────────────────────────
// activate_doc_version is SECURITY DEFINER and self-gates with
// manual_can_manage(), so it's called directly with the user's session. (Going
// through a service-role function broke the gate: auth.uid() is null there, so
// manual_can_manage() returned false → "Not authorized to activate.")
export async function activateVersion(docVersionId: string): Promise<{ ok: true }> {
  const { error } = await supabase.rpc("activate_doc_version", { p_version_id: docVersionId });
  if (error) throw new Error(error.message);
  return { ok: true };
}
// Parsing a 25–100 MB PDF blew past Netlify's function time/memory budget
// (→ 502), and background functions didn't help. Since RLS lets a manual
// manager write manual_chunks + doc_versions directly, we do the whole job in
// the browser — parse the PDF, chunk it, replace the version's chunks, stamp
// it indexed — with no server time limit. Pass the just-uploaded File to skip
// a re-download; Re-index downloads the stored file instead.
export async function ingestVersion(docVersionId: string, file?: Blob): Promise<{ ok: true; chunks: number }> {
  const { data: ver, error: vErr } = await supabase
    .from("doc_versions")
    .select("manual_id, storage_path")
    .eq("id", docVersionId)
    .single();
  if (vErr || !ver) throw new Error("Couldn't load the version to index.");

  let blob = file;
  if (!blob) {
    const { data, error } = await supabase.storage.from("manuals").download(ver.storage_path);
    if (error || !data) throw new Error("Couldn't download the file to index.");
    blob = data;
  }

  const text = await extractPdfText(blob);
  const sections = chunkSections(text);
  if (!sections.length) {
    await supabase.from("doc_versions")
      .update({ index_status: "error", index_error: "No sections detected — is this a text PDF (not a scan)?" })
      .eq("id", docVersionId);
    throw new Error("No sections detected — is this a text PDF, not a scanned image?");
  }

  // Replace this version's chunks, then stamp it indexed (RLS: manual_can_manage).
  const { error: delErr } = await supabase.from("manual_chunks").delete().eq("doc_version_id", docVersionId);
  if (delErr) throw new Error(delErr.message);

  const rows = sections.map((s) => ({
    manual_id: ver.manual_id,
    doc_version_id: docVersionId,
    section_path: s.section_path,
    heading: s.heading,
    content: s.content,
    ordinal: s.ordinal,
  }));
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase.from("manual_chunks").insert(rows.slice(i, i + 500));
    if (error) throw new Error(error.message);
  }

  const { error: upErr } = await supabase
    .from("doc_versions")
    .update({ indexed_at: new Date().toISOString(), index_status: "done", index_chunks: rows.length, index_error: null })
    .eq("id", docVersionId);
  if (upErr) throw new Error(upErr.message);

  return { ok: true, chunks: rows.length };
}
