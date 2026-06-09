// Minimal iCal (RFC 5545) reader for the Schedule's linked-calendar overlay.
// Fetches an .ics URL (with an SSRF guard + timeout), parses VEVENTs, and
// expands the common RRULE cases (DAILY/WEEKLY/MONTHLY/YEARLY + INTERVAL,
// COUNT, UNTIL, BYDAY-for-weekly, EXDATE) into occurrences inside a window.
//
// Time handling mirrors the rest of the app: UTC ("…Z") values become real
// UTC instants; floating / TZID values are treated as naive wall-clock and
// emitted without a zone so the client renders them in local time. DATE-only
// values are all-day (anchored 09:00 like native all-day events).

const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?|0\.0\.0\.0)/i;
const MAX_BYTES = 4 * 1024 * 1024; // 4 MB cap on a fetched calendar
const MAX_EVENTS = 1000;           // cap on emitted occurrences per calendar
const FETCH_TIMEOUT_MS = 6000;

const pad = (n) => String(n).padStart(2, "0");
const DAY_MS = 86400000;
const WD = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

// Guard against obvious SSRF targets. Callers are authenticated leaders, so
// this is defense-in-depth, not the only line.
function isSafeUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { return false; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  if (PRIVATE_HOST.test(u.hostname)) return false;
  return true;
}

async function fetchIcs(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    // webcal:// is just https for ICS feeds.
    const httpUrl = url.replace(/^webcal:\/\//i, "https://");
    const res = await fetch(httpUrl, { signal: ctrl.signal, redirect: "follow" });
    if (!res.ok) throw new Error(`feed responded ${res.status}`);
    const text = await res.text();
    if (text.length > MAX_BYTES) throw new Error("feed too large");
    return text;
  } finally {
    clearTimeout(t);
  }
}

// Unfold folded lines (continuations begin with a space or tab).
function unfold(text) {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n[ \t]/g, "");
}

// Parse a property line "NAME;PARAM=x:VALUE" → { name, params, value }.
function parseLine(line) {
  const colon = line.indexOf(":");
  if (colon === -1) return null;
  const left = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const segs = left.split(";");
  const name = segs[0].toUpperCase();
  const params = {};
  for (let i = 1; i < segs.length; i++) {
    const eq = segs[i].indexOf("=");
    if (eq > -1) params[segs[i].slice(0, eq).toUpperCase()] = segs[i].slice(eq + 1);
  }
  return { name, params, value };
}

// Parse a DATE or DATE-TIME value into { date: Date(UTC instant), dateOnly, utc }.
function parseDt(value, params) {
  const dateOnly = params?.VALUE === "DATE" || /^\d{8}$/.test(value);
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/);
  if (!m) return null;
  const [, y, mo, d, hh, mi, ss, z] = m;
  const Y = +y, Mo = +mo - 1, D = +d, H = +(hh || 0), Mi = +(mi || 0), S = +(ss || 0);
  // Build a UTC instant from the literal components. For Z it's truly UTC; for
  // floating/TZID we still build in UTC and later emit without a zone so the
  // client reads the same wall-clock locally.
  return { date: new Date(Date.UTC(Y, Mo, D, H, Mi, S)), dateOnly, utc: z === "Z" };
}

// Emit an ISO string: real UTC (with Z) for Z values, naive wall-clock for
// floating/TZID so the client renders the literal time in local.
function emitIso(dt) {
  if (dt.utc) return dt.date.toISOString();
  const d = dt.date;
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

function dayKey(date) {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function parseRrule(value) {
  const out = {};
  for (const part of value.split(";")) {
    const [k, v] = part.split("=");
    if (k && v) out[k.toUpperCase()] = v;
  }
  const rule = { freq: out.FREQ, interval: Math.max(1, parseInt(out.INTERVAL || "1", 10) || 1) };
  if (out.COUNT) rule.count = parseInt(out.COUNT, 10);
  if (out.UNTIL) {
    const m = out.UNTIL.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z?)?/);
    if (m) rule.until = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 23), +(m[5] || 59), +(m[6] || 59)));
  }
  if (out.BYDAY) rule.byday = out.BYDAY.split(",").map((s) => WD[s.slice(-2).toUpperCase()]).filter((n) => n != null);
  return rule;
}

// Advance a Date (UTC) by the rule's frequency × interval × n.
function stepDate(start, rule, n) {
  const y = start.getUTCFullYear(), m = start.getUTCMonth(), d = start.getUTCDate();
  const h = start.getUTCHours(), mi = start.getUTCMinutes(), s = start.getUTCSeconds();
  const step = rule.interval * n;
  if (rule.freq === "DAILY") return new Date(Date.UTC(y, m, d + step, h, mi, s));
  if (rule.freq === "WEEKLY") return new Date(Date.UTC(y, m, d + step * 7, h, mi, s));
  if (rule.freq === "MONTHLY") {
    const tm = m + step, ty = y + Math.floor(tm / 12), tmo = ((tm % 12) + 12) % 12;
    const last = new Date(Date.UTC(ty, tmo + 1, 0)).getUTCDate();
    return new Date(Date.UTC(ty, tmo, Math.min(d, last), h, mi, s));
  }
  if (rule.freq === "YEARLY") return new Date(Date.UTC(y + step, m, d, h, mi, s));
  return null;
}

// Expand one VEVENT into occurrence start-Dates inside [winFrom, winTo).
function expandEvent(ev, winFrom, winTo) {
  const start = ev.start.date;
  const occurrences = [];
  if (!ev.rrule) {
    if (start >= winFrom && start < winTo) occurrences.push(start);
    return occurrences;
  }
  const rule = ev.rrule;
  const ex = ev.exdates || new Set();
  let produced = 0;
  // For weekly-with-BYDAY, walk week starts and emit each listed weekday.
  for (let n = 0, guard = 0; guard < 1500; n++, guard++) {
    const anchor = stepDate(start, rule, n);
    if (!anchor) break;
    if (anchor >= winTo && (!rule.byday || rule.freq !== "WEEKLY")) {
      // past the window; for weekly-byday a later weekday in this same step
      // could still be < winTo, but stepDate already advanced by whole weeks,
      // so anchor is the week's base — safe to stop once well past.
      if (anchor.getTime() - winTo.getTime() > 7 * DAY_MS) break;
    }
    const cands = [];
    if (rule.freq === "WEEKLY" && rule.byday && rule.byday.length) {
      const base = anchor;
      const baseDow = base.getUTCDay();
      for (const wd of rule.byday) {
        cands.push(new Date(base.getTime() + (wd - baseDow) * DAY_MS));
      }
    } else {
      cands.push(anchor);
    }
    for (const c of cands) {
      if (rule.until && c > rule.until) return occurrences;
      if (rule.count && produced >= rule.count) return occurrences;
      if (c < start) continue;
      produced++;
      if (c >= winFrom && c < winTo && !ex.has(dayKey(c))) occurrences.push(c);
    }
    if (rule.count && produced >= rule.count) break;
    if (anchor >= winTo && anchor.getTime() - winTo.getTime() > 31 * DAY_MS) break;
    if (occurrences.length > MAX_EVENTS) break;
  }
  return occurrences;
}

// Parse the whole calendar text into VEVENT descriptors.
function parseEvents(text) {
  const lines = unfold(text).split("\n");
  const events = [];
  let cur = null;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "BEGIN:VEVENT") { cur = { exdates: new Set() }; continue; }
    if (trimmed === "END:VEVENT") { if (cur && cur.start) events.push(cur); cur = null; continue; }
    if (!cur) continue;
    const p = parseLine(trimmed);
    if (!p) continue;
    if (p.name === "DTSTART") { const dt = parseDt(p.value, p.params); if (dt) cur.start = dt; }
    else if (p.name === "DTEND") { const dt = parseDt(p.value, p.params); if (dt) cur.end = dt; }
    else if (p.name === "SUMMARY") cur.summary = p.value.replace(/\\,/g, ",").replace(/\\n/gi, " ").replace(/\\;/g, ";").trim();
    else if (p.name === "RRULE") cur.rrule = parseRrule(p.value);
    else if (p.name === "EXDATE") { const dt = parseDt(p.value, p.params); if (dt) cur.exdates.add(dayKey(dt.date)); }
    else if (p.name === "UID") cur.uid = p.value;
  }
  return events;
}

// Public: fetch a calendar and return overlay event cards inside [fromIso, toIso).
// `cal` is the linked-calendar row { id, label, color }. Throws on fetch error
// so the caller can record last_error; returns [] for an empty/parseless feed.
export async function fetchCalendarEvents(url, cal, fromIso, toIso) {
  if (!isSafeUrl(url)) throw new Error("unsupported or unsafe URL");
  const text = await fetchIcs(url);
  const winFrom = new Date(fromIso);
  const winTo = new Date(toIso);
  const events = parseEvents(text);
  const out = [];
  for (const ev of events) {
    if (!ev.start) continue;
    const dateOnly = ev.start.dateOnly;
    const durationMs = ev.end ? ev.end.date.getTime() - ev.start.date.getTime() : null;
    for (const occ of expandEvent(ev, winFrom, winTo)) {
      const startDt = { date: occ, dateOnly, utc: ev.start.utc };
      let endsIso = null;
      if (!dateOnly && durationMs && durationMs > 0) {
        endsIso = emitIso({ date: new Date(occ.getTime() + durationMs), dateOnly: false, utc: ev.start.utc });
      }
      out.push({
        id: `ext:${cal.id}:${ev.uid || ev.summary || "?"}:${occ.toISOString()}`,
        source: "external",
        editable: false,
        title: ev.summary || "(no title)",
        type: "other",
        starts_at: emitIso(startDt),
        ends_at: endsIso,
        all_day: !!dateOnly,
        scope_type: "external",
        scope_id: cal.id,
        store_number: null,
        notes: cal.label,
        color: cal.color || "blue",
        created_by_name: cal.label,
      });
      if (out.length >= MAX_EVENTS) return out;
    }
  }
  return out;
}
