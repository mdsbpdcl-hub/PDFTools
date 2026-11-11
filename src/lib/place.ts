import type { PDFDocumentProxy } from "pdfjs-dist";
import type { FRect } from "../components/PageCanvas";

/**
 * Converts a rectangle given in fractions of the displayed page (top-left origin, after the page's
 * own rotation) into PDF user-space placement: origin, size and the rotation needed to look upright.
 */
export async function toUserSpace(pdf: PDFDocumentProxy, pageIndex: number, r: FRect) {
  const page = await pdf.getPage(pageIndex + 1);
  const vp = page.getViewport({ scale: 1 });
  const pt = (fx: number, fy: number) => {
    const [x, y] = vp.convertToPdfPoint(fx * vp.width, fy * vp.height) as [number, number];
    return { x, y };
  };
  const o = pt(r.x, r.y + r.h); // display bottom-left
  const right = pt(r.x + r.w, r.y + r.h);
  const top = pt(r.x, r.y);
  const width = Math.hypot(right.x - o.x, right.y - o.y);
  const height = Math.hypot(top.x - o.x, top.y - o.y);
  const angle = Math.round((Math.atan2(right.y - o.y, right.x - o.x) * 180) / Math.PI);
  const xs = [o.x, right.x, top.x, right.x + top.x - o.x];
  const ys = [o.y, right.y, top.y, right.y + top.y - o.y];
  page.cleanup();
  return {
    x: o.x, y: o.y, width, height, angle,
    /** Axis-aligned box in user space (for form field widgets). */
    box: { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) },
    displayAspect: vp.width / vp.height,
  };
}
