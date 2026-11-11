// Optional backend client. The backend URL is not a secret (it is public in a static site);
// an access key, if the backend uses one, is kept in memory only for this tab.
import { UserError } from "./types";

export interface BackendState {
  url: string;
  key: string;
  status: "off" | "checking" | "online" | "offline";
  features: string[];
  message?: string;
}

const envUrl = (import.meta.env.VITE_BACKEND_URL as string | undefined)?.trim().replace(/\/+$/, "") ?? "";
const URL_KEY = "pdfdesk.backendUrl"; // only the URL is remembered, never files or keys

function initialUrl(): string {
  try { return localStorage.getItem(URL_KEY) ?? envUrl; } catch { return envUrl; }
}

let state: BackendState = { url: initialUrl(), key: "", status: "off", features: [] };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const backend = {
  get: () => state,
  subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
  async configure(url: string, key: string) {
    url = url.trim().replace(/\/+$/, "");
    try { if (url) localStorage.setItem(URL_KEY, url); else localStorage.removeItem(URL_KEY); } catch { /* storage unavailable */ }
    state = { ...state, url, key, features: [], status: url ? "checking" : "off", message: undefined };
    emit();
    if (url) await backend.check();
  },
  async check() {
    if (!state.url) return;
    state = { ...state, status: "checking" };
    emit();
    try {
      const res = await fetch(`${state.url}/health`, { headers: authHeaders(), signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(res.status === 401 ? "The access key was not accepted." : `The backend answered with status ${res.status}.`);
      const body = (await res.json()) as { features?: string[] };
      state = { ...state, status: "online", features: body.features ?? [], message: undefined };
    } catch (e) {
      const msg = e instanceof Error && !/fetch|network|timeout|abort/i.test(e.message) ? e.message : "Could not reach the backend (check the address, that it is running, and that it allows this site).";
      state = { ...state, status: "offline", features: [], message: msg };
    }
    emit();
  },
  has(feature: string) { return state.status === "online" && state.features.includes(feature); },
  host() { try { return new URL(state.url).host; } catch { return state.url; } },
};

function authHeaders(): Record<string, string> {
  return state.key ? { "X-Access-Key": state.key } : {};
}

/** Uploads a multipart form with progress, returning the response file. */
export function postToBackend(
  path: string,
  form: FormData,
  onProgress: (fraction: number | null, msg: string) => void,
  signal: AbortSignal,
): Promise<{ blob: Blob; filename?: string }> {
  return new Promise((resolve, reject) => {
    if (!state.url) return reject(new UserError("No backend is configured."));
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${state.url}${path}`);
    for (const [k, v] of Object.entries(authHeaders())) xhr.setRequestHeader(k, v);
    xhr.responseType = "blob";
    xhr.upload.onprogress = (e) => onProgress(e.lengthComputable ? (e.loaded / e.total) * 0.5 : null, "Uploading to backend…");
    xhr.upload.onload = () => onProgress(null, "Processing on backend…");
    xhr.onload = async () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const cd = xhr.getResponseHeader("Content-Disposition") ?? "";
        const m = /filename="?([^";]+)"?/i.exec(cd);
        resolve({ blob: xhr.response as Blob, filename: m?.[1] });
      } else {
        let detail = `The backend reported an error (status ${xhr.status}).`;
        try {
          const t = await (xhr.response as Blob).text();
          const j = JSON.parse(t) as { detail?: string };
          if (j.detail) detail = j.detail;
        } catch { /* keep generic */ }
        reject(new UserError(detail));
      }
    };
    xhr.onerror = () => reject(new UserError("The backend could not be reached."));
    signal.addEventListener("abort", () => { xhr.abort(); reject(new DOMException("Cancelled", "AbortError")); });
    xhr.send(form);
  });
}
