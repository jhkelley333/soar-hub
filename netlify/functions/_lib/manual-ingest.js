// Shared manual-indexing routine: download the version's PDF from storage,
// extract its text, split into sections, and replace that version's chunks.
// Writes live progress to the doc_versions row (index_status/error/chunks) so
// a background caller — which can't return a result to the browser — can be
// polled. Used by both ingest-manual (sync) and ingest-manual-background.

import { PDFParse } from "pdf-parse";
import { chunkSections } from "./manual-chunker.js";

export async function runIngest(supa, docVersionId) {
  if (!docVersionId) return { error: "doc_version_id is required.", status: 400 };

  const { data: ver, error: vErr } = await supa
    .from("doc_versions")
    .select("id, manual_id, storage_path")
    .eq("id", docVersionId)
    .maybeSingle();
  if (vErr) return { error: vErr.message, status: 500 };
  if (!ver) return { error: "doc_version not found.", status: 404 };

  const setStatus = (patch) => supa.from("doc_versions").update(patch).eq("id", docVersionId);
  const fail = async (error, status) => {
    await setStatus({ index_status: "error", index_error: error });
    return { error, status };
  };

  await setStatus({ index_status: "indexing", index_error: null });

  const { data: file, error: dErr } = await supa.storage.from("manuals").download(ver.storage_path);
  if (dErr || !file) return fail(`Couldn't download source file: ${dErr?.message || "missing"}`, 502);

  let text;
  try {
    const buf = Buffer.from(await file.arrayBuffer());
    const parser = new PDFParse({ data: buf });
    try {
      text = (await parser.getText()).text || "";
    } finally {
      await parser.destroy?.();
    }
  } catch (e) {
    return fail(`PDF parse failed: ${e.message}`, 422);
  }

  const sections = chunkSections(text);
  if (!sections.length) return fail("No sections detected in the document.", 422);

  // Idempotent: replace this version's chunks rather than appending.
  const { error: delErr } = await supa.from("manual_chunks").delete().eq("doc_version_id", docVersionId);
  if (delErr) return fail(delErr.message, 500);

  const rows = sections.map((s) => ({
    manual_id: ver.manual_id,
    doc_version_id: docVersionId,
    section_path: s.section_path,
    heading: s.heading,
    content: s.content,
    ordinal: s.ordinal,
    // embedding intentionally left NULL (reserved for pgvector).
  }));
  // Insert in chunks of 500 to stay well under payload limits.
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supa.from("manual_chunks").insert(rows.slice(i, i + 500));
    if (error) return fail(error.message, 500);
  }

  await setStatus({
    indexed_at: new Date().toISOString(),
    index_status: "done",
    index_chunks: rows.length,
    index_error: null,
  });
  return { ok: true, doc_version_id: docVersionId, chunks: rows.length };
}
