import { useEffect, useState } from "react";
import type { ToolProps } from "../lib/types";
import { getPdfLib, loadPdf, savePdf } from "../lib/pdflib";
import { describePages, parseGroups, parsePages } from "../lib/ranges";
import { baseName, checkAborted, pdfBlob, plural, yieldToUI } from "../lib/util";
import { Choices, NumberField, TextField } from "../components/ui";

type Mode = "ranges" | "extract" | "each" | "every";

export default function Split({ files, setAction }: ToolProps) {
  const f = files[0];
  const total = f.pages ?? 0;
  const [mode, setMode] = useState<Mode>("ranges");
  const [ranges, setRanges] = useState(total > 1 ? `1-${Math.ceil(total / 2)}, ${Math.ceil(total / 2) + 1}-${total}` : "1");
  const [pages, setPages] = useState("1");
  const [n, setN] = useState(2);

  let groups: number[][] = [];
  let err: string | undefined;
  try {
    if (mode === "ranges") groups = parseGroups(ranges, total, false);
    else if (mode === "extract") groups = [parsePages(pages, total, false)];
    else if (mode === "each") groups = Array.from({ length: total }, (_, i) => [i]);
    else {
      if (!Number.isFinite(n) || n < 1) throw new Error("Enter a number of pages of at least 1.");
      for (let i = 0; i < total; i += n) groups.push(Array.from({ length: Math.min(n, total - i) }, (_, k) => i + k));
    }
  } catch (e) { err = (e as Error).message; }

  useEffect(() => {
    setAction({
      label: groups.length > 1 ? `Split into ${groups.length} files` : "Create PDF",
      disabled: !!err || !groups.length,
      disabledReason: err,
      run: async ({ progress, signal }) => {
        const { PDFDocument } = await getPdfLib();
        const src = await loadPdf(f.file);
        const base = baseName(f.file.name);
        const outputs = [];
        const pad = String(total).length;
        for (let i = 0; i < groups.length; i++) {
          checkAborted(signal);
          progress(i / groups.length, `Creating file ${i + 1} of ${groups.length}…`);
          const doc = await PDFDocument.create();
          (await doc.copyPages(src, groups[i])).forEach((p) => doc.addPage(p));
          const g = groups[i];
          const label = g.length === 1 ? `page-${String(g[0] + 1).padStart(pad, "0")}` : mode === "extract" ? "extracted" : `pages-${describePages(g).replace(/, /g, "_")}`;
          outputs.push({ name: `${base}_${label}.pdf`, blob: pdfBlob(await savePdf(doc)) });
          await yieldToUI();
        }
        return { outputs, summary: [{ label: "Files created", value: String(outputs.length) }, { label: "Original pages", value: String(total) }] };
      },
    });
  }, [f, mode, ranges, pages, n, err, total, setAction]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="card stack-lg">
      <p className="muted">{f.file.name} · {plural(total, "page")}</p>
      <Choices<Mode>
        legend="How do you want to split it?"
        value={mode}
        onChange={setMode}
        options={[
          { value: "ranges", title: "By page ranges", desc: "Each range becomes its own PDF." },
          { value: "extract", title: "Extract selected pages", desc: "The chosen pages go into one new PDF." },
          { value: "each", title: "One PDF per page", desc: `Creates ${plural(total, "file")}.` },
          { value: "every", title: "Every few pages", desc: "For example, every 2 pages." },
        ]}
      />
      {mode === "ranges" && <TextField label="Ranges" value={ranges} onChange={setRanges} error={err} help="Separate files with commas, e.g. 1-3, 4-10, 11-. “11-” means to the end." />}
      {mode === "extract" && <TextField label="Pages to extract" value={pages} onChange={setPages} error={err} help="e.g. 1, 3, 5-7" />}
      {mode === "every" && <NumberField label="Pages per file" value={n} onChange={setN} min={1} max={total} />}
      {!err && <p className="small muted">Result: <span className="strong">{plural(groups.length, "file")}</span>{groups.length <= 6 && groups.length > 0 ? ` (${groups.map((g) => describePages(g)).join(" · ")})` : ""}</p>}
    </div>
  );
}
