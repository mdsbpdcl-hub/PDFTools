import { useEffect, useState } from "react";
import type { PDFDocument } from "pdf-lib";
import type { ToolProps } from "../lib/types";
import { getPdfLib, loadPdf, savePdf } from "../lib/pdflib";
import { parsePages } from "../lib/ranges";
import { anchorPoint, assertEncodable, displayFrame, drawTextCentered, type Anchor } from "../lib/stamp";
import { baseName, hexToRgb01, pdfBlob } from "../lib/util";
import { NumberField, PdfPagePreview, Range, Seg, SelectField, TextField, useDebounced } from "../components/ui";

type Mode = "numbers" | "bates";
interface Opts {
  mode: Mode; format: string; custom: string; start: number;
  prefix: string; suffix: string; digits: number;
  pos: Anchor; margin: number; size: number; color: string; range: string; skipFirst: boolean;
}

const FORMATS = [
  { value: "{n}", label: "1" },
  { value: "Page {n}", label: "Page 1" },
  { value: "Page {n} of {total}", label: "Page 1 of 10" },
  { value: "{n} / {total}", label: "1 / 10" },
  { value: "- {n} -", label: "- 1 -" },
  { value: "custom", label: "Custom…" },
];

export function labelFor(o: Opts, k: number, count: number): string {
  const n = o.start + k;
  if (o.mode === "bates") return `${o.prefix}${String(n).padStart(Math.max(1, o.digits), "0")}${o.suffix}`;
  const tpl = o.format === "custom" ? o.custom : o.format;
  return tpl.replace(/\{n\}/g, String(n)).replace(/\{total\}/g, String(o.start + count - 1));
}

export default function PageNumbers({ files, setAction }: ToolProps) {
  const f = files[0];
  const total = f.pages ?? 1;
  const [o, setO] = useState<Opts>({ mode: "numbers", format: "Page {n} of {total}", custom: "Page {n}", start: 1, prefix: "DOC-", suffix: "", digits: 6, pos: "bc", margin: 24, size: 10, color: "#111827", range: "", skipFirst: false });
  const set = <K extends keyof Opts>(k: K, v: Opts[K]) => setO((x) => ({ ...x, [k]: v }));
  const debounced = useDebounced(o, 350);
  const [preview, setPreview] = useState<Blob | null>(null);

  let pages: number[] = [];
  let rangeErr: string | undefined;
  try { pages = parsePages(o.range, total); if (o.skipFirst) pages = pages.slice(1); } catch (e) { rangeErr = (e as Error).message; }
  const invalid = rangeErr ?? (o.mode === "bates" && !(o.digits >= 1 && o.digits <= 12) ? "Digits must be between 1 and 12." : !Number.isFinite(o.start) || o.start < 0 ? "Enter a starting number of 0 or more." : !pages.length ? "No pages are selected." : o.mode === "numbers" && o.format === "custom" && !o.custom.includes("{n}") ? "Custom format must include {n}." : undefined);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { PDFDocument } = await getPdfLib();
        const src = await loadPdf(f.file);
        let ps: number[] = [];
        try { ps = parsePages(debounced.range, src.getPageCount()); if (debounced.skipFirst) ps = ps.slice(1); } catch { /* invalid range: show plain page */ }
        const one = await PDFDocument.create();
        const [p] = await one.copyPages(src, [ps[0] ?? 0]);
        one.addPage(p);
        if (ps.length) await stamp(one, [0], debounced, ps.length, 0);
        if (alive) setPreview(pdfBlob(await one.save()));
      } catch { /* preview is best-effort; errors show on run */ }
    })();
    return () => { alive = false; };
  }, [debounced, f]);

  useEffect(() => {
    setAction({
      label: o.mode === "bates" ? "Add Bates numbers" : "Add page numbers",
      disabled: !!invalid,
      disabledReason: invalid,
      run: async ({ progress }) => {
        progress(0.2, "Numbering pages…");
        const doc = await loadPdf(f.file);
        await stamp(doc, pages, o, pages.length, 0);
        progress(0.8, "Saving…");
        return {
          outputs: [{ name: `${baseName(f.file.name)}_${o.mode === "bates" ? "bates" : "numbered"}.pdf`, blob: pdfBlob(await savePdf(doc)) }],
          summary: [
            { label: "Pages numbered", value: String(pages.length) },
            { label: "First label", value: labelFor(o, 0, pages.length) },
            { label: "Last label", value: labelFor(o, pages.length - 1, pages.length) },
          ],
        };
      },
    });
  }, [o, pages.length, invalid, f, setAction]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="grid-2" style={{ alignItems: "start" }}>
      <div className="card stack-lg">
        <Seg<Mode> label="Type" value={o.mode} onChange={(v) => set("mode", v)} options={[{ value: "numbers", label: "Page numbers" }, { value: "bates", label: "Bates numbers" }]} />
        {o.mode === "numbers" ? (
          <>
            <SelectField label="Format" value={o.format} onChange={(v) => set("format", v)} options={FORMATS} />
            {o.format === "custom" && <TextField label="Custom format" value={o.custom} onChange={(v) => set("custom", v)} help="Use {n} for the number and {total} for the last number." />}
            <NumberField label="Start at" value={o.start} onChange={(v) => set("start", v)} min={0} />
          </>
        ) : (
          <>
            <div className="grid-3">
              <TextField label="Prefix" value={o.prefix} onChange={(v) => set("prefix", v)} />
              <NumberField label="Digits" value={o.digits} onChange={(v) => set("digits", v)} min={1} max={12} />
              <TextField label="Suffix" value={o.suffix} onChange={(v) => set("suffix", v)} />
            </div>
            <NumberField label="Starting number" value={o.start} onChange={(v) => set("start", v)} min={0} help="Use the next number after the last document in your set." />
          </>
        )}
        <p className="small">Example: <span className="strong">{labelFor(o, 0, pages.length || 1)}</span>{pages.length > 1 && <> … <span className="strong">{labelFor(o, pages.length - 1, pages.length)}</span></>}</p>
        <div className="grid-2">
          <SelectField<Anchor> label="Position" value={o.pos} onChange={(v) => set("pos", v)} options={[
            { value: "bc", label: "Bottom centre" }, { value: "br", label: "Bottom right" }, { value: "bl", label: "Bottom left" },
            { value: "tc", label: "Top centre" }, { value: "tr", label: "Top right" }, { value: "tl", label: "Top left" },
          ]} />
          <div className="field"><label htmlFor="pn-color">Colour</label><input id="pn-color" type="color" value={o.color} onChange={(e) => set("color", e.target.value)} /></div>
        </div>
        <Range label="Text size" value={o.size} onChange={(v) => set("size", v)} min={6} max={24} format={(v) => `${v} pt`} />
        <Range label="Distance from edge" value={o.margin} onChange={(v) => set("margin", v)} min={6} max={72} format={(v) => `${v} pt`} />
        <TextField label="Pages (optional)" value={o.range} onChange={(v) => set("range", v)} placeholder={`All ${total} pages`} error={rangeErr} />
        <label className="check"><input type="checkbox" checked={o.skipFirst} onChange={(e) => set("skipFirst", e.target.checked)} /><span>Leave the first selected page unnumbered (for a cover page)</span></label>
      </div>
      <div className="card stack">
        <h2>Preview</h2>
        <PdfPagePreview source={preview} label="Preview of the first numbered page" width={420} />
      </div>
    </div>
  );
}

async function stamp(doc: PDFDocument, pages: number[], o: Opts, count: number, offset: number) {
  const { StandardFonts } = await getPdfLib();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const color = hexToRgb01(o.color);
  for (let k = 0; k < pages.length; k++) {
    const text = labelFor(o, k + offset, count);
    assertEncodable(font, text);
    const page = doc.getPage(pages[k]);
    const fr = displayFrame(page);
    const tw = font.widthOfTextAtSize(text, o.size);
    const th = font.heightAtSize(o.size, { descender: false });
    const { cx, cy } = anchorPoint(o.pos, fr.w, fr.h, tw, th, 0, o.margin);
    await drawTextCentered(page, text, { cx, cy, font, size: o.size, color, opacity: 1, angle: 0 });
  }
}
