import { useEffect, useState } from "react";
import type { PDFRadioGroup } from "pdf-lib";
import type { ToolProps } from "../lib/types";
import { UserError } from "../lib/types";
import { getPdfLib, loadPdf, savePdf } from "../lib/pdflib";
import { openPdf, closePdf } from "../lib/pdfjs";
import { toUserSpace } from "../lib/place";
import { baseName, pdfBlob, plural, uid } from "../lib/util";
import { Check, Note, Seg, TextField, usePdfDoc } from "../components/ui";
import { DrawLayer, PageCanvas, PageNav, pct, type FRect } from "../components/PageCanvas";

interface ExistingField { name: string; type: "text" | "check" | "radio" | "dropdown" | "list" | "other"; options?: string[]; multiline?: boolean; readOnly: boolean }
type Value = string | boolean | string[];
interface NewField extends FRect { id: string; page: number; type: "text" | "check" | "radio"; name: string; option?: string }

export default function Forms({ files, setAction }: ToolProps) {
  const f = files[0];
  const total = f.pages ?? 1;
  const { doc } = usePdfDoc(f.file);
  const [existing, setExisting] = useState<ExistingField[] | null>(null);
  const [xfa, setXfa] = useState(false);
  const [values, setValues] = useState<Record<string, Value>>({});
  const [loadErr, setLoadErr] = useState("");
  const [mode, setMode] = useState<"fill" | "create">("fill");
  const [flatten, setFlatten] = useState(false);
  const [added, setAdded] = useState<NewField[]>([]);
  const [newType, setNewType] = useState<NewField["type"]>("text");
  const [radioGroup, setRadioGroup] = useState("choice");
  const [page, setPage] = useState(0);

  useEffect(() => {
    (async () => {
      try {
        const { PDFTextField, PDFCheckBox, PDFRadioGroup, PDFDropdown, PDFOptionList } = await getPdfLib();
        const pdf = await loadPdf(f.file);
        const form = pdf.getForm();
        setXfa(form.hasXFA());
        const list: ExistingField[] = [];
        const init: Record<string, Value> = {};
        for (const fld of form.getFields()) {
          const name = fld.getName();
          const readOnly = fld.isReadOnly();
          if (fld instanceof PDFTextField) { list.push({ name, type: "text", multiline: fld.isMultiline(), readOnly }); init[name] = fld.getText() ?? ""; }
          else if (fld instanceof PDFCheckBox) { list.push({ name, type: "check", readOnly }); init[name] = fld.isChecked(); }
          else if (fld instanceof PDFRadioGroup) { list.push({ name, type: "radio", options: fld.getOptions(), readOnly }); init[name] = fld.getSelected() ?? ""; }
          else if (fld instanceof PDFDropdown) { list.push({ name, type: "dropdown", options: fld.getOptions(), readOnly }); init[name] = fld.getSelected()[0] ?? ""; }
          else if (fld instanceof PDFOptionList) { list.push({ name, type: "list", options: fld.getOptions(), readOnly }); init[name] = fld.getSelected(); }
          else list.push({ name, type: "other", readOnly: true });
        }
        setExisting(list);
        setValues(init);
        if (!list.filter((x) => x.type !== "other").length) setMode("create");
      } catch (e) { setLoadErr(e instanceof Error ? e.message : String(e)); }
    })();
  }, [f]);

  const editable = existing?.filter((x) => x.type !== "other") ?? [];
  const nameProblem = (() => {
    if (added.some((a) => !a.name.trim())) return "Every new field needs a name.";
    const seen = new Set((existing ?? []).map((x) => x.name));
    for (const a of added) {
      if (a.type === "radio") { if (seen.has(a.name) && !added.some((b) => b.type === "radio" && b.name === a.name && b !== a)) return `A field called “${a.name}” already exists.`; continue; }
      if (seen.has(a.name)) return `Two fields are called “${a.name}”. Field names must be unique.`;
      seen.add(a.name);
    }
    const radioNames = new Set(added.filter((a) => a.type === "radio").map((a) => a.name));
    if (added.some((a) => a.type !== "radio" && radioNames.has(a.name))) return "A tick box or text box has the same name as an option group.";
    return null;
  })();

  useEffect(() => {
    setAction({
      label: "Save form",
      disabled: !existing || (editable.length === 0 && added.length === 0) || !!nameProblem,
      disabledReason: !existing ? "Reading the form…" : nameProblem ?? "Fill in a field or add a new one first.",
      run: async ({ progress }) => {
        const L = await getPdfLib();
        const pdf = await loadPdf(f.file);
        const form = pdf.getForm();
        progress(0.2, "Filling in fields…");
        const font = await pdf.embedFont(L.StandardFonts.Helvetica);
        for (const fld of editable) {
          if (fld.readOnly) continue;
          const v = values[fld.name];
          try {
            if (fld.type === "text") {
              const tf = form.getTextField(fld.name);
              const text = String(v ?? "");
              if ((tf.getText() ?? "") !== text) {
                try { font.encodeText(text); } catch { throw new UserError(`“${fld.name}”: the text has characters the form font cannot show (for example Hindi).`); }
                const max = tf.getMaxLength();
                tf.setText(max !== undefined ? text.slice(0, max) : text);
              }
            } else if (fld.type === "check") { const cb = form.getCheckBox(fld.name); if (v) cb.check(); else cb.uncheck(); }
            else if (fld.type === "radio" && v) form.getRadioGroup(fld.name).select(String(v));
            else if (fld.type === "dropdown" && v) form.getDropdown(fld.name).select(String(v));
            else if (fld.type === "list" && Array.isArray(v)) form.getOptionList(fld.name).select(v);
          } catch (e) {
            if (e instanceof UserError) throw e;
            throw new UserError(`The field “${fld.name}” could not be filled (${(e as Error).message}).`);
          }
        }
        if (added.length) {
          progress(0.5, "Adding new fields…");
          const pjs = await openPdf(f.file);
          const used = new Set(form.getFields().map((x) => x.getName()));
          const groups = new Map<string, PDFRadioGroup>();
          for (const a of added) {
            const u = await toUserSpace(pjs, a.page, a);
            const page = pdf.getPage(a.page);
            const opts = { ...u.box, borderWidth: 1, borderColor: L.rgb(0.6, 0.6, 0.6), backgroundColor: L.rgb(1, 1, 1) };
            if (a.type === "radio") {
              let g = groups.get(a.name);
              if (!g) {
                if (used.has(a.name)) throw new UserError(`A field called “${a.name}” already exists. Choose another name.`);
                g = form.createRadioGroup(a.name); groups.set(a.name, g); used.add(a.name);
              }
              g.addOptionToPage(a.option || `Option ${g.getOptions().length + 1}`, page, opts);
            } else {
              if (used.has(a.name)) throw new UserError(`A field called “${a.name}” already exists. Choose another name.`);
              used.add(a.name);
              if (a.type === "text") { const t = form.createTextField(a.name); t.addToPage(page, { ...opts, font }); }
              else form.createCheckBox(a.name).addToPage(page, opts);
            }
          }
          await closePdf(pjs);
        }
        progress(0.8, "Saving…");
        form.updateFieldAppearances(font);
        if (flatten) form.flatten();
        return {
          outputs: [{ name: `${baseName(f.file.name)}_${flatten ? "filled-flat" : "form"}.pdf`, blob: pdfBlob(await savePdf(pdf)) }],
          summary: [{ label: "Fields filled", value: String(editable.length) }, { label: "Fields added", value: String(added.length) }],
          notes: flatten ? [{ tone: "info", text: "The form was flattened: answers are now part of the page and can no longer be edited." }] : undefined,
        };
      },
    });
  }, [existing, values, added, flatten, nameProblem, f, setAction]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loadErr) return <Note tone="error">{loadErr}</Note>;
  if (!existing) return <div className="card"><p className="muted">Reading the form…</p></div>;

  const addRect = (r: FRect) => {
    const n = added.filter((a) => a.type === newType).length + 1;
    const name = newType === "radio" ? radioGroup.trim() || "choice" : `${newType === "text" ? "text" : "tick"}_${n}`;
    const option = newType === "radio" ? `Option ${added.filter((a) => a.type === "radio" && a.name === name).length + 1}` : undefined;
    let rect = r;
    if (newType !== "text") { const s = Math.max(r.w, r.h * 0.77); rect = { ...r, w: s, h: s / 0.77 }; }
    setAdded((a) => [...a, { ...rect, id: uid(), page, type: newType, name, option }]);
  };

  return (
    <div className="stack-lg">
      {xfa && <Note tone="warn" title="XFA form detected.">This file uses Adobe’s older XFA form technology. Fields shown below come from the standard form layer and may not match what Adobe Reader displays.</Note>}
      <Seg<"fill" | "create"> label="What do you want to do?" value={mode} onChange={setMode} options={[{ value: "fill", label: `Fill in fields (${editable.length})` }, { value: "create", label: `Add new fields (${added.length})` }]} />

      {mode === "fill" && (
        <div className="card stack-lg">
          {editable.length === 0 ? (
            <Note tone="info">This PDF has no fillable fields. Choose “Add new fields” to create them.</Note>
          ) : (
            <div className="grid-2">
              {editable.map((fld) => {
                const v = values[fld.name];
                const setV = (x: Value) => setValues((s) => ({ ...s, [fld.name]: x }));
                const label = fld.name + (fld.readOnly ? " (read-only)" : "");
                if (fld.type === "check") return <Check key={fld.name} checked={!!v} onChange={(x) => !fld.readOnly && setV(x)}>{label}</Check>;
                if (fld.type === "text") return fld.multiline
                  ? <div className="field" key={fld.name}><label htmlFor={`f-${fld.name}`}>{label}</label><textarea id={`f-${fld.name}`} className="input" style={{ fontFamily: "inherit", minHeight: 70 }} value={String(v ?? "")} readOnly={fld.readOnly} onChange={(e) => setV(e.target.value)} /></div>
                  : <TextField key={fld.name} label={label} value={String(v ?? "")} onChange={(x) => !fld.readOnly && setV(x)} />;
                if (fld.type === "list") return (
                  <div className="field" key={fld.name}><label htmlFor={`f-${fld.name}`}>{label}</label>
                    <select id={`f-${fld.name}`} multiple className="input" disabled={fld.readOnly} value={(v as string[]) ?? []} onChange={(e) => setV([...e.target.selectedOptions].map((o) => o.value))}>
                      {fld.options!.map((o) => <option key={o}>{o}</option>)}
                    </select></div>
                );
                return (
                  <div className="field" key={fld.name}><label htmlFor={`f-${fld.name}`}>{label}</label>
                    <select id={`f-${fld.name}`} className="input" disabled={fld.readOnly} value={String(v ?? "")} onChange={(e) => setV(e.target.value)}>
                      <option value="">— choose —</option>
                      {fld.options!.map((o) => <option key={o}>{o}</option>)}
                    </select></div>
                );
              })}
            </div>
          )}
          {existing.some((x) => x.type === "other") && <p className="small muted">Buttons and signature fields are left unchanged.</p>}
        </div>
      )}

      {mode === "create" && doc && (
        <div className="card stack">
          <div className="row">
            <Seg<NewField["type"]> label="Field to add" value={newType} onChange={setNewType} options={[{ value: "text", label: "Text box" }, { value: "check", label: "Tick box" }, { value: "radio", label: "Option (one of several)" }]} />
            {newType === "radio" && <div style={{ width: 220 }}><TextField label="Group name" value={radioGroup} onChange={setRadioGroup} help="Options with the same group name work together." /></div>}
          </div>
          <p className="small muted">Drag on the page where the field should go.</p>
          <PageNav page={page} total={total} onChange={setPage} />
          <PageCanvas doc={doc} page={page} label={`Page ${page + 1}`}>
            <DrawLayer ariaLabel="Draw a new form field" minSize={0.008} onRect={addRect} />
            {added.filter((a) => a.page === page).map((a) => (
              <div key={a.id} className="box field" style={pct(a)}>
                {a.type === "radio" ? `${a.name}: ${a.option}` : a.name}
                <button type="button" aria-label={`Remove field ${a.name}`} onClick={() => setAdded((x) => x.filter((y) => y.id !== a.id))}>×</button>
              </div>
            ))}
          </PageCanvas>
          {added.length > 0 && (
            <ul className="file-list">
              {added.map((a) => (
                <li key={a.id}>
                  <span className="tag">{a.type === "text" ? "Text" : a.type === "check" ? "Tick" : "Option"}</span>
                  <div className="grow" style={{ maxWidth: 260 }}>
                    <input className="input" aria-label="Field name" value={a.name} onChange={(e) => setAdded((x) => x.map((y) => (y.id === a.id ? { ...y, name: e.target.value } : y)))} />
                  </div>
                  {a.type === "radio" && <input className="input" style={{ maxWidth: 160 }} aria-label="Option value" value={a.option} onChange={(e) => setAdded((x) => x.map((y) => (y.id === a.id ? { ...y, option: e.target.value } : y)))} />}
                  <span className="meta">page {a.page + 1}</span>
                  <button className="icon-btn" type="button" aria-label={`Remove ${a.name}`} onClick={() => setAdded((x) => x.filter((y) => y.id !== a.id))}>×</button>
                </li>
              ))}
            </ul>
          )}
          {nameProblem && <p className="field-error">{nameProblem}</p>}
          <p className="small muted">{plural(added.length, "new field")}.</p>
        </div>
      )}

      <div className="card"><Check checked={flatten} onChange={setFlatten}>Flatten the form (answers become part of the page and can no longer be changed)</Check></div>
    </div>
  );
}
