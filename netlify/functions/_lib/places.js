// netlify/functions/_lib/places.js
//
// Google Places wrapper for the Hours of Operation "compare to Google" check.
// Mirrors _lib/geocode.js (env-guarded, never throws, returns {error}). Resolves
// a store to its Google place_id (Find Place from Text, biased by the store's
// coords), pulls the listing's regular opening hours, and normalizes them to the
// system's per-weekday shape (0=Mon .. 6=Sun, "HH:MM" local, is_closed).

const PLACES_KEY = process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY;

export function placesConfigured() {
  return !!PLACES_KEY;
}

// Search by BRAND + address, not the internal store name. The store's own name
// ("Shawnee OK (Kickapoo 1)") is an internal label, not the Google business
// name, and including it made Find Place match the wrong nearby business. The
// brand + full address (plus the coord bias below) pins the real listing.
const BRAND_LABEL = { sonic: "Sonic Drive-In", little_caesars: "Little Caesars" };
function queryFor(store) {
  const brand = BRAND_LABEL[String(store.brand || "").toLowerCase()] || "";
  return [brand, store.address, store.city, store.state, store.zip]
    .map((x) => (x || "").toString().trim()).filter(Boolean).join(", ");
}

// Resolve a store to a Google place_id. Uses coords as a location bias when
// present so we match the right physical location.
export async function findPlaceId(store) {
  if (!PLACES_KEY) return { error: "places not configured (GOOGLE_PLACES_API_KEY)" };
  const input = queryFor(store);
  if (!input) return { error: "store has no address to search" };
  let url =
    "https://maps.googleapis.com/maps/api/place/findplacefromtext/json?inputtype=textquery&fields=place_id" +
    "&input=" + encodeURIComponent(input) + "&key=" + PLACES_KEY;
  if (typeof store.latitude === "number" && typeof store.longitude === "number") {
    url += "&locationbias=" + encodeURIComponent(`point:${store.latitude},${store.longitude}`);
  }
  let json;
  try {
    const res = await fetch(url);
    if (!res.ok) return { error: `places http ${res.status}` };
    json = await res.json();
  } catch (e) {
    return { error: e?.message || "places request failed" };
  }
  if (json.status === "ZERO_RESULTS") return { error: "no Google listing found" };
  if (json.status === "OVER_QUERY_LIMIT") return { error: "over query limit" };
  if (json.status !== "OK") return { error: `places: ${json.status}` };
  const id = json.candidates?.[0]?.place_id;
  return id ? { place_id: id } : { error: "no candidate place" };
}

// Fetch a place's regular opening hours (periods) via Place Details.
export async function fetchPlaceHours(placeId) {
  if (!PLACES_KEY) return { error: "places not configured (GOOGLE_PLACES_API_KEY)" };
  const url =
    "https://maps.googleapis.com/maps/api/place/details/json?fields=opening_hours,business_status,name" +
    "&place_id=" + encodeURIComponent(placeId) + "&key=" + PLACES_KEY;
  let json;
  try {
    const res = await fetch(url);
    if (!res.ok) return { error: `places http ${res.status}` };
    json = await res.json();
  } catch (e) {
    return { error: e?.message || "places request failed" };
  }
  if (json.status !== "OK") return { error: `places: ${json.status}` };
  return { periods: json.result?.opening_hours?.periods || null, name: json.result?.name || null };
}

// Fetch a place's rating, total review count, and its (up to 5) most-relevant
// reviews via Place Details. The Places API caps reviews at 5 and gives no
// histogram, so `rating`/`user_ratings_total` are the accurate aggregates and
// `reviews` is a rolling sample. Each review: author_name, rating, text, time
// (unix seconds), relative_time_description, language.
export async function fetchPlaceReviews(placeId) {
  if (!PLACES_KEY) return { error: "places not configured (GOOGLE_PLACES_API_KEY)" };
  const url =
    "https://maps.googleapis.com/maps/api/place/details/json?fields=rating,user_ratings_total,reviews,name,url&reviews_sort=newest" +
    "&place_id=" + encodeURIComponent(placeId) + "&key=" + PLACES_KEY;
  let json;
  try {
    const res = await fetch(url);
    if (!res.ok) return { error: `places http ${res.status}` };
    json = await res.json();
  } catch (e) {
    return { error: e?.message || "places request failed" };
  }
  if (json.status !== "OK") return { error: `places: ${json.status}` };
  const r = json.result || {};
  return {
    rating: typeof r.rating === "number" ? r.rating : null,
    total: typeof r.user_ratings_total === "number" ? r.user_ratings_total : null,
    name: r.name || null,
    url: r.url || null,
    reviews: Array.isArray(r.reviews) ? r.reviews.map((rv) => ({
      author: rv.author_name || "Anonymous",
      rating: typeof rv.rating === "number" ? rv.rating : null,
      text: rv.text || "",
      time: typeof rv.time === "number" ? rv.time : null, // unix seconds
      relative_time: rv.relative_time_description || null,
      language: rv.language || null,
    })) : [],
  };
}

// "0930" -> "09:30".
const hm = (t) => (typeof t === "string" && /^\d{4}$/.test(t) ? `${t.slice(0, 2)}:${t.slice(2)}` : null);
// Google weekday: 0=Sunday..6=Saturday. System weekday: 0=Monday..6=Sunday.
const gToSys = (g) => (g + 6) % 7;

// Turn Google's periods[] into the system's 7-day array. A 24h listing is a
// single period with an open time and no close — represented here as 00:00-00:00
// with is_closed=false. A weekday absent from every period is treated as closed.
export function normalizeGoogleHours(periods) {
  if (!Array.isArray(periods)) return null;
  const days = Array.from({ length: 7 }, (_, dow) => ({ day_of_week: dow, is_closed: true, open: null, close: null }));
  // Single open with no close = open 24/7.
  if (periods.length === 1 && periods[0]?.open && !periods[0]?.close) {
    return days.map((d) => ({ ...d, is_closed: false, open: "00:00", close: "00:00" }));
  }
  for (const p of periods) {
    const openDay = p?.open?.day;
    const openT = hm(p?.open?.time);
    const closeT = hm(p?.close?.time);
    if (typeof openDay !== "number" || !openT) continue;
    const dow = gToSys(openDay);
    days[dow] = { day_of_week: dow, is_closed: false, open: openT, close: closeT || openT };
  }
  return days;
}

// Compare system standard hours to normalized Google hours. Returns
// { status: "match"|"mismatch"|"not_found", diffs:[{day_of_week, system, google}] }.
// Times are compared to the minute; both-closed counts as equal.
export function compareHours(systemDays, googleDays) {
  if (!Array.isArray(googleDays)) return { status: "not_found", diffs: [] };
  const label = (d) => (!d || d.is_closed || (!d.open && !d.close) ? "Closed" : `${d.open ?? "?"}-${d.close ?? "?"}`);
  const diffs = [];
  for (let dow = 0; dow < 7; dow++) {
    const s = (systemDays || []).find((x) => x.day_of_week === dow) || null;
    const g = googleDays.find((x) => x.day_of_week === dow) || null;
    const sClosed = !s || s.is_closed || (!s.open && !s.close);
    const gClosed = !g || g.is_closed || (!g.open && !g.close);
    const equal = (sClosed && gClosed) || (!sClosed && !gClosed && s.open === g.open && s.close === g.close);
    if (!equal) diffs.push({ day_of_week: dow, system: label(s), google: label(g) });
  }
  return { status: diffs.length ? "mismatch" : "match", diffs };
}
