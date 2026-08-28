// Dead-man's-switch heartbeat ping. Each successful capture pings an external
// cron-monitor (Healthchecks.io, Better Stack, Cronitor, …) via a GET to
// CAPTURE_HEARTBEAT_URL. If the monitor stops hearing pings within its grace
// window, IT sends the alert — so the alerting lives entirely OUTSIDE our infra
// and still fires even when Netlify AND GitHub Actions are both down (exactly
// the failure that silently lost 2026-08-26's labor data).
//
// Set CAPTURE_HEARTBEAT_URL to the monitor's ping URL (e.g. a Healthchecks.io
// check URL like https://hc-ping.com/<uuid>). Unset → no-op, so this is safe to
// deploy before the monitor exists. Best-effort and never throws: a heartbeat
// ping must never break or slow the capture it reports on.
//
// A trailing path segment can be passed to distinguish sources on monitors that
// support sub-checks (Healthchecks "slugs") — e.g. pingHeartbeat("labor").
export async function pingHeartbeat(tag = "") {
  const base = process.env.CAPTURE_HEARTBEAT_URL;
  if (!base) return { pinged: false, reason: "CAPTURE_HEARTBEAT_URL not set" };
  const url = tag ? `${base.replace(/\/+$/, "")}/${encodeURIComponent(tag)}` : base;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    await fetch(url, { method: "GET", signal: ctrl.signal });
    return { pinged: true };
  } catch (e) {
    // A missed heartbeat ping is itself harmless — the monitor just won't hear
    // this one; the next successful capture pings again. Log, never throw.
    console.log(`[heartbeat] ping failed: ${e?.name === "AbortError" ? "timed out" : e?.message || e}`);
    return { pinged: false, reason: e?.message || String(e) };
  } finally {
    clearTimeout(timer);
  }
}
