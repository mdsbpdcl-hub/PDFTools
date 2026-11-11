import { useEffect, useState } from "react";
import type { ToolProps } from "../lib/types";
import { UserError } from "../lib/types";
import { getPdfLib, loadPdf, savePdf } from "../lib/pdflib";
import { baseName, pdfBlob, plural } from "../lib/util";
import { Note, PageThumb, Seg, usePdfDoc } from "../components/ui";

interface Item { key: number; src: number; rot: number }

export default function Organize({ files, setAction }: ToolProps) {
  const f = files[0];
  const { doc, error } = usePdfDoc(f.file);
  const [items, setItems] = useState<Item[]>(() => Array.from({ length: f.pages ?? 0 }, (_, i) => ({ key: i, src: i, rot: 0 })));
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [dragKey, setDragKey] = useState<number | null>(null);
  const [overKey, setOverKey] = useState<number | null>(null);
  const [output, setOutput] = useState<"all" | "selected">("all");

  const changed = items.some((it, i) => it.src !== i || it.rot !== 0) || items.length !== f.pages;
  const toggle = (k: number) => setSel((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const rotate = (keys: number[], by: number) => setItems((its) => its.map((it) => (keys.includes(it.key) ? { ...it, rot: (it.rot + by + 360) % 360 } : it)));
  const remove = (keys: number[]) => { setItems((its) => its.filter((it) => !keys.includes(it.key))); setSel(new Set()); };
  const move = (from: number, to: number) => setItems((its) => { if (to < 0 || to >= its.length) return its; const n = [...its]; const [m] = n.splice(from, 1); n.splice(to, 0, m); return n; });

  useEffect(() => {
    const chosen = output === "selected" ? items.filter((it) => sel.has(it.key)) : items;
    setAction({
      label: output === "selected" ? `Extract ${plural(chosen.length, "page")}` : "Save PDF",
      disabled: chosen.length === 0 || (output === "all" && !changed),
      disabledReason: chosen.length === 0 ? (output === "selected" ? "Select the pages to extract." : "At least one page must remain.") : "Make a change first (reorder, rotate or delete pages).",
      run: async ({ progress }) => {
        const { PDFDocument, degrees } = await getPdfLib();
        progress(0.1, "Reading the PDF…");
        const src = await loadPdf(f.file);
        const out = await PDFDocument.create();
        progress(0.4, "Arranging pages…");
        const copied = await out.copyPages(src, chosen.map((c) => c.src));
        copied.forEach((p, i) => {
          if (chosen[i].rot) p.setRotation(degrees((p.getRotation().angle + chosen[i].rot) % 360));
          out.addPage(p);
        });
        if (!out.getPageCount()) throw new UserError("No pages left to save.");
        progress(0.85, "Saving…");
        return {
          outputs: [{ name: `${baseName(f.file.name)}_${output === "selected" ? "extracted" : "organised"}.pdf`, blob: pdfBlob(await savePdf(out)) }],
          summary: [{ label: "Pages in result", value: String(out.getPageCount()) }, { label: "Original pages", value: String(f.pages) }],
        };
      },
    });
  }, [items, sel, output, changed, f, setAction]);

  if (error) return <Note tone="error">{error}</Note>;
  const selKeys = [...sel];
  return (
    <div className="card stack-lg">
      <div className="row">
        <span className="grow muted small">Click pages to select them. Drag to reorder, or use the arrow buttons. {plural(items.length, "page")}, {sel.size} selected.</span>
        <button className="btn sm" type="button" onClick={() => setSel(sel.size === items.length ? new Set() : new Set(items.map((i) => i.key)))}>{sel.size === items.length ? "Select none" : "Select all"}</button>
        <button className="btn sm" type="button" disabled={!sel.size} onClick={() => rotate(selKeys, -90)}>⟲ Rotate left</button>
        <button className="btn sm" type="button" disabled={!sel.size} onClick={() => rotate(selKeys, 90)}>⟳ Rotate right</button>
        <button className="btn sm danger" type="button" disabled={!sel.size || sel.size === items.length} onClick={() => remove(selKeys)}>Delete selected</button>
        <button className="btn sm" type="button" disabled={!changed} onClick={() => { setItems(Array.from({ length: f.pages ?? 0 }, (_, i) => ({ key: i, src: i, rot: 0 }))); setSel(new Set()); }}>Reset</button>
      </div>
      {!doc ? <p className="muted">Loading page previews…</p> : (
        <div className="thumbs" role="list" aria-label="Pages">
          {items.map((it, i) => (
            <div
              key={it.key}
              role="listitem"
              className={`thumb ${sel.has(it.key) ? "selected" : ""} ${overKey === it.key ? "drag-over" : ""}`}
              draggable
              onDragStart={(e) => { setDragKey(it.key); e.dataTransfer.effectAllowed = "move"; }}
              onDragOver={(e) => { e.preventDefault(); setOverKey(it.key); }}
              onDragLeave={() => setOverKey(null)}
              onDrop={(e) => { e.preventDefault(); if (dragKey !== null) move(items.findIndex((x) => x.key === dragKey), i); setDragKey(null); setOverKey(null); }}
              onDragEnd={() => { setDragKey(null); setOverKey(null); }}
              onClick={() => toggle(it.key)}
            >
              <PageThumb doc={doc} page={it.src + 1} rotation={it.rot} width={130} />
              <div className="cap">
                <button type="button" className="link-btn" aria-pressed={sel.has(it.key)} onClick={(e) => { e.stopPropagation(); toggle(it.key); }} style={{ textDecoration: "none", color: "inherit" }}>
                  {sel.has(it.key) ? "✓ " : ""}Page {it.src + 1}{it.rot ? ` · ${it.rot}°` : ""}
                </button>
              </div>
              <div className="tools" onClick={(e) => e.stopPropagation()}>
                <button className="icon-btn" type="button" aria-label={`Move page ${it.src + 1} earlier`} disabled={i === 0} onClick={() => move(i, i - 1)}>←</button>
                <button className="icon-btn" type="button" aria-label={`Rotate page ${it.src + 1}`} onClick={() => rotate([it.key], 90)}>⟳</button>
                <button className="icon-btn" type="button" aria-label={`Delete page ${it.src + 1}`} disabled={items.length === 1} onClick={() => remove([it.key])}>×</button>
                <button className="icon-btn" type="button" aria-label={`Move page ${it.src + 1} later`} disabled={i === items.length - 1} onClick={() => move(i, i + 1)}>→</button>
              </div>
            </div>
          ))}
        </div>
      )}
      <Seg<"all" | "selected"> label="What to download" value={output} onChange={setOutput} options={[{ value: "all", label: "The rearranged PDF" }, { value: "selected", label: "Only the selected pages" }]} />
    </div>
  );
}
