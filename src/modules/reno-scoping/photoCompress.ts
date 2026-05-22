// Client-side JPEG compression via Canvas. No new deps.
//
// Sonic GMs shoot 18 photos per scope on a phone. Originals run 3-5 MB
// each = 50-90 MB per scope, which trashes LTE upload speed and burns
// Supabase storage. Re-encoding to ~1600px long edge / quality 0.82
// produces visually-equivalent JPEGs at ~600-1000 KB.
//
// Returns the original file untouched if it's already small or not an
// image we can decode. Always returns a JPEG Blob (we ignore the source
// MIME so HEIC from iOS Safari gets normalized to JPEG too — Safari
// decodes HEIC into Canvas natively).

const MAX_LONG_EDGE = 1600;
const QUALITY = 0.82;
const SKIP_BELOW_BYTES = 600 * 1024; // 600 KB — already small enough

export interface CompressedPhoto {
  blob: Blob;
  filename: string;
  originalSize: number;
  compressedSize: number;
  width: number;
  height: number;
}

export async function compressPhoto(file: File): Promise<CompressedPhoto> {
  if (file.size <= SKIP_BELOW_BYTES && file.type === "image/jpeg") {
    const img = await loadBitmap(file).catch(() => null);
    return {
      blob: file,
      filename: ensureJpgExt(file.name),
      originalSize: file.size,
      compressedSize: file.size,
      width: img?.width ?? 0,
      height: img?.height ?? 0,
    };
  }

  const bitmap = await loadBitmap(file);
  const { width, height } = fitWithin(bitmap.width, bitmap.height, MAX_LONG_EDGE);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  ctx.drawImage(bitmap, 0, 0, width, height);

  const blob = await canvasToBlob(canvas, "image/jpeg", QUALITY);
  return {
    blob,
    filename: ensureJpgExt(file.name),
    originalSize: file.size,
    compressedSize: blob.size,
    width,
    height,
  };
}

// ---- helpers ---------------------------------------------------------

async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  // createImageBitmap is the fast path; fall back to <img> for browsers /
  // formats that don't support it (older Safari HEIC, etc.).
  if ("createImageBitmap" in window) {
    try {
      return await createImageBitmap(file);
    } catch {
      /* fall through */
    }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (err) => {
      URL.revokeObjectURL(url);
      reject(err);
    };
    img.src = url;
  });
}

function fitWithin(w: number, h: number, maxEdge: number): { width: number; height: number } {
  const longest = Math.max(w, h);
  if (longest <= maxEdge) return { width: w, height: h };
  const scale = maxEdge / longest;
  return { width: Math.round(w * scale), height: Math.round(h * scale) };
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Canvas toBlob returned null"))),
      type,
      quality,
    );
  });
}

function ensureJpgExt(name: string): string {
  const base = name.replace(/\.[^.]+$/, "");
  return `${base || "photo"}.jpg`;
}
