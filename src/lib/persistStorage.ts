// Ask the browser to make this origin's storage *durable* so the OS won't
// silently evict it under storage pressure or an ITP-style cap. This is the
// piece that keeps people logged in: the Supabase session lives in
// localStorage and the offline data cache lives in IndexedDB, and a durable
// bucket is far less likely to be cleared out from under an installed PWA.
//
// Installed PWAs (Home Screen) are usually auto-granted; a plain browser tab
// may be denied — that's fine, we just ask and log the outcome. Best-effort,
// never throws.
export async function requestPersistentStorage(): Promise<void> {
  try {
    if (typeof navigator === "undefined" || !navigator.storage?.persist) return;
    // Already durable? Nothing to do — don't re-prompt.
    if (navigator.storage.persisted && (await navigator.storage.persisted())) return;
    const granted = await navigator.storage.persist();
    console.info(`[storage] persistent storage ${granted ? "granted" : "denied"}`);
  } catch {
    // API unavailable / blocked (private mode, etc.) — storage just stays
    // best-effort. Never let this break boot.
  }
}
