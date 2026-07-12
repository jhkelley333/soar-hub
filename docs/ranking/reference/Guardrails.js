/**
 * Guardrails.js — per-RVP "WHAT NEEDS ATTENTION" Action Report block.
 * Pure row-building (no sheet writes) so LeaderTabs and EmailReports can both
 * consume it. Compact one-page-landscape layout when exported.
 */

/** Score categories checked for red flags (score === 1). */
var GUARD_CATEGORIES_ = [
  { scoreKey: 'salesScore', metricKey: 'pctVsLy', label: 'Sales vs LY', fmt: 'pct' },
  { scoreKey: 'fcScore', metricKey: 'cogsEff', label: 'Food Cost Eff', fmt: 'pct' },
  { scoreKey: 'laborScore', metricKey: 'varianceToChart', label: 'Labor vs Chart', fmt: 'pct' },
  { scoreKey: 'bscScore', metricKey: 'bscTrainingPct', label: 'BSC Training', fmt: 'pct' },
  { scoreKey: 'onTimeScore', metricKey: 'onTimePct', label: 'On Time', fmt: 'pct' },
  { scoreKey: 'complaintsScore', metricKey: 'callsPer10k', label: 'Complaints /10k', fmt: 'num' },
  { scoreKey: 'ecosureScore', metricKey: 'ecosure', label: 'EcoSure', fmt: 'pct' },
  { scoreKey: 'vogScore', metricKey: 'vog', label: 'VOG', fmt: 'pct' },
  { scoreKey: 'totalTrainingScore', metricKey: 'totalTrainingPct', label: 'Total Training', fmt: 'pct' }
];

/** Outlier metrics (>2σ WORSE than company mean). `dir`: 1 = higher is worse. */
var GUARD_OUTLIER_METRICS_ = [
  { key: 'laborPct', label: 'Labor %', dir: 1, fmt: 'pct' },
  { key: 'cogsEff', label: 'COGS Eff %', dir: -1, fmt: 'pct' },
  { key: 'voidsPct', label: 'Voids %', dir: 1, fmt: 'pct' },
  { key: 'onTimePct', label: 'On Time %', dir: -1, fmt: 'pct' }
];

/** Sources checked for missing reporting per store. */
var GUARD_SOURCE_FIELDS_ = [
  { key: 'ix', label: 'IX (COGS/DOH)', field: 'cogsEff' },
  { key: 'ecosure', label: 'EcoSure', field: 'ecosure' },
  { key: 'vog', label: 'VOG', field: 'vog' },
  { key: 'bsc', label: 'BSC Training', field: 'bscTrainingPct' }
];

/**
 * Build the Action Report rows for one RVP.
 * @param {string} rvpName e.g. 'Danny Matar-RVP'
 * @param {Object} result Engine result (uses result.ptd)
 * @param {Object=} sourceStatus per-source freshness map (inputs.meta.sourceStatus)
 * @return {Array<Array>} 2D rows (max 6 wide), ready to write
 */
function buildActionReport(rvpName, result, sourceStatus) {
  var all = (result.ptd && result.ptd.stores) || [];
  var mine = all.filter(function (s) { return s.rvpName === rvpName; });
  var rows = [];

  rows.push(['WHAT NEEDS ATTENTION — ' + cleanLeaderName_(rvpName) +
    ' (' + mine.length + ' stores)', '', '', '', '', '']);

  // ---- (a) MISSING REPORTING ----
  rows.push(['MISSING REPORTING']);
  var anyMissing = false;
  GUARD_SOURCE_FIELDS_.forEach(function (src) {
    // whole source empty? say so once instead of listing every store
    var st = sourceStatus && (sourceStatus[src.key] || sourceStatus[src.key === 'bsc' ? 'bscTraining' : src.key]);
    if (st && st.empty) {
      rows.push(['', src.label, 'SOURCE NOT LOADED (' + (st.tab || '') + ')']);
      anyMissing = true;
      return;
    }
    var missing = mine.filter(function (s) {
      var v = s[src.field];
      return v === null || v === undefined || v === '' || v === 'No Audit';
    }).map(function (s) { return s.store; });
    if (missing.length) {
      anyMissing = true;
      rows.push(['', src.label, missing.length + ' stores', missing.slice(0, 25).join(', ') +
        (missing.length > 25 ? ' +' + (missing.length - 25) + ' more' : '')]);
    }
  });
  if (!anyMissing) rows.push(['', 'All sources reporting for all stores.']);

  // ---- (b) RED FLAGS: score 1, grouped by category, worst-5 each ----
  rows.push(['RED FLAGS (score = 1)']);
  var anyRed = false;
  GUARD_CATEGORIES_.forEach(function (cat) {
    var reds = mine.filter(function (s) { return toNumber_(s[cat.scoreKey]) === 1; });
    if (!reds.length) return;
    anyRed = true;
    reds.sort(function (a, b) {
      var av = toNumber_(a[cat.metricKey]), bv = toNumber_(b[cat.metricKey]);
      return (av === null ? 0 : av) - (bv === null ? 0 : bv);
    });
    var worst = reds.slice(0, 5).map(function (s) {
      return s.store + ' (' + fmtVal_(s[cat.metricKey], cat.fmt) + ')';
    });
    rows.push(['', cat.label, reds.length + ' stores', worst.join('  ·  ')]);
  });
  if (!anyRed) rows.push(['', 'No category reds.']);

  // ---- (c) BIGGEST $ OPPORTUNITIES: top 5 by annualized fin miss ----
  rows.push(['BIGGEST $ OPPORTUNITIES (annualized)']);
  var opp = mine.filter(function (s) { return toNumber_(s.finAnnualized) !== null; })
    .sort(function (a, b) {
      return Math.abs(toNumber_(b.finAnnualized)) - Math.abs(toNumber_(a.finAnnualized));
    }).slice(0, 5);
  if (opp.length) {
    rows.push(['', 'Store', 'Total Fin $', 'Labor $', 'Food Cost $', '']);
    opp.forEach(function (s) {
      rows.push(['', s.store + ' ' + (s.location || ''),
        fmtVal_(s.finAnnualized, 'usd'),
        fmtVal_(s.laborAnnualized, 'usd'),
        fmtVal_(s.fcAnnualized, 'usd'), '']);
    });
  } else {
    rows.push(['', 'No financial-miss data.']);
  }

  // ---- (d) OUTLIERS: >2σ worse than company mean ----
  rows.push(['OUTLIERS (>2σ worse than company)']);
  var anyOut = false;
  GUARD_OUTLIER_METRICS_.forEach(function (m) {
    var stats = meanStd_(all, m.key);
    if (!stats) return;
    var hits = mine.filter(function (s) {
      var v = toNumber_(s[m.key]);
      if (v === null || stats.std === 0) return false;
      var z = (v - stats.mean) / stats.std * m.dir;
      return z > 2;
    }).map(function (s) { return s.store + ' (' + fmtVal_(s[m.key], m.fmt) + ')'; });
    if (hits.length) {
      anyOut = true;
      rows.push(['', m.label, 'company avg ' + fmtVal_(stats.mean, m.fmt), hits.join('  ·  ')]);
    }
  });
  if (!anyOut) rows.push(['', 'No 2σ outliers.']);

  // ---- (e) BRIGHT SPOTS: all-5 financials, else biggest YoY sales gains ----
  rows.push(['BRIGHT SPOTS']);
  var perfect = mine.filter(function (s) {
    return toNumber_(s.salesScore) === 5 && toNumber_(s.fcScore) === 5 && toNumber_(s.laborScore) === 5;
  });
  var bright = perfect.slice(0, 3);
  if (bright.length < 3) {
    var gainers = mine.filter(function (s) { return toNumber_(s.pctVsLy) !== null; })
      .sort(function (a, b) { return toNumber_(b.pctVsLy) - toNumber_(a.pctVsLy); });
    for (var i = 0; i < gainers.length && bright.length < 3; i++) {
      if (bright.indexOf(gainers[i]) === -1) bright.push(gainers[i]);
    }
  }
  if (bright.length) {
    bright.forEach(function (s) {
      var tag = perfect.indexOf(s) !== -1 ? 'ALL-5 FINANCIALS' : ('+' + fmtVal_(s.pctVsLy, 'pct') + ' vs LY');
      rows.push(['', s.store + ' ' + (s.location || ''), tag,
        'Points: ' + cellVal_(s.totalPoints) + ' · Rank ' + cellVal_(s.rank)]);
    });
  } else {
    rows.push(['', '(no data)']);
  }

  // pad to uniform width 6
  return rows.map(function (r) {
    var c = r.slice(); while (c.length < 6) c.push('');
    return c;
  });
}

/**
 * Write an action-report block to a sheet at a row, with compact styling.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sh
 * @param {number} startRow 1-based
 * @param {Array<Array>} rows from buildActionReport
 * @return {number} next free row
 */
function writeActionReportBlock_(sh, startRow, rows) {
  if (!rows.length) return startRow;
  sh.getRange(startRow, 1, rows.length, rows[0].length).setValues(rows).setFontSize(9);
  // style: title + section header rows (col A non-empty)
  sh.getRange(startRow, 1, 1, rows[0].length)
    .setBackground(COLORS.RED).setFontColor(COLORS.WHITE).setFontWeight('bold').setFontSize(11);
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0] || '') !== '') {
      sh.getRange(startRow + i, 1, 1, rows[0].length)
        .setBackground(COLORS.BLUE_LIGHT).setFontWeight('bold');
    }
  }
  return startRow + rows.length + 1;
}

// ---- local helpers ----

/** Company mean/σ of a numeric metric (null-safe). */
function meanStd_(stores, key) {
  var vals = stores.map(function (s) { return toNumber_(s[key]); })
    .filter(function (v) { return v !== null; });
  if (vals.length < 5) return null;
  var mean = vals.reduce(function (a, b) { return a + b; }, 0) / vals.length;
  var variance = vals.reduce(function (a, b) { return a + (b - mean) * (b - mean); }, 0) / vals.length;
  return { mean: mean, std: Math.sqrt(variance) };
}

function fmtVal_(v, kind) {
  var n = toNumber_(v);
  if (n === null) return String(v === undefined || v === null ? '—' : v);
  if (kind === 'pct') return (n * 100).toFixed(1) + '%';
  if (kind === 'usd') return '$' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return n.toFixed(1);
}

/** 'Danny Matar-RVP' → 'Danny Matar'. */
function cleanLeaderName_(name) {
  return String(name || '').replace(/-(RVP|SDO|DO)\s*$/i, '').trim();
}
