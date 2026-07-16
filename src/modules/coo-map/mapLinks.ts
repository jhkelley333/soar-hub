// COO map — external map deep links. Directions open in the platform's native
// app (Apple Maps on iOS/Mac, Google Maps everywhere). To see ALL stores as pins,
// use the KML export (kmlExport.ts) + Google My Maps — a route URL can't plot
// hundreds of markers.

export function appleMapsDirections(address: string): string {
  return `https://maps.apple.com/?daddr=${encodeURIComponent(address)}`;
}

export function googleMapsDirections(address: string): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`;
}
