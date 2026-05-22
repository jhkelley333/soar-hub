// PDF export for a completed reno scope. Cover page → per-tier
// checklist tables → photo gallery → 360 tour list. Uses the existing
// jspdf + jspdf-autotable already in package.json.
//
// Photos are fetched via signed URL, converted to data URLs, and
// embedded. A failed photo fetch is logged and skipped rather than
// killing the whole export. Capped at MAX_PHOTOS so a runaway scope
// doesn't produce a 200 MB PDF.

import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import {
  fetchPhotoSlots,
  fetchScopeItems,
  fetchScopePhotos,
  fetchScopeNotes,
  fetchTemplateItems,
  getPhotoSignedUrl,
} from "./api";
import {
  BUILDING_TYPE_LABELS,
  COHORT_LABELS,
  ITEM_STATUS_LABELS,
  STATUS_LABELS,
  TIER_LABELS,
  TIER_ORDER,
  itemRequiredForBuilding,
  type RenoScopeRow,
  type ScopeTemplateItem,
  type ScopeTier,
} from "./types";

const MAX_PHOTOS = 60;

export async function exportScopePdf(scope: RenoScopeRow): Promise<void> {
  const [items, answers, photos, slots, notes] = await Promise.all([
    fetchTemplateItems(scope.template_id),
    fetchScopeItems(scope.id),
    fetchScopePhotos(scope.id),
    fetchPhotoSlots(scope.template_id),
    fetchScopeNotes(scope.id),
  ]);

  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const margin = 40;
  const pageW = doc.internal.pageSize.getWidth();

  // ---- Cover page ------------------------------------------------------
  doc.setFontSize(18);
  doc.text("SOAR Reno Scope", margin, 60);

  doc.setFontSize(13);
  doc.setTextColor(60);
  doc.text(
    `${scope.store?.number ?? "—"}  ${scope.store?.name ?? ""}`,
    margin,
    82,
  );
  doc.setTextColor(0);

  doc.setFontSize(9);
  const ts = new Date().toLocaleString();
  doc.setTextColor(120);
  doc.text(`Exported ${ts}`, margin, 100);
  doc.setTextColor(0);

  autoTable(doc, {
    startY: 120,
    head: [["Field", "Value"]],
    body: [
      ["Status", STATUS_LABELS[scope.status]],
      ["Building type", BUILDING_TYPE_LABELS[scope.building_type]],
      ["Cohort", scope.cohort ? COHORT_LABELS[scope.cohort] : "—"],
      ["Scope date", scope.scope_date],
      ["Scoped by", scope.scoper?.full_name ?? scope.scoper?.email ?? "—"],
      ["State", scope.store?.state ?? "—"],
      ["Signage vendor", scope.preferred_signage_vendor ?? "—"],
      ["Canopy vendor", scope.preferred_canopy_vendor ?? "—"],
      ["General contractor", scope.preferred_gc ?? "—"],
      ["Paint contractor", scope.preferred_paint_contractor ?? "—"],
    ],
    theme: "grid",
    styles: { fontSize: 10, cellPadding: 5 },
    headStyles: { fillColor: [30, 41, 59] },
    columnStyles: {
      0: { cellWidth: 140, fontStyle: "bold" },
      1: { cellWidth: "auto" },
    },
  });

  // Reviewer notes (if kicked back)
  if (scope.review_notes) {
    const y = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 300;
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.text("Reviewer notes", margin, y + 24);
    doc.setFont("helvetica", "normal");
    const wrapped = doc.splitTextToSize(scope.review_notes, pageW - margin * 2);
    doc.text(wrapped, margin, y + 40);
  }

  // ---- Checklist by tier ----------------------------------------------
  const answersById: Record<string, (typeof answers)[number]> = {};
  for (const a of answers) answersById[a.template_item_id] = a;

  const itemsByTier: Partial<Record<ScopeTier, ScopeTemplateItem[]>> = {};
  for (const it of items) {
    if (!it.applies_to_building_types.includes(scope.building_type)) continue;
    (itemsByTier[it.tier] = itemsByTier[it.tier] ?? []).push(it);
  }
  for (const tier of Object.keys(itemsByTier) as ScopeTier[]) {
    itemsByTier[tier]!.sort((a, b) => a.sort_order - b.sort_order);
  }

  for (const tier of TIER_ORDER) {
    const list = itemsByTier[tier];
    if (!list || list.length === 0) continue;
    doc.addPage();
    doc.setFontSize(13);
    doc.setFont("helvetica", "bold");
    doc.text(TIER_LABELS[tier], margin, 50);
    doc.setFont("helvetica", "normal");

    autoTable(doc, {
      startY: 64,
      head: [["#", "Item", "Status", "Cost", "Notes"]],
      body: list.map((it) => {
        const a = answersById[it.id];
        let label = "—";
        if (a?.status) {
          label = ITEM_STATUS_LABELS[a.status];
          if (tier === "plus_up" || tier === "optional") {
            if (a.recommend_for_plus_up) label += " ★";
          }
        }
        if (!itemRequiredForBuilding(it, scope.building_type)) {
          label = label === "—" ? "Optional" : label;
        }
        return [
          String(it.sort_order),
          it.item_label,
          label,
          a?.estimated_cost != null ? `$${Number(a.estimated_cost).toLocaleString()}` : "",
          a?.notes ?? "",
        ];
      }),
      theme: "grid",
      styles: { fontSize: 8, cellPadding: 4, valign: "top" },
      headStyles: { fillColor: [30, 41, 59] },
      columnStyles: {
        0: { cellWidth: 28, halign: "right" },
        1: { cellWidth: 220 },
        2: { cellWidth: 70 },
        3: { cellWidth: 60, halign: "right" },
        4: { cellWidth: "auto" },
      },
    });
  }

  // ---- Field notes feed ------------------------------------------------
  if (notes.length > 0) {
    doc.addPage();
    doc.setFontSize(13);
    doc.setFont("helvetica", "bold");
    doc.text("Field notes", margin, 50);
    doc.setFont("helvetica", "normal");
    autoTable(doc, {
      startY: 64,
      head: [["When", "Note"]],
      body: notes.map((n) => [
        new Date(n.created_at).toLocaleString(),
        n.note_text,
      ]),
      theme: "grid",
      styles: { fontSize: 8, cellPadding: 4, valign: "top" },
      headStyles: { fillColor: [30, 41, 59] },
      columnStyles: {
        0: { cellWidth: 130 },
        1: { cellWidth: "auto" },
      },
    });
  }

  // ---- Photo gallery ---------------------------------------------------
  const cappedPhotos = photos.slice(0, MAX_PHOTOS);
  if (cappedPhotos.length > 0) {
    const slotById: Record<string, (typeof slots)[number]> = {};
    for (const s of slots) slotById[s.id] = s;
    const itemById: Record<string, ScopeTemplateItem> = {};
    for (const it of items) itemById[it.id] = it;

    doc.addPage();
    doc.setFontSize(13);
    doc.setFont("helvetica", "bold");
    doc.text("Photos", margin, 50);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);

    // 2-column grid, ~220pt wide each
    const cellW = 235;
    const cellH = 200;
    const gap = 12;
    let row = 0;
    let col = 0;
    const topY = 70;
    let y = topY;

    for (const p of cappedPhotos) {
      // Resolve a label for this photo
      let label = "";
      if (p.photo_slot_id && slotById[p.photo_slot_id]) {
        label = slotById[p.photo_slot_id].slot_name;
      } else if (p.scope_item_id && itemById[p.scope_item_id]) {
        const it = itemById[p.scope_item_id];
        label = `#${it.sort_order} ${it.item_label}`;
      } else if (p.caption) {
        label = p.caption;
      }
      if (p.taken_at) {
        label = label
          ? `${label}  ·  ${new Date(p.taken_at).toLocaleDateString()}`
          : new Date(p.taken_at).toLocaleDateString();
      }

      const x = margin + col * (cellW + gap);

      try {
        const dataUrl = await imageToDataUrl(p.storage_path);
        if (dataUrl) {
          const fmt = dataUrl.startsWith("data:image/png") ? "PNG" : "JPEG";
          doc.addImage(dataUrl, fmt, x, y, cellW, cellH - 22, undefined, "FAST");
        } else {
          drawImagePlaceholder(doc, x, y, cellW, cellH - 22, "missing");
        }
      } catch (err) {
        console.warn("[reno-scoping] PDF photo skipped", p.storage_path, err);
        drawImagePlaceholder(doc, x, y, cellW, cellH - 22, "failed");
      }
      doc.setTextColor(80);
      const lines = doc.splitTextToSize(label || "—", cellW);
      doc.text(lines.slice(0, 2), x, y + cellH - 8);
      doc.setTextColor(0);

      col += 1;
      if (col >= 2) {
        col = 0;
        row += 1;
        y = topY + row * (cellH + gap);
        if (y + cellH > doc.internal.pageSize.getHeight() - margin) {
          doc.addPage();
          row = 0;
          y = topY;
        }
      }
    }

    if (photos.length > MAX_PHOTOS) {
      const noteY = y + cellH + 8;
      doc.setFontSize(8);
      doc.setTextColor(120);
      doc.text(
        `Showing first ${MAX_PHOTOS} of ${photos.length} photos. Full set available in the app.`,
        margin,
        noteY,
      );
      doc.setTextColor(0);
    }
  }

  // ---- 360 tours -------------------------------------------------------
  // PDF can't render Pannellum, so we just list each sphere by
  // capture_position with a "view in app" hint.
  // Tours table will be populated when PR 3b ships the tour upload UI.

  const today = new Date().toISOString().slice(0, 10);
  const number = scope.store?.number ?? "scope";
  doc.save(`soar-reno-scope-${number}-${today}.pdf`);
}

// ---- helpers -----------------------------------------------------------

async function imageToDataUrl(storagePath: string): Promise<string | null> {
  const url = await getPhotoSignedUrl(storagePath, 60 * 60);
  const res = await fetch(url);
  if (!res.ok) return null;
  const blob = await res.blob();
  return await blobToDataUrl(blob);
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function drawImagePlaceholder(
  doc: jsPDF,
  x: number,
  y: number,
  w: number,
  h: number,
  reason: "missing" | "failed",
) {
  doc.setDrawColor(200);
  doc.setFillColor(245);
  doc.rect(x, y, w, h, "FD");
  doc.setTextColor(150);
  doc.setFontSize(9);
  doc.text(
    reason === "missing" ? "(image unavailable)" : "(failed to load)",
    x + w / 2,
    y + h / 2,
    { align: "center" },
  );
  doc.setTextColor(0);
  doc.setDrawColor(0);
  doc.setFillColor(0);
}
