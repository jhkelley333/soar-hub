/**
 * EcoSure xlsx parser
 *
 * Parses the two xlsx exports from TrueView:
 *   1. List of Assessments  (one row per store visit)
 *   2. Standard Details     (one row per finding per visit)
 *
 * Both files end with an "Applied filters: …" footer row that must be dropped.
 * Manager Name from Non Scored Finding is intentionally skipped.
 *
 * Requires: xlsx (SheetJS)  — npm install xlsx
 */

"use strict";

const XLSX = require("xlsx");

// ── Shared helpers ─────────────────────────────────────────────────────────────

/** Parse an xlsx file and return rows as objects, header-keyed. */
function readXlsx(filePath) {
  const wb = XLSX.readFile(filePath, { cellDates: false, raw: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
  if (raw.length < 2) return [];

  const headers = raw[0].map((h) => String(h ?? "").trim());
  const dataRows = raw.slice(1);

  // Drop the "Applied filters" footer row (may be at the very end)
  const data = dataRows.filter((row) => {
    const first = String(row[0] ?? "").trim();
    return first !== "" && !first.startsWith("Applied filters");
  });

  return data.map((row) => {
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = String(row[i] ?? "").trim();
    });
    return obj;
  });
}

/** Normalize various date formats to YYYY-MM-DD. */
function normalizeDate(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  // Already ISO
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // MM/DD/YYYY or M/D/YYYY
  const slash = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash) {
    const [, m, d, y] = slash;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  // Excel serial number
  const n = Number(s);
  if (!isNaN(n) && n > 10000) {
    const date = XLSX.SSF.parse_date_code(n);
    if (date) {
      return `${date.y}-${String(date.m).padStart(2, "0")}-${String(date.d).padStart(2, "0")}`;
    }
  }
  return null;
}

/** Parse a numeric score string; strip "%" and other non-numeric chars. */
function parseScore(raw) {
  if (raw == null || raw === "") return null;
  const n = parseFloat(String(raw).replace(/[^0-9.]/g, ""));
  return isNaN(n) ? null : n;
}

/** Parse an integer count; return null if blank. */
function parseCount(raw) {
  if (raw == null || raw === "") return null;
  const n = parseInt(String(raw), 10);
  return isNaN(n) ? null : n;
}

// ── Column name normalization ─────────────────────────────────────────────────
// TrueView column names are pretty stable but may have leading/trailing spaces
// or minor casing variations between portal versions.

const COL_ALIASES = {
  store_number:      ["Store Number", "Store #", "StoreNumber"],
  store_name:        ["Store Name", "StoreName"],
  l3_entity:         ["L3 Name", "L3Name"],
  l4_market:         ["L4 Name", "L4Name"],
  assessment_date:   ["Assessment Date", "AssessmentDate", "Visit Date"],
  visit_type:        ["Visit Type", "VisitType"],
  visit_score:       ["Visit Score", "VisitScore", "Score"],
  visit_rating:      ["Visit Rating", "VisitRating", "Rating"],
  total_findings:    ["Total Findings", "TotalFindings"],
  imminent_risk:     ["Imminent Risk", "ImminentRisk"],
  critical_findings: ["Critical Findings", "CriticalFindings", "Critical"],
  major_findings:    ["Major Findings", "MajorFindings", "Major"],
  minor_findings:    ["Minor Findings", "MinorFindings", "Minor"],
  category_score:    ["Category Score", "CategoryScore"],
  category_rating:   ["Category Rating", "CategoryRating"],
  report_url:        ["Report URL", "ReportURL", "Report Link", "Report"],
  question_number:   ["Question Number", "QuestionNumber", "Question #"],
  standard_description: ["Standard Description", "StandardDescription", "Description"],
  primary_response:  ["Primary Response", "PrimaryResponse"],
  primary_comment:   ["Primary Comment", "PrimaryComment", "Comment"],
  pdc_response:      ["PDC Response", "PDCResponse"],
  pdc_comment:       ["PDC Comment", "PDCComment"],
};

/** Build a lookup from raw header → canonical key for a given row set. */
function buildColMap(headers) {
  const hSet = new Set(headers);
  const map = {};
  for (const [canonical, aliases] of Object.entries(COL_ALIASES)) {
    const found = aliases.find((a) => hSet.has(a));
    if (found) map[canonical] = found;
  }
  return map;
}

function getCol(row, map, key) {
  return map[key] ? row[map[key]] ?? "" : "";
}

// ── parseAssessmentsXlsx ──────────────────────────────────────────────────────

/**
 * Parse the "List of Assessments" xlsx export.
 * @returns {object[]} Array of objects ready for scrapekit_ecosure_upsert_assessments()
 */
function parseAssessmentsXlsx(filePath) {
  const rows = readXlsx(filePath);
  if (!rows.length) return [];

  const headers = Object.keys(rows[0]);
  const cm = buildColMap(headers);

  const pulledAt = new Date().toISOString();

  return rows
    .map((row) => {
      const storeNumber   = getCol(row, cm, "store_number");
      const assessmentDate = normalizeDate(getCol(row, cm, "assessment_date"));
      const visitType     = getCol(row, cm, "visit_type");

      // Skip rows without the three required fields
      if (!storeNumber || !assessmentDate || !visitType) return null;

      return {
        store_number:      storeNumber,
        assessment_date:   assessmentDate,
        visit_type:        visitType,
        visit_score:       parseScore(getCol(row, cm, "visit_score")),
        visit_rating:      getCol(row, cm, "visit_rating") || null,
        total_findings:    parseCount(getCol(row, cm, "total_findings")),
        imminent_risk:     parseCount(getCol(row, cm, "imminent_risk")),
        critical_findings: parseCount(getCol(row, cm, "critical_findings")),
        major_findings:    parseCount(getCol(row, cm, "major_findings")),
        minor_findings:    parseCount(getCol(row, cm, "minor_findings")),
        category_score:    parseScore(getCol(row, cm, "category_score")),
        category_rating:   getCol(row, cm, "category_rating") || null,
        report_url:        getCol(row, cm, "report_url") || null,
        l3_entity:         getCol(row, cm, "l3_entity") || null,
        l4_market:         getCol(row, cm, "l4_market") || null,
        pulled_at:         pulledAt,
      };
    })
    .filter(Boolean);
}

// ── parseFindingsXlsx ─────────────────────────────────────────────────────────

/**
 * Parse the "Standard Details" xlsx export.
 * Skips rows where question_number is blank (Non Scored Finding catch-all rows).
 * Does NOT include manager name fields.
 * @returns {object[]} Array ready for scrapekit_ecosure_upsert_findings()
 */
function parseFindingsXlsx(filePath) {
  const rows = readXlsx(filePath);
  if (!rows.length) return [];

  const headers = Object.keys(rows[0]);
  const cm = buildColMap(headers);

  const pulledAt = new Date().toISOString();

  return rows
    .map((row) => {
      const storeNumber    = getCol(row, cm, "store_number");
      const assessmentDate = normalizeDate(getCol(row, cm, "assessment_date"));
      const questionNumber = getCol(row, cm, "question_number");

      // Skip Non Scored Finding rows (blank question number)
      if (!storeNumber || !assessmentDate || !questionNumber) return null;

      return {
        store_number:         storeNumber,
        assessment_date:      assessmentDate,
        question_number:      questionNumber,
        standard_description: getCol(row, cm, "standard_description") || null,
        primary_response:     getCol(row, cm, "primary_response") || null,
        primary_comment:      getCol(row, cm, "primary_comment") || null,
        pdc_response:         getCol(row, cm, "pdc_response") || null,
        pdc_comment:          getCol(row, cm, "pdc_comment") || null,
        pulled_at:            pulledAt,
      };
    })
    .filter(Boolean);
}

module.exports = { parseAssessmentsXlsx, parseFindingsXlsx, normalizeDate, parseScore };
