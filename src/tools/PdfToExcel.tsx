import { useEffect, useState } from "react";
import type { ToolProps } from "../lib/types";
import { UserError } from "../lib/types";
import { openPdf, pageItems, closePdf } from "../lib/pdfjs";
import { detectTable } from "../lib/tables";
import { buildXlsx, colName, parseNumber, type Cell } from "../lib/xlsx";
import { baseName, plural, yieldToUI } from "../lib/util";
import { Check, Note, Progress, Seg } from "../components/ui";

type Tables = string[][][]; // [page][row][col]

export default function PdfToExcel({ files, setAction }: ToolProps) {
  const f = files[0];
  const [tablesOnly, setTablesOnly] = useState(true);
  const [tables, setTables] = useState<Tables | null>(null);
  const [scan, setScan] = useState({ done: 0, error: "" });
  const [page, setPage] = useState(0);
  const [layout, setLayout] = useState<"per-page" | "one">("per-page");
  const [numbers, setNumbers] = useState(true);

  // Extract on entry (and when the "tables only" choice changes) so the user can review before download.
  useEffect(() => {
    let alive = true;
    setTables(null);
    (async () => {
      try {
        const pdf = await openPdf(f.file);
        const result: Tables = [];
        for (let n = 1; n <= pdf.numPages && alive; n++) {
          const p = await pdf.getPage(n);
          result.push(detectTable(await pageItems(p), tablesOnly));
          p.cleanup();
          setScan({ done: n, error: "" });
          if (n % 3 === 0) await yieldToUI();
        }
        await closePdf(pdf);
        if (alive) {
          setTables(result);
          setPage(Math.max(0, result.findIndex((t) => t.length > 0)));
        }
      } catch (e) {
        if (alive) setScan({ done: 0, error: e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => { alive = false; };
  }, [f, tablesOnly]);

  const rowsTotal = tables?.reduce((s, t) => s + t.length, 0) ?? 0;
  const pagesWith = tables?.filter((t) => t.length).length ?? 0;

  useEffect(() => {
    setAction({
      label: "Download Excel file",
      disabled: !tables || rowsTotal === 0,
      disabledReason: !tables ? "Reading tables…" : "No table rows were found.",
      run: async ({ progress }) => {
        if (!tables) throw new UserError("Tables are still being read.");
        progress(0.5, "Building the Excel file…");
        const conv = (v: string): Cell => (numbers ? parseNumber(v) ?? v : v);
        const sheets = layout === "per-page"
          ? tables.map((t, i) => ({ name: `Page ${i + 1}`, rows: t.map((r) => r.map(conv)) })).filter((s) => s.rows.length)
          : [{ name: "Tables", rows: tables.flatMap((t, i) => t.map((r) => [i + 1, ...r.map(conv)] as Cell[])) }];
        if (layout === "one") sheets[0].rows.unshift(["Page"]);
        const blob = await buildXlsx(sheets);
        return {
          outputs: [{ name: `${baseName(f.file.name)}.xlsx`, blob }],
          summary: [{ label: "Rows", value: String(rowsTotal) }, { label: "Pages with tables", value: String(pagesWith) }, { label: "Sheets", value: String(sheets.length) }],
        };
      },
    });
  }, [tables, layout, numbers, rowsTotal, pagesWith, f, setAction]);

  const edit = (r: number, c: number, v: string) =>
    setTables((t) => t && t.map((pg, i) => (i !== page ? pg : pg.map((row, ri) => (ri !== r ? row : row.map((cell, ci) => (ci === c ? v : cell)))))));
  const removeRow = (r: number) => setTables((t) => t && t.map((pg, i) => (i !== page ? pg : pg.filter((_, ri) => ri !== r))));

  if (scan.error) return <Note tone="error">{scan.error}</Note>;
  const current = tables?.[page] ?? [];
  const width = Math.max(0, ...current.map((r) => r.length));

  return (
    <div className="stack-lg">
      <div className="card stack">
        <Check checked={tablesOnly} onChange={setTablesOnly}>Only keep rows that look like table rows (two or more columns)</Check>
        <Check checked={numbers} onChange={setNumbers}>Turn numbers like 1,23,456.50 into real numbers Excel can add up</Check>
        <Seg<"per-page" | "one"> label="Sheets" value={layout} onChange={setLayout} options={[{ value: "per-page", label: "One sheet per page" }, { value: "one", label: "Everything on one sheet" }]} />
      </div>
      <div className="card stack">
        <div className="row">
          <h2 className="grow">Review what was found</h2>
          {tables && (
            <label className="row small" style={{ gap: 6 }}>Page
              <select className="input" style={{ width: "auto" }} value={page} onChange={(e) => setPage(Number(e.target.value))}>
                {tables.map((t, i) => <option key={i} value={i}>{i + 1} ({plural(t.length, "row")})</option>)}
              </select>
            </label>
          )}
        </div>
        {!tables ? (
          <div className="stack"><p className="muted">Reading page {scan.done + 1} of {f.pages}…</p><Progress value={(scan.done) / (f.pages || 1)} /></div>
        ) : rowsTotal === 0 ? (
          <Note tone="warn">No tables were found. If this is a scanned PDF, run OCR first. You can also untick “Only keep rows that look like table rows”.</Note>
        ) : current.length === 0 ? (
          <p className="muted">No table rows on this page.</p>
        ) : (
          <>
            <p className="small muted">Click a cell to correct it. Use × to drop rows you do not need (such as titles or notes).</p>
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th scope="col"><span className="sr-only">Remove</span></th>{Array.from({ length: width }, (_, c) => <th key={c} scope="col">{colName(c)}</th>)}</tr></thead>
                <tbody>
                  {current.slice(0, 500).map((row, r) => (
                    <tr key={`${page}-${r}-${row.join("|").length}`}>
                      <td><button className="icon-btn" type="button" style={{ width: 24, height: 24 }} aria-label={`Remove row ${r + 1}`} onClick={() => removeRow(r)}>×</button></td>
                      {Array.from({ length: width }, (_, c) => (
                        <td key={c} contentEditable suppressContentEditableWarning aria-label={`Row ${r + 1}, column ${colName(c)}`}
                          onBlur={(e) => { const v = e.currentTarget.textContent ?? ""; if (v !== (row[c] ?? "")) edit(r, c, v); }}>{row[c] ?? ""}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {current.length > 500 && <p className="small muted">Showing the first 500 rows of this page; all rows are included in the download.</p>}
          </>
        )}
      </div>
    </div>
  );
}
