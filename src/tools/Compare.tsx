import { useEffect, useMemo, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { Change } from "diff";
import type { ToolProps } from "../lib/types";
import { openPdf, pageText, renderPage, closePdf } from "../lib/pdfjs";
import { baseName, plural, yieldToUI } from "../lib/util";
import { Note, Progress, Seg, Tiles, usePdfDoc } from "../components/ui";
import { PageNav } from "../components/PageCanvas";

type DiffFn = (a: string, b: string) => Change[];

export default function Compare({ files, setAction }: ToolProps) {
  const [a, b] = files;
  const docA = usePdfDoc(a.file);
  const docB = usePdfDoc(b.file);
  const [texts, setTexts] = useState<{ a: string[]; b: string[] } | null>(null);
  const [diffWords, setDiffWords] = useState<DiffFn | null>(null);
  const [loading, setLoading] = useState({ done: 0, total: (a.pages ?? 0) + (b.pages ?? 0), err: "" });
  const [view, setView] = useState<"text" | "visual">("text");
  const [page, setPage] = useState(0);
  const pages = Math.max(a.pages ?? 0, b.pages ?? 0);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const mod = await import("diff");
        if (alive) setDiffWords(() => mod.diffWords as DiffFn);
        let done = 0;
        const read = async (file: File) => {
          const pdf = await openPdf(file);
          const out: string[] = [];
          for (let n = 1; n <= pdf.numPages && alive; n++) {
            const p = await pdf.getPage(n);
            out.push(await pageText(p));
            p.cleanup();
            done++;
            setLoading((l) => ({ ...l, done }));
            if (n % 5 === 0) await yieldToUI();
          }
          await closePdf(pdf);
          return out;
        };
        const ta = await read(a.file);
        const tb = await read(b.file);
        if (alive) setTexts({ a: ta, b: tb });
      } catch (e) { if (alive) setLoading((l) => ({ ...l, err: e instanceof Error ? e.message : String(e) })); }
    })();
    return () => { alive = false; };
  }, [a, b]);

  const diffs = useMemo(() => {
    if (!texts || !diffWords) return null;
    return Array.from({ length: pages }, (_, i) => diffWords(texts.a[i] ?? "", texts.b[i] ?? ""));
  }, [texts, diffWords, pages]);

  const stats = useMemo(() => {
    if (!diffs) return null;
    let added = 0, removed = 0;
    const changedPages: number[] = [];
    diffs.forEach((d, i) => {
      let changed = false;
      for (const c of d) {
        const words = c.value.trim() ? c.value.trim().split(/\s+/).length : 0;
        if (c.added) { added += words; if (words) changed = true; }
        if (c.removed) { removed += words; if (words) changed = true; }
      }
      if (changed) changedPages.push(i);
    });
    return { added, removed, changedPages };
  }, [diffs]);

  useEffect(() => {
    setAction({
      label: "Download comparison report",
      disabled: !diffs || !stats,
      disabledReason: "Comparing…",
      run: async () => {
        const html = buildReport(a.file.name, b.file.name, diffs!, stats!);
        return {
          outputs: [{ name: `comparison_${baseName(a.file.name)}_vs_${baseName(b.file.name)}.html`, blob: new Blob([html], { type: "text/html;charset=utf-8" }) }],
          notes: [{ tone: "info", text: "The report opens in any web browser and can be printed to PDF." }],
        };
      },
    });
  }, [diffs, stats, a, b, setAction]);

  if (loading.err) return <Note tone="error">{loading.err}</Note>;
  if (!diffs || !stats) {
    return <div className="card stack"><p className="muted">Reading both files… ({loading.done} of {loading.total} pages)</p><Progress value={loading.total ? loading.done / loading.total : null} /></div>;
  }
  const noText = texts!.a.every((t) => !t.trim()) && texts!.b.every((t) => !t.trim());
  const d = diffs[page] ?? [];
  return (
    <div className="stack-lg">
      <Tiles items={[
        { label: "Words added", value: stats.added.toLocaleString() },
        { label: "Words removed", value: stats.removed.toLocaleString() },
        { label: "Pages with changes", value: `${stats.changedPages.length} of ${pages}` },
        { label: "Page counts", value: `${a.pages} → ${b.pages}` },
      ]} />
      {noText && <Note tone="warn">Neither file has extractable text (they may be scans). Use the visual comparison, or run OCR on both first.</Note>}
      {a.pages !== b.pages && <Note tone="info">The files have different page counts. Pages are compared by position, so an inserted page makes later pages look changed. Use the visual view to check.</Note>}
      <div className="card stack">
        <div className="row">
          <Seg<"text" | "visual"> label="View" value={view} onChange={setView} options={[{ value: "text", label: "Text changes" }, { value: "visual", label: "Visual differences" }]} />
          <div className="grow" />
          {stats.changedPages.length > 0 && (
            <label className="row small" style={{ gap: 6 }}>Jump to a changed page
              <select className="input" style={{ width: "auto" }} value={stats.changedPages.includes(page) ? page : ""} onChange={(e) => setPage(Number(e.target.value))}>
                <option value="" disabled>—</option>
                {stats.changedPages.map((p) => <option key={p} value={p}>Page {p + 1}</option>)}
              </select>
            </label>
          )}
        </div>
        <PageNav page={page} total={pages} onChange={setPage} extra={<span className={`tag ${stats.changedPages.includes(page) ? "backend" : "ok"}`}>{stats.changedPages.includes(page) ? "Changed" : "No text changes"}</span>} />
        {view === "text" ? (
          <>
            <p className="small muted"><ins style={{ background: "#dcfce7", textDecoration: "none", padding: "0 4px" }}>Added in {b.file.name}</ins> · <del style={{ background: "#fee2e2", padding: "0 4px" }}>Removed from {a.file.name}</del></p>
            <div className="diff" aria-label={`Text differences on page ${page + 1}`}>
              {d.length === 0 || d.every((c) => !c.value.trim()) ? <span className="muted">No text on this page in either file.</span> :
                d.map((c, i) => (c.added ? <ins key={i}>{c.value}</ins> : c.removed ? <del key={i}>{c.value}</del> : <span key={i}>{c.value}</span>))}
            </div>
          </>
        ) : docA.doc && docB.doc ? (
          <VisualDiff a={docA.doc} b={docB.doc} page={page} />
        ) : <p className="muted">Loading pages…</p>}
      </div>
      <p className="small muted">{plural(stats.changedPages.length, "page")} with text changes. Text comparison ignores formatting, images and position; visual comparison shows any pixel difference.</p>
    </div>
  );
}

function VisualDiff({ a, b, page }: { a: PDFDocumentProxy; b: PDFDocumentProxy; page: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pct, setPct] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      const W = 700;
      const render = async (d: PDFDocumentProxy) => {
        if (page >= d.numPages) return null;
        const p = await d.getPage(page + 1);
        const vp = p.getViewport({ scale: 1 });
        const { canvas } = await renderPage(p, W / vp.width);
        p.cleanup();
        return canvas;
      };
      const [ca, cb] = await Promise.all([render(a), render(b)]);
      if (!alive || !ref.current) return;
      const h = Math.max(ca?.height ?? 0, cb?.height ?? 0);
      const blank = () => { const c = document.createElement("canvas"); c.width = W; c.height = h || 900; const x = c.getContext("2d")!; x.fillStyle = "#f3f4f6"; x.fillRect(0, 0, c.width, c.height); return c; };
      const A = ca ?? blank(), B = cb ?? blank();
      const diff = document.createElement("canvas");
      diff.width = W; diff.height = h;
      const dx = diff.getContext("2d")!;
      const da = A.getContext("2d")!.getImageData(0, 0, W, h).data;
      const db = B.getContext("2d")!.getImageData(0, 0, W, h).data;
      const out = dx.createImageData(W, h);
      let changed = 0;
      for (let i = 0; i < out.data.length; i += 4) {
        const g = (da[i] + da[i + 1] + da[i + 2]) / 3;
        const delta = Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]);
        if (delta > 60) { out.data[i] = 220; out.data[i + 1] = 38; out.data[i + 2] = 38; out.data[i + 3] = 255; changed++; }
        else { const v = 255 - (255 - g) * 0.25; out.data[i] = out.data[i + 1] = out.data[i + 2] = v; out.data[i + 3] = 255; }
      }
      dx.putImageData(out, 0, 0);
      setPct((changed / (W * h)) * 100);
      const label = (c: HTMLCanvasElement, t: string) => { c.setAttribute("role", "img"); c.setAttribute("aria-label", t); return c; };
      const wrap = (c: HTMLCanvasElement, t: string) => { const d = document.createElement("div"); const p = document.createElement("p"); p.className = "small muted"; p.textContent = t; d.append(p, label(c, t)); return d; };
      ref.current.replaceChildren(wrap(A, `Original, page ${page + 1}`), wrap(B, `New version, page ${page + 1}`), wrap(diff, "Differences shown in red"));
    })().catch(() => setPct(null));
    return () => { alive = false; };
  }, [a, b, page]);
  return (
    <div className="stack">
      {pct !== null && <p className="small">About <span className="strong">{pct < 0.01 && pct > 0 ? "<0.01" : pct.toFixed(2)}%</span> of this page looks different.</p>}
      <div ref={ref} className="side-by-side" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}><p className="muted">Rendering…</p></div>
    </div>
  );
}

function buildReport(nameA: string, nameB: string, diffs: Change[][], stats: { added: number; removed: number; changedPages: number[] }): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const body = stats.changedPages.map((i) => `<section><h2>Page ${i + 1}</h2><div class="d">${diffs[i].map((c) => (c.added ? `<ins>${esc(c.value)}</ins>` : c.removed ? `<del>${esc(c.value)}</del>` : esc(c.value))).join("")}</div></section>`).join("\n");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Comparison: ${esc(nameA)} vs ${esc(nameB)}</title>
<style>body{font-family:Inter,"Segoe UI",Roboto,sans-serif;font-size:15px;color:#1f2937;background:#f8f9fb;max-width:900px;margin:24px auto;padding:0 16px}
section,header{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:16px 20px;margin-bottom:14px}.d{white-space:pre-wrap;line-height:1.6}
ins{background:#dcfce7;color:#14532d;text-decoration:none}del{background:#fee2e2;color:#7f1d1d}h1{font-size:20px}h2{font-size:16px;color:#2f6f47}</style></head><body>
<header><h1>Comparison report</h1><p>Original: <strong>${esc(nameA)}</strong><br>New version: <strong>${esc(nameB)}</strong></p>
<p>Words added: <strong>${stats.added}</strong> · Words removed: <strong>${stats.removed}</strong> · Pages with text changes: <strong>${stats.changedPages.length}</strong></p>
<p style="color:#6b7280;font-size:13px">Generated by PDF Desk on ${new Date().toLocaleString()}. Text comparison only; formatting and images are not compared.</p></header>
${body || "<section><p>No text differences were found.</p></section>"}
</body></html>`;
}
