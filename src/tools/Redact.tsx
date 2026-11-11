import { useEffect, useMemo, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { ToolProps } from "../lib/types";
import { UserError } from "../lib/types";
import { getPdfLib, loadPdf } from "../lib/pdflib";
import { openPdf, renderPage, closePdf } from "../lib/pdfjs";
import { baseName, canvasToBlob, checkAborted, pdfBlob, plural, uid, yieldToUI } from "../lib/util";
import { Check, Note, SelectField, usePdfDoc } from "../components/ui";
import { DrawLayer, PageCanvas, PageNav, pct, type FRect } from "../components/PageCanvas";

interface Box extends FRect { id: string; page: number; source: "drawn" | "search" }

const PATTERNS = {
  email: { label: "Email addresses", re: /[\w.+-]+@[\w-]+(\.[\w-]+)+/g },
  phone: { label: "Phone numbers (10 digits, optional +91)", re: /(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}\b/g },
  id12: { label: "12-digit ID numbers (e.g. 1234 5678 9012)", re: /\b\d{4}\s?\d{4}\s?\d{4}\b/g },
} as const;
type PatternKey = keyof typeof PATTERNS;

export default function Redact({ files, setAction }: ToolProps) {
  const f = files[0];
  const total = f.pages ?? 1;
  const { doc, error } = usePdfDoc(f.file);
  const [page, setPage] = useState(0);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [terms, setTerms] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [patterns, setPatterns] = useState<Record<PatternKey, boolean>>({ email: false, phone: false, id12: false });
  const [searching, setSearching] = useState(false);
  const [searchMsg, setSearchMsg] = useState("");
  const [dpi, setDpi] = useState("200");

  const pagesWithBoxes = useMemo(() => [...new Set(boxes.map((b) => b.page))].sort((a, b) => a - b), [boxes]);

  const runSearch = async () => {
    if (!doc) return;
    const list = terms.split("\n").map((t) => t.trim()).filter(Boolean);
    const regs: RegExp[] = [
      ...list.map((t) => new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), caseSensitive ? "g" : "gi")),
      ...(Object.keys(patterns) as PatternKey[]).filter((k) => patterns[k]).map((k) => new RegExp(PATTERNS[k].re.source, "g")),
    ];
    if (!regs.length) { setSearchMsg("Enter words to find, or tick a pattern."); return; }
    setSearching(true);
    const found = await findMatches(doc, regs, setSearchMsg);
    setBoxes((b) => [...b.filter((x) => x.source !== "search"), ...found]);
    setSearching(false);
    setSearchMsg(found.length ? `Found ${plural(found.length, "match", "matches")} on ${plural(new Set(found.map((x) => x.page)).size, "page")}. They are marked for removal — check each page below.` : "No matches found. Scanned pages have no text to search; draw boxes on them instead.");
  };

  useEffect(() => {
    setAction({
      label: pagesWithBoxes.length ? `Redact ${plural(pagesWithBoxes.length, "page")}` : "Redact",
      disabled: boxes.length === 0,
      disabledReason: "Mark at least one area or search for text to remove.",
      run: async ({ progress, signal }) => {
        const { PDFDocument } = await getPdfLib();
        const src = await loadPdf(f.file);
        const pdf = await openPdf(f.file);
        const out = await PDFDocument.create();
        const redactSet = new Set(pagesWithBoxes);
        try {
          for (let i = 0; i < src.getPageCount(); i++) {
            checkAborted(signal);
            progress(i / src.getPageCount() * 0.85, redactSet.has(i) ? `Redacting page ${i + 1}…` : `Copying page ${i + 1}…`);
            if (!redactSet.has(i)) {
              const [p] = await out.copyPages(src, [i]);
              out.addPage(p);
              continue;
            }
            const pg = await pdf.getPage(i + 1);
            const vp = pg.getViewport({ scale: 1 });
            const { canvas } = await renderPage(pg, Number(dpi) / 72, { annotations: true });
            const ctx = canvas.getContext("2d")!;
            ctx.fillStyle = "#000";
            for (const b of boxes.filter((x) => x.page === i)) {
              ctx.fillRect(Math.floor(b.x * canvas.width) - 1, Math.floor(b.y * canvas.height) - 1, Math.ceil(b.w * canvas.width) + 2, Math.ceil(b.h * canvas.height) + 2);
            }
            const img = await out.embedJpg(new Uint8Array(await (await canvasToBlob(canvas, "image/jpeg", 0.9)).arrayBuffer()));
            const np = out.addPage([vp.width, vp.height]);
            np.drawImage(img, { x: 0, y: 0, width: vp.width, height: vp.height });
            canvas.width = canvas.height = 0;
            pg.cleanup();
            await yieldToUI();
          }
        } finally { await closePdf(pdf); }
        out.setProducer("PDF Desk");
        out.setCreator("PDF Desk");
        progress(0.9, "Saving…");
        const bytes = await out.save({ useObjectStreams: true });

        // Verify: redacted pages must have no text left, and searched terms must not appear anywhere.
        progress(0.95, "Checking the result…");
        const check = await openPdf(bytes);
        const leftovers: number[] = [];
        const termHits: number[] = [];
        const list = terms.split("\n").map((t) => t.trim()).filter(Boolean);
        for (let n = 1; n <= check.numPages; n++) {
          const pg = await check.getPage(n);
          const text = (await pg.getTextContent()).items.map((it) => ("str" in it ? it.str : "")).join(" ");
          if (redactSet.has(n - 1) && text.trim()) leftovers.push(n);
          const hay = caseSensitive ? text : text.toLowerCase();
          if (list.some((t) => hay.includes(caseSensitive ? t : t.toLowerCase()))) termHits.push(n);
        }
        await closePdf(check);
        if (leftovers.length) throw new UserError(`Verification failed: text remained on page(s) ${leftovers.join(", ")}. No file was produced.`);
        return {
          outputs: [{ name: `${baseName(f.file.name)}_redacted.pdf`, blob: pdfBlob(bytes) }],
          summary: [{ label: "Areas removed", value: String(boxes.length) }, { label: "Pages rebuilt", value: String(pagesWithBoxes.length) }],
          notes: [
            termHits.length
              ? { tone: "warn", text: `Some search words still appear as text on page(s) ${termHits.join(", ")} — probably in places that were not boxed. Go back and check those pages.` }
              : { tone: "ok", text: "Check passed: the redacted pages contain no hidden text, and none of your search words remain in the document text." },
            { tone: "warn", text: "Open the result and look through every page before sharing it. Document properties, bookmarks and attachments from the original were not copied." },
          ],
        };
      },
    });
  }, [boxes, pagesWithBoxes, dpi, f, terms, caseSensitive, setAction]);

  if (error) return <Note tone="error">{error}</Note>;
  const onPage = boxes.filter((b) => b.page === page);
  return (
    <div className="stack-lg">
      <Note tone="warn" title="Real redaction.">Marked areas are permanently removed by rebuilding those pages as images with the areas blacked out. The original text underneath is not kept, so it cannot be recovered.</Note>
      <div className="card stack">
        <h2>1. Find text to remove (optional)</h2>
        <div className="field">
          <label htmlFor="redact-terms">Words or phrases, one per line</label>
          <textarea id="redact-terms" className="input" rows={3} value={terms} onChange={(e) => setTerms(e.target.value)} style={{ fontFamily: "inherit", minHeight: 80 }} />
        </div>
        <Check checked={caseSensitive} onChange={setCaseSensitive}>Match upper and lower case exactly</Check>
        <div className="row">
          {(Object.keys(PATTERNS) as PatternKey[]).map((k) => (
            <Check key={k} checked={patterns[k]} onChange={(v) => setPatterns((p) => ({ ...p, [k]: v }))}>{PATTERNS[k].label}</Check>
          ))}
        </div>
        <div className="row">
          <button className="btn" type="button" disabled={!doc || searching} onClick={runSearch}>{searching ? "Searching…" : "Find and mark"}</button>
          <span className="small muted" role="status">{searchMsg}</span>
        </div>
      </div>
      <div className="card stack">
        <h2>2. Check pages and draw boxes</h2>
        <p className="small muted">Drag on the page to cover anything else, such as signatures, photos or stamps. Click × on a box to remove it.</p>
        <PageNav page={page} total={total} onChange={setPage} extra={
          <span className="small muted">
            {pagesWithBoxes.length ? `Marked pages: ${pagesWithBoxes.slice(0, 15).map((p) => p + 1).join(", ")}${pagesWithBoxes.length > 15 ? "…" : ""}` : "No pages marked yet"}
          </span>} />
        {doc && (
          <PageCanvas doc={doc} page={page} label={`Page ${page + 1}`}>
            <DrawLayer ariaLabel="Draw a box to redact" onRect={(r) => setBoxes((b) => [...b, { ...r, id: uid(), page, source: "drawn" }])} />
            {onPage.map((b) => (
              <div key={b.id} className="box" style={pct(b)}>
                <button type="button" aria-label="Remove this box" onClick={() => setBoxes((x) => x.filter((y) => y.id !== b.id))}>×</button>
              </div>
            ))}
          </PageCanvas>
        )}
        <div className="row">
          <button className="btn sm" type="button" disabled={!onPage.length} onClick={() => setBoxes((b) => b.filter((x) => x.page !== page))}>Clear this page</button>
          <button className="btn sm" type="button" disabled={!boxes.length} onClick={() => setBoxes([])}>Clear all</button>
        </div>
      </div>
      <div className="card">
        <SelectField label="Quality of rebuilt pages" value={dpi} onChange={setDpi} options={[
          { value: "150", label: "150 dpi — smaller file" }, { value: "200", label: "200 dpi — recommended" }, { value: "300", label: "300 dpi — print quality" },
        ]} />
      </div>
    </div>
  );
}

async function findMatches(doc: PDFDocumentProxy, regs: RegExp[], status: (s: string) => void): Promise<Box[]> {
  const out: Box[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    status(`Searching page ${n} of ${doc.numPages}…`);
    const page = await doc.getPage(n);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    for (const it of tc.items) {
      if (!("str" in it) || !it.str) continue;
      const [a, b, c, d, e, f] = it.transform as number[];
      const h = Math.hypot(c, d) || Math.hypot(a, b);
      const len = it.str.length;
      for (const re of regs) {
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(it.str))) {
          if (!m[0].length) { re.lastIndex++; continue; }
          const x1 = e + (it.width * m.index) / len;
          const x2 = e + (it.width * (m.index + m[0].length)) / len;
          // Generous box: descenders below the baseline and some slack for proportional fonts.
          const [vx1, vy1] = vp.convertToViewportPoint(x1 - h * 0.15, f - h * 0.3) as number[];
          const [vx2, vy2] = vp.convertToViewportPoint(x2 + h * 0.15, f + h * 1.0) as number[];
          const rx = Math.min(vx1, vx2), ry = Math.min(vy1, vy2);
          out.push({ id: uid(), page: n - 1, source: "search", x: rx / vp.width, y: ry / vp.height, w: Math.abs(vx2 - vx1) / vp.width, h: Math.abs(vy2 - vy1) / vp.height });
        }
      }
    }
    page.cleanup();
    if (n % 5 === 0) await yieldToUI();
  }
  return out;
}
