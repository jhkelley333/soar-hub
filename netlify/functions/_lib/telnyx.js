// Telnyx SMS — minimal outbound helper. Used by PAF to text an approver a
// heads-up when a quick response is needed. Outbound only (no inbound webhook).
//
// Env: TELNYX_API_KEY (required) + one sender:
//   TELNYX_FROM_NUMBER (E.164, e.g. +14695551234)  — or —
//   TELNYX_MESSAGING_PROFILE_ID (lets Telnyx pick a number on the profile)

const KEY = process.env.TELNYX_API_KEY;
const FROM = process.env.TELNYX_FROM_NUMBER;
const PROFILE = process.env.TELNYX_MESSAGING_PROFILE_ID;

export function telnyxConfigured() {
  return !!KEY && (!!FROM || !!PROFILE);
}

// 10-digit US numbers (how profiles store phone) -> E.164. Pass-through if it
// already looks like E.164.
export function toE164(raw) {
  const s = String(raw || "").trim();
  if (s.startsWith("+")) return s.replace(/[^\d+]/g, "");
  const d = s.replace(/\D/g, "");
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  return null;
}

export async function sendSms(to, text) {
  if (!KEY) return { ok: false, error: "Telnyx isn't configured (set TELNYX_API_KEY)." };
  if (!FROM && !PROFILE) return { ok: false, error: "Set TELNYX_FROM_NUMBER or TELNYX_MESSAGING_PROFILE_ID." };
  const e164 = toE164(to);
  if (!e164) return { ok: false, error: "No valid phone number to text." };

  const payload = { to: e164, text: String(text || "").slice(0, 1500) };
  if (FROM) payload.from = FROM;
  else payload.messaging_profile_id = PROFILE;

  try {
    const res = await fetch("https://api.telnyx.com/v2/messages", {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      return { ok: false, error: `Telnyx ${res.status}: ${t.slice(0, 180)}` };
    }
    const j = await res.json().catch(() => ({}));
    return { ok: true, id: j?.data?.id ?? null };
  } catch (e) {
    return { ok: false, error: e.message || "Telnyx request failed." };
  }
}
