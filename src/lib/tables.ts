import { groupLines, type TItem } from "./pdfjs";

/** Detects a grid of cells on one page from text positions. */
export function detectTable(items: TItem[], tablesOnly: boolean): string[][] {
  const lines = groupLines(items);
  // Split each line into cells at wide horizontal gaps.
  type C = { x0: number; x1: number; text: string };
  const rows: C[][] = lines.map((l) => {
    const cells: C[] = [];
    for (const it of l.items) {
      if (!it.str.trim()) continue; // spacer items can span column gaps
      const last = cells[cells.length - 1];
      const gap = last ? it.x - last.x1 : Infinity;
      if (last && gap < Math.max(l.size * 0.9, 4)) {
        last.text += (gap > l.size * 0.15 && !last.text.endsWith(" ") ? " " : "") + it.str;
        last.x1 = Math.max(last.x1, it.x + it.w);
      } else {
        cells.push({ x0: it.x, x1: it.x + it.w, text: it.str });
      }
    }
    return cells.map((c) => ({ ...c, text: c.text.replace(/\s+/g, " ").trim() })).filter((c) => c.text);
  });
  const tableRows = rows.filter((r) => r.length >= 2);
  if (!tableRows.length) return tablesOnly ? [] : rows.map((r) => [r.map((c) => c.text).join(" ")]);

  // Column boundaries: x positions covered by cells in table rows.
  const minX = Math.floor(Math.min(...tableRows.flat().map((c) => c.x0)));
  const maxX = Math.ceil(Math.max(...tableRows.flat().map((c) => c.x1)));
  const cover = new Uint16Array(maxX - minX + 2);
  for (const r of tableRows) for (const c of r) for (let x = Math.floor(c.x0); x < Math.ceil(c.x1); x++) cover[x - minX]++;
  const limit = Math.max(1, Math.floor(tableRows.length * 0.08));
  const cols: [number, number][] = [];
  let start = -1;
  for (let i = 0; i < cover.length; i++) {
    const on = cover[i] > limit;
    if (on && start < 0) start = i;
    if (!on && start >= 0) { cols.push([start + minX, i + minX]); start = -1; }
  }
  if (start >= 0) cols.push([start + minX, cover.length + minX]);
  if (cols.length < 2) return tablesOnly ? [] : rows.map((r) => [r.map((c) => c.text).join(" ")]);

  const colOf = (c: C) => {
    let best = 0, bestOverlap = -Infinity;
    cols.forEach(([a, b], i) => {
      const overlap = Math.min(b, c.x1) - Math.max(a, c.x0);
      const dist = overlap > 0 ? overlap : -Math.min(Math.abs(a - c.x1), Math.abs(c.x0 - b));
      if (dist > bestOverlap) { bestOverlap = dist; best = i; }
    });
    return best;
  };
  const out: string[][] = [];
  for (const r of rows) {
    if (r.length < 2 && tablesOnly) continue;
    const row = new Array<string>(cols.length).fill("");
    for (const c of r) { const k = colOf(c); row[k] = row[k] ? `${row[k]} ${c.text}` : c.text; }
    out.push(row);
  }
  return out;
}
