import type { Editor } from "tldraw";

/**
 * Board export helpers (REVIEW P2-1/backlog "share my notes").
 *
 * tldraw's export API is browser/DOM-only and there is no toPdf in the SDK
 * (REVIEW §5), so the PDF is assembled client-side: each page renders to a
 * PNG via editor.toImage and pdf-lib lays the pages into one document.
 * Returns a short user-facing message so the toolbar can surface success or
 * a precise failure without throwing into the UI.
 */

async function downloadBlob(blob: Blob, filename: string): Promise<string> {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return `Saved ${filename}`;
}

function pageName(editor: Editor): string {
  const page = editor.getCurrentPage();
  return (page?.name ?? "page").trim().replace(/\s+/g, "-").replace(/[^a-zA-Z0-9_-]/g, "") || "page";
}

/** Exports the current page as a PNG at 2x. */
export async function exportCurrentPagePng(editor: Editor): Promise<string> {
  const ids = [...editor.getCurrentPageShapeIds()];
  const result = await editor.toImage(ids, { format: "png", scale: 1, pixelRatio: 2 });
  const stamp = new Date().toISOString().slice(0, 10);
  return downloadBlob(result.blob, `inkboard-${pageName(editor)}-${stamp}.png`);
}

/**
 * Exports every page as one PDF. Blank pages are skipped; a board with no
 * shapes on any page reports that instead of producing an empty document.
 */
export async function exportBoardPdf(editor: Editor): Promise<string> {
  const { PDFDocument } = await import("pdf-lib");
  const pages = editor.getPages();
  const pdf = await PDFDocument.create();

  let exported = 0;
  for (const page of pages) {
    const ids = [...editor.getPageShapeIds(page.id)];
    if (ids.length === 0) continue;
    const result = await editor.toImage(ids, { format: "png", scale: 1, pixelRatio: 2 });
    const png = await pdf.embedPng(await result.blob.arrayBuffer());
    // Points == pixels at 72dpi; scale 2 export is downsampled to 1x points
    // so the PDF page is roughly what a 1080p export would look like.
    const width = Math.max(1, Math.round(result.width));
    const height = Math.max(1, Math.round(result.height));
    const pdfPage = pdf.addPage([width, height]);
    pdfPage.drawImage(png, { x: 0, y: 0, width, height });
    exported += 1;
  }

  if (exported === 0) {
    return "Nothing to export yet — the board is empty";
  }

  const bytes = await pdf.save();
  const pdfBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const blob = new Blob([pdfBuffer], { type: "application/pdf" });
  const stamp = new Date().toISOString().slice(0, 10);
  return downloadBlob(blob, `inkboard-board-${stamp}.pdf`);
}
