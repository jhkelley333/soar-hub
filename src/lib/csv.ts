// src/lib/csv.ts
//
// Tiny CSV utilities. We use these for the bulk-import upload (parse
// pasted/uploaded CSV → rows of named fields) and the My Team export
// (row objects → CSV string for download). Quote-aware enough for
// real-world spreadsheets but not a full RFC4180 implementation —
// fields containing commas, quotes, or newlines are wrapped in double
// quotes with embedded quotes doubled.

/** Serialize a single field for CSV. */
function escapeField(v: string): string {
  const needsQuote = /[",\n\r]/.test(v);
  const inner = v.replace(/"/g, '""');
  return needsQuote ? `"${inner}"` : inner;
}

/**
 * Convert an array of row objects to CSV. Header order is taken from the
 * `headers` argument so the output is stable regardless of object key
 * iteration order.
 */
export function toCSV(headers: string[], rows: Record<string, unknown>[]): string {
  const head = headers.map(escapeField).join(",");
  const body = rows
    .map((r) =>
      headers
        .map((h) => {
          const v = r[h];
          if (v === null || v === undefined) return "";
          return escapeField(String(v));
        })
        .join(",")
    )
    .join("\n");
  return body ? `${head}\n${body}\n` : `${head}\n`;
}

/** Trigger a browser download of the given CSV string. */
export function downloadCSV(filename: string, csv: string) {
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Quote-aware CSV row splitter. Handles \"escaped\" quotes inside fields,
 * commas-in-quotes, and CRLF line endings. Tabs are also treated as
 * column delimiters so users pasting from Google Sheets without
 * downloading first still works.
 */
export function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let i = 0;
  let inQuotes = false;
  // Auto-detect tab vs comma based on the first non-quoted delimiter we see.
  // Default to comma; flip to tab if a tab appears before any comma.
  let delim: "," | "\t" = ",";
  if (text.includes("\t") && !text.split("\n")[0].includes(",")) {
    delim = "\t";
  }

  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === delim) {
      cur.push(field);
      field = "";
      i++;
      continue;
    }
    if (c === "\r") {
      i++;
      continue;
    }
    if (c === "\n") {
      cur.push(field);
      // Skip empty trailing rows.
      if (cur.length > 1 || cur[0] !== "") rows.push(cur);
      cur = [];
      field = "";
      i++;
      continue;
    }
    field += c;
    i++;
  }
  // Flush trailing partial row.
  if (field.length > 0 || cur.length > 0) {
    cur.push(field);
    if (cur.length > 1 || cur[0] !== "") rows.push(cur);
  }
  return rows;
}

/**
 * Parse a CSV with a header row into objects keyed by header name.
 * Trims values and lowercases header names so casing doesn't matter.
 */
export function parseCSVWithHeader(text: string): Record<string, string>[] {
  const rows = parseCSV(text);
  if (rows.length === 0) return [];
  const headers = rows[0].map((h) => h.trim().toLowerCase());
  return rows.slice(1).map((r) => {
    const obj: Record<string, string> = {};
    for (let i = 0; i < headers.length; i++) {
      obj[headers[i]] = (r[i] ?? "").trim();
    }
    return obj;
  });
}
