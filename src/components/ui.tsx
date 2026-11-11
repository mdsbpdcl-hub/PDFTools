import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { openPdf, renderThumb, renderPage, closePdf } from "../lib/pdfjs";
import type { PickedFile } from "../lib/types";

export function Note({ tone = "ok", title, children }: { tone?: "ok" | "warn" | "error" | "info"; title?: string; children: ReactNode }) {
  return (
    <div className={`note ${tone === "ok" ? "" : tone}`} role={tone === "error" ? "alert" : undefined}>
      {title && <strong>{title} </strong>}
      {children}
    </div>
  );
}

export function Progress({ value }: { value: number | null }) {
  return (
    <div
      className={`progress ${value === null ? "indeterminate" : ""}`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value === null ? undefined : Math.round(value * 100)}
    >
      <div style={{ width: `${Math.round((value ?? 0.3) * 100)}%` }} />
    </div>
  );
}

export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="stepper" aria-label="Progress">
      {steps.map((s, i) => (
        <li key={s} className={i < current ? "done" : i === current ? "current" : ""} aria-current={i === current ? "step" : undefined}>
          <span className="num" aria-hidden="true">{i < current ? "✓" : i + 1}</span>
          <span className="label">{s}</span>
          {i < current && <span className="sr-only">(done)</span>}
        </li>
      ))}
    </ol>
  );
}

export function Field({ label, help, error, children, htmlFor }: { label: string; help?: ReactNode; error?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {help && <span className="help">{help}</span>}
      {error && <span className="field-error" role="alert">{error}</span>}
    </div>
  );
}

/** Text input with a generated id and label. */
export function TextField(props: {
  label: string; value: string; onChange: (v: string) => void; help?: ReactNode; error?: string;
  placeholder?: string; type?: string; autoComplete?: string; inputMode?: "numeric" | "text"; maxLength?: number;
}) {
  const id = useId();
  return (
    <Field label={props.label} help={props.help} error={props.error} htmlFor={id}>
      <input
        id={id} className="input" type={props.type ?? "text"} value={props.value} placeholder={props.placeholder}
        autoComplete={props.autoComplete ?? "off"} inputMode={props.inputMode} maxLength={props.maxLength}
        aria-invalid={props.error ? true : undefined} onChange={(e) => props.onChange(e.target.value)}
      />
    </Field>
  );
}

export function NumberField(props: { label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; help?: ReactNode }) {
  const id = useId();
  return (
    <Field label={props.label} help={props.help} htmlFor={id}>
      <input
        id={id} className="input" type="number" value={Number.isFinite(props.value) ? props.value : ""} min={props.min} max={props.max} step={props.step ?? 1}
        onChange={(e) => props.onChange(e.target.value === "" ? NaN : Number(e.target.value))}
      />
    </Field>
  );
}

export function SelectField<T extends string>(props: { label: string; value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; help?: ReactNode }) {
  const id = useId();
  return (
    <Field label={props.label} help={props.help} htmlFor={id}>
      <select id={id} className="input" value={props.value} onChange={(e) => props.onChange(e.target.value as T)}>
        {props.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </Field>
  );
}

export function Range(props: { label: string; value: number; onChange: (v: number) => void; min: number; max: number; step?: number; format?: (v: number) => string }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{props.label}: <span className="strong">{props.format ? props.format(props.value) : props.value}</span></label>
      <input id={id} type="range" min={props.min} max={props.max} step={props.step ?? 1} value={props.value} onChange={(e) => props.onChange(Number(e.target.value))} />
    </div>
  );
}

export function Choices<T extends string>(props: { legend: string; value: T; onChange: (v: T) => void; options: { value: T; title: string; desc?: string; disabled?: boolean }[] }) {
  const name = useId();
  return (
    <fieldset className="choice-group">
      <legend>{props.legend}</legend>
      {props.options.map((o) => (
        <label key={o.value} className="choice" style={o.disabled ? { opacity: 0.6, cursor: "not-allowed" } : undefined}>
          <input type="radio" name={name} value={o.value} checked={props.value === o.value} disabled={o.disabled} onChange={() => props.onChange(o.value)} />
          <span>
            <span className="c-title">{o.title}</span>
            {o.desc && <span className="c-desc" style={{ display: "block" }}>{o.desc}</span>}
          </span>
        </label>
      ))}
    </fieldset>
  );
}

export function Seg<T extends string>(props: { label: string; value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div className="field">
      <span style={{ fontWeight: 600, fontSize: 14 }} id={useId()}>{props.label}</span>
      <div className="seg" role="group" aria-label={props.label}>
        {props.options.map((o) => (
          <button type="button" key={o.value} aria-pressed={props.value === o.value} onClick={() => props.onChange(o.value)}>{o.label}</button>
        ))}
      </div>
    </div>
  );
}

export function Check({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{children}</span>
    </label>
  );
}

export function Tiles({ items }: { items: { label: string; value: string }[] }) {
  return (
    <div className="tiles">
      {items.map((t) => (
        <div className="tile" key={t.label}><div className="v">{t.value}</div><div className="l">{t.label}</div></div>
      ))}
    </div>
  );
}

export function Modal({ title, children, onClose, actions }: { title: string; children: ReactNode; onClose: () => void; actions: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>("input, button, select, textarea");
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab" && ref.current) {
        const els = [...ref.current.querySelectorAll<HTMLElement>("input, button, select, textarea, a[href]")].filter((x) => !x.hasAttribute("disabled"));
        if (!els.length) return;
        const f = els[0], l = els[els.length - 1];
        if (e.shiftKey && document.activeElement === f) { e.preventDefault(); l.focus(); }
        else if (!e.shiftKey && document.activeElement === l) { e.preventDefault(); f.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); prev?.focus(); };
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal fade-in" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref}>
        <h2 id={titleId}>{title}</h2>
        <div className="stack">{children}</div>
        <div className="actions">{actions}</div>
      </div>
    </div>
  );
}

/** Opens a picked PDF with pdf.js for previews; closes it when the component unmounts. */
export function usePdfDoc(file: File | Blob | undefined): { doc: PDFDocumentProxy | null; error: string | null } {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!file) return;
    let alive = true;
    let opened: PDFDocumentProxy | null = null;
    setDoc(null);
    setError(null);
    openPdf(file)
      .then((d) => { opened = d; if (alive) setDoc(d); else closePdf(d); })
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => { alive = false; (opened && closePdf(opened)); };
  }, [file]);
  return { doc, error };
}

/** A page thumbnail that renders only when scrolled into view. */
export function PageThumb({ doc, page, width = 140, rotation = 0 }: { doc: PDFDocumentProxy; page: number; width?: number; rotation?: number }) {
  const holder = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = holder.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setVisible(true), { rootMargin: "300px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (!visible || !holder.current) return;
    let alive = true;
    renderThumb(doc, page, width, rotation).then((c) => {
      if (!alive || !holder.current) return;
      c.style.width = "100%";
      c.setAttribute("aria-hidden", "true");
      holder.current.replaceChildren(c);
    }).catch(() => { /* page failed to render; keep placeholder */ });
    return () => { alive = false; };
  }, [visible, doc, page, width, rotation]);
  return <div ref={holder} style={{ width: "100%" }}><div className="ph" /></div>;
}

/** Renders one page of a PDF (given as bytes/blob) at a display width; used for live previews. */
export function PdfPagePreview({ source, page = 1, width = 520, label }: { source: Blob | null; page?: number; width?: number; label: string }) {
  const holder = useRef<HTMLDivElement>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!source) return;
    let alive = true;
    (async () => {
      try {
        const doc = await openPdf(source);
        const p = await doc.getPage(Math.min(page, doc.numPages));
        const vp = p.getViewport({ scale: 1 });
        const { canvas } = await renderPage(p, (width * (window.devicePixelRatio || 1)) / vp.width);
        await closePdf(doc);
        if (!alive || !holder.current) return;
        canvas.style.width = `${Math.min(width, vp.width * 2)}px`;
        canvas.setAttribute("role", "img");
        canvas.setAttribute("aria-label", label);
        holder.current.replaceChildren(canvas);
        setErr(null);
      } catch (e) {
        if (alive) setErr(e instanceof Error ? e.message : "Preview failed.");
      }
    })();
    return () => { alive = false; };
  }, [source, page, width, label]);
  return (
    <div className="preview-frame">
      <div ref={holder}><span className="muted small">Preparing preview…</span></div>
      {err && <p className="field-error">{err}</p>}
    </div>
  );
}

export function readyPdfs(files: PickedFile[]) {
  return files.filter((f) => f.status === "ready");
}

/** Debounces a changing value (for live previews). */
export function useDebounced<T>(value: T, ms = 350): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
