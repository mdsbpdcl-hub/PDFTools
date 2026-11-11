import { useEffect, useState } from "react";
import type { PDFDict, PDFDocument, PDFNumber, PDFRawStream, PDFRef } from "pdf-lib";
import type { OutputFile, ResultNote, RunContext, ToolProps } from "../lib/types";
import { loadPdf } from "../lib/pdflib";
import { openPdf, renderPage, closePdf } from "../lib/pdfjs";
import { runQpdf } from "../lib/qpdf";
import { backend, postToBackend } from "../lib/backend";
import { useBackend } from "../App";
import { baseName, canvasToBlob, checkAborted, formatBytes, pdfBlob, yieldToUI } from "../lib/util";
import { Choices, Note } from "../components/ui";

type Level = "light" | "medium" | "strong" | "raster" | "backend";

const SETTINGS = {
  medium: { maxSide: 2000, quality: 0.72, flate: false },
  strong: { maxSide: 1400, quality: 0.55, flate: true },
} as const;

export default function Compress({ files, setAction }: ToolProps) {
  const be = useBackend();
  const hasBackend = be.status === "online" && be.features.includes("compress");
  const [level, setLevel] = useState<Level>("medium");

  useEffect(() => {
    const totalIn = files.reduce((s, f) => s + f.file.size, 0);
    setAction({
      label: "Compress",
      sendsToBackend: level === "backend" ? { files: files.map((f) => ({ name: f.file.name, size: f.file.size })), purpose: "compress with Ghostscript" } : undefined,
      run: async (ctx) => {
        const outputs: OutputFile[] = [];
        const notes: ResultNote[] = [];
        let totalOut = 0;
        for (let i = 0; i < files.length; i++) {
          checkAborted(ctx.signal);
          const f = files[i];
          const sub: RunContext = { ...ctx, progress: (v, m) => ctx.progress((i + (v ?? 0.5)) / files.length, files.length > 1 ? `${f.file.name}: ${m ?? ""}` : m) };
          let blob: Blob;
          if (level === "backend") {
            const form = new FormData();
            form.append("file", f.file);
            form.append("level", "ebook");
            blob = (await postToBackend("/compress", form, sub.progress, ctx.signal)).blob;
          } else {
            blob = await compressLocal(f.file, level, sub, notes);
          }
          if (blob.size >= f.file.size) {
            notes.push({ tone: "info", text: `${f.file.name} could not be made smaller at this level (it is probably already well optimised), so the original is offered unchanged.` });
            blob = f.file;
          }
          totalOut += blob.size;
          outputs.push({ name: `${baseName(f.file.name)}_compressed.pdf`, blob: blob.type === "application/pdf" ? blob : new Blob([blob], { type: "application/pdf" }) });
        }
        const saved = totalIn - totalOut;
        if (level === "raster") notes.unshift({ tone: "warn", text: "Pages were turned into pictures. Text can no longer be selected or searched, and links and form fields were removed." });
        notes.push({ tone: "info", text: "If a file had a digital signature, that signature is no longer valid after compression." });
        return {
          outputs,
          notes,
          summary: [
            { label: "Original size", value: formatBytes(totalIn) },
            { label: "New size", value: formatBytes(totalOut) },
            { label: "Saved", value: saved > 0 ? `${Math.round((saved / totalIn) * 100)}%` : "0%" },
          ],
        };
      },
    });
  }, [files, level, setAction]);

  return (
    <div className="card stack-lg">
      <Choices<Level>
        legend="How much should it be compressed?"
        value={level}
        onChange={setLevel}
        options={[
          { value: "light", title: "Light — no quality loss", desc: "Cleans up and repacks the file. Text and images are untouched." },
          { value: "medium", title: "Recommended — good quality", desc: "Also recompresses large photos (up to about 2000 pixels, good JPEG quality)." },
          { value: "strong", title: "Strong — smaller file", desc: "Shrinks photos further. Fine for screen reading; printed photos may look softer." },
          { value: "raster", title: "Maximum — pages become pictures", desc: "For scans and image-heavy files. Text stops being selectable or searchable." },
          { value: "backend", title: `Backend (Ghostscript)${hasBackend ? "" : " — not available"}`, desc: hasBackend ? `Sends the file to ${backend.host()}. Often best for mixed documents.` : "Needs the optional backend with Ghostscript.", disabled: !hasBackend },
        ]}
      />
      {level === "raster" && <Note tone="warn">Only use this when the other levels are not enough. The result looks the same but behaves like a scan.</Note>}
      <p className="small muted">Your original files are never changed. You will see the size before and after.</p>
    </div>
  );
}

async function compressLocal(file: File, level: Exclude<Level, "backend">, ctx: RunContext, notes: ResultNote[]): Promise<Blob> {
  let bytes: Uint8Array;
  if (level === "raster") {
    bytes = await rasterize(file, ctx);
  } else {
    ctx.progress(0.05, "Reading…");
    const doc = await loadPdf(file);
    if (level !== "light") {
      const n = await recompressImages(doc, SETTINGS[level], ctx);
      if (n === 0) notes.push({ tone: "info", text: `${file.name}: no photos could be recompressed; only the structure was optimised.` });
    }
    ctx.progress(0.8, "Saving…");
    bytes = await doc.save({ useObjectStreams: true });
  }
  ctx.progress(0.88, "Optimising structure…");
  const q = await runQpdf(["--object-streams=generate", "--compress-streams=y", "--recompress-flate", "--compression-level=9", "--", "/in.pdf", "/out.pdf"], bytes);
  if (q.result && q.code !== 2 && q.result.length < bytes.length) bytes = q.result;
  return pdfBlob(bytes);
}

/** Re-encodes large JPEG (and, at the strong level, raw 8-bit) images. Returns how many were replaced. */
async function recompressImages(doc: PDFDocument, s: { maxSide: number; quality: number; flate: boolean }, ctx: RunContext): Promise<number> {
  const { PDFName, PDFRawStream: RawStream, PDFArray } = await import("pdf-lib");
  const objects = doc.context.enumerateIndirectObjects();
  // Images used as masks must keep their exact pixels.
  const maskRefs = new Set<string>();
  for (const [, obj] of objects) {
    if (obj instanceof RawStream) {
      for (const k of ["SMask", "Mask"]) {
        const v = obj.dict.get(PDFName.of(k));
        if (v && !(v instanceof PDFArray)) maskRefs.add(v.toString());
      }
    }
  }
  const candidates = objects.filter(([ref, obj]) =>
    obj instanceof RawStream && obj.dict.get(PDFName.of("Subtype")) === PDFName.of("Image") && !maskRefs.has(ref.toString()),
  ) as [PDFRef, PDFRawStream][];

  const num = (d: PDFDict, k: string) => (d.lookup(PDFName.of(k)) as PDFNumber | undefined)?.asNumber?.();
  const components = (cs: unknown): number | null => {
    if (cs === PDFName.of("DeviceRGB")) return 3;
    if (cs === PDFName.of("DeviceGray")) return 1;
    if (cs instanceof PDFArray && cs.get(0) === PDFName.of("ICCBased")) {
      const icc = doc.context.lookup(cs.get(1));
      const n = icc instanceof RawStream ? num(icc.dict, "N") : undefined;
      return n === 3 || n === 1 ? n : null;
    }
    return null;
  };

  let replaced = 0;
  for (let i = 0; i < candidates.length; i++) {
    checkAborted(ctx.signal);
    ctx.progress(0.1 + (0.65 * i) / candidates.length, `Recompressing images (${i + 1} of ${candidates.length})…`);
    const [ref, stream] = candidates[i];
    const d = stream.dict;
    const w = num(d, "Width"), h = num(d, "Height"), bpc = num(d, "BitsPerComponent");
    if (!w || !h || bpc !== 8 || d.has(PDFName.of("ImageMask")) || d.has(PDFName.of("Decode"))) continue;
    if (w * h < 40_000) continue; // icons and small graphics are not worth it
    const comps = components(d.lookup(PDFName.of("ColorSpace")));
    if (!comps) continue;
    const filter = d.lookup(PDFName.of("Filter"));
    const f = filter instanceof PDFArray && filter.size() === 1 ? filter.get(0) : filter;
    let bitmap: ImageBitmap | null = null;
    try {
      if (f === PDFName.of("DCTDecode")) {
        bitmap = await createImageBitmap(new Blob([stream.contents as BlobPart], { type: "image/jpeg" }));
      } else if (s.flate && f === PDFName.of("FlateDecode") && !d.has(PDFName.of("DecodeParms"))) {
        const raw = new Uint8Array(await new Response(new Blob([stream.contents as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate"))).arrayBuffer());
        if (raw.length < w * h * comps) continue;
        const rgba = new Uint8ClampedArray(w * h * 4);
        for (let p = 0, q = 0; p < w * h; p++, q += comps) {
          rgba[p * 4] = raw[q]; rgba[p * 4 + 1] = raw[q + (comps === 3 ? 1 : 0)]; rgba[p * 4 + 2] = raw[q + (comps === 3 ? 2 : 0)]; rgba[p * 4 + 3] = 255;
        }
        bitmap = await createImageBitmap(new ImageData(rgba, w, h));
      } else continue;
    } catch { continue; }
    const scale = Math.min(1, s.maxSide / Math.max(w, h));
    const nw = Math.max(1, Math.round(w * scale)), nh = Math.max(1, Math.round(h * scale));
    const canvas = document.createElement("canvas");
    canvas.width = nw; canvas.height = nh;
    const c2d = canvas.getContext("2d")!;
    c2d.imageSmoothingQuality = "high";
    c2d.drawImage(bitmap, 0, 0, nw, nh);
    bitmap.close();
    const jpeg = new Uint8Array(await (await canvasToBlob(canvas, "image/jpeg", s.quality)).arrayBuffer());
    if (jpeg.length > stream.contents.length * 0.9) continue;
    const dict: Record<string, unknown> = {
      Type: "XObject", Subtype: "Image", Width: nw, Height: nh,
      ColorSpace: "DeviceRGB", BitsPerComponent: 8, Filter: "DCTDecode",
    };
    const newStream = doc.context.stream(jpeg, dict as never);
    for (const k of ["SMask", "Mask", "Intent", "Interpolate"]) {
      const v = d.get(PDFName.of(k));
      if (v) newStream.dict.set(PDFName.of(k), v);
    }
    doc.context.assign(ref, newStream);
    replaced++;
    if (i % 4 === 0) await yieldToUI();
  }
  return replaced;
}

async function rasterize(file: File, ctx: RunContext): Promise<Uint8Array> {
  const { PDFDocument } = await import("pdf-lib");
  const src = await openPdf(file);
  const out = await PDFDocument.create();
  try {
    for (let n = 1; n <= src.numPages; n++) {
      checkAborted(ctx.signal);
      ctx.progress((n - 1) / src.numPages * 0.85, `Converting page ${n} of ${src.numPages}…`);
      const page = await src.getPage(n);
      const vp = page.getViewport({ scale: 1 });
      const { canvas } = await renderPage(page, 110 / 72);
      const jpg = await out.embedJpg(new Uint8Array(await (await canvasToBlob(canvas, "image/jpeg", 0.6)).arrayBuffer()));
      const p = out.addPage([vp.width, vp.height]);
      p.drawImage(jpg, { x: 0, y: 0, width: vp.width, height: vp.height });
      page.cleanup();
      canvas.width = canvas.height = 0;
      await yieldToUI();
    }
  } finally {
    await closePdf(src);
  }
  return out.save({ useObjectStreams: true });
}
