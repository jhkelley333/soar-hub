// netlify/functions/resources.js
//
// Resource library — Google Drive-backed file browser, gated to
// signed-in users (gm/do/sdo/rvp/vp/coo/admin) via Supabase JWT.
//
// Adapted from the previous (cookie-auth) implementation. Now matches
// the auth pattern used by paf.js / org-mgmt.js: Bearer token →
// supabase.auth.getUser(token) → profile lookup. Drive credentials
// continue to live in GOOGLE_SERVICE_ACCOUNT_JSON.
//
// Actions:
//   GET ?action=getFolder&folderId=<id>   -> folder contents
//   GET ?action=search&q=<query>          -> recursive name search

import { google } from "googleapis";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Override the root via env if you ever swap the Drive folder; defaults
// to the existing Operations Library root so this is drop-in.
const ROOT_FOLDER_ID = process.env.RESOURCES_ROOT_FOLDER_ID
  || "1E7ATygR2gg2CKny8NFhjVhee68HbsVkQ";

// Folders we never want surfacing to anyone via this UI, even though
// the service account can see them in Drive.
const EXCLUDED_NAMES = new Set(["Soar Hub User Data"]);

// Same role set the React route is gated to. Keep in sync with
// src/app/router.tsx's `requireRoles` for /resources.
const RESOURCES_ROLES = new Set([
  "gm", "do", "sdo", "rvp", "vp", "coo", "admin",
]);

function supabaseAdmin() {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error("resources env vars not configured");
  }
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function getSessionUser(event) {
  const header = event.headers?.authorization || event.headers?.Authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  if (!token) return null;

  const supa = supabaseAdmin();
  const { data: userRes, error: userErr } = await supa.auth.getUser(token);
  if (userErr || !userRes?.user) return null;

  const { data: profile } = await supa
    .from("profiles")
    .select("id, email, full_name, role, is_active")
    .eq("id", userRes.user.id)
    .single();
  if (!profile || !profile.is_active) return null;
  return profile;
}

function respond(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

function getDrive() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON not set");
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(raw),
    scopes: ["https://www.googleapis.com/auth/drive.readonly"],
  });
  return google.drive({ version: "v3", auth });
}

function fileIcon(mimeType, name) {
  if (mimeType === "application/vnd.google-apps.folder") return "📁";
  if (mimeType === "application/vnd.google-apps.spreadsheet") return "📊";
  if (mimeType === "application/vnd.google-apps.document") return "📄";
  if (mimeType === "application/vnd.google-apps.presentation") return "📑";
  if (mimeType === "application/vnd.google-apps.form") return "📋";
  if (mimeType === "application/pdf") return "📕";
  if (mimeType?.startsWith("image/")) return "🖼";
  if (mimeType?.startsWith("video/")) return "🎬";
  if (mimeType?.startsWith("audio/")) return "🎵";
  const ext = (name || "").split(".").pop()?.toLowerCase() ?? "";
  if (["xls", "xlsx"].includes(ext)) return "📊";
  if (["doc", "docx"].includes(ext)) return "📄";
  if (["ppt", "pptx"].includes(ext)) return "📑";
  return "📎";
}

function fileUrl(file) {
  if (file.mimeType === "application/vnd.google-apps.folder") {
    return `https://drive.google.com/drive/folders/${file.id}`;
  }
  return file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`;
}

function shape(file) {
  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    url: fileUrl(file),
    icon: fileIcon(file.mimeType, file.name),
    isFolder: file.mimeType === "application/vnd.google-apps.folder",
    modifiedTime: file.modifiedTime || "",
    size: file.size || null,
  };
}

// BFS the folder tree so search can walk every subfolder. Cached
// per-request only — the cost is one shallow Drive call per folder,
// which is cheap and avoids stale-cache invalidation problems.
async function getAllFolderIds(drive) {
  const folderIds = [ROOT_FOLDER_ID];
  const queue = [ROOT_FOLDER_ID];
  while (queue.length > 0) {
    const parentId = queue.shift();
    try {
      const res = await drive.files.list({
        q: `'${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
        fields: "files(id)",
        pageSize: 1000,
      });
      for (const f of res.data.files || []) {
        folderIds.push(f.id);
        queue.push(f.id);
      }
    } catch (e) {
      // Skip folders the service account can't read; don't fail the
      // whole search just because one shared folder has tighter ACLs.
    }
  }
  return folderIds;
}

async function actionGetFolder(drive, folderId) {
  const res = await drive.files.list({
    q: `'${folderId}' in parents and trashed=false`,
    fields: "files(id,name,mimeType,webViewLink,modifiedTime,size)",
    orderBy: "folder,name",
    pageSize: 1000,
  });
  const files = (res.data.files || [])
    .filter((f) => !EXCLUDED_NAMES.has(f.name))
    .map(shape);

  let folderName = "Resources";
  if (folderId !== ROOT_FOLDER_ID) {
    try {
      const meta = await drive.files.get({ fileId: folderId, fields: "name" });
      folderName = meta.data.name || "Resources";
    } catch (e) {
      // Folder might exist but be inaccessible; fall back to default name.
    }
  }
  return { files, folderName, folderId, isRoot: folderId === ROOT_FOLDER_ID };
}

async function actionSearch(drive, q) {
  if (!q) return { files: [], folderName: "Search Results" };

  // Drive query strings have a length cap, so batch parent-IN filters
  // 20 folders at a time and union the results client-side.
  const allFolderIds = await getAllFolderIds(drive);
  const BATCH_SIZE = 20;
  const escaped = q.replace(/'/g, "\\'");
  let all = [];

  for (let i = 0; i < allFolderIds.length; i += BATCH_SIZE) {
    const batch = allFolderIds.slice(i, i + BATCH_SIZE);
    const parentQ = batch.map((id) => `'${id}' in parents`).join(" or ");
    const searchQ = `name contains '${escaped}' and trashed=false and (${parentQ})`;
    try {
      const res = await drive.files.list({
        q: searchQ,
        fields: "files(id,name,mimeType,webViewLink,modifiedTime)",
        pageSize: 100,
      });
      all = all.concat(res.data.files || []);
    } catch (e) {
      // Skip individual batch failures.
    }
  }

  const seen = new Set();
  const files = all
    .filter((f) => {
      if (seen.has(f.id)) return false;
      if (EXCLUDED_NAMES.has(f.name)) return false;
      seen.add(f.id);
      return true;
    })
    .map(shape)
    .sort((a, b) => a.name.localeCompare(b.name));

  return { files, folderName: `Search: ${q}`, isRoot: false };
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return respond(204, {});

  let user;
  try {
    user = await getSessionUser(event);
  } catch (e) {
    return respond(500, { ok: false, message: e.message || "auth failed" });
  }
  if (!user) return respond(401, { ok: false, message: "Not authenticated." });
  if (!RESOURCES_ROLES.has(user.role)) {
    return respond(403, { ok: false, message: "Resources is restricted." });
  }

  const params = event.queryStringParameters || {};
  const action = params.action || "getFolder";
  const folderId = params.folderId || ROOT_FOLDER_ID;

  try {
    const drive = getDrive();
    if (action === "getFolder") {
      return respond(200, await actionGetFolder(drive, folderId));
    }
    if (action === "search") {
      const q = (params.q || "").trim();
      return respond(200, await actionSearch(drive, q));
    }
    return respond(400, { ok: false, message: "Unknown action." });
  } catch (err) {
    console.error("resources error:", err);
    return respond(500, { ok: false, message: err?.message || "Server error." });
  }
};
