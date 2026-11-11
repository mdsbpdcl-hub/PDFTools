import { useEffect, useState } from "react";
import type { PDFDocument } from "pdf-lib";
import type { OutputFile, PickedFile, ToolProps } from "../lib/types";
import { UserError } from "../lib/types";
import { getPdfLib, savePdf } from "../lib/pdflib";
import { backend, postToBackend } from "../lib/backend";
import { useBackend } from "../App";
import { baseName, canvasToBlob, checkAborted, pdfBlob, plural, yieldToUI } from "../lib/util";
import { Note, Seg, SelectField } from "../components/ui";

type Size = "fit" | "a4" | "letter";
const SIZES = { a4: [595.28, 841.89], letter: [612, 792] } as const;
const MARGINS = { none: 0, small: 18, normal: 36 } as const;

export default function ToPdf({ files, setAction }: ToolProps) {
  const be = useBackend();
  const hasBackend = be.status === "online" && be.features.includes("office-to-pdf");
  const office = files.filter((f) => f.kind === "office");
  const images = files.filter((f) => f.kind === "image");
  const [size, setSize] = useState<Size>("a4");
  const [margin, setMargin] = useState<keyof typeof MARGINS>("small");
  const [combine, setCombine] = useState<"one" | "each">(files.length > 1 && !office.length ? "one" : "each");

  useEffect(() => {
    const blocked = office.length > 0 && !hasBackend;
    setAction({
      label: "Convert to PDF",
      disabled: blocked,
      disabledReason: `${plural(office.length, "Office file")} ${office.length === 1 ? "needs" : "need"} the optional backend, which is not connected. ${office.length === 1 ? "Remove it" : "Remove them"} or set up a backend.`,
      sendsToBackend: office.length ? { files: office.map((f) => ({ name: f.file.name, size: f.file.size })), purpose: "convert Office files to PDF with LibreOffice (images stay in your browser)" } : undefined,
      run: async ({ progress, signal }) => {
        const { PDFDocument } = await getPdfLib();
        const parts: { name: string; bytes: Uint8Array }[] = [];
        for (let i = 0; i < files.length; i++) {
          checkAborted(signal);
          const f = files[i];
          const tick = (v: number | null, m?: string) => progress((i + (v ?? 0.5)) / files.length, `${f.file.name}: ${m ?? "converting…"}`);
          if (f.kind === "office") {
            const form = new FormData();
            form.append("file", f.file);
            const r = await postToBackend("/convert/office-to-pdf", form, tick, signal);
            parts.push({ name: f.file.name, bytes: new Uint8Array(await r.blob.arrayBuffer()) });
          } else {
            tick(0.2, "placing image…");
            const doc = await PDFDocument.create();
            await addImagePage(doc, f, size, MARGINS[margin]);
            parts.push({ name: f.file.name, bytes: await savePdf(doc) });
          }
          await yieldToUI();
        }
        let outputs: OutputFile[];
        if (combine === "one" && parts.length > 1) {
          progress(0.95, "Combining…");
          const out = await PDFDocument.create();
          for (const p of parts) {
            const src = await PDFDocument.load(p.bytes);
            (await out.copyPages(src, src.getPageIndices())).forEach((pg) => out.addPage(pg));
          }
          outputs = [{ name: "converted.pdf", blob: pdfBlob(await savePdf(out)) }];
        } else {
          outputs = parts.map((p) => ({ name: `${baseName(p.name)}.pdf`, blob: pdfBlob(p.bytes) }));
        }
        return {
          outputs,
          summary: [{ label: "Files converted", value: String(parts.length) }],
          notes: office.length ? [{ tone: "info", text: "Check Office conversions for font substitutions and changed page breaks." }] : undefined,
        };
      },
    });
  }, [files, size, margin, combine, hasBackend, setAction]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="card stack-lg">
      {office.length > 0 && (hasBackend
        ? <Note tone="info">{plural(office.length, "Office file")} will be converted by the backend at {backend.host()}. You will be asked to confirm before anything is sent. {images.length ? `${plural(images.length, "image")} stay in your browser.` : ""}</Note>
        : <Note tone="warn" title="Backend needed.">Word, Excel and PowerPoint files need a conversion engine (LibreOffice) that cannot run in a browser. Connect the optional backend, or go Back and remove: {office.map((o) => o.file.name).join(", ")}.</Note>)}
      {images.length > 0 && (
        <div className="grid-2">
          <SelectField<Size> label="Page size for images" value={size} onChange={setSize} options={[
            { value: "a4", label: "A4" }, { value: "letter", label: "US Letter" }, { value: "fit", label: "Same size as the image" },
          ]} help="Pages turn landscape automatically for wide images." />
          <SelectField label="Margin" value={margin} onChange={(v) => setMargin(v as keyof typeof MARGINS)} options={[
            { value: "none", label: "None" }, { value: "small", label: "Small" }, { value: "normal", label: "Normal" },
          ]} />
        </div>
      )}
      {files.length > 1 && <Seg<"one" | "each"> label="Output" value={combine} onChange={setCombine} options={[{ value: "one", label: "One combined PDF" }, { value: "each", label: "One PDF per file" }]} />}
    </div>
  );
}

async function addImagePage(doc: PDFDocument, f: PickedFile, size: Size, margin: number) {
  const buf = new Uint8Array(await f.file.arrayBuffer());
  const isJpeg = buf[0] === 0xff && buf[1] === 0xd8;
  const isPng = buf[0] === 0x89 && buf[1] === 0x50;
  let img;
  if (isJpeg && jpegOrientation(buf) <= 1) img = await doc.embedJpg(buf);
  else if (isPng) img = await doc.embedPng(buf);
  else {
    // Other formats (WebP, GIF, BMP, rotated JPEG…): let the browser decode, then re-encode.
    let bmp: ImageBitmap;
    try { bmp = await createImageBitmap(f.file, { imageOrientation: "from-image" }); }
    catch { throw new UserError(`${f.file.name}: this browser cannot open this image type.`); }
    const c = document.createElement("canvas");
    c.width = bmp.width; c.height = bmp.height;
    c.getContext("2d")!.drawImage(bmp, 0, 0);
    bmp.close();
    const jpeg = isJpeg || /\.(webp|avif|heic|heif)$/i.test(f.file.name);
    const out = new Uint8Array(await (await canvasToBlob(c, jpeg ? "image/jpeg" : "image/png", 0.92)).arrayBuffer());
    img = jpeg ? await doc.embedJpg(out) : await doc.embedPng(out);
  }
  const iw = img.width * 0.75, ih = img.height * 0.75; // 96 dpi pixels to points
  let pw: number, ph: number;
  if (size === "fit") { pw = iw + margin * 2; ph = ih + margin * 2; }
  else {
    const [a, b] = SIZES[size];
    [pw, ph] = iw > ih ? [b, a] : [a, b];
  }
  const k = Math.min((pw - margin * 2) / iw, (ph - margin * 2) / ih, size === "fit" ? 1 : Infinity);
  const page = doc.addPage([pw, ph]);
  page.drawImage(img, { x: (pw - iw * k) / 2, y: (ph - ih * k) / 2, width: iw * k, height: ih * k });
}

/** Reads the EXIF orientation tag of a JPEG (1 = normal). */
function jpegOrientation(b: Uint8Array): number {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let o = 2;
  while (o + 4 < b.length) {
    if (b[o] !== 0xff) return 1;
    const marker = b[o + 1];
    const len = v.getUint16(o + 2);
    if (marker === 0xe1 && v.getUint32(o + 4) === 0x45786966) {
      const t = o + 10;
      const le = v.getUint16(t) === 0x4949;
      const ifd = t + v.getUint32(t + 4, le);
      const n = v.getUint16(ifd, le);
      for (let i = 0; i < n; i++) {
        const e = ifd + 2 + i * 12;
        if (e + 10 > b.length) return 1;
        if (v.getUint16(e, le) === 0x0112) return v.getUint16(e + 8, le);
      }
      return 1;
    }
    if (marker === 0xda) return 1;
    o += 2 + len;
  }
  return 1;
}
