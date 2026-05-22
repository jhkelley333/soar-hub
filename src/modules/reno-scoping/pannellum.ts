// Lazy CDN loader for Pannellum (equirectangular 360 sphere viewer).
//
// Pannellum is loaded via jsDelivr the first time a viewer is mounted,
// then the script + stylesheet are cached on window so subsequent
// instantiations are instant. We don't bundle it via npm because the
// package is a global script and the bundler integration is awkward —
// CDN-load matches the project's no-pannellum-in-package.json choice
// in the original brief.
//
// Returns the global pannellum object once the script has executed.

const PANNELLUM_CSS = "https://cdn.jsdelivr.net/npm/pannellum@2.5.6/build/pannellum.css";
const PANNELLUM_JS = "https://cdn.jsdelivr.net/npm/pannellum@2.5.6/build/pannellum.js";

interface PannellumViewerConfig {
  type?: "equirectangular";
  panorama: string;
  autoLoad?: boolean;
  autoRotate?: number;
  hfov?: number;
  showControls?: boolean;
  showZoomCtrl?: boolean;
  showFullscreenCtrl?: boolean;
  preview?: string;
}

export interface PannellumViewer {
  destroy(): void;
}

export interface PannellumApi {
  viewer(container: HTMLElement | string, config: PannellumViewerConfig): PannellumViewer;
}

declare global {
  interface Window {
    pannellum?: PannellumApi;
    __pannellumLoading?: Promise<PannellumApi>;
  }
}

export function loadPannellum(): Promise<PannellumApi> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Pannellum requires a window"));
  }
  if (window.pannellum) return Promise.resolve(window.pannellum);
  if (window.__pannellumLoading) return window.__pannellumLoading;

  window.__pannellumLoading = new Promise<PannellumApi>((resolve, reject) => {
    // CSS — inject once.
    if (!document.querySelector(`link[href="${PANNELLUM_CSS}"]`)) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = PANNELLUM_CSS;
      document.head.appendChild(link);
    }

    // JS — inject once.
    if (document.querySelector(`script[src="${PANNELLUM_JS}"]`)) {
      // already in flight from a previous mount — wait for window.pannellum
      const start = Date.now();
      const tick = () => {
        if (window.pannellum) resolve(window.pannellum);
        else if (Date.now() - start > 10_000) reject(new Error("Pannellum load timed out"));
        else setTimeout(tick, 50);
      };
      tick();
      return;
    }

    const script = document.createElement("script");
    script.src = PANNELLUM_JS;
    script.async = true;
    script.onload = () => {
      if (window.pannellum) resolve(window.pannellum);
      else reject(new Error("Pannellum loaded but global not present"));
    };
    script.onerror = () => reject(new Error("Failed to load Pannellum from CDN"));
    document.head.appendChild(script);
  });

  return window.__pannellumLoading;
}
