import { useEffect, useState } from "react";
import type { PDFFont } from "pdf-lib";
import type { ToolProps } from "../lib/types";
import { UserError } from "../lib/types";
import { getPdfLib, loadPdf, savePdf } from "../lib/pdflib";
import { openPdf, renderPage, vendorUrl, closePdf } from "../lib/pdfjs";
import { displayFrame } from "../lib/stamp";
import { backend, postToBackend } from "../lib/backend";
import { useBackend } from "../App";
import { baseName, checkAborted, pdfBlob, plural, yieldToUI } from "../lib/util";
import { Check, Choices, Note, SelectField } from "../components/ui";

const LANGS = [
  { code: "eng", label: "English" }, { code: "hin", label: "Hindi" }, { code: "mar", label: "Marathi" },
  { code: "fra", label: "French" }, { code: "deu", label: "German" }, { code: "spa", label: "Spanish" },
  { code: "por", label: "Portuguese" }, { code: "ita", label: "Italian" },
];
const TESSDATA = (import.meta.env.VITE_TESSDATA_URL as string | undefined)?.trim() || undefined;

export default function Ocr({ files, setAction }: ToolProps) {
  const f = files[0];
  const be = useBackend();
  const hasBackend = be.status === "online" && be.features.includes("ocr");
  const [where, setWhere] = useState<"local" | "backend">("local");
  const [langs, setLangs] = useState<string[]>(["eng"]);
  const [dpi, setDpi] = useState("250");
  const [skipText, setSkipText] = useState(true);

  useEffect(() => {
    setAction({
      label: "Make searchable",
      disabled: !langs.length,
      disabledReason: "Choose at least one language.",
      sendsToBackend: where === "backend" ? { files: [{ name: f.file.name, size: f.file.size }], purpose: "recognise text with OCRmyPDF" } : undefined,
      run: async ({ progress, signal }) => {
        const name = `${baseName(f.file.name)}_searchable.pdf`;
        if (where === "backend") {
          const form = new FormData();
          form.append("file", f.file);
          form.append("languages", langs.join("+"));
          const r = await postToBackend("/ocr", form, progress, signal);
          return { outputs: [{ name, blob: new Blob([r.blob], { type: "application/pdf" }) }], notes: [{ tone: "info", text: "Text was added by OCRmyPDF. Spot-check a few pages by searching for words you can see." }] };
        }

        progress(null, "Loading the text-recognition engine…");
        const T = await import("tesseract.js");
        let langProgress = "";
        let failLoad: (e: Error) => void = () => {};
        const loadFailed = new Promise<never>((_, rej) => { failLoad = rej; });
        const loadError = () => new UserError(`The OCR engine or language data could not be loaded${langProgress ? ` (stopped at: ${langProgress})` : ""}. Language data is downloaded from the internet the first time — check your connection or firewall.`);
        const timer = setTimeout(() => failLoad(loadError()), 180_000);
        const worker = await Promise.race([
          T.createWorker(langs, T.OEM.LSTM_ONLY, {
            workerPath: vendorUrl("tesseract/worker.min.js"),
            corePath: vendorUrl("tesseract/core/"),
            ...(TESSDATA ? { langPath: TESSDATA } : {}),
            logger: (m) => { if (/loading|initializ/i.test(m.status)) { langProgress = m.status; progress(null, `Preparing: ${m.status}…`); } },
            errorHandler: () => failLoad(loadError()),
          }),
          loadFailed,
        ]).catch(() => { throw loadError(); }).finally(() => clearTimeout(timer));

        const { pushGraphicsState, popGraphicsState, setTextRenderingMode, setCharacterSqueeze, TextRenderingMode, StandardFonts, degrees } = await getPdfLib();
        // If the file cannot be opened, stop the OCR worker instead of leaving it running.
        const out = await loadPdf(f.file).catch(async (e) => { await worker.terminate(); throw e; });
        const pdf = await openPdf(f.file).catch(async (e) => { await worker.terminate(); throw e; });
        const latin = await out.embedFont(StandardFonts.Helvetica);
        let deva: PDFFont | null = null;
        let done = 0, skipped = 0, dropped = 0, conf = 0;
        try {
          for (let n = 1; n <= pdf.numPages; n++) {
            checkAborted(signal);
            progress((n - 1) / pdf.numPages, `Recognising page ${n} of ${pdf.numPages}…`);
            const page = await pdf.getPage(n);
            if (skipText) {
              const tc = await page.getTextContent();
              if (tc.items.reduce((s, it) => s + ("str" in it ? it.str.trim().length : 0), 0) > 30) { skipped++; continue; }
            }
            const { canvas } = await renderPage(page, Number(dpi) / 72);
            page.cleanup();
            const { data } = await worker.recognize(canvas, {}, { blocks: true });
            conf += data.confidence;
            const target = out.getPage(n - 1);
            const fr = displayFrame(target);
            const k = fr.w / canvas.width; // display points per pixel
            target.pushOperators(pushGraphicsState(), setTextRenderingMode(TextRenderingMode.Invisible));
            for (const block of data.blocks ?? []) for (const para of block.paragraphs) for (const line of para.lines) {
              // One baseline and one font size per line, so copy/paste and search read words in order.
              const lb = line.bbox;
              const ra = line.rowAttributes as { rowHeight?: number; row_height?: number; descenders?: number } | undefined;
              const rowH = ra?.rowHeight || ra?.row_height || (lb.y1 - lb.y0) * 0.8;
              const size = rowH * k;
              if (!(size > 0)) continue;
              const bl = line.baseline;
              const hasBl = bl && Number.isFinite(bl.y0) && bl.x1 > bl.x0;
              const baseAt = (x: number) => hasBl ? bl.y0 + ((bl.y1 - bl.y0) * (x - bl.x0)) / (bl.x1 - bl.x0) : lb.y1 - (ra?.descenders ?? 0);
              for (const w of line.words) {
                const text = w.text.trim();
                if (!text) continue;
                let font = latin;
                try { latin.encodeText(text); } catch {
                  if (/[\u0900-\u097F]/.test(text)) {
                    deva ??= await loadDevanagari(out);
                    font = deva;
                  } else { dropped++; continue; }
                }
                const bw = (w.bbox.x1 - w.bbox.x0) * k;
                if (bw <= 0) continue;
                let squeeze = 100;
                try {
                  const natural = font.widthOfTextAtSize(text, size);
                  if (natural > 0) squeeze = Math.min(400, Math.max(25, (bw / natural) * 100));
                } catch { dropped++; continue; }
                const p = fr.toUser(w.bbox.x0 * k, fr.h - baseAt(w.bbox.x0) * k);
                target.pushOperators(pushGraphicsState(), setCharacterSqueeze(squeeze));
                try { target.drawText(text, { x: p.x, y: p.y, size, font, rotate: degrees(fr.rotation) }); } catch { dropped++; }
                target.pushOperators(popGraphicsState());
              }
            }
            target.pushOperators(popGraphicsState());
            canvas.width = canvas.height = 0;
            done++;
            await yieldToUI();
          }
        } finally {
          await worker.terminate();
          await closePdf(pdf);
        }
        if (!done) throw new UserError("Every page already has text, so nothing needed OCR. Untick “Skip pages that already have text” to OCR them anyway.");
        progress(0.97, "Saving…");
        const bytes = await savePdf(out);
        return {
          outputs: [{ name, blob: pdfBlob(bytes) }],
          summary: [
            { label: "Pages recognised", value: String(done) },
            ...(skipped ? [{ label: "Already had text", value: String(skipped) }] : []),
            { label: "Average confidence", value: `${Math.round(conf / done)}%` },
          ],
          notes: [
            { tone: "info", text: "The pages look exactly as before; an invisible text layer was added so you can search, select and copy." },
            ...(dropped ? [{ tone: "warn" as const, text: `${plural(dropped, "word")} in an unsupported script could not be added to the text layer.` }] : []),
            ...(conf / done < 70 ? [{ tone: "warn" as const, text: "Confidence was low. Try a higher resolution or check that the right language is selected." }] : []),
          ],
        };
      },
    });
  }, [f, where, langs, dpi, skipText, setAction]);

  const toggle = (code: string) => setLangs((l) => (l.includes(code) ? l.filter((x) => x !== code) : [...l, code]));

  return (
    <div className="card stack-lg">
      <Choices<"local" | "backend"> legend="Where should text be recognised?" value={where} onChange={setWhere} options={[
        { value: "local", title: "In your browser", desc: "Your file stays on this device. The engine and language data (about 2–15 MB per language) download once and are then cached." },
        { value: "backend", title: `On the backend (OCRmyPDF)${hasBackend ? "" : " — not available"}`, desc: hasBackend ? `Sends the file to ${backend.host()}. Faster for long documents.` : "Needs the optional backend.", disabled: !hasBackend },
      ]} />
      <fieldset className="choice-group">
        <legend>Languages in the document</legend>
        <div className="row">{LANGS.map((l) => <Check key={l.code} checked={langs.includes(l.code)} onChange={() => toggle(l.code)}>{l.label}</Check>)}</div>
        <span className="small muted">Pick only the languages that appear — each extra language slows recognition.</span>
      </fieldset>
      {where === "local" && (
        <>
          <SelectField label="Scan resolution" value={dpi} onChange={setDpi} options={[
            { value: "200", label: "200 dpi — faster" }, { value: "250", label: "250 dpi — recommended" }, { value: "300", label: "300 dpi — small print" },
          ]} />
          <Check checked={skipText} onChange={setSkipText}>Skip pages that already have text</Check>
          {(f.pages ?? 0) > 40 && <Note tone="warn">{f.pages} pages may take several minutes in the browser. Keep this tab open.</Note>}
        </>
      )}
    </div>
  );
}

async function loadDevanagari(doc: import("pdf-lib").PDFDocument): Promise<PDFFont> {
  await import("regenerator-runtime/runtime"); // needed by fontkit's Indic shaper
  const { default: fontkit } = await import("@pdf-lib/fontkit");
  doc.registerFontkit(fontkit);
  const res = await fetch(vendorUrl("fonts/noto-sans-devanagari.woff"));
  if (!res.ok) throw new UserError("The Devanagari font could not be loaded.");
  return doc.embedFont(new Uint8Array(await res.arrayBuffer()), { subset: true });
}
