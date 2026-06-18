// Manual chunker — browser port of netlify/functions/_lib/manual-chunker.js.
// Splits a manual's extracted text into per-section chunks for manual_chunks.
// v1 keys off numbered section headings ("4.2 Fryer Procedures"); everything
// before the first heading becomes an intro chunk.

export interface ManualSection {
  section_path: string | null;
  heading: string | null;
  content: string;
  ordinal: number;
}

// A heading: optional indent, a dotted section number (4 / 4.2 / 4.2.1), an
// optional separator, then a short Title (not a full sentence).
const HEADING_RE = /^\s*(\d+(?:\.\d+){0,4})[.)]?\s+(\S.{0,78}?)\s*$/;

function asHeading(line: string): { num: string; title: string } | null {
  const m = line.match(HEADING_RE);
  if (!m) return null;
  const title = m[2].trim();
  // Reject prose / list items: headings don't end in sentence punctuation and
  // aren't long.
  if (/[.:;,]$/.test(title)) return null;
  if (title.split(/\s+/).length > 12) return null;
  return { num: m[1], title };
}

export function chunkSections(rawText: string): ManualSection[] {
  const lines = String(rawText || "").replace(/\r/g, "").split("\n");
  const sections: ManualSection[] = [];
  let cur: ManualSection | null = null;
  let ordinal = 0;
  const flush = () => { if (cur) sections.push(cur); };

  for (const line of lines) {
    const h = asHeading(line);
    if (h) {
      flush();
      cur = { section_path: `${h.num} ${h.title}`, heading: h.title, content: "", ordinal: ordinal++ };
    } else if (cur) {
      cur.content += (cur.content ? "\n" : "") + line;
    } else if (line.trim()) {
      // Preamble before the first numbered heading.
      cur = { section_path: null, heading: null, content: line, ordinal: ordinal++ };
    }
  }
  flush();

  return sections
    .map((s) => ({ ...s, content: s.content.replace(/\n{3,}/g, "\n\n").trim() }))
    .filter((s) => s.content || s.heading);
}
