import type { RankedStore, RankerRunPayload } from './types';

/**
 * Pure. No jsPDF, no DOM, no Supabase. Everything the PDF prints is decided
 * here so it can be unit tested against a fixture of a known run.
 */

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

const sum = (rows: RankedStore[], pick: (r: RankedStore) => number | null | undefined) =>
  rows.reduce((acc, r) => acc + (isNum(pick(r)) ? (pick(r) as number) : 0), 0);

const mean = (rows: RankedStore[], pick: (r: RankedStore) => number | null | undefined) => {
  const vals = rows.map(pick).filter(isNum);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
};

const countWhere = (rows: RankedStore[], test: (r: RankedStore) => boolean) =>
  rows.reduce((acc, r) => acc + (test(r) ? 1 : 0), 0);

const median = (nums: number[]) => {
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export interface CategorySummary {
  label: string;
  avg: number;
  atFive: number;
  atOne: number;
  context: string;
}

export interface ExecSummary {
  header: {
    title: string;
    subtitle: string;
    runId: string;
    generatedAtISO: string;
  };
  kpis: Array<{ label: string; value: string; sub: string; tone: 'good' | 'bad' | 'neutral' }>;
  narrative: string;
  categories: CategorySummary[];
  categoryNote: string;
  exposure: Array<{
    driver: string;
    storesMissing: string;
    weekMiss: string;
    annualized: string;
    detail: string;
    isTotal?: boolean;
  }>;
  board: {
    top: RankedStore[];
    bottom: RankedStore[];
    note: string;
  };
  sends: RankerRunPayload['sends'];
  leaderStandings: Array<{ level: string; top: string; bottom: string; ranked: number }>;
  footnote: string;
  /** Anything the run itself looks wrong about. Rendered as a warning strip. */
  dataWarnings: string[];
}

const money = (v: number) => `$${Math.round(v).toLocaleString('en-US')}`;
const moneyM = (v: number) => `$${(v / 1_000_000).toFixed(2)}M`;
const signedMoney = (v: number) => (v < 0 ? `-${money(Math.abs(v))}` : money(v));
const pct = (v: number, d = 1) => `${(v * 100).toFixed(d)}%`;
const signedPct = (v: number, d = 1) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(d)}%`;

export function computeExecSummary(payload: RankerRunPayload): ExecSummary {
  const rows = payload.ptd.stores;
  const n = rows.length;
  const co = payload.ptd.company;
  const warnings: string[] = [];

  // ---- headline ----
  const tixVsLy = co.tickets / co.lyTickets - 1;
  const posSales = countWhere(rows, (r) => (r.pctVsLy ?? 0) > 0);
  const posTickets = countWhere(rows, (r) => (r.ticketsVsLyPct ?? 0) > 0);
  const points = rows.map((r) => r.totalPoints);
  const avgPoints = points.reduce((a, b) => a + b, 0) / n;

  // ---- cash over/short ----
  const cashNet = sum(rows, (r) => r.cashOverShortWtd);
  const cashShortN = countWhere(rows, (r) => r.cashOverShortWtd < 0);
  const cashOverN = countWhere(rows, (r) => r.cashOverShortWtd > 0);
  const cashFlatN = n - cashShortN - cashOverN;
  const worstCash = [...rows].sort((a, b) => a.cashOverShortWtd - b.cashOverShortWtd).slice(0, 2);

  // ---- late tickets ----
  // On-time above 100% is impossible; exclude those stores and surface them.
  const otValid = rows.filter((r) => isNum(r.onTimePct) && (r.onTimePct as number) <= 1);
  const otBroken = rows.filter((r) => isNum(r.onTimePct) && (r.onTimePct as number) > 1);
  const lateTickets = otValid.reduce(
    (acc, r) => acc + r.tickets * (1 - (r.onTimePct as number)),
    0
  );
  const validTickets = otValid.reduce((acc, r) => acc + r.tickets, 0);
  const latePct = validTickets ? lateTickets / validTickets : 0;
  const under50 = countWhere(otValid, (r) => (r.onTimePct as number) < 0.5);
  if (otBroken.length) {
    warnings.push(
      `${otBroken.length} store${otBroken.length === 1 ? '' : 's'} report on-time above 100% ` +
        `(${otBroken
          .slice(0, 6)
          .map((r) => `${r.storeNumber} ${pct(r.onTimePct as number)}`)
          .join(', ')}). ` +
        `Each scores a 5 on on-time. Excluded from the late-ticket figures.`
    );
  }

  // ---- misses ----
  const laborMiss = sum(rows, (r) => r.laborDollarMiss);
  const laborAnn = sum(rows, (r) => r.laborAnnualized);
  const fcMiss = sum(rows, (r) => r.fcDollarMiss);
  const fcAnn = sum(rows, (r) => r.fcAnnualized);
  const finMiss = sum(rows, (r) => r.finDollarMiss);
  const finAnn = sum(rows, (r) => r.finAnnualized);
  const laborN = countWhere(rows, (r) => r.laborDollarMiss > 0);
  const fcN = countWhere(rows, (r) => r.fcDollarMiss > 0);
  const hoursOver = sum(rows, (r) => r.hoursOver);
  const overChart = countWhere(rows, (r) => (r.varToChart ?? 0) > 0);
  const worstFc = [...rows].sort((a, b) => b.fcDollarMiss - a.fcDollarMiss).slice(0, 3);

  // ---- company LY reconciliation ----
  const storeLySum = sum(rows, (r) => r.lySales);
  const lyGap = Math.abs(storeLySum - co.lySales) / co.lySales;
  if (lyGap > 0.001) {
    warnings.push(
      `Company line last-year sales (${money(co.lySales)}) and the sum of the ${n} store rows ` +
        `(${money(storeLySum)}) differ by ${pct(lyGap, 1)}. Percentages use the Company line.`
    );
  }

  // ---- categories ----
  const cat = (
    label: string,
    pick: (r: RankedStore) => number,
    context: string
  ): CategorySummary => ({
    label,
    avg: mean(rows, pick),
    atFive: countWhere(rows, (r) => pick(r) === 5),
    atOne: countWhere(rows, (r) => pick(r) === 1),
    context,
  });

  const categories: CategorySummary[] = [
    cat('Sales', (r) => r.salesScore, `${signedPct(co.pctVsLy)} vs LY company-wide`),
    cat('Food Cost', (r) => r.fcScore, `COGS efficiency avg ${pct(mean(rows, (r) => r.cogsEffPct))}`),
    cat(
      'Labor',
      (r) => r.laborScore,
      `labor ${pct(mean(rows, (r) => r.laborPct))} vs ${pct(mean(rows, (r) => r.chart))} chart`
    ),
    cat(
      'BSC Training',
      (r) => r.bscScore,
      `${countWhere(rows, (r) => (r.bscTrainingPct ?? 0) >= 1)} stores at 100%`
    ),
    cat(
      'On Time',
      (r) => r.onTimeScore,
      `${pct(latePct, 0)} of tickets late; ${under50} stores under 50% on time`
    ),
    cat('Complaints', (r) => r.complaintsScore, complaintsContext(rows)),
    cat(
      'EcoSure',
      (r) => r.ecoSureScore,
      `${countWhere(rows, (r) => r.ecoSure === 'No Audit')} stores unaudited`
    ),
    cat('VOG', (r) => r.vogScore, `avg ${pct(mean(rows, (r) => r.vog))}`),
    cat('Training', (r) => r.trainingScore, `avg ${pct(mean(rows, (r) => r.trainingPct))} complete`),
  ];

  const finAvg = mean(rows, (r) => r.finScore);
  const opsAvg = mean(rows, (r) => r.opsScore);

  // ---- board ----
  const sorted = [...rows].sort((a, b) => a.rank - b.rank);
  const top = sorted.slice(0, 8);
  const bottom = sorted.slice(-8);
  const worst = sorted[sorted.length - 1];

  // ---- leader standings ----
  const byLevel = (lvl: string) =>
    payload.ptd.leaders.filter((l) => l.level === lvl).sort((a, b) => a.rank - b.rank);
  const standings = (['RVP', 'SDO', 'DO', 'Entity'] as const).map((lvl) => {
    const set = byLevel(lvl);
    const best = set.filter((l) => l.rank === set[0]?.rank);
    const last = set[set.length - 1];
    return {
      level: lvl === 'DO' ? 'Director of Ops' : lvl,
      top: best.map((l) => l.name).join(' · ') + (best[0] ? ` (${best[0].totalPoints} pts)` : ''),
      bottom: last ? `${last.name} (${last.totalPoints} pts, ${last.stores} stores)` : '—',
      ranked: set.length,
    };
  });
  const topPts = top[0]?.totalPoints ?? 0;
  standings.push({
    level: 'Store',
    top: `${countWhere(rows, (r) => r.totalPoints === topPts)} stores tied at ${topPts} pts`,
    bottom: `${worst.location} (${worst.totalPoints} pts)`,
    ranked: n,
  });

  return {
    header: {
      title: 'SOAR QSR  ·  Weekly Ranking Executive Summary',
      subtitle:
        `${payload.periodLabel}  ·  Week ending ${formatLongDate(payload.weekEndingISO)}  ·  ` +
        `${payload.storeCount} stores  ·  Run ${payload.runId.slice(0, 8)}`,
      runId: payload.runId,
      generatedAtISO: payload.generatedAtISO,
    },

    kpis: [
      { label: 'Net Sales', value: moneyM(co.sales), sub: `${signedPct(co.pctVsLy)} vs LY`, tone: co.pctVsLy < 0 ? 'bad' : 'good' },
      { label: 'Tickets', value: co.tickets.toLocaleString('en-US'), sub: `${signedPct(tixVsLy)} vs LY`, tone: tixVsLy < 0 ? 'bad' : 'good' },
      { label: 'Company Score', value: `${co.totalPoints}`, sub: `${payload.wtd.company.totalPoints} week to date`, tone: 'neutral' },
      { label: 'Avg Store Pts', value: avgPoints.toFixed(1), sub: `median ${median(points)} · range ${Math.min(...points)}–${Math.max(...points)}`, tone: 'neutral' },
      { label: 'Stores Up', value: `${posSales}`, sub: `of ${n} on sales (${Math.round((posSales / n) * 100)}%)`, tone: 'neutral' },
      { label: 'Annual. Miss', value: moneyM(finAnn), sub: 'food + labor exposure', tone: 'bad' },
      { label: 'Cash +/-', value: signedMoney(cashNet), sub: `net, ${cashShortN} stores short`, tone: cashNet < 0 ? 'bad' : 'good' },
      { label: 'Late Tickets', value: pct(latePct, 0), sub: `${Math.round(lateTickets).toLocaleString('en-US')} of ${validTickets.toLocaleString('en-US')} tickets`, tone: 'bad' },
    ],

    narrative:
      `${payload.periodLabel.split(',')[0]} sales of ${money(co.sales)} ran ${signedPct(co.pctVsLy)} against last year on ` +
      `${signedPct(tixVsLy)} traffic — a guest-count gap, with only ${posTickets} of ${n} stores growing tickets. ` +
      `Food cost averaged ${pct(mean(rows, (r) => r.cogsEffPct))} efficiency and labor ran ` +
      `${pct(mean(rows, (r) => r.laborPct))} against a ${pct(mean(rows, (r) => r.chart))} chart. ` +
      `${pct(latePct, 0)} of tickets went out late.`,

    categories,
    categoryNote:
      `Financial points (sales + food cost + labor, 15 possible) averaged ${finAvg.toFixed(2)}; ` +
      `operations averaged ${opsAvg.toFixed(2)}.`,

    exposure: [
      {
        driver: 'Labor',
        storesMissing: `${laborN} of ${n}`,
        weekMiss: money(laborMiss),
        annualized: money(laborAnn),
        detail: `${Math.round(hoursOver).toLocaleString('en-US')} hours over chart; ${overChart} stores above chart`,
      },
      {
        driver: 'Food cost',
        storesMissing: `${fcN} of ${n}`,
        weekMiss: money(fcMiss),
        annualized: money(fcAnn),
        detail: `worst three: ${worstFc.map((r) => `${shortName(r.location)} ${money(r.fcDollarMiss)}`).join(', ')}`,
      },
      {
        driver: 'Total scored',
        storesMissing: '—',
        weekMiss: money(finMiss),
        annualized: money(finAnn),
        detail: `voids of ${money(sum(rows, (r) => r.voidsDollars))} sit outside the score`,
        isTotal: true,
      },
      {
        driver: 'Cash +/-',
        storesMissing: `${cashShortN} short`,
        weekMiss: signedMoney(cashNet),
        annualized: signedMoney(cashNet * 52),
        detail:
          `${cashShortN} short, ${cashOverN} over, ${cashFlatN} flat; worst ` +
          worstCash.map((r) => `${shortName(r.location)} ${signedMoney(r.cashOverShortWtd)}`).join(' and '),
      },
      {
        driver: 'Late tickets',
        storesMissing: `${under50} under 50%`,
        weekMiss: `${Math.round(lateTickets).toLocaleString('en-US')} tkts`,
        annualized: '—',
        detail:
          `${pct(latePct)} of ${validTickets.toLocaleString('en-US')} tickets late` +
          (otBroken.length ? `; ${otBroken.length} stores report on-time above 100% and are excluded` : ''),
      },
    ],

    board: {
      top,
      bottom,
      note:
        `Period-to-date store ranking; ties share a rank. ${shortName(worst.location)} is the worst position on the board — ` +
        `last at ${worst.totalPoints} points, sales ${signedPct(worst.pctVsLy ?? 0)}, food cost efficiency ` +
        `${pct(worst.cogsEffPct ?? 0)}, labor ${pct(worst.laborPct ?? 0)} against a ${pct(worst.chart ?? 0)} chart.`,
    },

    sends: payload.sends,
    leaderStandings: standings,

    footnote:
      'Company-level sales, tickets and points are taken from the Company line of the ranking run. ' +
      'Voids, days on hand, ending cash, cash over/short and paid-outs are tracked but not scored.',

    dataWarnings: warnings,
  };
}

function complaintsContext(rows: RankedStore[]): string {
  const distinct = new Set(rows.map((r) => r.complaintsScore));
  if (distinct.size === 1) {
    const only = [...distinct][0];
    return `flat ${only} at every store — contributing nothing to the spread`;
  }
  return `avg ${mean(rows, (r) => r.callsPer10kTickets).toFixed(1)} calls / 10k tickets`;
}

/** 'Blue Springs MO #4 (Woods Chapel)' -> 'Blue Springs MO #4' when too long. */
export function shortName(loc: string, max = 28): string {
  if (loc.length <= max) return loc;
  const base = loc.split(' (')[0];
  return base.length <= max ? base : `${base.slice(0, max - 1)}\u2026`;
}

function formatLongDate(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}
