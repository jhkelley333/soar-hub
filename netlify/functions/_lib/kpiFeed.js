// Shared fetch for the Expressway KPI feed. Builds the URL from env (stripping
// any token already on it), time-boxes the request, and returns the parsed
// payload. Throws a readable Error on any failure.

const KPI_URL = process.env.SKUNKWORKS_KPI_URL;
const KPI_TOKEN = process.env.SKUNKWORKS_KPI_TOKEN;

export function kpiConfigured() {
  return Boolean(KPI_URL && KPI_TOKEN);
}

export async function fetchKpiFeed({ timeoutMs = 12000 } = {}) {
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
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" }, signal: ctrl.signal });
    const text = await res.text();
    if (!res.ok) throw new Error(`KPI feed responded ${res.status}: ${text.slice(0, 200)}`);
    try { return JSON.parse(text); }
    catch {
      // Surface what the feed actually returned (HTML error/login page, gateway
      // notice, empty body…) so a non-JSON response is diagnosable, not opaque.
      const ct = res.headers.get("content-type") || "unknown";
      const body = text.trim();
      // A meta-refresh / redirect to an accounts/login URL means the feed is
      // bouncing us to a sign-in wall — the URL or token (or, for a Google
      // Apps Script web app, its deployment access) needs fixing, not a retry.
      const redirect = body.match(/<meta[^>]*http-equiv=["']?refresh["']?[^>]*content=["'][^"']*url=([^"'>]+)/i);
      if (redirect || /accounts\.google\.com|login|sign[\s-]?in/i.test(body.slice(0, 400))) {
        const to = redirect ? ` → ${redirect[1].slice(0, 160)}` : "";
        throw new Error(`KPI feed redirected to a login/redirect page${to}. The feed URL/token (or its web-app deployment access) needs updating — retrying won't help.`);
      }
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
