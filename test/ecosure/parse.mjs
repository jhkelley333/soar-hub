/**
 * Offline tests for the EcoSure xlsx parser logic.
 *
 * Tests the parsing functions in isolation using synthetic data,
 * without real xlsx files or Supabase connections.
 *
 * Run:  node test/ecosure/parse.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";

// ── Inline copies of the parser utilities under test ─────────────────────────
// (Duplicated here so tests run from the SOAR Hub repo without depending on
//  the scrapekit connector's local path. Keep in sync with parser.js.)

function normalizeDate(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const slash = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash) {
    const [, m, d, y] = slash;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  return null;
}

function parseScore(raw) {
  if (raw == null || raw === "") return null;
  const n = parseFloat(String(raw).replace(/[^0-9.]/g, ""));
  return isNaN(n) ? null : n;
}

function parseCount(raw) {
  if (raw == null || raw === "") return null;
  const n = parseInt(String(raw), 10);
  return isNaN(n) ? null : n;
}

// Minimal parser that accepts plain object rows (bypasses xlsx I/O)
function parseAssessmentRows(rows) {
  const pulledAt = "2024-11-15T00:00:00.000Z";
  return rows
    .map((row) => {
      const storeNumber    = String(row["Store Number"] ?? "").trim();
      const assessmentDate = normalizeDate(row["Assessment Date"]);
      const visitType      = String(row["Visit Type"] ?? "").trim();
      if (!storeNumber || !assessmentDate || !visitType) return null;
      return {
        store_number:      storeNumber,
        assessment_date:   assessmentDate,
        visit_type:        visitType,
        visit_score:       parseScore(row["Visit Score"]),
        visit_rating:      row["Visit Rating"] || null,
        total_findings:    parseCount(row["Total Findings"]),
        imminent_risk:     parseCount(row["Imminent Risk"]),
        critical_findings: parseCount(row["Critical Findings"]),
        major_findings:    parseCount(row["Major Findings"]),
        minor_findings:    parseCount(row["Minor Findings"]),
        category_score:    parseScore(row["Category Score"]),
        category_rating:   row["Category Rating"] || null,
        report_url:        row["Report URL"] || null,
        l3_entity:         row["L3 Name"] || null,
        l4_market:         row["L4 Name"] || null,
        pulled_at:         pulledAt,
      };
    })
    .filter(Boolean);
}

function parseFindingRows(rows) {
  const pulledAt = "2024-11-15T00:00:00.000Z";
  return rows
    .map((row) => {
      const storeNumber    = String(row["Store Number"] ?? "").trim();
      const assessmentDate = normalizeDate(row["Assessment Date"]);
      const questionNumber = String(row["Question Number"] ?? "").trim();
      if (!storeNumber || !assessmentDate || !questionNumber) return null;
      return {
        store_number:         storeNumber,
        assessment_date:      assessmentDate,
        question_number:      questionNumber,
        standard_description: row["Standard Description"] || null,
        primary_response:     row["Primary Response"] || null,
        primary_comment:      row["Primary Comment"] || null,
        pdc_response:         row["PDC Response"] || null,
        pdc_comment:          row["PDC Comment"] || null,
        pulled_at:            pulledAt,
      };
    })
    .filter(Boolean);
}

// ── normalizeDate ─────────────────────────────────────────────────────────────

test("normalizeDate: ISO passthrough", () => {
  assert.equal(normalizeDate("2024-11-01"), "2024-11-01");
});

test("normalizeDate: M/D/YYYY slash format", () => {
  assert.equal(normalizeDate("11/1/2024"), "2024-11-01");
});

test("normalizeDate: MM/DD/YYYY slash format", () => {
  assert.equal(normalizeDate("11/15/2024"), "2024-11-15");
});

test("normalizeDate: returns null for empty string", () => {
  assert.equal(normalizeDate(""), null);
});

test("normalizeDate: returns null for null", () => {
  assert.equal(normalizeDate(null), null);
});

// ── parseScore ────────────────────────────────────────────────────────────────

test("parseScore: plain number string", () => {
  assert.equal(parseScore("87.18"), 87.18);
});

test("parseScore: strips trailing %", () => {
  assert.equal(parseScore("87.18%"), 87.18);
});

test("parseScore: returns null for empty", () => {
  assert.equal(parseScore(""), null);
});

test("parseScore: returns null for null", () => {
  assert.equal(parseScore(null), null);
});

test("parseScore: handles integer string", () => {
  assert.equal(parseScore("95"), 95);
});

// ── parseCount ────────────────────────────────────────────────────────────────

test("parseCount: parses integer", () => {
  assert.equal(parseCount("3"), 3);
});

test("parseCount: returns null for empty", () => {
  assert.equal(parseCount(""), null);
});

test("parseCount: truncates decimal", () => {
  assert.equal(parseCount("3.9"), 3);
});

// ── parseAssessmentRows ───────────────────────────────────────────────────────

test("parseAssessmentRows: maps columns correctly", () => {
  const rows = [
    {
      "L3 Name":           "SOAR Inc",
      "L4 Name":           "Dallas",
      "Store Number":      "1234",
      "Store Name":        "Test Store",
      "Assessment Date":   "11/1/2024",
      "Visit Type":        "1 - Routine",
      "Visit Score":       "92.5",
      "Visit Rating":      "Low Risk",
      "Total Findings":    "2",
      "Imminent Risk":     "0",
      "Critical Findings": "0",
      "Major Findings":    "1",
      "Minor Findings":    "1",
      "Category Score":    "88.0",
      "Category Rating":   "Moderate Risk",
      "Report URL":        "https://analyticsdocs.trueview.ecosure.com/report/abc",
    },
  ];
  const result = parseAssessmentRows(rows);
  assert.equal(result.length, 1);
  const r = result[0];
  assert.equal(r.store_number, "1234");
  assert.equal(r.assessment_date, "2024-11-01");
  assert.equal(r.visit_type, "1 - Routine");
  assert.equal(r.visit_score, 92.5);
  assert.equal(r.visit_rating, "Low Risk");
  assert.equal(r.total_findings, 2);
  assert.equal(r.imminent_risk, 0);
  assert.equal(r.major_findings, 1);
  assert.equal(r.minor_findings, 1);
  assert.equal(r.l3_entity, "SOAR Inc");
  assert.equal(r.l4_market, "Dallas");
  assert.equal(r.report_url, "https://analyticsdocs.trueview.ecosure.com/report/abc");
});

test("parseAssessmentRows: skips row missing store_number", () => {
  const rows = [{ "Store Number": "", "Assessment Date": "11/1/2024", "Visit Type": "1 - Routine" }];
  assert.equal(parseAssessmentRows(rows).length, 0);
});

test("parseAssessmentRows: skips row missing assessment_date", () => {
  const rows = [{ "Store Number": "1234", "Assessment Date": "", "Visit Type": "1 - Routine" }];
  assert.equal(parseAssessmentRows(rows).length, 0);
});

test("parseAssessmentRows: drops 'Applied filters' footer row", () => {
  // Simulates what readXlsx() does before calling parseAssessmentRows
  const allRows = [
    { "Store Number": "1234", "Assessment Date": "11/1/2024", "Visit Type": "1 - Routine",
      "Visit Score": "90", "Visit Rating": "Low Risk", "Total Findings": "1",
      "Imminent Risk": "0", "Critical Findings": "0", "Major Findings": "1", "Minor Findings": "0" },
    { "Store Number": "Applied filters: Date: Last 30 Days, Region: All", "Assessment Date": "", "Visit Type": "" },
  ];
  // The filter step (mirrors readXlsx)
  const dataRows = allRows.filter((row) => {
    const first = String(row["Store Number"] ?? "").trim();
    return first !== "" && !first.startsWith("Applied filters");
  });
  const result = parseAssessmentRows(dataRows);
  assert.equal(result.length, 1);
  assert.equal(result[0].store_number, "1234");
});

// ── parseFindingRows ──────────────────────────────────────────────────────────

test("parseFindingRows: maps columns correctly", () => {
  const rows = [
    {
      "Store Number":         "1234",
      "Assessment Date":      "11/1/2024",
      "Question Number":      "CS.2",
      "Standard Description": "Food contact surfaces clean",
      "Primary Response":     "No",
      "Primary Comment":      "Prep table had residue",
      "PDC Response":         "No",
      "PDC Comment":          "Will retrain",
    },
  ];
  const result = parseFindingRows(rows);
  assert.equal(result.length, 1);
  const f = result[0];
  assert.equal(f.store_number, "1234");
  assert.equal(f.assessment_date, "2024-11-01");
  assert.equal(f.question_number, "CS.2");
  assert.equal(f.standard_description, "Food contact surfaces clean");
  assert.equal(f.primary_response, "No");
  assert.equal(f.pdc_comment, "Will retrain");
});

test("parseFindingRows: skips Non Scored Finding (blank question_number)", () => {
  const rows = [
    {
      "Store Number": "1234",
      "Assessment Date": "11/1/2024",
      "Question Number": "",
      "Standard Description": "Non Scored Finding",
      "Primary Response": "Yes",
    },
  ];
  assert.equal(parseFindingRows(rows).length, 0);
});

test("parseFindingRows: handles null PDC fields", () => {
  const rows = [
    {
      "Store Number": "1234",
      "Assessment Date": "11/1/2024",
      "Question Number": "TT.1",
      "Standard Description": "Temperature",
      "Primary Response": "Cured in the moment",
    },
  ];
  const result = parseFindingRows(rows);
  assert.equal(result.length, 1);
  assert.equal(result[0].pdc_response, null);
  assert.equal(result[0].pdc_comment, null);
});

test("parseFindingRows: multiple findings for same assessment deduped by question", () => {
  const rows = Array.from({ length: 5 }, (_, i) => ({
    "Store Number": "1234",
    "Assessment Date": "11/1/2024",
    "Question Number": `CS.${i + 1}`,
    "Standard Description": `Standard ${i + 1}`,
    "Primary Response": "No",
  }));
  const result = parseFindingRows(rows);
  assert.equal(result.length, 5);
  assert.equal(result[0].question_number, "CS.1");
  assert.equal(result[4].question_number, "CS.5");
});
