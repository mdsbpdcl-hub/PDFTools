import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ACCEPT, kindOf, type ToolDef } from "../tools/registry";
import type { OutputFile, PickedFile, RunResult, ToolAction } from "../lib/types";
import { UserError } from "../lib/types";
import { downloadBlob, formatBytes, plural, uid, zipOutputs } from "../lib/util";
import { inspectPdf } from "../lib/pdfjs";
import { backend } from "../lib/backend";
import { useBackend } from "../App";
import { AvailabilityTag } from "./Home";
import { Modal, Note, PdfPagePreview, Progress, Stepper, Tiles } from "./ui";

const MAX_TOTAL_MB = 500;
const STEPS = ["Add files", "Options", "Download"];

export default function ToolPage({ tool, onOpenSettings }: { tool: ToolDef; onOpenSettings: () => void }) {
  const [step, setStep] = useState(0);
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [action, setActionState] = useState<ToolAction | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ value: number | null; msg: string }>({ value: 0, msg: "" });
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RunResult | null>(null);
  const [consent, setConsent] = useState(false);
  const [announce, setAnnounce] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const be = useBackend();

  const setAction = useCallback((a: ToolAction | null) => setActionState(a), []);

  // ------------------------------------------------------------ files
  const addFiles = useCallback((list: FileList | File[]) => {
    const incoming = [...list];
    setError(null);
    setFiles((prev) => {
      const next = [...prev];
      for (const file of incoming) {
        const kind = kindOf(file);
        const pf: PickedFile = { id: uid(), file, kind, status: "checking" };
        if (!tool.accept.includes(kind)) {
          pf.status = "error";
          pf.error = `Not supported here. This tool accepts ${tool.accept.map((k) => ACCEPT[k].label).join(" or ")}.`;
        } else if (file.size === 0) {
          pf.status = "error"; pf.error = "This file is empty.";
        } else if (file.size > tool.maxFileMB * 1024 * 1024) {
          pf.status = "error"; pf.error = `Too large (limit ${tool.maxFileMB} MB per file for this tool).`;
        } else if (kind !== "pdf") {
          pf.status = "ready";
        }
        if (tool.maxFiles === 1 && pf.status !== "error") {
          // Replacing the single file is friendlier than an error.
          for (let i = next.length - 1; i >= 0; i--) if (next[i].status !== "error") next.splice(i, 1);
        }
        next.push(pf);
      }
      return next;
    });
  }, [tool]);

  // Inspect PDFs (page count, password) after they are added.
  useEffect(() => {
    const pending = files.filter((f) => f.status === "checking");
    if (!pending.length) return;
    let alive = true;
    (async () => {
      for (const pf of pending) {
        let update: Partial<PickedFile>;
        try {
          const info = await inspectPdf(pf.file);
          update = { status: "ready", pages: info.pages, encrypted: info.encrypted, restricted: info.restricted };
          if (info.encrypted && !tool.allowEncrypted) update = { ...update, status: "error", error: "This PDF needs a password to open. Use Unlock PDF first if you have the password." };
          else if (info.restricted && !tool.allowRestricted && !tool.allowEncrypted)
            update = { ...update, status: "error", error: "This PDF has permission restrictions. Use Unlock PDF with the permissions password first." };
          else if (tool.id === "unlock" && !info.encrypted && !info.restricted)
            update = { ...update, status: "error", error: "This PDF has no password or restrictions, so there is nothing to unlock." };
        } catch (e) {
          update = { status: "error", error: e instanceof Error ? e.message : "Could not read this file." };
        }
        if (!alive) return;
        setFiles((prev) => prev.map((f) => (f.id === pf.id ? { ...f, ...update } : f)));
      }
    })();
    return () => { alive = false; };
  }, [files, tool]);

  const ready = useMemo(() => files.filter((f) => f.status === "ready"), [files]);
  const checking = files.some((f) => f.status === "checking");
  const hasErrors = files.some((f) => f.status === "error");
  const totalMB = files.reduce((s, f) => s + f.file.size, 0) / 1024 / 1024;

  const step1Problem = useMemo(() => {
    if (checking) return "Checking files…";
    if (hasErrors) return "Remove the files marked with a problem to continue.";
    if (ready.length < tool.minFiles) return tool.minFiles === 1 ? "Add a file to continue." : `Add at least ${tool.minFiles} files to continue.`;
    if (ready.length > tool.maxFiles) return `This tool takes at most ${plural(tool.maxFiles, "file")}. Remove ${ready.length - tool.maxFiles}.`;
    if (totalMB > MAX_TOTAL_MB) return `Together these files are over ${MAX_TOTAL_MB} MB. Remove some to continue.`;
    return null;
  }, [checking, hasErrors, ready.length, tool, totalMB]);

  // ------------------------------------------------------------ run
  const run = async () => {
    if (!action || action.disabled) return;
    setConsent(false);
    setError(null);
    setRunning(true);
    setProgress({ value: null, msg: "Starting…" });
    setAnnounce("Working on your files.");
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const r = await action.run({
        signal: ac.signal,
        progress: (value, msg) => setProgress((p) => ({ value: value === null ? null : Math.max(0, Math.min(1, value)), msg: msg ?? p.msg })),
      });
      if (!r.outputs.length) throw new UserError("Nothing was produced. Check the options and try again.");
      for (const o of r.outputs) if (!o.blob.size) throw new UserError(`“${o.name}” came out empty, so it was not offered for download.`);
      setResult(r);
      setStep(2);
      setAnnounce(`Done. ${plural(r.outputs.length, "file")} ready to download.`);
    } catch (e) {
      const name = (e as { name?: string })?.name;
      const msg = name === "AbortError" ? "Cancelled. No file was produced." :
        e instanceof UserError ? e.message :
        `Something went wrong: ${(e as Error)?.message ?? e}. No file was produced.`;
      if (!(e instanceof UserError) && name !== "AbortError") console.error(e);
      setError(msg);
      setAnnounce(msg);
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  };

  const onPrimary = () => {
    if (step === 0) { setStep(1); setResult(null); return; }
    if (step === 1 && action) {
      if (action.sendsToBackend) setConsent(true);
      else run();
    }
  };

  const startOver = () => { setFiles([]); setResult(null); setError(null); setAction(null); setStep(0); };

  // ------------------------------------------------------------ render
  return (
    <div className="fade-in">
      <div className="page-head">
        <p className="small" style={{ marginBottom: 6 }}><a href="#/">All tools</a> <span aria-hidden="true">›</span> {tool.title}</p>
        <div className="row" style={{ alignItems: "flex-start" }}>
          <div className="grow">
            <h1>{step === 0 ? tool.question : step === 1 ? "Choose your options" : "Your file is ready"}</h1>
            <p>{step === 0 ? tool.summary : step === 1 ? `${tool.title} · ${plural(ready.length, "file")}` : "Download it below. Nothing has been kept by this site."}</p>
          </div>
          <AvailabilityTag tool={tool} />
        </div>
      </div>
      <Stepper steps={STEPS} current={step} />
      <div className="sr-only" aria-live="polite">{announce}</div>

      {step === 0 && (
        <div className="stack-lg">
          <DropZone tool={tool} onFiles={addFiles} />
          {files.length > 0 && (
            <FileList
              files={files}
              reorder={tool.maxFiles > 1}
              onRemove={(id) => setFiles((f) => f.filter((x) => x.id !== id))}
              onMove={(from, to) => setFiles((f) => { const n = [...f]; const [m] = n.splice(from, 1); n.splice(to, 0, m); return n; })}
            />
          )}
          {tool.backendNote && (
            <Note tone="info">
              {tool.backendNote}{" "}
              {be.status === "online" ? "A backend is connected; you can choose it on the next step." : <>No backend is connected. <button className="link-btn" type="button" onClick={onOpenSettings}>Backend settings</button></>}
            </Note>
          )}
        </div>
      )}

      {(step === 1 || step === 2) && (
        <div className="stack-lg" hidden={step !== 1}>
          {tool.limitations && (
            <details className="more card" style={{ paddingTop: 12 }}>
              <summary>What to expect from this tool</summary>
              <ul style={{ margin: 0, paddingLeft: 18 }} className="small">{tool.limitations.map((l) => <li key={l}>{l}</li>)}</ul>
            </details>
          )}
          <Suspense fallback={<div className="card"><p className="muted">Loading the tool…</p><Progress value={null} /></div>}>
            <div style={running ? { pointerEvents: "none", opacity: 0.6 } : undefined} aria-busy={running}>
              <tool.component files={ready} setAction={setAction} />
            </div>
          </Suspense>
          {running && (
            <div className="card stack fade-in" role="status">
              <div className="row"><strong className="grow">{progress.msg || "Working…"}</strong>{progress.value !== null && <span className="strong">{Math.round(progress.value * 100)}%</span>}</div>
              <Progress value={progress.value} />
              <p className="small muted">You can keep this tab open in the background. Large files can take a while.</p>
            </div>
          )}
          {error && <Note tone="error">{error}</Note>}
        </div>
      )}

      {step === 2 && result && <ResultView result={result} />}

      {consent && action?.sendsToBackend && (
        <Modal
          title="Send files to the backend?"
          onClose={() => setConsent(false)}
          actions={<>
            <button className="btn" type="button" onClick={() => setConsent(false)}>Cancel</button>
            <button className="btn primary" type="button" onClick={run}>Send and continue</button>
          </>}
        >
          <p>This option needs your files to be processed on <strong>{backend.host()}</strong>, not in this browser.</p>
          <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
            {action.sendsToBackend.files.map((f) => <li key={f.name}>{f.name} ({formatBytes(f.size)})</li>)}
          </ul>
          <p className="small muted">Purpose: {action.sendsToBackend.purpose}. The standard backend deletes files as soon as the result is returned and does not log their contents. Only continue if you trust whoever runs this backend.</p>
        </Modal>
      )}

      <div className="bottom-bar">
        <div className="bottom-inner">
          {step === 0 && <a className="btn" href="#/">Back</a>}
          {step === 1 && <button className="btn" type="button" disabled={running} onClick={() => { setStep(0); setError(null); }}>Back</button>}
          {step === 2 && <button className="btn" type="button" onClick={() => setStep(1)}>Change options</button>}
          <span className="hint">
            {step === 0 && (step1Problem ?? `${plural(ready.length, "file")} ready · ${formatBytes(totalMB * 1024 * 1024)}`)}
            {step === 1 && !running && (action?.disabled ? action.disabledReason : action?.sendsToBackend ? `Uses the backend at ${backend.host()}` : "Runs in your browser")}
          </span>
          {step === 0 && <button className="btn primary" type="button" disabled={!!step1Problem} onClick={onPrimary}>Next</button>}
          {step === 1 && !running && (
            <button className="btn primary" type="button" disabled={!action || action.disabled} onClick={onPrimary}>{action?.label ?? "Run"}</button>
          )}
          {step === 1 && running && <button className="btn" type="button" onClick={() => abortRef.current?.abort()}>Cancel</button>}
          {step === 2 && <button className="btn primary" type="button" onClick={startOver}>Start again</button>}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- upload

function DropZone({ tool, onFiles }: { tool: ToolDef; onFiles: (f: FileList | File[]) => void }) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const accept = tool.accept.flatMap((k) => ACCEPT[k].ext).join(",");
  const labels = tool.accept.map((k) => ACCEPT[k].label).join(" or ");
  return (
    <div
      className={`drop ${over ? "over" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); if (e.dataTransfer.files.length) onFiles(e.dataTransfer.files); }}
    >
      <p className="big">Drag and drop {tool.maxFiles === 1 ? "a file" : "files"} here</p>
      <p className="muted">or</p>
      <p style={{ marginTop: 8 }}>
        <button className="btn primary" type="button" onClick={() => input.current?.click()}>Choose {tool.maxFiles === 1 ? "a file" : "files"}</button>
      </p>
      <input ref={input} type="file" accept={accept} multiple={tool.maxFiles > 1} hidden onChange={(e) => { if (e.target.files?.length) onFiles(e.target.files); e.target.value = ""; }} />
      <p className="small muted" style={{ marginTop: 12 }}>
        {labels} · up to {tool.maxFileMB} MB per file{tool.maxFiles > 1 ? ` · up to ${tool.maxFiles} files` : ""} · {MAX_TOTAL_MB} MB in total.
        {" "}Limits keep the browser responsive; very large files may be slow on phones.
      </p>
    </div>
  );
}

function FileList({ files, reorder, onRemove, onMove }: { files: PickedFile[]; reorder: boolean; onRemove: (id: string) => void; onMove: (from: number, to: number) => void }) {
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  return (
    <ul className="file-list" aria-label="Selected files">
      {files.map((f, i) => (
        <li
          key={f.id}
          draggable={reorder}
          className={overIdx === i ? "drag-over" : ""}
          onDragStart={() => setDragIdx(i)}
          onDragOver={(e) => { if (dragIdx !== null) { e.preventDefault(); setOverIdx(i); } }}
          onDragLeave={() => setOverIdx(null)}
          onDrop={(e) => { e.preventDefault(); if (dragIdx !== null && dragIdx !== i) onMove(dragIdx, i); setDragIdx(null); setOverIdx(null); }}
          onDragEnd={() => { setDragIdx(null); setOverIdx(null); }}
        >
          {reorder && <span className="muted small" aria-hidden="true" style={{ width: 18 }}>{i + 1}</span>}
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="name" title={f.file.name}>{f.file.name}</div>
            {f.error ? <div className="err-msg">{f.error}</div> : (
              <div className="meta">
                {formatBytes(f.file.size)}
                {f.pages !== undefined && ` · ${plural(f.pages, "page")}`}
                {f.encrypted && " · password-protected"}
                {f.restricted && " · has restrictions"}
              </div>
            )}
          </div>
          <span className={`tag ${f.status === "ready" ? "ok" : f.status === "error" ? "err" : "busy"}`}>
            {f.status === "ready" ? "Ready" : f.status === "error" ? "Problem" : "Checking"}
          </span>
          {reorder && (
            <>
              <button className="icon-btn" type="button" aria-label={`Move ${f.file.name} up`} disabled={i === 0} onClick={() => onMove(i, i - 1)}>↑</button>
              <button className="icon-btn" type="button" aria-label={`Move ${f.file.name} down`} disabled={i === files.length - 1} onClick={() => onMove(i, i + 1)}>↓</button>
            </>
          )}
          <button className="icon-btn" type="button" aria-label={`Remove ${f.file.name}`} onClick={() => onRemove(f.id)}>×</button>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------- result

function ResultView({ result }: { result: RunResult }) {
  const [zipping, setZipping] = useState(false);
  const firstPdf = result.outputs.find((o) => o.blob.type === "application/pdf");
  const firstImg = result.outputs.find((o) => o.blob.type.startsWith("image/"));
  const imgUrl = useMemo(() => (firstImg ? URL.createObjectURL(firstImg.blob) : null), [firstImg]);
  useEffect(() => () => { if (imgUrl) URL.revokeObjectURL(imgUrl); }, [imgUrl]);
  const total = result.outputs.reduce((s, o) => s + o.blob.size, 0);

  const downloadAll = async () => {
    setZipping(true);
    try { downloadBlob(await zipOutputs(result.outputs), "pdf-desk-results.zip"); } finally { setZipping(false); }
  };

  return (
    <div className="stack-lg fade-in">
      {result.summary && <Tiles items={result.summary} />}
      {result.notes?.map((n, i) => <Note key={i} tone={n.tone === "ok" ? "ok" : n.tone}>{n.text}</Note>)}
      <div className="card stack">
        <div className="row">
          <h2 className="grow">{plural(result.outputs.length, "file")} · {formatBytes(total)}</h2>
          {result.outputs.length > 1 && <button className="btn primary" type="button" disabled={zipping} onClick={downloadAll}>{zipping ? "Preparing ZIP…" : "Download all (ZIP)"}</button>}
        </div>
        <ul className="file-list">
          {result.outputs.slice(0, 200).map((o: OutputFile, i) => (
            <li key={i}>
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="name">{o.name}</div>
                <div className="meta">{formatBytes(o.blob.size)}</div>
              </div>
              <button className={`btn sm ${result.outputs.length === 1 ? "primary" : ""}`} type="button" onClick={() => downloadBlob(o.blob, o.name)}>Download</button>
            </li>
          ))}
        </ul>
        {result.outputs.length > 200 && <p className="small muted">Showing the first 200 files. Use “Download all (ZIP)” to get every file.</p>}
      </div>
      {result.textPreview !== undefined && (
        <div className="card stack">
          <h3>Preview</h3>
          <textarea className="input" readOnly value={result.textPreview} rows={12} aria-label="Text preview" />
        </div>
      )}
      {firstPdf && (
        <div className="card stack">
          <h3>Preview of the first page{result.outputs.length > 1 ? ` of ${firstPdf.name}` : ""}</h3>
          <PdfPagePreview source={firstPdf.blob} label="First page of the result" width={480} />
        </div>
      )}
      {!firstPdf && imgUrl && (
        <div className="card stack">
          <h3>Preview of {firstImg!.name}</h3>
          <div className="preview-frame"><img src={imgUrl} alt={`Preview of ${firstImg!.name}`} style={{ maxWidth: "100%", maxHeight: 520 }} /></div>
        </div>
      )}
    </div>
  );
}
