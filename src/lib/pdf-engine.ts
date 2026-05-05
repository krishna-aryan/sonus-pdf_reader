// Lazy wrapper around pdf.js with worker setup. Loads pages on demand.
import * as pdfjsLib from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";

if (typeof window !== "undefined") {
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;
}

export interface PageContent {
  pageNumber: number;
  text: string;
  // word offsets so we can map TTS boundaries back to characters
  words: { start: number; end: number; text: string }[];
}

export async function loadPdfFromBlob(blob: Blob) {
  const buf = await blob.arrayBuffer();
  try {
    return await pdfjsLib.getDocument({ data: buf }).promise;
  } catch (err) {
    console.warn("pdf.js worker load failed, retrying without worker", err);
    // iOS WebKit can fail module-worker initialization in some browser/version combos.
    return await pdfjsLib.getDocument({ data: buf, disableWorker: true }).promise;
  }
}

export async function getPageCount(blob: Blob): Promise<number> {
  const doc = await loadPdfFromBlob(blob);
  const n = doc.numPages;
  await doc.destroy();
  return n;
}

export async function extractPageText(
  doc: Awaited<ReturnType<typeof loadPdfFromBlob>>,
  pageNumber: number
): Promise<PageContent> {
  const page = await doc.getPage(pageNumber);
  let content = await page.getTextContent();
  if (!content.items.length) {
    // Retry with normalization hints to improve extraction for some iOS-rendered PDFs.
    content = await page.getTextContent({
      normalizeWhitespace: true,
      disableCombineTextItems: false,
    });
  }
  let text = "";
  let lastY: number | null = null;
  for (const item of content.items as Array<{ str?: string; transform?: number[]; hasEOL?: boolean }>) {
    const str = item.str ?? "";
    const y = item.transform?.[5] ?? null;
    if (lastY !== null && y !== null && Math.abs(y - lastY) > 5 && text && !text.endsWith(" ") && !text.endsWith("\n")) {
      text += "\n";
    }
    text += str;
    if (item.hasEOL) text += "\n";
    else text += " ";
    lastY = y;
  }
  text = text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

  // tokenize into words with character offsets
  const words: PageContent["words"] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    words.push({ start: m.index, end: m.index + m[0].length, text: m[0] });
  }
  page.cleanup();
  return { pageNumber, text, words };
}
