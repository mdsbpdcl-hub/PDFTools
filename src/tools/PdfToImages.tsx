import { useEffect, useState } from "react";
import type { OutputFile, ToolProps } from "../lib/types";
import { openPdf, renderPage, closePdf } from "../lib/pdfjs";
import { parsePages } from "../lib/ranges";
import { baseName, canvasToBlob, checkAborted, plural, yieldToUI } from "../lib/util";
import { Note, Range, Seg, SelectField, TextField } from "../components/ui";

export default function PdfToImages({ files, setAction }: ToolProps) {
  const f = files[0];
  const total = f.pages ?? 0;
  const [format, setFormat] = useState<"png" | "jpeg">("png");
  const [dpi, setDpi] = useState("150");
  const [quality, setQuality] = useState(85);
  const [range, setRange] = useState("");
  let pages: number[] = [];
  let err: string | undefined;
  try { pages = parsePages(range, total); } catch (e) { err = (e as Error).message; }

  useEffect(() => {
    setAction({
      label: `Create ${plural(pages.length, "image")}`,
      disabled: !!err || !pages.length,
      disabledReason: err,
      run: async ({ progress, signal }) => {
        const pdf = await openPdf(f.file);
        const outputs: OutputFile[] = [];
        let reduced = 0;
        const pad = String(total).length;
        try {
          for (let i = 0; i < pages.length; i++) {
            checkAborted(signal);
            progress(i / pages.length, `Rendering page ${pages[i] + 1} (${i + 1} of ${pages.length})…`);
            const page = await pdf.getPage(pages[i] + 1);
            const want = Number(dpi) / 72;
            const { canvas, scale } = await renderPage(page, want);
            if (scale < want * 0.99) reduced++;
            const blob = await canvasToBlob(canvas, `image/${format}`, format === "jpeg" ? quality / 100 : undefined);
            outputs.push({ name: `${baseName(f.file.name)}_page-${String(pages[i] + 1).padStart(pad, "0")}.${format === "jpeg" ? "jpg" : "png"}`, blob });
            canvas.width = canvas.height = 0;
            page.cleanup();
            await yieldToUI();
          }
        } finally { await closePdf(pdf); }
        return {
          outputs,
          summary: [{ label: "Images", value: String(outputs.length) }, { label: "Resolution", value: `${dpi} dpi` }],
          notes: reduced ? [{ tone: "warn", text: `${plural(reduced, "page")} were reduced in resolution to stay within browser limits.` }] : undefined,
        };
      },
    });
  }, [f, format, dpi, quality, range, err, total, setAction]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="card stack-lg">
      <div className="grid-2">
        <Seg<"png" | "jpeg"> label="Format" value={format} onChange={setFormat} options={[{ value: "png", label: "PNG (sharp, larger)" }, { value: "jpeg", label: "JPEG (smaller)" }]} />
        <SelectField label="Resolution" value={dpi} onChange={setDpi} options={[
          { value: "72", label: "72 dpi — screen preview" }, { value: "150", label: "150 dpi — good for sharing" },
          { value: "200", label: "200 dpi — documents" }, { value: "300", label: "300 dpi — print quality" }, { value: "600", label: "600 dpi — very large files" },
        ]} />
      </div>
      {format === "jpeg" && <Range label="JPEG quality" value={quality} onChange={setQuality} min={40} max={100} format={(v) => `${v}%`} />}
      <TextField label="Pages (optional)" value={range} onChange={setRange} placeholder={`All ${total} pages`} error={err} help="e.g. 1-3, 7. Leave empty for all pages." />
      {Number(dpi) >= 300 && pages.length > 30 && <Note tone="warn">High resolution for many pages creates large files and can take a while.</Note>}
    </div>
  );
}
