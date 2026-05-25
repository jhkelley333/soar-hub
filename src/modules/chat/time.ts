// Client-side chat timestamp formatting. The server returns raw ISO
// strings; we format here so times render in each user's *local* zone
// (the Netlify function runs in UTC, which was showing e.g. 10:15 PM as
// 3:27a). Mirrors the old server fmtTime, but in the browser's timezone.

export function formatChatTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const yest = new Date(now);
  yest.setDate(now.getDate() - 1);

  if (sameDay) {
    let h = d.getHours();
    const m = d.getMinutes();
    const ap = h >= 12 ? "p" : "a";
    h = h % 12 || 12;
    return `${h}:${String(m).padStart(2, "0")}${ap}`;
  }
  if (d.toDateString() === yest.toDateString()) return "Yesterday";
  const days = (now.getTime() - d.getTime()) / 86_400_000;
  if (days < 7) return d.toLocaleDateString("en-US", { weekday: "short" });
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
