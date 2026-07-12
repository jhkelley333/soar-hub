// Ranking config loader. ranking_config is append-only and versioned by
// effective_from; a run resolves, per key, the newest row whose
// effective_from is on/before the run's week-ending date, and stamps the
// slice's version (max effective_from used) so re-running P7-W1 next year
// reproduces P7-W1 (brief section 2.5).

// Pure resolver — rows: [{ key, value, effective_from }] -> { values, version }.
export function resolveConfigSlice(rows, asOf) {
  const byKey = new Map();
  for (const r of rows || []) {
    if (!r?.key || !r.effective_from || r.effective_from > asOf) continue;
    const cur = byKey.get(r.key);
    if (!cur || r.effective_from > cur.effective_from) byKey.set(r.key, r);
  }
  const values = {};
  let version = null;
  for (const [k, r] of byKey) {
    values[k] = r.value;
    if (!version || r.effective_from > version) version = r.effective_from;
  }
  return { values, version };
}

// Band keys the engine consumes (bands.shops is info-only, kept for the UI).
const BAND_KEYS = [
  "sales_vs_ly", "food_cost", "bsc_training", "on_time",
  "complaints", "food_safety", "vog", "total_training", "shops",
];

export async function loadRankingConfig(supa, asOfDate) {
  const { data, error } = await supa
    .from("ranking_config")
    .select("key, value, effective_from")
    .lte("effective_from", asOfDate);
  if (error) throw new Error(`ranking_config read failed: ${error.message}`);
  const { values, version } = resolveConfigSlice(data, asOfDate);
  const bands = {};
  for (const k of BAND_KEYS) {
    const v = values[`bands.${k}`];
    if (Array.isArray(v)) bands[k] = v;
  }
  return {
    bands,
    avgWage: Number(values["avg_wage"]?.amount) || null,
    dryRun: values["distribution.dry_run"]?.enabled !== false, // default SAFE (dry run)
    testEmail: values["distribution.test_email"]?.email || null,
    configVersion: version,
  };
}
