// Shared show_if evaluator for the form renderer. Same DSL on both
// questions and sections — the evaluator doesn't care which.
//
// DSL shape:
//   { show_if: [{ question_id: <uuid>, op: <Op>, value: <unknown> }] }
// Multiple rules are implicit AND.
// Empty/missing show_if → always show (no condition is a true condition).
//
// Operators:
//   eq      — strict equal (after coercion of empty string to null)
//   neq     — strict not-equal
//   in      — value is an array, answer must be one of the entries
//   not_in  — value is an array, answer must NOT be one of the entries
//
// The "answer value" we compare against depends on the source
// question's field_type — see getAnswerValue() below.

import type { TemplateQuestion } from "./types";

type Op = "eq" | "neq" | "in" | "not_in";

type ShowIfRule = {
  question_id: string;
  op: Op;
  value: unknown;
};

type LocalAnswer = {
  question_id: string;
  answer_text?: string | null;
  answer_number?: number | null;
  answer_boolean?: boolean | null;
  answer_date?: string | null;
  answer_json?: unknown;
  audit_result?: "pass" | "fail" | "na" | null;
};

// Pull the answer "value" for comparison from a LocalAnswer, keyed off
// the source question's field type. Returns `null` when the question
// is unanswered — show_if rules that compare to a specific value will
// naturally fail in that case (so dependent fields stay hidden until
// the parent is filled).
export function getAnswerValue(
  answer: LocalAnswer | undefined,
  question: TemplateQuestion | undefined,
): unknown {
  if (!answer || !question) return null;
  switch (question.field_type) {
    case "pass_fail_na":
      return answer.audit_result ?? null;
    case "number":
      return answer.answer_number ?? null;
    case "checkbox":
      return answer.answer_boolean ?? null;
    case "date":
      return answer.answer_date ?? null;
    case "select_many":
      // Array of selected options. Callers should use `in`/`not_in`
      // with single-string `value`, and we treat membership as
      // "any selected option matches".
      return Array.isArray(answer.answer_json) ? (answer.answer_json as unknown[]) : [];
    case "short_text":
    case "long_text":
    case "select_one":
    default:
      return answer.answer_text ?? null;
  }
}

function evalRule(
  rule: ShowIfRule,
  answersByQid: Map<string, LocalAnswer>,
  questionsByQid: Map<string, TemplateQuestion>,
): boolean {
  const q = questionsByQid.get(rule.question_id);
  const a = answersByQid.get(rule.question_id);
  const got = getAnswerValue(a, q);

  // select_many → membership test: does the selected array contain
  // the rule value? Same semantics for `eq`/`in` (and inverse for
  // `neq`/`not_in`). Saves the author having to remember which
  // operator applies to which field type.
  if (Array.isArray(got)) {
    const arr = got as unknown[];
    if (rule.op === "eq")     return arr.includes(rule.value);
    if (rule.op === "neq")    return !arr.includes(rule.value);
    if (rule.op === "in") {
      return Array.isArray(rule.value) && (rule.value as unknown[]).some((v) => arr.includes(v));
    }
    if (rule.op === "not_in") {
      return !(Array.isArray(rule.value) && (rule.value as unknown[]).some((v) => arr.includes(v)));
    }
    return true;
  }

  // Scalar comparisons.
  switch (rule.op) {
    case "eq":     return got === rule.value;
    case "neq":    return got !== rule.value;
    case "in":     return Array.isArray(rule.value) && (rule.value as unknown[]).includes(got);
    case "not_in": return !(Array.isArray(rule.value) && (rule.value as unknown[]).includes(got));
    default:       return true;
  }
}

// Returns true if the row (question or section) should be visible
// given the current answer state. Empty/missing show_if → visible.
// Malformed rules → visible (fail-open; we don't want to silently
// hide content because a value happens to be wrongly typed).
export function shouldShow(
  conditionalLogic: Record<string, unknown> | null | undefined,
  answersByQid: Map<string, LocalAnswer>,
  questionsByQid: Map<string, TemplateQuestion>,
): boolean {
  if (!conditionalLogic) return true;
  const rules = (conditionalLogic as { show_if?: unknown }).show_if;
  if (!Array.isArray(rules) || rules.length === 0) return true;

  for (const raw of rules) {
    const r = raw as Partial<ShowIfRule>;
    if (typeof r?.question_id !== "string" || typeof r?.op !== "string") {
      // Skip malformed rule rather than fail the whole evaluation.
      continue;
    }
    if (!evalRule(r as ShowIfRule, answersByQid, questionsByQid)) {
      return false;
    }
  }
  return true;
}
