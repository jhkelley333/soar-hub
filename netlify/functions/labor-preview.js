// Link-preview (Open Graph) shell for the public labor share links (/labor/:token).
// WhatsApp / iMessage / Slack scrape OG tags from the HTML and never run JS, so a
// SPA route would otherwise show the generic app card. netlify.toml proxies
// /labor/* here BEFORE the SPA fallback: we fetch the real built index.html
// (keeping its hashed asset refs so the app still boots) and inject labor-specific
// title / description / image. Optional ?label enriches the title.

const TITLE = "SOAR Labor";
const DESC = "Live labor — Daily · WTD · PTD across Company → RVP → SDO → DO → Store.";

function esc(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export const handler = async (event) => {
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL || `https://${event.headers?.host || "mysoarhub.com"}`;
  const label = (event.queryStringParameters || {}).label;
  const title = esc(label ? `SOAR Labor — ${label}` : TITLE);
  const desc = esc(DESC);
  const image = `${base}/labor-og.png`;
  const url = `${base}${event.path || "/labor"}`;

  let html;
  try {
    const res = await fetch(`${base}/index.html`, { headers: { "User-Agent": "labor-preview" } });
    if (!res.ok) throw new Error(`index ${res.status}`);
    html = await res.text();
  } catch {
    // Minimal fallback shell — still gives scrapers a correct card.
    html = `<!doctype html><html><head><meta charset="utf-8" /></head><body></body></html>`;
  }

  const tags = [
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="SOAR Hub" />`,
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${desc}" />`,
    `<meta property="og:image" content="${image}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${title}" />`,
    `<meta name="twitter:description" content="${desc}" />`,
    `<meta name="twitter:image" content="${image}" />`,
  ].join("\n    ");

  html = html
    .replace(/<title>[^<]*<\/title>/i, `<title>${title}</title>`)
    .replace(/<meta\s+name="description"[^>]*>/i, `<meta name="description" content="${desc}" />`)
    .replace(/<\/head>/i, `    ${tags}\n  </head>`);

  return {
    statusCode: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // Short cache so a scraper re-fetch is cheap but updates land quickly.
      "Cache-Control": "public, max-age=300, must-revalidate",
    },
    body: html,
  };
};
