import { useEffect, useState } from "react";
import type { OutputFile, ToolProps } from "../lib/types";
import { openPdf, pageText, closePdf } from "../lib/pdfjs";
import { baseName, checkAborted, plural, yieldToUI } from "../lib/util";
import { Check } from "../components/ui";

export default function PdfToText({ files, setAction }: ToolProps) {
  const [markers, setMarkers] = useState(true);
  const [combine, setCombine] = useState(false);

  useEffect(() => {
    const totalPages = files.reduce((s, f) => s + (f.pages ?? 0), 0);
    setAction({
      label: "Extract text",
      run: async ({ progress, signal }) => {
        const outputs: OutputFile[] = [];
        const combined: string[] = [];
        let done = 0, empty = 0, chars = 0;
        for (const f of files) {
          const pdf = await openPdf(f.file);
          const parts: string[] = [];
          try {
            for (let n = 1; n <= pdf.numPages; n++) {
              checkAborted(signal);
              progress(done / totalPages, `${f.file.name}: page ${n} of ${pdf.numPages}`);
              const page = await pdf.getPage(n);
              const t = await pageText(page);
              page.cleanup();
              if (!t.trim()) empty++;
              chars += t.length;
              parts.push(markers ? `--- Page ${n} ---\n${t}` : t);
              done++;
              if (n % 5 === 0) await yieldToUI();
            }
          } finally { await closePdf(pdf); }
          const text = parts.join(markers ? "\n\n" : "\n\f\n");
          if (combine) combined.push(`===== ${f.file.name} =====\n\n${text}`);
          else outputs.push({ name: `${baseName(f.file.name)}.txt`, blob: new Blob(["﻿" + text], { type: "text/plain;charset=utf-8" }) });
        }
        if (combine) outputs.push({ name: "extracted-text.txt", blob: new Blob(["﻿" + combined.join("\n\n")], { type: "text/plain;charset=utf-8" }) });
        const preview = await outputs[0].blob.text();
        return {
          outputs,
          textPreview: preview.replace(/^﻿/, "").slice(0, 20000) + (preview.length > 20000 ? "\n…" : ""),
          summary: [{ label: "Pages read", value: String(done) }, { label: "Characters", value: chars.toLocaleString() }],
          notes: empty ? [{ tone: "warn", text: `${plural(empty, "page")} had no text. They may be scanned images — use OCR to make them readable.` }] : undefined,
        };
      },
    });
  }, [files, markers, combine, setAction]);

  return (
    <div className="card stack">
      <Check checked={markers} onChange={setMarkers}>Mark where each page starts (“--- Page 3 ---”)</Check>
      {files.length > 1 && <Check checked={combine} onChange={setCombine}>Put all files into one text file</Check>}
      <p className="small muted">Text is saved as UTF-8, which keeps Hindi and other scripts intact.</p>
    </div>
  );
}
