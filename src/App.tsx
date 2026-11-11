import { useEffect, useState, useSyncExternalStore } from "react";
import Home from "./components/Home";
import ToolPage from "./components/ToolPage";
import BackendSettings from "./components/BackendSettings";
import { toolById } from "./tools/registry";
import { backend } from "./lib/backend";

function useHashRoute() {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const on = () => setHash(window.location.hash);
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return hash.replace(/^#\/?/, "");
}

export function useBackend() {
  return useSyncExternalStore(backend.subscribe, backend.get);
}

export default function App() {
  const route = useHashRoute();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const be = useBackend();
  const tool = route.startsWith("tool/") ? toolById(route.slice(5)) : undefined;

  useEffect(() => { if (be.url && be.status === "off") backend.check(); }, [be.url, be.status]);
  useEffect(() => {
    document.title = tool ? `${tool.title} · PDF Desk` : "PDF Desk";
    window.scrollTo(0, 0);
    document.getElementById("main")?.focus({ preventScroll: true });
  }, [tool]);

  return (
    <>
      <a className="skip-link" href="#main" onClick={(e) => { e.preventDefault(); document.getElementById("main")?.focus(); }}>Skip to content</a>
      <header className="header">
        <div className="header-inner">
          <a className="brand" href="#/">
            <span className="logo" aria-hidden="true">
              <svg viewBox="0 0 16 16"><path d="M3 1h7l3 3v11H3z" fill="#fff" /><path d="M10 1v3h3" fill="none" stroke="#173a25" strokeWidth="1" /></svg>
            </span>
            PDF Desk
          </a>
          <div className="header-note">
            <span><span className="dot" aria-hidden="true" /><span className="note-text">Files stay on this device unless you choose a backend option</span></span>
            <button className="link-btn" type="button" onClick={() => setSettingsOpen(true)}>
              Backend: {be.status === "online" ? "connected" : be.status === "checking" ? "checking…" : be.url ? "not reachable" : "off"}
            </button>
          </div>
        </div>
      </header>
      <main id="main" tabIndex={-1} style={{ outline: "none" }}>
        {route.startsWith("tool/") && !tool ? (
          <div className="card stack"><h1>Tool not found</h1><p>That address does not match any tool. <a href="#/">See all tools</a>.</p></div>
        ) : tool ? (
          <ToolPage key={tool.id} tool={tool} onOpenSettings={() => setSettingsOpen(true)} />
        ) : (
          <Home onOpenSettings={() => setSettingsOpen(true)} />
        )}
      </main>
      {settingsOpen && <BackendSettings onClose={() => setSettingsOpen(false)} />}
    </>
  );
}
