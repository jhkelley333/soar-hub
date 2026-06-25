// Best-effort append to kpi_pull_log. Never throws — logging a pull must not
// break the pull itself.
export async function logPull(supa, row) {
  try {
    await supa.from("kpi_pull_log").insert({ ...row, created_at: new Date().toISOString() });
  } catch (e) {
    console.log(`[pull-log] insert failed: ${e?.message || e}`);
  }
}
