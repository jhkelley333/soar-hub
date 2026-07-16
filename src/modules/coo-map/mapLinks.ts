// COO map — external map deep links. Directions open in the platform's native
// app (Apple Maps on iOS/Mac, Google Maps everywhere). The multi-stop link hands
// a whole route to Google Maps, which caps the classic /dir/ URL at ~10 stops —
// callers should warn when they truncate.

export function appleMapsDirections(address: string): string {
  return `https://maps.apple.com/?daddr=${encodeURIComponent(address)}`;
}

export function googleMapsDirections(address: string): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`;
}

export const GMAPS_MAX_STOPS = 10;

// Route through many stops. Google's classic dir URL reliably handles ~10;
// extra addresses are dropped, so surface `truncated` to the caller.
export function googleMapsMultiStop(addresses: string[]): { url: string; truncated: boolean } {
  const stops = addresses.slice(0, GMAPS_MAX_STOPS).map((a) => encodeURIComponent(a));
  return {
    url: `https://www.google.com/maps/dir/${stops.join("/")}`,
    truncated: addresses.length > GMAPS_MAX_STOPS,
  };
}
