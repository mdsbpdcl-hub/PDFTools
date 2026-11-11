import { useEffect, useRef, useState, type ReactNode, type PointerEvent as RPointerEvent } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { renderPage } from "../lib/pdfjs";

/** Rectangle in fractions (0..1) of the displayed page, origin top-left. */
export interface FRect { x: number; y: number; w: number; h: number }

/** Shows one page, with an overlay for boxes. Coordinates passed to children are fractions of the page. */
export function PageCanvas({ doc, page, maxWidth = 760, children, label }: { doc: PDFDocumentProxy; page: number; maxWidth?: number; children?: ReactNode; label: string }) {
  const holder = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      const p = await doc.getPage(page + 1);
      const vp = p.getViewport({ scale: 1 });
      const cssW = Math.min(maxWidth, holder.current?.parentElement?.clientWidth ?? maxWidth);
      const scale = (cssW / vp.width) * (window.devicePixelRatio || 1);
      const { canvas } = await renderPage(p, scale);
      p.cleanup();
      if (!alive || !holder.current) return;
      canvas.style.width = `${cssW}px`;
      canvas.setAttribute("role", "img");
      canvas.setAttribute("aria-label", label);
      holder.current.replaceChildren(canvas);
      setSize({ w: cssW, h: (cssW * vp.height) / vp.width });
    })().catch(() => { /* render failure leaves the placeholder */ });
    return () => { alive = false; };
  }, [doc, page, maxWidth, label]);
  return (
    <div className="viewer" style={size ? { width: size.w } : { width: "100%", minHeight: 200 }}>
      <div ref={holder}><p className="muted small" style={{ padding: 12 }}>Loading page…</p></div>
      {size && <div className="overlay">{children}</div>}
    </div>
  );
}

/** Lets the user drag out rectangles on the page overlay. */
export function DrawLayer({ onRect, minSize = 0.01, ariaLabel }: { onRect: (r: FRect) => void; minSize?: number; ariaLabel: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [start, setStart] = useState<{ x: number; y: number } | null>(null);
  const [cur, setCur] = useState<FRect | null>(null);
  const pos = (e: RPointerEvent) => {
    const b = ref.current!.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - b.left) / b.width)), y: Math.min(1, Math.max(0, (e.clientY - b.top) / b.height)) };
  };
  return (
    <div
      ref={ref}
      aria-label={ariaLabel}
      style={{ position: "absolute", inset: 0, cursor: "crosshair" }}
      onPointerDown={(e) => { if ((e.target as HTMLElement).tagName === "BUTTON") return; (e.target as HTMLElement).setPointerCapture(e.pointerId); const p = pos(e); setStart(p); setCur({ x: p.x, y: p.y, w: 0, h: 0 }); }}
      onPointerMove={(e) => { if (!start) return; const p = pos(e); setCur({ x: Math.min(p.x, start.x), y: Math.min(p.y, start.y), w: Math.abs(p.x - start.x), h: Math.abs(p.y - start.y) }); }}
      onPointerUp={() => { if (cur && cur.w > minSize && cur.h > minSize) onRect(cur); setStart(null); setCur(null); }}
      onPointerCancel={() => { setStart(null); setCur(null); }}
    >
      {cur && <div className="draft" style={pct(cur)} />}
    </div>
  );
}

export const pct = (r: FRect) => ({ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` });

export function PageNav({ page, total, onChange, extra }: { page: number; total: number; onChange: (p: number) => void; extra?: ReactNode }) {
  return (
    <div className="row">
      <button className="btn sm" type="button" disabled={page <= 0} onClick={() => onChange(page - 1)}>‹ Previous</button>
      <span className="small">Page <strong>{page + 1}</strong> of {total}</span>
      <button className="btn sm" type="button" disabled={page >= total - 1} onClick={() => onChange(page + 1)}>Next ›</button>
      {extra}
    </div>
  );
}
