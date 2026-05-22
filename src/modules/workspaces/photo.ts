// src/modules/workspaces/photo.ts
//
// Helpers for capturing + preparing photos in the submission renderer.
// All client-side: compression keeps payloads small for the upload
// endpoint, GPS gets cached so we only ask the browser permission once
// per session. Nothing here touches the network.

const COMPRESS_MAX_DIMENSION = 1600;   // longest side, px
const COMPRESS_QUALITY = 0.85;         // JPEG quality

// Module-level GPS cache. We pull location on the first photo and
// reuse the result for subsequent ones in the same session — phones
// don't move appreciably mid-audit and a fresh fix per shot wastes
// time + battery.
let geoCache: { lat: number; lng: number } | "denied" | null = null;
let geoInFlight: Promise<{ lat: number; lng: number } | null> | null = null;

export async function getCachedGeolocation(): Promise<{ lat: number; lng: number } | null> {
  if (geoCache === "denied") return null;
  if (geoCache && typeof geoCache === "object") return geoCache;
  if (geoInFlight) return geoInFlight;

  if (typeof navigator === "undefined" || !navigator.geolocation) {
    geoCache = "denied";
    return null;
  }

  geoInFlight = new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        geoCache = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        resolve(geoCache);
      },
      () => {
        // Denied / unavailable. Don't ask again this session.
        geoCache = "denied";
        resolve(null);
      },
      { enableHighAccuracy: false, maximumAge: 60_000, timeout: 8_000 },
    );
  });
  const result = await geoInFlight;
  geoInFlight = null;
  return result;
}

// Compress an image File to a JPEG blob, downscaling so the longest
// side is at most COMPRESS_MAX_DIMENSION px. If anything in the
// canvas pipeline fails (HEIC on a browser that can't decode it,
// CORS, etc.) we fall back to the original File rather than blocking
// the user — the upload endpoint will validate and reject if it's
// truly broken.
export async function compressImage(file: File): Promise<{ blob: Blob; name: string; mime: string }> {
  if (!file.type.startsWith("image/")) {
    return { blob: file, name: file.name, mime: file.type || "application/octet-stream" };
  }

  try {
    const bitmap = await createImageBitmap(file).catch(async () => {
      // Fallback for browsers without createImageBitmap support, or
      // formats it can't decode. Use an <img> + objectURL.
      return await new Promise<ImageBitmap | HTMLImageElement>((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
        img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
        img.src = url;
      });
    });

    const w = "width" in bitmap ? bitmap.width : (bitmap as HTMLImageElement).naturalWidth;
    const h = "height" in bitmap ? bitmap.height : (bitmap as HTMLImageElement).naturalHeight;
    const longest = Math.max(w, h);
    const scale = longest > COMPRESS_MAX_DIMENSION ? COMPRESS_MAX_DIMENSION / longest : 1;
    const dw = Math.round(w * scale);
    const dh = Math.round(h * scale);

    const canvas = document.createElement("canvas");
    canvas.width = dw;
    canvas.height = dh;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d ctx");
    ctx.drawImage(bitmap as CanvasImageSource, 0, 0, dw, dh);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", COMPRESS_QUALITY),
    );
    if (!blob) throw new Error("toBlob failed");

    // Rename to .jpg so the stored file extension matches the bytes
    // (the original might have been .heic / .png).
    const base = file.name.replace(/\.[^.]+$/, "") || "photo";
    return { blob, name: `${base}.jpg`, mime: "image/jpeg" };
  } catch {
    return { blob: file, name: file.name, mime: file.type || "application/octet-stream" };
  }
}

// Convert a Blob to a base64 string (no data: prefix), for sending
// through the JSON-bodied uploadAttachment endpoint. We use FileReader
// because it's the only built-in that handles arbitrary blob sizes
// without manual chunking, and the result strips well via split(',').
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("FileReader error"));
    reader.onload = () => {
      const result = String(reader.result || "");
      const idx = result.indexOf(",");
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.readAsDataURL(blob);
  });
}
