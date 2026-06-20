// Styled QR renderer built on `qr-code-styling` — shape (square/round), dot &
// corner styles, foreground/background colors + gradient, and an optional
// center logo. Shared by the live preview and the PNG download so what you
// see is exactly what downloads.
import { useEffect, useRef } from "react";
import QRCodeStyling, { type Options } from "qr-code-styling";
import type { QrStyle } from "./api";

function buildOptions(value: string, style: QrStyle, logo: string | null, size: number): Options {
  const fg = style.fg || "#0a0a0a";
  const bg = style.bg || "#ffffff";
  const dots = style.dots || "square";
  const corners = style.corners || "square";

  const dotsOptions =
    style.gradient && style.fg2
      ? { type: dots, gradient: { type: "linear" as const, rotation: Math.PI / 4, colorStops: [{ offset: 0, color: fg }, { offset: 1, color: style.fg2 }] } }
      : { type: dots, color: fg };

  return {
    width: size,
    height: size,
    type: "canvas",
    data: value,
    image: logo || undefined,
    margin: Math.round(size * 0.06),
    // High EC level when a logo is present so the center cutout still scans.
    qrOptions: { errorCorrectionLevel: logo ? "H" : "M" },
    shape: style.shape === "circle" ? "circle" : "square",
    dotsOptions,
    backgroundOptions: { color: bg },
    cornersSquareOptions: { type: corners, color: fg },
    cornersDotOptions: { type: corners === "square" ? "square" : "dot", color: fg },
    imageOptions: { crossOrigin: "anonymous", margin: 4, imageSize: 0.32, hideBackgroundDots: true },
  } as Options;
}

export function StyledQr({ value, style, logo, size = 132 }: { value: string; style: QrStyle; logo: string | null; size?: number }) {
  const host = useRef<HTMLDivElement>(null);
  const qr = useRef<QRCodeStyling | null>(null);

  useEffect(() => {
    qr.current = new QRCodeStyling(buildOptions(value, style, logo, size));
    const node = host.current;
    if (node) { node.innerHTML = ""; qr.current.append(node); }
    return () => { if (node) node.innerHTML = ""; };
    // Mount once; subsequent prop changes flow through the update effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    qr.current?.update(buildOptions(value, style, logo, size));
  }, [value, style, logo, size]);

  return <div ref={host} style={{ width: size, height: size }} />;
}

export function downloadStyledQr(value: string, style: QrStyle, logo: string | null, filename: string) {
  const qr = new QRCodeStyling(buildOptions(value, style, logo, 1024));
  void qr.download({ name: filename, extension: "png" });
}

// Read an uploaded image and downscale it to a small PNG data URL so the logo
// stays well under the server's ~200 KB inline limit.
export function fileToLogoDataUrl(file: File, max = 256): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("That image couldn’t be loaded."));
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("Canvas unavailable."));
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/png"));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}
