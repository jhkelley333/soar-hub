#!/usr/bin/env node
// Sonic ATS export → Team Pipeline roster-import CSV.
//
// The ATS onboarding export doesn't match the roster importer's shape:
// names are split, the store number is buried in the Location string, dates
// are M/D/YYYY, and the Position titles don't line up 1:1 with our 7-role
// ladder. This converts one into the other and prints a mapping summary.
//
//   node scripts/ats-roster-convert.mjs <input.csv> [output.csv]
//
// Mapping decisions (confirmed with the operator, 2026-06):
//   • Carhop/Skating Carhop      → carhop
//   • Team/Crew Member, Cook     → crew
//   • Team/Crew Leader           → lead
//   • Assistant Manager          → assoc  (DEFAULT — title is mixed in
//                                   practice; re-tier individuals in the drawer)
//   • Onboarding* placeholders   → by Department: Management → assoc, else crew
//   • GM/Operating Partner, Market/Multi-Unit Supervisor, VP → EXCLUDED
//   • Everyone imported as status=active.
//
// A stable external_id is synthesized (SONIC-<store>-<LAST>-<FIRST>) so
// re-running updates rows instead of duplicating them.

import { readFileSync, writeFileSync } from "node:fs";

const ASSISTANT_DEFAULT = "assoc"; // Assistant Manager + Management onboarding

// Quote-aware CSV parser (commas + newlines inside quotes, "" escapes).
function parseCSV(text) {
  const rows = [];
  let cur = [], field = "", i = 0, q = false;
  while (i < text.length) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i += 2; continue; } q = false; i++; continue; }
      field += c; i++; continue;
    }
    if (c === '"') { q = true; i++; continue; }
    if (c === ",") { cur.push(field); field = ""; i++; continue; }
    if (c === "\r") { i++; continue; }
    if (c === "\n") { cur.push(field); if (cur.length > 1 || cur[0] !== "") rows.push(cur); cur = []; field = ""; i++; continue; }
    field += c; i++;
  }
  if (field.length > 0 || cur.length > 0) { cur.push(field); if (cur.length > 1 || cur[0] !== "") rows.push(cur); }
  return rows;
}

function csvField(v) {
  const s = String(v ?? "");
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toISODate(s) {
  const m = String(s || "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return "";
  const [, mm, dd, yyyy] = m;
  return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}

function storeNumber(location) {
  // Handles both "Sonic 8100 - ..." and "Sonic - 1832 - ..." (dash variant).
  const m = String(location || "").match(/Sonic\s*-?\s*(\d+)/i);
  return m ? m[1] : "";
}

const EXCLUDE = [/operating partner/i, /general manager/i, /supervisor/i, /multi-?unit/i, /vp\b/i, /accounting/i];

function mapRole(position, department) {
  const p = String(position || "").trim().toLowerCase();
  const mgmt = String(department || "").trim().toLowerCase() === "management";
  if (EXCLUDE.some((re) => re.test(position))) return { role: null, excluded: true };
  if (p.startsWith("onboarding")) return { role: mgmt ? ASSISTANT_DEFAULT : "crew", excluded: false };
  if (/carhop/.test(p)) return { role: "carhop", excluded: false };
  if (/crew leader|team leader|team\/crew leader/.test(p)) return { role: "lead", excluded: false };
  if (/crew member|team member|team\/crew member/.test(p)) return { role: "crew", excluded: false };
  if (/cook/.test(p)) return { role: "crew", excluded: false };
  if (/assistant manager/.test(p)) return { role: ASSISTANT_DEFAULT, excluded: false };
  return { role: null, excluded: false }; // unknown — reported, not written
}

function slug(s) { return String(s || "").trim().toUpperCase().replace(/[^A-Z0-9]+/g, ""); }

const [, , inPath, outPath = "roster-import.csv"] = process.argv;
if (!inPath) { console.error("usage: node scripts/ats-roster-convert.mjs <input.csv> [output.csv]"); process.exit(1); }

const rows = parseCSV(readFileSync(inPath, "utf8"));
const header = rows[0].map((h) => h.replace(/^﻿/, "").trim().toLowerCase());
const col = (name) => header.indexOf(name);
const ci = {
  first: col("first name"), last: col("last name"), loc: col("location"),
  dept: col("department"), pos: col("position"), start: col("start date"),
};

const OUT_HEADERS = ["external_id", "full_name", "store_number", "role", "email", "phone", "status", "hire_date"];
const out = [];
const byRole = {}, excludedByTitle = {};
let unknown = 0, noStore = 0, noDate = 0;

for (let r = 1; r < rows.length; r++) {
  const row = rows[r];
  if (!row || row.every((c) => c.trim() === "")) continue;
  const first = (row[ci.first] || "").trim();
  const last = (row[ci.last] || "").trim();
  const position = (row[ci.pos] || "").trim();
  const department = (row[ci.dept] || "").trim();
  const { role, excluded } = mapRole(position, department);
  if (excluded) { excludedByTitle[position] = (excludedByTitle[position] || 0) + 1; continue; }
  if (!role) { unknown++; continue; }

  const store = storeNumber(row[ci.loc]);
  if (!store) noStore++;
  const hire = toISODate(row[ci.start]);
  if (!hire) noDate++;
  const fullName = `${first} ${last}`.trim();

  out.push({
    external_id: `SONIC-${store || "NA"}-${slug(last)}-${slug(first)}`,
    full_name: fullName, store_number: store, role, email: "", phone: "",
    status: "active", hire_date: hire,
  });
  byRole[role] = (byRole[role] || 0) + 1;
}

const csv = [OUT_HEADERS.join(",")]
  .concat(out.map((o) => OUT_HEADERS.map((h) => csvField(o[h])).join(",")))
  .join("\n") + "\n";
writeFileSync(outPath, csv);

const stores = new Set(out.map((o) => o.store_number).filter(Boolean));
console.log(`\nIn:  ${rows.length - 1} rows`);
console.log(`Out: ${out.length} roster rows → ${outPath}  (${stores.size} stores)`);
console.log("\nRoles:");
for (const [k, v] of Object.entries(byRole).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(8)} ${v}`);
console.log("\nExcluded (title):");
for (const [k, v] of Object.entries(excludedByTitle).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(4)}  ${k}`);
console.log(`\nWarnings: ${noStore} no store#, ${noDate} no/blank start date, ${unknown} unmapped position(s).`);
