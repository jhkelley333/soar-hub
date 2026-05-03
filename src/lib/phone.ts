// src/lib/phone.ts
//
// Phone-number normalization + light formatting helpers.
//
// Storage rule (matches profiles.phone CHECK constraint): exactly 10 digits,
// no formatting, no country code prefix. Display is just for humans.

/**
 * Normalize loose user input to 10 digits. Returns null if the result isn't
 * exactly 10 digits after stripping non-digit characters and the leading "1".
 *
 * Accepts:
 *   "2145551234" / "214-555-1234" / "(214) 555-1234" /
 *   "+1 214 555 1234" / "214.555.1234"
 */
export function normalizePhone(input: string): string | null {
  const digits = String(input || "").replace(/\D/g, "");
  // Drop a US country code if present (11 digits, leading 1).
  const trimmed = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (trimmed.length !== 10) return null;
  return trimmed;
}

/** True if the input looks like an email (just checks for an "@"). */
export function looksLikeEmail(input: string): boolean {
  return input.includes("@");
}

/**
 * What the login form is detecting based on what the user typed.
 *   - "email"   : contains "@"
 *   - "phone"   : at least 3 digits, no "@"
 *   - "unknown" : empty / too short to guess
 */
export type IdentifierMode = "email" | "phone" | "unknown";

export function detectMode(input: string): IdentifierMode {
  const v = input.trim();
  if (!v) return "unknown";
  if (looksLikeEmail(v)) return "email";
  const digits = v.replace(/\D/g, "");
  if (digits.length >= 3) return "phone";
  return "unknown";
}

/** "(214) 555-1234" for display. Pass-through if not exactly 10 digits. */
export function formatPhoneForDisplay(value: string | null | undefined): string {
  if (!value) return "";
  const d = String(value).replace(/\D/g, "");
  if (d.length !== 10) return String(value);
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}
