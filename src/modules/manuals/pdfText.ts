// Browser PDF text extraction via pdfjs-dist. Doing this client-side (where
// the file already lives) sidesteps the server's function time/memory budget
// entirely — a 25–100 MB manual that 502'd a Netlify function parses fine here.
//
// The heavy library is dynamically imported so it only loads in the manuals
// admin flow; the worker ships as a separate asset (?url) fetched on first use.

import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

export async function extractPdfText(blob: Blob, onProgress?: (frac: number) => void): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  const data = new Uint8Array(await blob.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data }).promise;
  try {
    let text = "";
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      for (const item of content.items) {
        if ("str" in item) {
          text += item.str;
          if (item.hasEOL) text += "\n";
        }
      }
      text += "\n";
      onProgress?.(p / pdf.numPages);
    }
    return text;
  } finally {
    await pdf.destroy();
  }
}
