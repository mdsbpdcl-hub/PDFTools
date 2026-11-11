import { useState } from "react";
import { backend } from "../lib/backend";
import { useBackend } from "../App";
import { Modal, Note, TextField } from "./ui";

export default function BackendSettings({ onClose }: { onClose: () => void }) {
  const be = useBackend();
  const [url, setUrl] = useState(be.url);
  const [key, setKey] = useState(be.key);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    await backend.configure(url, key);
    setBusy(false);
  };
  return (
    <Modal
      title="Optional backend"
      onClose={onClose}
      actions={<>
        {be.url && <button className="btn" type="button" onClick={() => { setUrl(""); setKey(""); backend.configure("", ""); }}>Turn off</button>}
        <button className="btn" type="button" onClick={onClose}>Close</button>
        <button className="btn primary" type="button" disabled={busy || !url.trim()} onClick={save}>{busy ? "Checking…" : "Save and test"}</button>
      </>}
    >
      <p className="muted">
        Most tools work entirely in your browser. A few options (Office to PDF, certificate signing, higher-quality Word
        conversion, OCR and compression) can use a backend that you or your organisation run separately.
      </p>
      <TextField label="Backend address" value={url} onChange={setUrl} placeholder="https://pdf-backend.example.org" help="Only the address is remembered on this device." />
      <TextField label="Access key (if your backend uses one)" type="password" value={key} onChange={setKey} help="Kept in memory for this tab only; never saved." />
      {be.status === "online" && <Note title="Connected.">Available on this backend: {be.features.join(", ") || "none"}.</Note>}
      {be.status === "offline" && <Note tone="error" title="Not reachable.">{be.message}</Note>}
      <Note tone="info">Files are only sent to the backend when you choose a backend option and confirm. Nothing is sent in the background.</Note>
    </Modal>
  );
}
