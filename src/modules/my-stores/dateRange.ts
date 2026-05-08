// Helpers for the birthday widget date math.
//
// Window: Monday of *this* week through Sunday of *next* week (14 days).
// Week math is local-time so reset to midnight before slicing.

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}
function isoLocal(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function thisAndNextWeekRange(now: Date = new Date()): {
  start: string;
  end: string;
} {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  // Mon=1, Sun=0 → shift so Monday is start of week.
  const dow = d.getDay() === 0 ? 7 : d.getDay();
  const monday = new Date(d);
  monday.setDate(d.getDate() - (dow - 1));
  const sundayOfNext = new Date(monday);
  sundayOfNext.setDate(monday.getDate() + 13);
  return { start: isoLocal(monday), end: isoLocal(sundayOfNext) };
}

export function thisWeekRange(now: Date = new Date()): {
  start: string;
  end: string;
} {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  const dow = d.getDay() === 0 ? 7 : d.getDay();
  const monday = new Date(d);
  monday.setDate(d.getDate() - (dow - 1));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { start: isoLocal(monday), end: isoLocal(sunday) };
}

export function isToday(birthdayISO: string, now: Date = new Date()): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthdayISO)) return false;
  const md = birthdayISO.slice(5);
  const today = `${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  // Feb-29 birthday on a non-leap year => celebrated on Feb-28.
  if (md === "02-29") {
    const isLeap = new Date(now.getFullYear(), 1, 29).getMonth() === 1;
    return isLeap ? today === "02-29" : today === "02-28";
  }
  return today === md;
}

export function isTomorrow(birthdayISO: string, now: Date = new Date()): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthdayISO)) return false;
  const t = new Date(now);
  t.setDate(t.getDate() + 1);
  const md = birthdayISO.slice(5);
  const tomorrow = `${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
  if (md === "02-29") {
    const yearOfTomorrow = t.getFullYear();
    const isLeap = new Date(yearOfTomorrow, 1, 29).getMonth() === 1;
    return isLeap ? tomorrow === "02-29" : tomorrow === "02-28";
  }
  return tomorrow === md;
}

export function formatMonthDay(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const [_, mm, dd] = iso.split("-");
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const m = parseInt(mm, 10);
  if (m < 1 || m > 12) return iso;
  return `${months[m - 1]} ${parseInt(dd, 10)}`;
}
