// Styled QR renderer built on `qr-code-styling`, with an optional caption frame
// composited around it (words like "SCAN ME"). Everything is drawn onto one
// canvas so the on-screen preview and the downloaded PNG are identical —
// including the frame, border, and text.
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
    qrOptions: { errorCorrectionLevel: logo ? "H" : "M" },
    shape: style.shape === "circle" ? "circle" : "square",
    dotsOptions,
    backgroundOptions: { color: bg },
    cornersSquareOptions: { type: corners, color: fg },
    cornersDotOptions: { type: corners === "square" ? "square" : "dot", color: fg },
    imageOptions: { crossOrigin: "anonymous", margin: 4, imageSize: 0.32, hideBackgroundDots: true },
  } as Options;
}

// Render just the QR (no frame) into an <img> we can composite.
async function qrToImage(value: string, style: QrStyle, logo: string | null, size: number): Promise<{ img: HTMLImageElement; url: string }> {
  const qr = new QRCodeStyling(buildOptions(value, style, logo, size));
  const blob = (await qr.getRawData("png")) as Blob;
  const url = URL.createObjectURL(blob);
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("QR render failed"));
    img.src = url;
  });
  return { img, url };
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

// Compose the QR + (optional) caption frame onto a single 2x canvas.
async function composeCanvas(value: string, style: QrStyle, logo: string | null, qrPx: number): Promise<HTMLCanvasElement> {
  const { img, url } = await qrToImage(value, style, logo, qrPx);
  try {
    const frame = style.frame && style.frame !== "none" ? style.frame : null;
    const text = (style.frameText || "").trim();
    const hasCap = !!frame && text.length > 0;
    const pos = style.framePosition === "top" ? "top" : "bottom";
    const bg = style.bg || "#ffffff";
    const frameColor = style.frameColor || style.fg || "#0a0a0a";
    const textColor = style.frameTextColor || "#ffffff";
    const border = frame === "border";

    const pad = border ? Math.round(qrPx * 0.08) : 0;
    const barH = hasCap ? Math.round(qrPx * 0.17) : 0;
    const gap = hasCap && !border ? Math.round(qrPx * 0.04) : 0;
    const W = qrPx + pad * 2;
    const H = qrPx + pad * 2 + barH + gap;

    const scale = 2; // crisp text + edges on screen and in print
    const canvas = document.createElement("canvas");
    canvas.width = W * scale;
    canvas.height = H * scale;
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return canvas;
    ctx.scale(scale, scale);

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    const cardY = pos === "top" ? barH + gap : 0;

    // Framed-card border around the QR area.
    if (border) {
      ctx.lineWidth = Math.max(3, Math.round(qrPx * 0.035));
      ctx.strokeStyle = frameColor;
      const inset = ctx.lineWidth / 2;
      roundRect(ctx, inset, cardY + inset, W - ctx.lineWidth, qrPx + pad * 2 - ctx.lineWidth, Math.round(qrPx * 0.09));
      ctx.stroke();
    }

    // The QR itself.
    const qrY = pos === "top" ? barH + gap + pad : pad;
    ctx.drawImage(img, pad, qrY, qrPx, qrPx);

    // Caption bar with the words.
    if (hasCap) {
      const barTop = pos === "top" ? 0 : H - barH;
      let barX = 0;
      let barW = W;
      if (border) {
        // A centered pill "tab" that sits on the border edge.
        barW = Math.round(W * 0.66);
        barX = (W - barW) / 2;
      }
      roundRect(ctx, barX, barTop, barW, barH, Math.round(barH * (border ? 0.5 : 0.28)));
      ctx.fillStyle = frameColor;
      ctx.fill();

      const upper = text.toUpperCase();
      ctx.fillStyle = textColor;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      try { (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${Math.max(1, Math.round(qrPx * 0.006))}px`; } catch { /* not supported */ }
      const maxW = barW * 0.84;
      let fontPx = Math.round(barH * 0.44);
      for (; fontPx > 8; fontPx--) {
        ctx.font = `700 ${fontPx}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
        if (ctx.measureText(upper).width <= maxW) break;
      }
      ctx.fillText(upper, W / 2, barTop + barH / 2 + 1);
    }

    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function StyledQr({ value, style, logo, size = 132 }: { value: string; style: QrStyle; logo: string | null; size?: number }) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    const node = host.current;
    composeCanvas(value, style, logo, size)
      .then((canvas) => {
        if (cancelled || !node) return;
        node.innerHTML = "";
        canvas.style.maxWidth = "100%";
        node.appendChild(canvas);
      })
      .catch(() => { /* transient render error — ignore */ });
    return () => { cancelled = true; };
  }, [value, style, logo, size]);

  return <div ref={host} className="inline-flex items-center justify-center" style={{ minWidth: size, minHeight: size }} />;
}

export function downloadStyledQr(value: string, style: QrStyle, logo: string | null, filename: string) {
  void composeCanvas(value, style, logo, 1024).then((canvas) => {
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename.endsWith(".png") ? filename : `${filename}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, "image/png");
  });
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
