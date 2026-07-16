// COO map — KML export for Google My Maps. A route URL can only carry a handful
// of stops, so to see EVERY store as a pin we hand Google a KML file: import it
// at mymaps.google.com (Create map → Import) and the resulting map shows up in
// the Google Maps app under Saved → Maps. Per-district colors carry through the
// <Style> tint so the imported map matches what's on screen.

export interface KmlPoint {
  name: string;
  description: string;
  lat: number;
  lng: number;
  colorHex: string; // #rrggbb; hsl()/non-hex falls back to a neutral tint
  folder: string;
}

function xmlEsc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// KML colors are aabbggrr (alpha, blue, green, red) — the reverse of CSS hex.
function kmlColor(hex: string): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return "ff5c3d1c"; // neutral fallback
  const [, r, g, b] = m;
  return `ff${b}${g}${r}`.toLowerCase();
}

export function buildStoresKml(title: string, points: KmlPoint[]): string {
  const colors = [...new Set(points.map((p) => kmlColor(p.colorHex)))];
  const styles = colors
    .map(
      (c) =>
        `  <Style id="c${c}"><IconStyle><color>${c}</color><scale>1.1</scale>` +
        `<Icon><href>https://maps.google.com/mapfiles/kml/paddle/wht-blank.png</href></Icon></IconStyle></Style>`,
    )
    .join("\n");

  const folders = [...new Set(points.map((p) => p.folder))];
  const body = folders
    .map((f) => {
      const marks = points
        .filter((p) => p.folder === f)
        .map(
          (p) =>
            `    <Placemark><name>${xmlEsc(p.name)}</name>` +
            `<description>${xmlEsc(p.description)}</description>` +
            `<styleUrl>#c${kmlColor(p.colorHex)}</styleUrl>` +
            `<Point><coordinates>${p.lng},${p.lat},0</coordinates></Point></Placemark>`,
        )
        .join("\n");
      return `  <Folder><name>${xmlEsc(f)}</name>\n${marks}\n  </Folder>`;
    })
    .join("\n");

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<kml xmlns="http://www.opengis.net/kml/2.2">\n<Document>\n` +
    `  <name>${xmlEsc(title)}</name>\n${styles}\n${body}\n</Document>\n</kml>\n`
  );
}

export function downloadKml(filename: string, kml: string): void {
  const blob = new Blob([kml], { type: "application/vnd.google-earth.kml+xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".kml") ? filename : `${filename}.kml`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
