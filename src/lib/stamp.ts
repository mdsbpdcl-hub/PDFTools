import type { PDFFont, PDFImage, PDFPage } from "pdf-lib";
import { getPdfLib } from "./pdflib";
import { UserError } from "./types";

export type Anchor = "tl" | "tc" | "tr" | "ml" | "mc" | "mr" | "bl" | "bc" | "br";

/** Page geometry as the reader sees it (after /Rotate), with a mapper back to PDF user space. */
export function displayFrame(page: PDFPage) {
  const box = page.getCropBox();
  const r = ((page.getRotation().angle % 360) + 360) % 360;
  const W = box.width, H = box.height;
  const swap = r === 90 || r === 270;
  const w = swap ? H : W, h = swap ? W : H;
  const toUser = (dx: number, dy: number) => {
    let x: number, y: number;
    if (r === 90) { x = W - dy; y = dx; }
    else if (r === 180) { x = W - dx; y = H - dy; }
    else if (r === 270) { x = dy; y = H - dx; }
    else { x = dx; y = dy; }
    return { x: x + box.x, y: y + box.y };
  };
  return { w, h, rotation: r, toUser };
}

/** Centre point (display coords, origin bottom-left) for an item of the given rotated size. */
export function anchorPoint(anchor: Anchor | "tile", w: number, h: number, itemW: number, itemH: number, angleDeg: number, margin: number) {
  const a = (angleDeg * Math.PI) / 180;
  const bw = Math.abs(itemW * Math.cos(a)) + Math.abs(itemH * Math.sin(a));
  const bh = Math.abs(itemW * Math.sin(a)) + Math.abs(itemH * Math.cos(a));
  const col = anchor === "tile" ? "c" : anchor[1];
  const row = anchor === "tile" ? "m" : anchor[0];
  const cx = col === "l" ? margin + bw / 2 : col === "r" ? w - margin - bw / 2 : w / 2;
  const cy = row === "b" ? margin + bh / 2 : row === "t" ? h - margin - bh / 2 : h / 2;
  return { cx, cy, bw, bh };
}

/** Draws text centred on (cx, cy) in display coordinates, rotated by angle (counter-clockwise). */
export async function drawTextCentered(page: PDFPage, text: string, o: {
  cx: number; cy: number; font: PDFFont; size: number; color: [number, number, number]; opacity: number; angle: number;
}) {
  const { rgb, degrees } = await getPdfLib();
  const f = displayFrame(page);
  const tw = o.font.widthOfTextAtSize(text, o.size);
  const th = o.font.heightAtSize(o.size, { descender: false });
  const a = (o.angle * Math.PI) / 180;
  // start = centre − R(a)·(tw/2, th/2)
  const sx = o.cx - (Math.cos(a) * tw) / 2 + (Math.sin(a) * th) / 2;
  const sy = o.cy - (Math.sin(a) * tw) / 2 - (Math.cos(a) * th) / 2;
  const p = f.toUser(sx, sy);
  page.drawText(text, { x: p.x, y: p.y, size: o.size, font: o.font, color: rgb(...o.color), opacity: o.opacity, rotate: degrees(o.angle + f.rotation) });
}

export async function drawImageCentered(page: PDFPage, img: PDFImage, o: { cx: number; cy: number; width: number; height: number; opacity: number; angle: number }) {
  const { degrees } = await getPdfLib();
  const f = displayFrame(page);
  const a = (o.angle * Math.PI) / 180;
  const sx = o.cx - (Math.cos(a) * o.width) / 2 + (Math.sin(a) * o.height) / 2;
  const sy = o.cy - (Math.sin(a) * o.width) / 2 - (Math.cos(a) * o.height) / 2;
  const p = f.toUser(sx, sy);
  page.drawImage(img, { x: p.x, y: p.y, width: o.width, height: o.height, opacity: o.opacity, rotate: degrees(o.angle + f.rotation) });
}

/** Standard PDF fonts only cover Western European characters. */
export function assertEncodable(font: PDFFont, text: string) {
  try { font.encodeText(text); } catch {
    throw new UserError("The text contains characters the built-in font cannot show (for example Hindi). Use English letters, numbers and common symbols.");
  }
}
