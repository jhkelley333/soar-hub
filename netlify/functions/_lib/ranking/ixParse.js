// Inventory Expressway category-export parser (ranking source `ix`).
// The CSV carries a full hierarchy: company total, RVP rollups (Region
// Group), SDO rollups (Region), DO rollups (District), and store rows
// ("4871 - Ankeny"). The engine prefers these measured rollups over
// recomputed ones (brief section 6), so every level is kept.
//
// Scoring uses the "Ttl Food (Group)" category rows; other categories in
// the file are skipped (counted, not stored).

// Minimal quote-aware CSV split (server-side; client has its own in lib/csv).
function csvRows(text) {
  const rows = [];
  let cur = [], field = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { cur.push(field); field = ""; }
    else if (c === "\r") { /* skip */ }
    else if (c === "\n") { cur.push(field); if (cur.length > 1 || cur[0] !== "") rows.push(cur); cur = []; field = ""; }
    else field += c;
  }
  if (field.length || cur.length) { cur.push(field); if (cur.length > 1 || cur[0] !== "") rows.push(cur); }
  return rows;
}

const num = (v) => {
  const n = Number(String(v ?? "").replace(/[$,%\s]/g, "").replace(/,/g, ""));
  return isFinite(n) && String(v ?? "").trim() !== "" ? n : null;
};

// 'Danny Matar-RVP' -> 'Danny Matar' (matches the run's org leader names).
const stripSuffix = (s) => String(s || "").replace(/-(RVP|SDO|DO)\s*$/i, "").trim();

// '07-05-2026' -> '2026-07-05'
function isoFromUs(d) {
  const m = /^(\d{2})-(\d{2})-(\d{4})/.exec(String(d || "").trim());
  return m ? `${m[3]}-${m[1]}-${m[2]}` : null;
}

export function parseIxCsv(text) {
  const rows = csvRows(String(text));
  if (rows.length < 2) throw new Error("Empty or unreadable CSV.");
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const idx = (name) => header.indexOf(name.toLowerCase());
  const col = {
    status: idx("Status"),
    date: idx("Cycle End Date"),
    rvp: idx("Region Group"),
    sdo: idx("Region"),
    district: idx("District"),
    store: idx("Store"),
    category: idx("Category"),
    netSales: idx("MTD Net Sales"),
    ending: idx("MTD Ending $"),
    variance: idx("MTD $ Variance"),
    eff: idx("MTD_Efficiency"),
    doh: idx("DOH"),
    excess: idx("Excess $"),
  };
  if (col.store < 0 || col.eff < 0 || col.category < 0) {
    throw new Error("Doesn't look like an IX category export — missing Store / Category / MTD_Efficiency columns.");
  }

  const out = [];
  let weekEnding = null;
  let flashCount = 0;
  let skippedCategories = 0;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const category = (r[col.category] ?? "").trim();
    if (!/^ttl food/i.test(category)) { skippedCategories++; continue; }
    if (!weekEnding && col.date >= 0) weekEnding = isoFromUs(r[col.date]);

    const storeCell = (r[col.store] ?? "").trim();
    const district = (r[col.district] ?? "").trim();
    const sdo = (r[col.sdo] ?? "").trim();
    const rvp = (r[col.rvp] ?? "").trim();
    const level = storeCell ? "store" : district ? "do" : sdo ? "sdo" : rvp ? "rvp" : "company";
    const status = (r[col.status] ?? "").trim();
    if (status.toLowerCase() === "flash") flashCount++;

    const effRaw = num(r[col.eff]);
    const variance = num(r[col.variance]);
    out.push({
      level,
      store_code: level === "store" ? (storeCell.match(/^\s*(\d+)/)?.[1] ?? storeCell) : null,
      store_label: level === "store" ? storeCell : null,
      leader: level === "do" ? stripSuffix(district) : level === "sdo" ? stripSuffix(sdo) : level === "rvp" ? stripSuffix(rvp) : level === "company" ? "SOAR QSR" : null,
      category,
      status,
      net_sales: num(r[col.netSales]),
      ending_dollars: num(r[col.ending]),
      fc_variance: variance,
      // Positive dollars MISSED: actual above ideal -> negative variance.
      // A saving row misses $0 (dollar misses are absolute, DEVIATIONS A).
      fc_miss: variance == null ? null : Math.max(0, -variance),
      cogs_eff: effRaw == null ? null : effRaw / 100, // 96.19 -> 0.9619 (fraction, engine unit)
      doh: num(r[col.doh]),
      excess_dollars: num(r[col.excess]),
    });
  }
  if (!out.length) throw new Error("No 'Ttl Food (Group)' rows found in the file.");
  return { weekEnding, rows: out, flashCount, skippedCategories };
}
