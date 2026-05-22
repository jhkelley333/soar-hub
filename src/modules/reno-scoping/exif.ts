// Best-effort EXIF DateTimeOriginal extraction. Lazy-loads exifr so we
// don't bloat the initial bundle.

export async function readPhotoTakenAt(file: Blob): Promise<string | null> {
  try {
    const { default: exifr } = await import("exifr");
    const tags = await exifr.parse(file, ["DateTimeOriginal", "CreateDate", "ModifyDate"]);
    const ts =
      (tags?.DateTimeOriginal as Date | string | undefined) ??
      (tags?.CreateDate as Date | string | undefined) ??
      (tags?.ModifyDate as Date | string | undefined);
    if (!ts) return null;
    const date = ts instanceof Date ? ts : new Date(ts);
    if (isNaN(date.getTime())) return null;
    return date.toISOString();
  } catch {
    // exifr fails on non-image files / unreadable EXIF / missing browser
    // APIs (Workers). Never block the upload over a missing timestamp.
    return null;
  }
}
