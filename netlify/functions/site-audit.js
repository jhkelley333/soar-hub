// SOAR Site Audits (Audit Pro) — backend.
//
// A GM (or above) walks a store and captures issues (photo + note + severity +
// due + optional required proof). Anyone in scope tracks each issue to
// completion; the required-proof loop is enforced HERE, server-side, so an
// issue can never close without its photo/note even via the API.
//
// Service-role gatekeeper: this function uses the service key and scopes every
// read/write to the caller's stores. One audit = one dated walk.

import { createClient } from "@supabase/supabase-js";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { findUsersForStore, sendEmail } from "./_lib/ticketEmail.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = "site-audit-photos";
const MAX_PDF_PHOTOS = 40; // bound PDF size + generation time on big audits

// GM and above may create audits, capture issues, set proof, resolve, share.
const CAPTURE_ROLES = new Set(["gm", "do", "sdo", "rvp", "vp", "coo", "admin"]);
const ORG_WIDE = new Set(["vp", "coo", "admin"]);
const AREAS = new Set(["FOH", "BOH", "Restroom", "Stock Room", "Roof", "Parking Lot", "Stall", "Landscaping", "Managers Desk", "Patio", "Trash Enclosure", "Kitchen", "Misc."]);
const SEVERITIES = new Set(["high", "medium", "low"]);

function admin() {
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("site-audit env vars not configured");
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}
function respond(statusCode, payload) {
  return { statusCode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) };
}
function unwrap(result) {
  if (result && typeof result === "object" && "error" in result && "status" in result) {
    return respond(result.status, { error: result.error });
  }
  return respond(200, result);
}
function sanitize(v, max) {
  if (typeof v !== "string") return "";
  return v.slice(0, max).trim();
}
function displayName(p) {
  return p?.preferred_name || p?.full_name || p?.email || "Someone";
}

async function getSessionUser(event) {
  const header = event.headers?.authorization || event.headers?.Authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  if (!token) return null;
  const supa = admin();
  const { data: userRes, error } = await supa.auth.getUser(token);
  if (error || !userRes?.user) return null;
  const { data: profile } = await supa
    .from("profiles")
    .select("id, email, full_name, preferred_name, role, is_active")
    .eq("id", userRes.user.id).single();
  if (!profile || profile.is_active === false) return null;
  return profile;
}

// Stores the caller can see (org-wide roles see all; others by user_scopes).
async function storesForUser(supa, profile) {
  const role = String(profile.role || "").toLowerCase();
  if (ORG_WIDE.has(role)) {
    const { data } = await supa.from("stores").select("id, number, name, district_id").eq("is_active", true).limit(2000);
    return { all: true, ids: new Set((data || []).map((s) => s.id)), rows: data || [] };
  }
  const { data: scopes } = await supa.from("user_scopes").select("scope_type, scope_id").eq("user_id", profile.id);
  if (!scopes?.length) return { all: false, ids: new Set(), rows: [] };
  const directStoreIds = scopes.filter((s) => s.scope_type === "store").map((s) => s.scope_id);
  const districtIds = scopes.filter((s) => s.scope_type === "district").map((s) => s.scope_id);
  const areaIds = scopes.filter((s) => s.scope_type === "area").map((s) => s.scope_id);
  const regionIds = scopes.filter((s) => s.scope_type === "region").map((s) => s.scope_id);
  if (regionIds.length) {
    const { data } = await supa.from("areas").select("id").in("region_id", regionIds);
    for (const a of data || []) areaIds.push(a.id);
  }
  if (areaIds.length) {
    const { data } = await supa.from("districts").select("id").in("area_id", areaIds);
    for (const d of data || []) districtIds.push(d.id);
  }
  const storeIds = new Set(directStoreIds);
  if (districtIds.length) {
    const { data } = await supa.from("stores").select("id").in("district_id", districtIds);
    for (const s of data || []) storeIds.add(s.id);
  }
  if (storeIds.size === 0) return { all: false, ids: new Set(), rows: [] };
  const { data: rows } = await supa.from("stores").select("id, number, name, district_id").in("id", Array.from(storeIds));
  return { all: false, ids: storeIds, rows: rows || [] };
}

// Decode a base64 / data-URL image and upload it; returns the storage path.
// Accepts either a raw data-URL string (e.g. the signature canvas) or a
// { data, type, name } object (captured photos).
async function uploadImage(supa, photo, prefix) {
  const raw = typeof photo === "string" ? photo : photo?.data;
  if (!raw) return null;
  let b64 = String(raw);
  let type = typeof photo === "object" && photo ? sanitize(photo.type, 40) : "";
  const comma = b64.indexOf(",");
  if (b64.startsWith("data:") && comma > -1) {
    if (!type) type = b64.slice(5, comma).split(";")[0] || ""; // sniff mime from the data URL
    b64 = b64.slice(comma + 1);
  }
  const buf = Buffer.from(b64, "base64");
  if (!buf.length || buf.length > 10 * 1024 * 1024) return null; // 10 MB cap
  type = type || "image/jpeg";
  const ext = type.includes("png") ? "png" : type.includes("webp") ? "webp" : "jpg";
  const path = `${prefix}/${globalThis.crypto.randomUUID()}.${ext}`;
  const { error } = await supa.storage.from(BUCKET).upload(path, buf, { contentType: type, upsert: false });
  if (error) throw new Error(error.message);
  return path;
}
async function signed(supa, path) {
  if (!path) return null;
  // 7-day TTL: an audit is captured + reviewed over a full work day (sometimes
  // 30+ issues in one sitting). A short TTL expires while the list sits cached
  // in the PWA (refetchOnWindowFocus is off), which silently breaks every photo.
  const { data } = await supa.storage.from(BUCKET).createSignedUrl(path, 60 * 60 * 24 * 7);
  return data?.signedUrl || null;
}

async function issueCard(supa, i) {
  let completion = i.completion || null;
  if (completion?.photo_url) completion = { ...completion, photo_url: await signed(supa, completion.photo_url) };
  return {
    id: i.id, audit_id: i.audit_id, title: i.title, area: i.area, severity: i.severity,
    comment: i.comment, photo_url: await signed(supa, i.photo_url), due: i.due,
    proof_required: i.proof_required || [], completed: i.completed, completion,
    created_at: i.created_at,
  };
}
function auditStats(issues) {
  const total = issues.length;
  const done = issues.filter((i) => i.completed).length;
  const high = issues.filter((i) => i.severity === "high" && !i.completed).length;
  return { total, done, open: total - done, high, pct: total ? Math.round((done / total) * 100) : 0 };
}

// Look up an audit + verify the caller can see its store. Returns { audit } or { error }.
async function loadAudit(supa, user, auditId) {
  const { data: audit } = await supa.from("site_audits").select("*").eq("id", auditId).maybeSingle();
  if (!audit) return { error: "Audit not found.", status: 404 };
  const scope = await storesForUser(supa, user);
  if (!scope.all && !scope.ids.has(audit.store_id)) return { error: "That store is outside your scope.", status: 403 };
  return { audit };
}

// ----------------------------------------------------------------------------
async function listAudits(supa, user) {
  const scope = await storesForUser(supa, user);
  let q = supa.from("site_audits").select("*").order("date", { ascending: false }).order("created_at", { ascending: false }).limit(200);
  if (!scope.all) {
    if (scope.ids.size === 0) return { audits: [], can_write: CAPTURE_ROLES.has(String(user.role)) };
    q = q.in("store_id", Array.from(scope.ids));
  }
  const { data: audits, error } = await q;
  if (error) return { error: error.message, status: 500 };
  const ids = (audits || []).map((a) => a.id);
  const { data: allIssues } = ids.length
    ? await supa.from("site_audit_issues").select("*").in("audit_id", ids).order("created_at", { ascending: true })
    : { data: [] };
  const byAudit = new Map();
  for (const i of allIssues || []) {
    if (!byAudit.has(i.audit_id)) byAudit.set(i.audit_id, []);
    byAudit.get(i.audit_id).push(i);
  }
  // Latest shared report per audit (for the "Shared" indicator).
  const { data: reports } = ids.length
    ? await supa.from("site_audit_reports").select("audit_id, signed_by_name, recipients, status, sent_at").in("audit_id", ids).order("sent_at", { ascending: false })
    : { data: [] };
  const lastReport = new Map();
  for (const rep of reports || []) if (!lastReport.has(rep.audit_id)) lastReport.set(rep.audit_id, rep);

  const storeName = new Map(scope.rows.map((s) => [s.id, s.name]));
  const role = String(user.role || "").toLowerCase();
  const out = [];
  for (const a of audits || []) {
    const issues = byAudit.get(a.id) || [];
    const rep = lastReport.get(a.id);
    out.push({
      id: a.id, store_id: a.store_id, store_number: a.store_number, store_name: storeName.get(a.store_id) || null,
      created_by_name: a.created_by_name, status: a.status, note: a.note, date: a.date, created_at: a.created_at,
      // Only the auditor who created it, or an admin, may delete an audit.
      can_delete: a.created_by === user.id || role === "admin",
      stats: auditStats(issues),
      last_report: rep ? { signed_by_name: rep.signed_by_name, sent_at: rep.sent_at, status: rep.status, recipient_count: (rep.recipients || []).length } : null,
      issues: await Promise.all(issues.map((i) => issueCard(supa, i))),
    });
  }
  return { audits: out, can_write: CAPTURE_ROLES.has(String(user.role)) };
}

async function createAudit(supa, user, body) {
  if (!CAPTURE_ROLES.has(String(user.role))) return { error: "Your role can't start an audit.", status: 403 };
  const storeId = sanitize(body?.store_id, 64);
  if (!storeId) return { error: "Pick a store.", status: 400 };
  const scope = await storesForUser(supa, user);
  if (!scope.all && !scope.ids.has(storeId)) return { error: "That store is outside your scope.", status: 403 };
  const store = scope.rows.find((s) => s.id === storeId);
  const { data, error } = await supa.from("site_audits").insert({
    store_id: storeId, store_number: store ? String(store.number) : "",
    created_by: user.id, created_by_name: displayName(user), note: sanitize(body?.note, 500) || null,
  }).select("*").single();
  if (error) return { error: error.message, status: 500 };
  return { ok: true, audit_id: data.id };
}

async function captureIssue(supa, user, body) {
  if (!CAPTURE_ROLES.has(String(user.role))) return { error: "Your role can't capture issues.", status: 403 };
  const auditId = sanitize(body?.audit_id, 64);
  const r = await loadAudit(supa, user, auditId);
  if (r.error) return r;
  const title = sanitize(body?.title, 200);
  if (!title) return { error: "Add a short title for the issue.", status: 400 };
  const area = AREAS.has(body?.area) ? body.area : "Misc.";
  const severity = SEVERITIES.has(body?.severity) ? body.severity : "medium";
  const proofRequired = Array.isArray(body?.proof_required)
    ? body.proof_required.filter((p) => p === "photo" || p === "note")
    : [];
  const due = /^\d{4}-\d{2}-\d{2}$/.test(body?.due || "") ? body.due : null;
  let photoPath = null;
  try { photoPath = await uploadImage(supa, body?.photo, auditId); }
  catch (e) { return { error: `Photo upload failed: ${e.message}`, status: 500 }; }
  const { data, error } = await supa.from("site_audit_issues").insert({
    audit_id: auditId, title, area, severity, comment: sanitize(body?.comment, 2000) || null,
    photo_url: photoPath, due, proof_required: proofRequired, created_by: user.id,
  }).select("*").single();
  if (error) return { error: error.message, status: 500 };
  await supa.from("site_audits").update({ updated_at: new Date().toISOString() }).eq("id", auditId);
  return { ok: true, issue: await issueCard(supa, data) };
}

async function updateIssue(supa, user, body) {
  const auditId = sanitize(body?.audit_id, 64);
  const issueId = sanitize(body?.issue_id, 64);
  const r = await loadAudit(supa, user, auditId);
  if (r.error) return r;
  if (!CAPTURE_ROLES.has(String(user.role))) return { error: "Your role can't edit issues.", status: 403 };
  const patch = { updated_at: new Date().toISOString() };
  if (typeof body?.title === "string") patch.title = sanitize(body.title, 200) || undefined;
  if (AREAS.has(body?.area)) patch.area = body.area;
  if (SEVERITIES.has(body?.severity)) patch.severity = body.severity;
  if (typeof body?.comment === "string") patch.comment = sanitize(body.comment, 2000) || null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(body?.due || "")) patch.due = body.due;
  const { error } = await supa.from("site_audit_issues").update(patch).eq("id", issueId).eq("audit_id", auditId);
  if (error) return { error: error.message, status: 500 };
  return { ok: true };
}

// The proof loop — enforced here. An issue with proof_required can't close
// unless the matching items are supplied.
async function resolveIssue(supa, user, body) {
  const auditId = sanitize(body?.audit_id, 64);
  const issueId = sanitize(body?.issue_id, 64);
  const r = await loadAudit(supa, user, auditId);
  if (r.error) return r;
  if (!CAPTURE_ROLES.has(String(user.role))) return { error: "Your role can't resolve issues.", status: 403 };
  const { data: issue } = await supa.from("site_audit_issues").select("*").eq("id", issueId).eq("audit_id", auditId).maybeSingle();
  if (!issue) return { error: "Issue not found.", status: 404 };

  if (body?.reopen === true) {
    const { error } = await supa.from("site_audit_issues")
      .update({ completed: false, updated_at: new Date().toISOString() }).eq("id", issueId);
    if (error) return { error: error.message, status: 500 };
    return { ok: true };
  }

  const need = issue.proof_required || [];
  const note = sanitize(body?.completion?.note, 2000);
  let photoPath = null;
  try { photoPath = await uploadImage(supa, body?.completion?.photo, `${auditId}/proof`); }
  catch (e) { return { error: `Proof photo upload failed: ${e.message}`, status: 500 }; }

  if (need.includes("note") && note.length < 1) {
    return { error: "A note is required to close this issue.", status: 422 };
  }
  if (need.includes("photo") && !photoPath) {
    return { error: "A photo is required to close this issue.", status: 422 };
  }

  const completion = {
    by: user.id, by_name: displayName(user), at: new Date().toISOString(),
    note: note || null, photo_url: photoPath,
  };
  const { error } = await supa.from("site_audit_issues")
    .update({ completed: true, completion, updated_at: new Date().toISOString() }).eq("id", issueId);
  if (error) return { error: error.message, status: 500 };
  return { ok: true };
}

async function deleteIssue(supa, user, body) {
  const auditId = sanitize(body?.audit_id, 64);
  const r = await loadAudit(supa, user, auditId);
  if (r.error) return r;
  if (!CAPTURE_ROLES.has(String(user.role))) return { error: "Your role can't delete issues.", status: 403 };
  const { error } = await supa.from("site_audit_issues").delete().eq("id", sanitize(body?.issue_id, 64)).eq("audit_id", auditId);
  if (error) return { error: error.message, status: 500 };
  return { ok: true };
}

async function deleteAudit(supa, user, body) {
  const auditId = sanitize(body?.audit_id, 64);
  const r = await loadAudit(supa, user, auditId);
  if (r.error) return r;
  // Only the auditor who created it, or an admin, can delete an audit.
  const isAdmin = String(user.role || "").toLowerCase() === "admin";
  if (r.audit.created_by !== user.id && !isAdmin) return { error: "Only the auditor or an admin can delete this audit.", status: 403 };
  const { error } = await supa.from("site_audits").delete().eq("id", auditId);
  if (error) return { error: error.message, status: 500 };
  return { ok: true };
}

function esc(s) {
  return String(s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
function reportHtml(audit, issues, stats, auditor, message) {
  const rows = issues.map((i) => `
    <tr>
      <td style="padding:8px;border-bottom:1px solid #eee;">${esc(i.title)}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-transform:capitalize;">${esc(i.severity)}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;">${esc(i.area || "")}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;color:${i.completed ? "#16a34a" : "#b45309"};">${i.completed ? "Resolved" : (i.due ? "Due " + i.due : "Open")}</td>
    </tr>`).join("");
  const note = message
    ? `<div style="margin:16px 0;padding:14px 16px;background:#f1f5f9;border-radius:10px;font-size:14px;line-height:1.5;white-space:pre-wrap;">${esc(message).replace(/\n/g, "<br>")}</div>`
    : "";
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#15324B;max-width:640px;margin:0 auto;">
    <h2 style="margin:0 0 4px;">Site Audit — Store #${esc(audit.store_number)}</h2>
    <div style="color:#64748b;font-size:14px;">${esc(audit.date)} · by ${esc(auditor)}</div>
    ${note}
    <div style="margin:16px 0;font-size:15px;"><strong>${stats.done}/${stats.total}</strong> resolved · <strong>${stats.high}</strong> high · <strong>${stats.open}</strong> open</div>
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      <thead><tr style="text-align:left;color:#64748b;font-size:12px;text-transform:uppercase;">
        <th style="padding:8px;">Issue</th><th style="padding:8px;">Severity</th><th style="padding:8px;">Area</th><th style="padding:8px;">Status</th></tr></thead>
      <tbody>${rows || '<tr><td style="padding:8px;color:#999;">No issues logged.</td></tr>'}</tbody>
    </table>
    <div style="margin-top:16px;color:#64748b;font-size:13px;">📎 A printable PDF with the issues and photos is attached.</div>
    <div style="margin-top:16px;color:#94a3b8;font-size:12px;">Signed off by ${esc(auditor)} · SOAR Hub Site Audits</div>
  </div>`;
}

function capWord(s) { s = String(s || ""); return s.charAt(0).toUpperCase() + s.slice(1); }
function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error("pdf timeout")), ms))]);
}

// Download a stored photo as base64 + a jsPDF-embeddable format (JPEG/PNG only).
async function fetchImageData(supa, path) {
  try {
    const { data, error } = await supa.storage.from(BUCKET).download(path);
    if (error || !data) return null;
    const buf = Buffer.from(await data.arrayBuffer());
    if (!buf.length) return null;
    const lower = String(path).toLowerCase();
    const fmt = lower.endsWith(".png") ? "PNG" : (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) ? "JPEG" : null;
    if (!fmt) return null;
    return { dataUrl: `data:image/${fmt.toLowerCase()};base64,${buf.toString("base64")}`, fmt };
  } catch { return null; }
}

// A printable report: header + stats + optional message + issues table + a
// photo gallery (each photo captioned with its issue). Returns a Buffer.
async function buildReportPdf(supa, audit, issues, stats, auditor, message) {
  const doc = new jsPDF({ unit: "pt", format: "letter", compress: true });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 40;
  let y = M;

  doc.setFont("helvetica", "bold"); doc.setFontSize(18); doc.setTextColor(21, 50, 75);
  doc.text(`Site Audit — Store #${audit.store_number}`, M, y); y += 20;
  doc.setFont("helvetica", "normal"); doc.setFontSize(11); doc.setTextColor(110);
  doc.text(`${audit.date}   ·   by ${auditor}`, M, y); y += 16;
  doc.setTextColor(40);
  doc.text(`${stats.done}/${stats.total} resolved    ·    ${stats.high} high    ·    ${stats.open} open`, M, y);

  if (message) {
    y += 22;
    doc.setFontSize(10.5); doc.setTextColor(40);
    const lines = doc.splitTextToSize(message, W - 2 * M);
    doc.text(lines, M, y); y += lines.length * 13;
  }

  autoTable(doc, {
    startY: y + 14,
    head: [["#", "Issue", "Severity", "Area", "Status"]],
    body: issues.map((i, idx) => [
      String(idx + 1), i.title || "", capWord(i.severity), i.area || "",
      i.completed ? "Resolved" : (i.due ? "Due " + i.due : "Open"),
    ]),
    styles: { fontSize: 9, cellPadding: 4, valign: "middle" },
    headStyles: { fillColor: [40, 87, 128], halign: "left" },
    columnStyles: { 0: { cellWidth: 22 }, 2: { cellWidth: 64 }, 3: { cellWidth: 86 }, 4: { cellWidth: 66 } },
    margin: { left: M, right: M },
  });
  y = (doc.lastAutoTable?.finalY || y) + 26;

  const photoIssues = issues.map((i, idx) => ({ i, idx })).filter((x) => x.i.photo_url);
  const shown = photoIssues.slice(0, MAX_PDF_PHOTOS);
  if (shown.length) {
    const imgs = await Promise.all(shown.map((x) => fetchImageData(supa, x.i.photo_url)));
    if (y > H - 60) { doc.addPage(); y = M; }
    doc.setFont("helvetica", "bold"); doc.setFontSize(13); doc.setTextColor(21, 50, 75);
    doc.text("Photos", M, y); y += 16;
    const colW = W - 2 * M;

    for (let k = 0; k < shown.length; k++) {
      const { i, idx } = shown[k];
      const img = imgs[k];
      doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(40);
      const capLines = doc.splitTextToSize(`${idx + 1}. ${i.title || ""}  —  ${capWord(i.severity)}${i.area ? " · " + i.area : ""}`, colW);
      const capH = capLines.length * 12 + 4;

      let drawW = 0, drawH = 0;
      if (img) {
        try {
          const p = doc.getImageProperties(img.dataUrl);
          const r = Math.min(Math.min(colW, 320) / p.width, 240 / p.height);
          drawW = p.width * r; drawH = p.height * r;
        } catch { /* fall to placeholder */ }
      }
      const blockH = capH + (drawH || 54) + 16;
      if (y + blockH > H - M) { doc.addPage(); y = M; }
      doc.text(capLines, M, y + 10);
      const imgY = y + capH + 2;
      if (img && drawW > 0) {
        try { doc.addImage(img.dataUrl, img.fmt, M, imgY, drawW, drawH); }
        catch { doc.setDrawColor(210); doc.rect(M, imgY, 200, 50); }
      } else {
        doc.setDrawColor(210); doc.rect(M, imgY, 200, 50);
        doc.setTextColor(150); doc.setFontSize(9); doc.text("Photo unavailable", M + 8, imgY + 28);
      }
      y += blockH;
    }
    if (photoIssues.length > shown.length) {
      if (y > H - 40) { doc.addPage(); y = M; }
      doc.setFontSize(9); doc.setTextColor(120);
      doc.text(`+ ${photoIssues.length - shown.length} more photo(s) not shown`, M, y + 12);
    }
  }

  return Buffer.from(doc.output("arraybuffer"));
}

async function shareReport(supa, user, body) {
  const auditId = sanitize(body?.audit_id, 64);
  const r = await loadAudit(supa, user, auditId);
  if (r.error) return r;
  if (!CAPTURE_ROLES.has(String(user.role))) return { error: "Your role can't share a report.", status: 403 };
  const audit = r.audit;

  let sigPath = null;
  try { sigPath = await uploadImage(supa, body?.signature, `${auditId}/signatures`); }
  catch (e) { return { error: `Signature upload failed: ${e.message}`, status: 500 }; }
  if (!sigPath) return { error: "A signature is required to share the report.", status: 422 };

  const emails = new Set();
  if (body?.to_do === true) for (const u of await findUsersForStore(supa, audit.store_number, ["do"])) if (u.email) emails.add(u.email);
  if (body?.to_sdo === true) for (const u of await findUsersForStore(supa, audit.store_number, ["sdo"])) if (u.email) emails.add(u.email);
  if (body?.to_self === true && user.email) emails.add(user.email);
  for (const e of Array.isArray(body?.extra_emails) ? body.extra_emails : []) {
    const em = sanitize(e, 200);
    if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) emails.add(em);
  }

  const { data: allIssues } = await supa.from("site_audit_issues").select("*").eq("audit_id", auditId).order("created_at");
  // The auditor can edit the report before sending: an optional cover message
  // and a chosen subset of issues to include. When issue_ids is present we
  // honor it exactly (even an empty selection); otherwise all issues go.
  let issues = allIssues || [];
  if (Array.isArray(body?.issue_ids)) {
    const keep = new Set(body.issue_ids.map((x) => String(x)));
    issues = issues.filter((i) => keep.has(String(i.id)));
  }
  const message = sanitize(body?.message, 4000);
  const stats = auditStats(issues);
  const recipients = Array.from(emails);
  let sent = false;
  if (recipients.length) {
    // Build a PDF of the issues + photos and attach it. Best-effort and
    // time-boxed: a slow/failed build never blocks the email itself.
    let attachments;
    try {
      const pdf = await withTimeout(buildReportPdf(supa, audit, issues, stats, displayName(user), message), 9000);
      if (pdf?.length) attachments = [{ filename: `Site-Audit-${audit.store_number}-${audit.date}.pdf`, content: pdf.toString("base64") }];
    } catch { /* send without the PDF rather than fail */ }
    try {
      const res = await sendEmail({
        to: recipients,
        subject: `Site Audit — Store #${audit.store_number} · ${audit.date}`,
        html: reportHtml(audit, issues, stats, displayName(user), message),
        attachments,
      });
      sent = res?.sent !== false;
    } catch { /* best-effort — still record the report */ }
  }

  await supa.from("site_audit_reports").insert({
    audit_id: auditId, signature_url: sigPath, signed_by: user.id, signed_by_name: displayName(user),
    recipients: recipients.map((email) => ({ email })), status: sent ? "sent" : "queued",
  });
  await supa.from("site_audits").update({ status: "shared", updated_at: new Date().toISOString() }).eq("id", auditId);
  return { ok: true, recipients: recipients.length, sent };
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return respond(204, {});
  let user;
  try { user = await getSessionUser(event); }
  catch (e) { return respond(500, { error: e.message || "auth failed" }); }
  if (!user) return respond(401, { error: "unauthorized" });

  const params = event.queryStringParameters || {};
  const action = params.action || "list";
  let body = {};
  if (event.httpMethod === "POST") { try { body = JSON.parse(event.body || "{}"); } catch { body = {}; } }

  try {
    const supa = admin();
    if (event.httpMethod === "GET") {
      if (action === "list") return unwrap(await listAudits(supa, user));
      if (action === "stores") return unwrap(await listStores(supa, user));
      return respond(400, { error: `Unknown action: ${action}` });
    }
    if (action === "create-audit") return unwrap(await createAudit(supa, user, body));
    if (action === "capture-issue") return unwrap(await captureIssue(supa, user, body));
    if (action === "update-issue") return unwrap(await updateIssue(supa, user, body));
    if (action === "resolve-issue") return unwrap(await resolveIssue(supa, user, body));
    if (action === "delete-issue") return unwrap(await deleteIssue(supa, user, body));
    if (action === "delete-audit") return unwrap(await deleteAudit(supa, user, body));
    if (action === "share-report") return unwrap(await shareReport(supa, user, body));
    return respond(400, { error: `Unknown action: ${action}` });
  } catch (e) {
    return respond(500, { error: e.message || "server error" });
  }
};

// Stores the caller can start an audit at (for the New Audit picker).
async function listStores(supa, user) {
  const scope = await storesForUser(supa, user);
  const rows = (scope.rows || []).slice().sort((a, b) => String(a.number).localeCompare(String(b.number), undefined, { numeric: true }));
  return { stores: rows.map((s) => ({ id: s.id, number: String(s.number), name: s.name })), can_write: CAPTURE_ROLES.has(String(user.role)) };
}
