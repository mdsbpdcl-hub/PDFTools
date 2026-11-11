// Lazy wrapper around pdf.js (Mozilla, Apache-2.0) for rendering and text extraction.
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import { UserError } from "./types";

type PdfjsModule = typeof import("pdfjs-dist");
let modPromise: Promise<PdfjsModule> | null = null;

export const vendorUrl = (path: string) => new URL(`vendor/${path}`, document.baseURI).href;

export function getPdfjs(): Promise<PdfjsModule> {
  if (!modPromise) {
    modPromise = (async () => {
      const [mod, worker] = await Promise.all([
        import("pdfjs-dist"),
        import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
      ]);
      mod.GlobalWorkerOptions.workerSrc = worker.default;
      return mod;
    })();
  }
  return modPromise;
}

export async function openPdf(data: Uint8Array | ArrayBuffer | Blob, password?: string): Promise<PDFDocumentProxy> {
  const pdfjs = await getPdfjs();
  const bytes = data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : new Uint8Array(data).slice();
  const task = pdfjs.getDocument({
    data: bytes,
    password,
    cMapUrl: vendorUrl("pdfjs/cmaps/"),
    cMapPacked: true,
    standardFontDataUrl: vendorUrl("pdfjs/standard_fonts/"),
    wasmUrl: vendorUrl("pdfjs/wasm/"),
    iccUrl: vendorUrl("pdfjs/iccs/"),
    enableXfa: false,
  });
  try {
    return await task.promise;
  } catch (e) {
    const name = (e as { name?: string })?.name;
    if (name === "PasswordException") {
      throw new UserError(password ? "That password is not correct." : "This PDF is password-protected. Use “Unlock PDF” first if you have the password.");
    }
    if (name === "InvalidPDFException") throw new UserError("This file is not a valid PDF, or it is damaged.");
    throw e;
  }
}

/** Inspects a PDF: page count and whether it needs a password to open. */
export async function inspectPdf(file: File): Promise<{ pages?: number; encrypted: boolean; restricted?: boolean }> {
  const pdfjs = await getPdfjs();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const task = pdfjs.getDocument({ data: bytes, stopAtErrors: false });
  try {
    const doc = await task.promise;
    const pages = doc.numPages;
    // Files that open without a password can still carry permission restrictions (owner password).
    const perms = await doc.getPermissions().catch(() => null);
    await closePdf(doc);
    return { pages, encrypted: false, restricted: perms !== null };
  } catch (e) {
    const name = (e as { name?: string })?.name;
    if (name === "PasswordException") return { encrypted: true };
    if (name === "InvalidPDFException") throw new UserError("Not a valid PDF, or the file is damaged.");
    throw new UserError("Could not read this PDF.");
  } finally {
    task.destroy();
  }
}

/** Largest canvas area we allow (Safari on iOS fails above ~16.7 million pixels). */
export const MAX_CANVAS_PIXELS = 16_000_000;

export async function renderPage(
  page: PDFPageProxy,
  scale: number,
  opts: { annotations?: boolean; rotation?: number; background?: string } = {},
): Promise<{ canvas: HTMLCanvasElement; scale: number }> {
  const pdfjs = await getPdfjs();
  let viewport = page.getViewport({ scale, rotation: opts.rotation ?? page.rotate });
  const area = viewport.width * viewport.height;
  if (area > MAX_CANVAS_PIXELS) {
    scale = scale * Math.sqrt(MAX_CANVAS_PIXELS / area) * 0.98;
    viewport = page.getViewport({ scale, rotation: opts.rotation ?? page.rotate });
  }
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  const ctx = canvas.getContext("2d", { alpha: false })!;
  ctx.fillStyle = opts.background ?? "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({
    canvas,
    canvasContext: ctx,
    viewport,
    annotationMode: opts.annotations === false ? pdfjs.AnnotationMode.DISABLE : pdfjs.AnnotationMode.ENABLE,
  } as Parameters<PDFPageProxy["render"]>[0]).promise;
  return { canvas, scale };
}

export async function renderThumb(doc: PDFDocumentProxy, pageNumber: number, width = 160, rotation = 0) {
  const page = await doc.getPage(pageNumber);
  const base = page.getViewport({ scale: 1, rotation: (page.rotate + rotation) % 360 });
  const scale = (width * (window.devicePixelRatio || 1)) / base.width;
  const { canvas } = await renderPage(page, scale, { rotation: (page.rotate + rotation) % 360 });
  page.cleanup();
  return canvas;
}

// ---------------------------------------------------------------- text

export interface TItem { str: string; x: number; y: number; w: number; h: number }
export interface TLine { y: number; x0: number; x1: number; size: number; items: TItem[]; text: string }
export interface TPara { text: string; size: number; heading: boolean }

export async function pageItems(page: PDFPageProxy): Promise<TItem[]> {
  const tc = await page.getTextContent();
  const items: TItem[] = [];
  for (const it of tc.items) {
    if (!("str" in it)) continue;
    if (!it.str) continue;
    const [a, b, c, d, e, f] = it.transform as number[];
    const h = Math.hypot(c, d) || Math.hypot(a, b) || it.height || 10;
    items.push({ str: it.str, x: e, y: f, w: it.width, h });
  }
  return items;
}

export function groupLines(items: TItem[]): TLine[] {
  const sorted = [...items].sort((p, q) => q.y - p.y || p.x - q.x);
  const lines: TLine[] = [];
  for (const it of sorted) {
    if (!it.str.trim() && it.w < 1) continue;
    const line = lines.find((l) => Math.abs(l.y - it.y) < Math.max(2, Math.min(l.size, it.h) * 0.5));
    if (line) line.items.push(it);
    else lines.push({ y: it.y, x0: 0, x1: 0, size: it.h, items: [it], text: "" });
  }
  for (const l of lines) {
    l.items.sort((p, q) => p.x - q.x);
    l.x0 = l.items[0].x;
    l.x1 = Math.max(...l.items.map((i) => i.x + i.w));
    l.size = Math.max(...l.items.map((i) => i.h));
    let text = "";
    let prevEnd = -Infinity;
    for (const it of l.items) {
      const gap = it.x - prevEnd;
      if (text && gap > l.size * 0.18 && !text.endsWith(" ") && !it.str.startsWith(" ")) text += " ";
      text += it.str;
      prevEnd = it.x + it.w;
    }
    l.text = text.replace(/\s+/g, " ").trim();
  }
  return lines.filter((l) => l.text).sort((p, q) => q.y - p.y);
}

export function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/** Joins lines into paragraphs using vertical gaps and font size changes. */
export function toParagraphs(lines: TLine[], bodySize?: number): TPara[] {
  if (!lines.length) return [];
  const body = bodySize ?? median(lines.map((l) => l.size));
  const gaps: number[] = [];
  for (let i = 1; i < lines.length; i++) gaps.push(lines[i - 1].y - lines[i].y);
  const lineGap = median(gaps.filter((g) => g > 0)) || body * 1.2;
  const paras: TPara[] = [];
  let cur: TLine[] = [];
  const flush = () => {
    if (!cur.length) return;
    let text = "";
    for (const l of cur) {
      if (text.endsWith("-") && /^[a-z]/.test(l.text)) text = text.slice(0, -1) + l.text;
      else text += (text ? " " : "") + l.text;
    }
    const size = median(cur.map((l) => l.size));
    paras.push({ text, size, heading: size >= body * 1.2 && text.length < 160 });
    cur = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (cur.length) {
      const prev = cur[cur.length - 1];
      const gap = prev.y - l.y;
      const sizeChange = Math.abs(l.size - prev.size) > body * 0.15;
      if (gap > lineGap * 1.45 || gap < 0 || sizeChange) flush();
    }
    cur.push(l);
  }
  flush();
  return paras;
}

export async function pageText(page: PDFPageProxy): Promise<string> {
  return groupLines(await pageItems(page)).map((l) => l.text).join("\n");
}

/** Releases a document opened with pdf.js (and its worker resources). */
export function closePdf(doc: PDFDocumentProxy): Promise<void> {
  return doc.loadingTask.destroy();
}
