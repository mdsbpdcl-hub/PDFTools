import { useEffect, useState } from "react";
import type { ToolProps } from "../lib/types";
import { UserError } from "../lib/types";
import { getPdfLib, loadPdf, savePdf } from "../lib/pdflib";
import { parsePages } from "../lib/ranges";
import { checkAborted, pdfBlob, plural, yieldToUI } from "../lib/util";
import { Check, Note, TextField } from "../components/ui";

export default function Merge({ files, setAction }: ToolProps) {
  const [ranges, setRanges] = useState<Record<string, string>>({});
  const [name, setName] = useState("merged");
  const [bookmarksNote, setBookmarksNote] = useState(true);
  const errors: Record<string, string> = {};
  for (const f of files) {
    try { if (ranges[f.id]) parsePages(ranges[f.id], f.pages ?? 0); } catch (e) { errors[f.id] = (e as Error).message; }
  }
  const hasErr = Object.keys(errors).length > 0;
  const totalPages = files.reduce((s, f) => {
    try { return s + (ranges[f.id] ? parsePages(ranges[f.id], f.pages ?? 0).length : f.pages ?? 0); } catch { return s; }
  }, 0);

  useEffect(() => {
    setAction({
      label: "Merge PDFs",
      disabled: hasErr || !name.trim(),
      disabledReason: hasErr ? "Fix the page ranges marked in red." : "Enter a file name.",
      run: async ({ progress, signal }) => {
        const { PDFDocument } = await getPdfLib();
        const out = await PDFDocument.create();
        for (let i = 0; i < files.length; i++) {
          checkAborted(signal);
          const f = files[i];
          progress(i / files.length, `Adding ${f.file.name}…`);
          const src = await loadPdf(f.file);
          const idx = ranges[f.id] ? parsePages(ranges[f.id], src.getPageCount()) : src.getPageIndices();
          const pages = await out.copyPages(src, idx);
          pages.forEach((p) => out.addPage(p));
          await yieldToUI();
        }
        if (!out.getPageCount()) throw new UserError("No pages were selected.");
        progress(0.95, "Saving…");
        const bytes = await savePdf(out);
        return {
          outputs: [{ name: `${name.trim().replace(/\.pdf$/i, "")}.pdf`, blob: pdfBlob(bytes) }],
          summary: [{ label: "Files combined", value: String(files.length) }, { label: "Pages", value: String(out.getPageCount()) }],
        };
      },
    });
  }, [files, ranges, name, hasErr, setAction]);

  return (
    <div className="card stack-lg">
      <div className="stack">
        <h2>Order and pages</h2>
        <p className="muted small">Files are merged top to bottom. Go Back to drag them into a different order. Leave “Pages” empty to include every page.</p>
        <ul className="file-list">
          {files.map((f, i) => (
            <li key={f.id} style={{ flexWrap: "wrap" }}>
              <span className="muted small" style={{ width: 18 }}>{i + 1}</span>
              <div className="grow" style={{ minWidth: 160 }}>
                <div className="name">{f.file.name}</div>
                <div className="meta">{plural(f.pages ?? 0, "page")}</div>
              </div>
              <div style={{ width: 220 }}>
                <TextField label="Pages (optional)" value={ranges[f.id] ?? ""} placeholder={`1-${f.pages}`} error={errors[f.id]} onChange={(v) => setRanges((r) => ({ ...r, [f.id]: v }))} />
              </div>
            </li>
          ))}
        </ul>
      </div>
      <div className="grid-2">
        <TextField label="Name of the merged file" value={name} onChange={setName} help=".pdf is added for you" />
        <div className="field"><span style={{ fontWeight: 600, fontSize: 14 }}>Result</span><p className="strong" style={{ fontSize: 20 }}>{plural(totalPages, "page")}</p></div>
      </div>
      <Check checked={bookmarksNote} onChange={setBookmarksNote}>Show me what is not carried over</Check>
      {bookmarksNote && <Note tone="info">Pages, text, images, links inside pages and form fields are kept. Bookmarks (the outline panel) from the original files are not carried over.</Note>}
    </div>
  );
}
