import { useEffect, useMemo, useState } from "react";
import type { PDFDocument } from "pdf-lib";
import type { ToolProps } from "../lib/types";
import { UserError } from "../lib/types";
import { getPdfLib, loadPdf, savePdf } from "../lib/pdflib";
import { parsePages } from "../lib/ranges";
import { anchorPoint, assertEncodable, displayFrame, drawImageCentered, drawTextCentered, type Anchor } from "../lib/stamp";
import { baseName, checkAborted, hexToRgb01, pdfBlob, yieldToUI } from "../lib/util";
import { Note, PdfPagePreview, Range, Seg, SelectField, TextField, useDebounced } from "../components/ui";

type Kind = "text" | "image";
type Pos = Anchor | "tile";
interface Opts { kind: Kind; text: string; size: number; color: string; bold: boolean; image: File | null; scale: number; opacity: number; angle: number; pos: Pos; range: string }

export default function Watermark({ files, setAction }: ToolProps) {
  const first = files[0];
  const [o, setO] = useState<Opts>({ kind: "text", text: "CONFIDENTIAL", size: 60, color: "#9ca3af", bold: true, image: null, scale: 40, opacity: 30, angle: 45, pos: "mc", range: "" });
  const set = <K extends keyof Opts>(k: K, v: Opts[K]) => setO((x) => ({ ...x, [k]: v }));
  const debounced = useDebounced(o, 400);
  const [preview, setPreview] = useState<Blob | null>(null);
  const [previewErr, setPreviewErr] = useState("");

  let rangeErr: string | undefined;
  try { parsePages(o.range, first.pages ?? 1); } catch (e) { rangeErr = (e as Error).message; }
  const invalid = rangeErr ?? (o.kind === "text" && !o.text.trim() ? "Enter the watermark text." : o.kind === "image" && !o.image ? "Choose an image." : undefined);

  // Live preview: watermark only the first selected page of the first file.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { PDFDocument } = await getPdfLib();
        const src = await loadPdf(first.file);
        let idx = 0;
        try { idx = parsePages(debounced.range, src.getPageCount())[0] ?? 0; } catch { /* use first page */ }
        const one = await PDFDocument.create();
        const [p] = await one.copyPages(src, [idx]);
        one.addPage(p);
        if (!(debounced.kind === "image" && !debounced.image) && !(debounced.kind === "text" && !debounced.text.trim())) await applyWatermark(one, [0], debounced);
        if (alive) { setPreview(pdfBlob(await one.save())); setPreviewErr(""); }
      } catch (e) { if (alive) setPreviewErr((e as Error).message); }
    })();
    return () => { alive = false; };
  }, [debounced, first]);

  useEffect(() => {
    setAction({
      label: "Add watermark",
      disabled: !!invalid,
      disabledReason: invalid,
      run: async ({ progress, signal }) => {
        const outputs = [];
        for (let i = 0; i < files.length; i++) {
          checkAborted(signal);
          progress(i / files.length, `Watermarking ${files[i].file.name}…`);
          const doc = await loadPdf(files[i].file);
          let pages: number[];
          try { pages = parsePages(o.range, doc.getPageCount()); }
          catch { throw new UserError(`${files[i].file.name} does not have the pages in your range.`); }
          await applyWatermark(doc, pages, o);
          outputs.push({ name: `${baseName(files[i].file.name)}_watermarked.pdf`, blob: pdfBlob(await savePdf(doc)) });
          await yieldToUI();
        }
        return { outputs, summary: [{ label: "Files", value: String(outputs.length) }] };
      },
    });
  }, [files, o, invalid, setAction]);

  const imageName = useMemo(() => o.image?.name, [o.image]);

  return (
    <div className="grid-2" style={{ alignItems: "start" }}>
      <div className="card stack-lg">
        <Seg<Kind> label="Watermark type" value={o.kind} onChange={(v) => set("kind", v)} options={[{ value: "text", label: "Text" }, { value: "image", label: "Image" }]} />
        {o.kind === "text" ? (
          <>
            <TextField label="Text" value={o.text} onChange={(v) => set("text", v)} maxLength={120} />
            <div className="grid-2">
              <Range label="Text size" value={o.size} onChange={(v) => set("size", v)} min={8} max={160} format={(v) => `${v} pt`} />
              <div className="field"><label htmlFor="wm-color">Colour</label><input id="wm-color" type="color" value={o.color} onChange={(e) => set("color", e.target.value)} /></div>
            </div>
          </>
        ) : (
          <div className="stack">
            <div className="field">
              <label htmlFor="wm-img">Image (PNG or JPG)</label>
              <input id="wm-img" type="file" accept="image/png,image/jpeg" className="input" onChange={(e) => set("image", e.target.files?.[0] ?? null)} />
              {imageName && <span className="help">Using {imageName}</span>}
            </div>
            <Range label="Image width" value={o.scale} onChange={(v) => set("scale", v)} min={5} max={100} format={(v) => `${v}% of page`} />
          </div>
        )}
        <Range label="Opacity" value={o.opacity} onChange={(v) => set("opacity", v)} min={5} max={100} format={(v) => `${v}%`} />
        <Range label="Rotation" value={o.angle} onChange={(v) => set("angle", v)} min={-90} max={90} step={5} format={(v) => `${v}°`} />
        <SelectField<Pos> label="Position" value={o.pos} onChange={(v) => set("pos", v)} options={[
          { value: "mc", label: "Centre" }, { value: "tile", label: "Repeat across the page" },
          { value: "tl", label: "Top left" }, { value: "tc", label: "Top centre" }, { value: "tr", label: "Top right" },
          { value: "bl", label: "Bottom left" }, { value: "bc", label: "Bottom centre" }, { value: "br", label: "Bottom right" },
        ]} />
        <TextField label="Pages (optional)" value={o.range} onChange={(v) => set("range", v)} placeholder="All pages" error={rangeErr} help="e.g. 1-3, 8. Leave empty for every page." />
        {files.length > 1 && <Note tone="info">The same watermark is applied to all {files.length} files.</Note>}
      </div>
      <div className="card stack">
        <h2>Preview</h2>
        <PdfPagePreview source={preview} label="Preview of the watermarked page" width={420} />
        {previewErr && <Note tone="error">{previewErr}</Note>}
      </div>
    </div>
  );
}

async function applyWatermark(doc: PDFDocument, pages: number[], o: Opts) {
  const { StandardFonts } = await getPdfLib();
  const font = await doc.embedFont(o.bold ? StandardFonts.HelveticaBold : StandardFonts.Helvetica);
  const color = hexToRgb01(o.color);
  let img = null;
  if (o.kind === "image" && o.image) {
    const bytes = new Uint8Array(await o.image.arrayBuffer());
    img = bytes[0] === 0x89 ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
  }
  if (o.kind === "text") assertEncodable(font, o.text);
  for (const i of pages) {
    const page = doc.getPage(i);
    const f = displayFrame(page);
    let iw: number, ih: number;
    if (img) { iw = (f.w * o.scale) / 100; ih = (iw * img.height) / img.width; }
    else { iw = font.widthOfTextAtSize(o.text, o.size); ih = font.heightAtSize(o.size, { descender: false }); }
    const centres: { cx: number; cy: number }[] = [];
    if (o.pos === "tile") {
      const { bw, bh } = anchorPoint("mc", f.w, f.h, iw, ih, o.angle, 0);
      const stepX = bw + Math.max(40, bw * 0.4), stepY = bh + Math.max(40, bh * 0.6);
      for (let y = stepY / 2; y < f.h + stepY / 2; y += stepY)
        for (let x = stepX / 2 + ((Math.round(y / stepY) % 2) * stepX) / 2; x < f.w + stepX / 2; x += stepX) centres.push({ cx: x, cy: y });
    } else centres.push(anchorPoint(o.pos, f.w, f.h, iw, ih, o.angle, 28));
    for (const c of centres) {
      if (img) await drawImageCentered(page, img, { ...c, width: iw, height: ih, opacity: o.opacity / 100, angle: o.angle });
      else await drawTextCentered(page, o.text, { ...c, font, size: o.size, color, opacity: o.opacity / 100, angle: o.angle });
    }
  }
}
