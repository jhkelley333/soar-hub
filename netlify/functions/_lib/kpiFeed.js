// Shared fetch for the Expressway KPI feed. Builds the URL from env (stripping
// any token already on it), time-boxes the request, and returns the parsed
// payload. Throws a readable Error on any failure.

const KPI_URL = process.env.SKUNKWORKS_KPI_URL;
const KPI_TOKEN = process.env.SKUNKWORKS_KPI_TOKEN;

export function kpiConfigured() {
  return Boolean(KPI_URL && KPI_TOKEN);
}

// A failure that a retry can never fix (bad config, login wall). Carries
// `.fatal = true` so the retry loop rethrows it immediately.
function fatal(message) {
  const e = new Error(message);
  e.fatal = true;
  return e;
}

// Single attempt. Throws with `.fatal` set for unretryable cases (config,
// login-redirect); everything else (5xx, timeout, transient interstitial /
// non-JSON) throws a plain Error the caller retries.
async function attemptFetch(url, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" }, signal: ctrl.signal });
    const text = await res.text();
    if (!res.ok) throw new Error(`KPI feed responded ${res.status}: ${text.slice(0, 200)}`);
    try { return JSON.parse(text); }
    catch {
      const ct = res.headers.get("content-type") || "unknown";
      const body = text.trim();
      // A redirect to an accounts/login URL means the feed is bouncing us to a
      // sign-in wall — the URL/token (or a Google Apps Script web app's
      // deployment access) needs fixing, not a retry.
      const redirect = body.match(/<meta[^>]*http-equiv=["']?refresh["']?[^>]*content=["'][^"']*url=([^"'>]+)/i);
      if (redirect || /accounts\.google\.com|\/login|sign[\s-]?in/i.test(body.slice(0, 400))) {
        const to = redirect ? ` → ${redirect[1].slice(0, 160)}` : "";
        throw fatal(`KPI feed redirected to a login/redirect page${to}. The feed URL/token (or its web-app deployment access) needs updating — retrying won't help.`);
      }
      // Otherwise a transient HTML interstitial / gateway notice — retryable.
      const snippet = body.slice(0, 180).replace(/\s+/g, " ");
      throw new Error(`KPI feed returned non-JSON (content-type ${ct}): ${snippet || "<empty body>"}`);
    }
  } catch (e) {
    if (e?.name === "AbortError") throw new Error("KPI feed timed out.");
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// Fetch the feed with retries. The feed intermittently serves an HTML
// "please wait / refreshing" interstitial or a 5xx instead of JSON — the
// scheduled capture already retries past that; this shared helper now does
// too, so a single blip no longer fails a manual refresh. A definitive
// login-redirect (fatal) is rethrown without retrying.
export async function fetchKpiFeed({ timeoutMs = 12000, attempts = 3 } = {}) {
  if (!KPI_URL || !KPI_TOKEN) {
    throw new Error("KPI feed isn't configured (SKUNKWORKS_KPI_URL + SKUNKWORKS_KPI_TOKEN).");
  }
  let url;
  try {
    const u = new URL(KPI_URL);
    u.searchParams.delete("token");
    u.searchParams.set("token", KPI_TOKEN);
    url = u.toString();
  } catch {
    throw new Error("SKUNKWORKS_KPI_URL is not a valid URL.");
  }
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await attemptFetch(url, timeoutMs);
    } catch (e) {
      if (e?.fatal) throw e;
      lastErr = e;
      if (i < attempts) await new Promise((r) => setTimeout(r, i * 1500)); // 1.5s, 3s
    }
  }
  throw lastErr;
}
