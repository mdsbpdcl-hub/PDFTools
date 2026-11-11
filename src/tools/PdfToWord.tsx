import { useEffect, useState } from "react";
import type { ToolProps } from "../lib/types";
import { UserError } from "../lib/types";
import { groupLines, median, openPdf, pageItems, renderPage, toParagraphs, type TLine, closePdf } from "../lib/pdfjs";
import { postToBackend, backend } from "../lib/backend";
import { useBackend } from "../App";
import { baseName, canvasToBlob, checkAborted, yieldToUI } from "../lib/util";
import { Choices, Note } from "../components/ui";

type Mode = "text" | "picture" | "backend";
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export default function PdfToWord({ files, setAction }: ToolProps) {
  const f = files[0];
  const be = useBackend();
  const hasBackend = be.status === "online" && be.features.includes("pdf-to-docx");
  const [mode, setMode] = useState<Mode>(hasBackend ? "backend" : "text");

  useEffect(() => {
    setAction({
      label: "Convert to Word",
      sendsToBackend: mode === "backend" ? { files: [{ name: f.file.name, size: f.file.size }], purpose: "convert to Word with pdf2docx" } : undefined,
      run: async ({ progress, signal }) => {
        const name = `${baseName(f.file.name)}.docx`;
        if (mode === "backend") {
          const form = new FormData();
          form.append("file", f.file);
          const r = await postToBackend("/convert/pdf-to-docx", form, progress, signal);
          return { outputs: [{ name, blob: new Blob([r.blob], { type: DOCX }) }] };
        }
        const docx = await import("docx");
        const pdf = await openPdf(f.file);
        const children: InstanceType<typeof docx.Paragraph>[] = [];
        let textChars = 0;
        let pageW = 612, pageH = 792;
        try {
          // First pass: body text size across the document, for heading detection.
          const allLines: TLine[][] = [];
          for (let n = 1; n <= pdf.numPages; n++) {
            checkAborted(signal);
            progress((n / pdf.numPages) * (mode === "text" ? 0.6 : 0.85), `Reading page ${n} of ${pdf.numPages}…`);
            const page = await pdf.getPage(n);
            if (n === 1) { const vp = page.getViewport({ scale: 1 }); pageW = vp.width; pageH = vp.height; }
            if (mode === "text") {
              allLines.push(groupLines(await pageItems(page)));
            } else {
              const vp = page.getViewport({ scale: 1 });
              const { canvas } = await renderPage(page, 150 / 72);
              const data = new Uint8Array(await (await canvasToBlob(canvas, "image/jpeg", 0.85)).arrayBuffer());
              const maxW = 6.5 * 96, maxH = 9 * 96; // px at 96 dpi inside 1-inch margins (Letter/A4 safe)
              const k = Math.min(maxW / vp.width, maxH / vp.height);
              children.push(new docx.Paragraph({
                pageBreakBefore: n > 1,
                children: [new docx.ImageRun({ type: "jpg", data, transformation: { width: Math.round(vp.width * k), height: Math.round(vp.height * k) } })],
              }));
            }
            page.cleanup();
            await yieldToUI();
          }
          if (mode === "text") {
            const body = median(allLines.flat().map((l) => l.size)) || 11;
            allLines.forEach((lines, pi) => {
              const paras = toParagraphs(lines, body);
              if (!paras.length) {
                children.push(new docx.Paragraph({ pageBreakBefore: pi > 0, children: [new docx.TextRun({ text: `[Page ${pi + 1} has no extractable text]`, italics: true, color: "888888" })] }));
                return;
              }
              paras.forEach((p, i) => {
                textChars += p.text.length;
                const ratio = p.size / body;
                children.push(new docx.Paragraph({
                  pageBreakBefore: pi > 0 && i === 0,
                  heading: p.heading ? (ratio > 1.6 ? docx.HeadingLevel.HEADING_1 : ratio > 1.35 ? docx.HeadingLevel.HEADING_2 : docx.HeadingLevel.HEADING_3) : undefined,
                  spacing: { after: 120 },
                  children: [new docx.TextRun({ text: p.text, size: p.heading ? undefined : Math.round(Math.min(Math.max(p.size, 8), 14) * 2) })],
                }));
              });
            });
            if (textChars === 0) throw new UserError("No text was found. This looks like a scanned PDF. Run OCR first, or choose “Exact look (pictures)”.");
          }
        } finally {
          await closePdf(pdf);
        }
        progress(0.92, "Building the Word file…");
        const twip = (pt: number) => Math.round(pt * 20);
        const document = new docx.Document({
          creator: "PDF Desk",
          title: baseName(f.file.name),
          styles: { default: { document: { run: { font: "Calibri" } } } },
          sections: [{ properties: { page: { size: { width: twip(pageW), height: twip(pageH) }, margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } }, children }],
        });
        const blob = await docx.Packer.toBlob(document);
        return {
          outputs: [{ name, blob: new Blob([blob], { type: DOCX }) }],
          notes: mode === "text"
            ? [{ tone: "info", text: "Text and headings were kept. Check tables, columns and images against the original — they are not reproduced in this mode." }]
            : [{ tone: "info", text: "Each page is a picture in the Word file, so it looks right but the text cannot be edited." }],
        };
      },
    });
  }, [f, mode, setAction]);

  return (
    <div className="card stack-lg">
      <Choices<Mode>
        legend="What kind of Word file do you need?"
        value={mode}
        onChange={setMode}
        options={[
          { value: "text", title: "Editable text (in your browser)", desc: "Paragraphs and headings you can edit. Layout, tables and images are simplified." },
          { value: "picture", title: "Exact look (pictures, in your browser)", desc: "Each page placed as an image. Looks like the PDF but is not editable." },
          { value: "backend", title: `Closest layout (backend)${hasBackend ? "" : " — not available"}`, desc: hasBackend ? `Uses pdf2docx on ${backend.host()}. Keeps tables, columns and images where it can.` : "Needs the optional backend with pdf2docx.", disabled: !hasBackend },
        ]}
      />
      {f.pages && f.pages > 150 && mode !== "backend" && <Note tone="warn">This PDF has {f.pages} pages. Conversion may take a minute or two.</Note>}
    </div>
  );
}
