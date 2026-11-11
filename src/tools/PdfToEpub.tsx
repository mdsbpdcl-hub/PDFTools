import { useEffect, useState } from "react";
import type { ToolProps } from "../lib/types";
import { UserError } from "../lib/types";
import { groupLines, median, openPdf, pageItems, toParagraphs, type TLine, type TPara, closePdf } from "../lib/pdfjs";
import { buildEpub, type Chapter } from "../lib/epub";
import { baseName, checkAborted, plural, yieldToUI } from "../lib/util";
import { Check, Choices, NumberField, SelectField, TextField } from "../components/ui";

type Split = "headings" | "pages";

export default function PdfToEpub({ files, setAction }: ToolProps) {
  const f = files[0];
  const [title, setTitle] = useState(baseName(f.file.name).replace(/[_-]+/g, " "));
  const [author, setAuthor] = useState("");
  const [language, setLanguage] = useState("en");
  const [split, setSplit] = useState<Split>("headings");
  const [every, setEvery] = useState(10);
  const [dropRepeats, setDropRepeats] = useState(true);

  useEffect(() => {
    setAction({
      label: "Create e-book",
      disabled: !title.trim() || (split === "pages" && !(every >= 1)),
      disabledReason: !title.trim() ? "Enter a title." : "Enter how many pages per chapter.",
      run: async ({ progress, signal }) => {
        const pdf = await openPdf(f.file);
        const pages: TPara[][] = [];
        try {
          const lineSets = [];
          for (let n = 1; n <= pdf.numPages; n++) {
            checkAborted(signal);
            progress((n / pdf.numPages) * 0.8, `Reading page ${n} of ${pdf.numPages}…`);
            const page = await pdf.getPage(n);
            lineSets.push(groupLines(await pageItems(page)));
            page.cleanup();
            if (n % 5 === 0) await yieldToUI();
          }
          // Lines at the very top or bottom that repeat on most pages are running headers/footers.
          const edge = (ls: TLine[]) => [...ls.slice(0, 2), ...ls.slice(-2)];
          const key = (t: string) => t.replace(/\d+/g, "#");
          const counts = new Map<string, number>();
          if (dropRepeats && lineSets.length >= 4) {
            for (const ls of lineSets) for (const t of new Set(edge(ls).map((l) => key(l.text)))) counts.set(t, (counts.get(t) ?? 0) + 1);
          }
          const body = median(lineSets.flat().map((l) => l.size)) || 11;
          for (const ls of lineSets) {
            const edges = new Set(edge(ls));
            const keep = ls.filter((l) => !(dropRepeats && edges.has(l) && ((counts.get(key(l.text)) ?? 0) >= lineSets.length * 0.6 || /^\d{1,4}$/.test(l.text))));
            pages.push(toParagraphs(keep, body));
          }
        } finally { await closePdf(pdf); }

        if (!pages.some((p) => p.length)) throw new UserError("No text was found. This looks like a scanned PDF — run OCR first.");
        progress(0.85, "Building chapters…");
        const chapters: Chapter[] = [];
        if (split === "headings") {
          let cur: Chapter = { title: title.trim(), paragraphs: [] };
          for (const p of pages.flat()) {
            if (p.heading && p.text.length < 120 && cur.paragraphs.some((x) => !x.heading)) {
              chapters.push(cur);
              cur = { title: p.text, paragraphs: [] };
            } else if (p.heading && !cur.paragraphs.length && chapters.length === 0 && cur.title === title.trim()) {
              cur.title = p.text;
            } else cur.paragraphs.push({ text: p.text, heading: p.heading });
          }
          chapters.push(cur);
        } else {
          for (let i = 0; i < pages.length; i += every) {
            const last = Math.min(i + every, pages.length);
            chapters.push({ title: every === 1 ? `Page ${i + 1}` : `Pages ${i + 1}–${last}`, paragraphs: pages.slice(i, last).flat().map((p) => ({ text: p.text, heading: p.heading })) });
          }
        }
        const blob = await buildEpub({ title: title.trim(), author: author.trim(), language }, chapters.filter((c) => c.paragraphs.length || c.title));
        return {
          outputs: [{ name: `${baseName(f.file.name)}.epub`, blob }],
          summary: [{ label: "Chapters", value: String(chapters.length) }, { label: "Pages read", value: String(pages.length) }],
          notes: [{ tone: "info", text: "Open the e-book in a reader to check the chapter breaks. Images and tables from the PDF are not included." }],
        };
      },
    });
  }, [f, title, author, language, split, every, dropRepeats, setAction]);

  return (
    <div className="card stack-lg">
      <div className="grid-2">
        <TextField label="Book title" value={title} onChange={setTitle} />
        <TextField label="Author (optional)" value={author} onChange={setAuthor} />
      </div>
      <SelectField label="Language of the text" value={language} onChange={setLanguage} options={[
        { value: "en", label: "English" }, { value: "hi", label: "Hindi" }, { value: "mr", label: "Marathi" }, { value: "bn", label: "Bengali" },
        { value: "ur", label: "Urdu" }, { value: "fr", label: "French" }, { value: "de", label: "German" }, { value: "es", label: "Spanish" },
      ]} />
      <Choices<Split> legend="How should chapters be made?" value={split} onChange={setSplit} options={[
        { value: "headings", title: "At headings", desc: "Starts a new chapter at large text. Best for reports and books." },
        { value: "pages", title: "Every few pages", desc: "Predictable, for documents without clear headings." },
      ]} />
      {split === "pages" && <NumberField label="Pages per chapter" value={every} onChange={setEvery} min={1} max={f.pages} help={`${plural(Math.ceil((f.pages ?? 0) / Math.max(1, every || 1)), "chapter")}`} />}
      <Check checked={dropRepeats} onChange={setDropRepeats}>Leave out repeated headers, footers and page numbers</Check>
    </div>
  );
}
