import { UserError } from "./types";

/**
 * Parses page selections such as "1-3, 5, 8-" (1-based, inclusive) into 0-based page indexes.
 * "8-" means page 8 to the end. Empty input means all pages when allowEmpty is true.
 */
export function parsePages(input: string, total: number, allowEmpty = true): number[] {
  const groups = parseGroups(input, total, allowEmpty);
  const out: number[] = [];
  for (const g of groups) out.push(...g);
  return out;
}

/** Like parsePages, but keeps each comma-separated part as its own group (used for Split). */
export function parseGroups(input: string, total: number, allowEmpty = true): number[][] {
  const s = input.trim();
  if (!s) {
    if (allowEmpty) return [Array.from({ length: total }, (_, i) => i)];
    throw new UserError("Enter at least one page or range, for example 1-3, 5.");
  }
  const groups: number[][] = [];
  for (const raw of s.split(/[,;]/)) {
    const part = raw.trim();
    if (!part) continue;
    const m = /^(\d+)?\s*(?:(-|–|to)\s*(\d+)?)?$/i.exec(part);
    if (!m || (!m[1] && !m[3])) throw new UserError(`"${part}" is not a valid page or range. Use forms like 4, 2-6 or 8-.`);
    const a = m[1] ? parseInt(m[1], 10) : 1;
    const b = m[2] ? (m[3] ? parseInt(m[3], 10) : total) : a;
    if (a < 1 || b < 1) throw new UserError("Page numbers start at 1.");
    if (a > total || b > total) throw new UserError(`"${part}" goes beyond the last page (${total}).`);
    const g: number[] = [];
    if (a <= b) for (let i = a; i <= b; i++) g.push(i - 1);
    else for (let i = a; i >= b; i--) g.push(i - 1);
    groups.push(g);
  }
  if (!groups.length) throw new UserError("Enter at least one page or range.");
  return groups;
}

export function describePages(indexes: number[]): string {
  if (!indexes.length) return "none";
  const sorted = [...new Set(indexes)].sort((x, y) => x - y);
  const parts: string[] = [];
  let start = sorted[0];
  let prev = start;
  for (let i = 1; i <= sorted.length; i++) {
    const v = sorted[i];
    if (v === prev + 1) { prev = v; continue; }
    parts.push(start === prev ? `${start + 1}` : `${start + 1}-${prev + 1}`);
    start = prev = v;
  }
  return parts.join(", ");
}
