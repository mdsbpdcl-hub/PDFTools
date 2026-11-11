import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import type { ToolProps } from "../lib/types";
import { UserError } from "../lib/types";
import { getPdfLib, loadPdf, savePdf } from "../lib/pdflib";
import { openPdf, closePdf } from "../lib/pdfjs";
import { toUserSpace } from "../lib/place";
import { postToBackend } from "../lib/backend";
import { useBackend } from "../App";
import { baseName, canvasToBlob, pdfBlob } from "../lib/util";
import { Check, Choices, Note, Range, Seg, TextField, usePdfDoc } from "../components/ui";
import { PageCanvas, PageNav, pct } from "../components/PageCanvas";

type Kind = "hand" | "digital";
type Source = "draw" | "type" | "upload";

export default function Sign({ files, setAction }: ToolProps) {
  const f = files[0];
  const total = f.pages ?? 1;
  const be = useBackend();
  const hasBackend = be.status === "online" && be.features.includes("sign");
  const { doc, error } = usePdfDoc(f.file);
  const [kind, setKind] = useState<Kind>("hand");
  const [source, setSource] = useState<Source>("draw");
  const [sig, setSig] = useState<{ blob: Blob; url: string; aspect: number } | null>(null);
  const [page, setPage] = useState(total - 1);
  const [pos, setPos] = useState({ x: 0.6, y: 0.82 });
  const [width, setWidth] = useState(0.25);
  const [applyTo, setApplyTo] = useState<"this" | "all">("this");
  const [withHand, setWithHand] = useState(false);
  // digital
  const [cert, setCert] = useState<File | null>(null);
  const [certPw, setCertPw] = useState("");
  const [reason, setReason] = useState("");
  const [location, setLocation] = useState("");

  useEffect(() => () => { if (sig) URL.revokeObjectURL(sig.url); }, [sig]);

  const [pageAspect, setPageAspect] = useState(0.77);
  useEffect(() => {
    if (!doc) return;
    doc.getPage(page + 1).then((p) => { const v = p.getViewport({ scale: 1 }); setPageAspect(v.width / v.height); });
  }, [doc, page]);
  const height = sig ? (width / sig.aspect) * pageAspect : 0.08;
  useEffect(() => {
    setPos((p) => ({ x: Math.min(Math.max(0, 1 - width), p.x), y: Math.min(Math.max(0, 1 - height), p.y) }));
  }, [width, height]);

  useEffect(() => {
    const needsHand = kind === "hand" || withHand;
    const missing = needsHand && !sig ? "Create your signature first." : kind === "digital" && (!cert || !certPw) ? "Choose your certificate file and enter its password." : null;
    setAction({
      label: kind === "hand" ? "Add signature" : "Sign digitally",
      disabled: !!missing || (kind === "digital" && !hasBackend),
      disabledReason: kind === "digital" && !hasBackend ? "Digital signing needs the optional backend." : missing ?? undefined,
      sendsToBackend: kind === "digital" ? { files: [{ name: f.file.name, size: f.file.size }, ...(cert ? [{ name: cert.name, size: cert.size }] : [])], purpose: "apply a certificate-based digital signature with pyHanko. Your certificate and its password are sent too" } : undefined,
      run: async ({ progress, signal }) => {
        let bytes: Uint8Array = new Uint8Array(await f.file.arrayBuffer());
        if (needsHand && sig) {
          progress(0.2, "Placing signature…");
          const { degrees } = await getPdfLib();
          const out = await loadPdf(bytes);
          const pdf = await openPdf(bytes);
          const png = await out.embedPng(new Uint8Array(await sig.blob.arrayBuffer()));
          const targets = applyTo === "all" ? out.getPageIndices() : [page];
          for (const i of targets) {
            const u = await toUserSpace(pdf, i, { x: pos.x, y: pos.y, w: width, h: height });
            out.getPage(i).drawImage(png, { x: u.x, y: u.y, width: u.width, height: u.height, rotate: degrees(u.angle) });
          }
          await closePdf(pdf);
          bytes = await savePdf(out);
        }
        if (kind === "digital") {
          if (!cert) throw new UserError("Choose your certificate file.");
          const form = new FormData();
          form.append("file", new Blob([bytes as BlobPart], { type: "application/pdf" }), f.file.name);
          form.append("certificate", cert);
          form.append("password", certPw);
          form.append("reason", reason);
          form.append("location", location);
          const r = await postToBackend("/sign", form, progress, signal);
          return {
            outputs: [{ name: `${baseName(f.file.name)}_signed.pdf`, blob: new Blob([r.blob], { type: "application/pdf" }) }],
            notes: [
              { tone: "ok", text: "The PDF was digitally signed. Open it in a PDF reader’s signature panel to check the signature." },
              { tone: "info", text: "Any later change to this file (including with PDF Desk) will invalidate the signature. Do all other edits first." },
            ],
          };
        }
        return {
          outputs: [{ name: `${baseName(f.file.name)}_signed.pdf`, blob: pdfBlob(bytes) }],
          notes: [{ tone: "info", text: "This is a picture of your signature placed on the page. It is not a cryptographic digital signature and does not prove who signed or that the file was not changed." }],
        };
      },
    });
  }, [kind, sig, cert, certPw, reason, location, page, pos, width, height, applyTo, withHand, hasBackend, f, setAction]);

  // Drag the signature on the page.
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const onDown = (e: RPointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.parentElement!.getBoundingClientRect();
    drag.current = { dx: (e.clientX - box.left) / box.width - pos.x, dy: (e.clientY - box.top) / box.height - pos.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e: RPointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const box = e.currentTarget.parentElement!.getBoundingClientRect();
    setPos({
      x: Math.min(1 - width, Math.max(0, (e.clientX - box.left) / box.width - drag.current.dx)),
      y: Math.min(1 - height, Math.max(0, (e.clientY - box.top) / box.height - drag.current.dy)),
    });
  };
  const nudge = (dx: number, dy: number) => setPos((p) => ({ x: Math.min(1 - width, Math.max(0, p.x + dx)), y: Math.min(1 - height, Math.max(0, p.y + dy)) }));

  if (error) return <Note tone="error">{error}</Note>;
  return (
    <div className="stack-lg">
      <div className="card">
        <Choices<Kind> legend="What kind of signature?" value={kind} onChange={setKind} options={[
          { value: "hand", title: "Handwritten signature (in your browser)", desc: "A picture of your signature on the page, like signing a printout. Quick, but anyone could copy it." },
          { value: "digital", title: `Digital signature with a certificate${hasBackend ? " (backend)" : " — needs backend"}`, desc: "Cryptographic proof of who signed and that the file has not changed since. Needs your certificate (.p12 / .pfx) from a certifying authority or your organisation." },
        ]} />
      </div>

      {kind === "digital" && (
        <div className="card stack">
          {!hasBackend && <Note tone="warn" title="Backend needed.">Digital signing uses a signing engine (pyHanko) on the optional backend. Connect one in Backend settings.</Note>}
          <div className="field">
            <label htmlFor="cert">Certificate file (.p12 or .pfx)</label>
            <input id="cert" type="file" accept=".p12,.pfx" className="input" onChange={(e) => setCert(e.target.files?.[0] ?? null)} />
            <span className="help">Use a certificate issued to you. For DSC tokens that cannot export a .pfx file, use your token’s own signing software instead.</span>
          </div>
          <TextField label="Certificate password" type="password" value={certPw} onChange={setCertPw} autoComplete="off" />
          <div className="grid-2">
            <TextField label="Reason (optional)" value={reason} onChange={setReason} placeholder="Approved" />
            <TextField label="Location (optional)" value={location} onChange={setLocation} placeholder="Patna" />
          </div>
          <Check checked={withHand} onChange={setWithHand}>Also show a handwritten signature on the page</Check>
          <Note tone="info">Only use a backend you or your organisation control: your certificate and password are sent to it to create the signature, and should be deleted straight after.</Note>
        </div>
      )}

      {(kind === "hand" || withHand) && (
        <>
          <div className="card stack">
            <h2>Your signature</h2>
            <Seg<Source> label="Create it by" value={source} onChange={setSource} options={[{ value: "draw", label: "Drawing" }, { value: "type", label: "Typing" }, { value: "upload", label: "Uploading a picture" }]} />
            {source === "draw" && <SigPad onDone={setSig} />}
            {source === "type" && <TypeSig onDone={setSig} />}
            {source === "upload" && <UploadSig onDone={setSig} />}
            {sig && <div className="row"><span className="small muted">Current signature:</span><img src={sig.url} alt="Your signature" style={{ height: 48, border: "1px solid var(--border)", borderRadius: 6, background: "#fff" }} /></div>}
          </div>
          <div className="card stack">
            <h2>Place it</h2>
            <PageNav page={page} total={total} onChange={setPage} />
            <p className="small muted">Drag the signature into position, or select it and use the arrow keys.</p>
            {doc && (
              <PageCanvas doc={doc} page={page} label={`Page ${page + 1}`}>
                {sig && (
                  <div className="sig" style={pct({ x: pos.x, y: pos.y, w: width, h: height })} tabIndex={0} role="button" aria-label="Signature position. Use arrow keys to move."
                    onPointerDown={onDown} onPointerMove={onMove} onPointerUp={() => { drag.current = null; }}
                    onKeyDown={(e) => {
                      const s = e.shiftKey ? 0.05 : 0.01;
                      const m: Record<string, [number, number]> = { ArrowLeft: [-s, 0], ArrowRight: [s, 0], ArrowUp: [0, -s], ArrowDown: [0, s] };
                      if (m[e.key]) { e.preventDefault(); nudge(...m[e.key]); }
                    }}>
                    <img src={sig.url} alt="" draggable={false} />
                  </div>
                )}
              </PageCanvas>
            )}
            <Range label="Size" value={Math.round(width * 100)} onChange={(v) => setWidth(v / 100)} min={8} max={60} format={(v) => `${v}% of page width`} />
            <Seg<"this" | "all"> label="Add to" value={applyTo} onChange={setApplyTo} options={[{ value: "this", label: `Page ${page + 1} only` }, { value: "all", label: "Every page, same spot" }]} />
          </div>
        </>
      )}
    </div>
  );
}

/** Trims transparent/white margins and returns a PNG. */
async function finish(canvas: HTMLCanvasElement, onDone: (s: { blob: Blob; url: string; aspect: number }) => void) {
  const ctx = canvas.getContext("2d")!;
  const { width: w, height: h } = canvas;
  const data = ctx.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = 0, y1 = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (data[(y * w + x) * 4 + 3] > 10) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 <= x0 || y1 <= y0) return;
  const pad = 6;
  const out = document.createElement("canvas");
  out.width = x1 - x0 + pad * 2; out.height = y1 - y0 + pad * 2;
  out.getContext("2d")!.drawImage(canvas, x0 - pad, y0 - pad, out.width, out.height, 0, 0, out.width, out.height);
  const blob = await canvasToBlob(out, "image/png");
  onDone({ blob, url: URL.createObjectURL(blob), aspect: out.width / out.height });
}

function SigPad({ onDone }: { onDone: (s: { blob: Blob; url: string; aspect: number }) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [color, setColor] = useState("#1e2a78");
  const [empty, setEmpty] = useState(true);
  useEffect(() => {
    const c = ref.current!;
    const r = c.getBoundingClientRect();
    c.width = r.width * 2; c.height = r.height * 2;
  }, []);
  const p = (e: RPointerEvent) => { const r = ref.current!.getBoundingClientRect(); return { x: (e.clientX - r.left) * 2, y: (e.clientY - r.top) * 2 }; };
  return (
    <div className="stack">
      <canvas ref={ref} className="sigpad" aria-label="Signature drawing area. Draw with a mouse, finger or stylus."
        onPointerDown={(e) => { ref.current!.setPointerCapture(e.pointerId); last.current = p(e); }}
        onPointerMove={(e) => {
          if (!last.current) return;
          const ctx = ref.current!.getContext("2d")!;
          const q = p(e);
          ctx.strokeStyle = color; ctx.lineWidth = 5; ctx.lineCap = "round"; ctx.lineJoin = "round";
          ctx.beginPath(); ctx.moveTo(last.current.x, last.current.y); ctx.lineTo(q.x, q.y); ctx.stroke();
          last.current = q; setEmpty(false);
        }}
        onPointerUp={() => { last.current = null; }} />
      <div className="row">
        <label className="row small" style={{ gap: 6 }}>Ink <input type="color" value={color} onChange={(e) => setColor(e.target.value)} /></label>
        <button className="btn sm" type="button" onClick={() => { const c = ref.current!; c.getContext("2d")!.clearRect(0, 0, c.width, c.height); setEmpty(true); }}>Clear</button>
        <button className="btn sm primary" type="button" disabled={empty} onClick={() => finish(ref.current!, onDone)}>Use this signature</button>
      </div>
    </div>
  );
}

function TypeSig({ onDone }: { onDone: (s: { blob: Blob; url: string; aspect: number }) => void }) {
  const [name, setName] = useState("");
  const [color, setColor] = useState("#1e2a78");
  const make = () => {
    const c = document.createElement("canvas");
    c.width = 1400; c.height = 300;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = color;
    ctx.font = `italic 120px "Segoe Script", "Brush Script MT", "Lucida Handwriting", "Apple Chancery", cursive`;
    ctx.textBaseline = "middle";
    ctx.fillText(name, 20, 150, 1360);
    finish(c, onDone);
  };
  return (
    <div className="row" style={{ alignItems: "flex-end" }}>
      <div className="grow"><TextField label="Your name" value={name} onChange={setName} /></div>
      <label className="row small" style={{ gap: 6 }}>Ink <input type="color" value={color} onChange={(e) => setColor(e.target.value)} /></label>
      <button className="btn primary" type="button" disabled={!name.trim()} onClick={make}>Use this signature</button>
    </div>
  );
}

function UploadSig({ onDone }: { onDone: (s: { blob: Blob; url: string; aspect: number }) => void }) {
  const [clean, setClean] = useState(true);
  const [err, setErr] = useState("");
  const load = async (file: File | undefined) => {
    if (!file) return;
    setErr("");
    try {
      const bmp = await createImageBitmap(file);
      const c = document.createElement("canvas");
      const k = Math.min(1, 1600 / bmp.width);
      c.width = bmp.width * k; c.height = bmp.height * k;
      const ctx = c.getContext("2d")!;
      ctx.drawImage(bmp, 0, 0, c.width, c.height);
      if (clean) {
        const img = ctx.getImageData(0, 0, c.width, c.height);
        for (let i = 0; i < img.data.length; i += 4) {
          const lum = (img.data[i] + img.data[i + 1] + img.data[i + 2]) / 3;
          if (lum > 215) img.data[i + 3] = 0;
        }
        ctx.putImageData(img, 0, 0);
      }
      await finish(c, onDone);
    } catch { setErr("That image could not be opened. Use a PNG or JPG."); }
  };
  return (
    <div className="stack">
      <input type="file" accept="image/png,image/jpeg" className="input" aria-label="Signature image" onChange={(e) => load(e.target.files?.[0])} />
      <Check checked={clean} onChange={setClean}>Make the white background transparent</Check>
      {err && <p className="field-error">{err}</p>}
    </div>
  );
}
