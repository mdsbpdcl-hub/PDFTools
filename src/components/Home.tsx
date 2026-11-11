import { SECTIONS, TOOLS, type ToolDef } from "../tools/registry";
import { useBackend } from "../App";
import { Note } from "./ui";

export function AvailabilityTag({ tool }: { tool: ToolDef }) {
  const be = useBackend();
  const connected = (tool.backendFeatures ?? []).some((f) => be.status === "online" && be.features.includes(f));
  if (tool.availability === "browser") return <span className="tag local">In your browser</span>;
  if (tool.availability === "browser+backend")
    return (
      <span className="row" style={{ gap: 6 }}>
        <span className="tag local">In your browser</span>
        <span className={`tag ${connected ? "ok" : "off"}`} title={tool.backendNote}>{connected ? "+ backend ready" : "+ backend option"}</span>
      </span>
    );
  return <span className={`tag ${connected ? "ok" : "backend"}`}>{connected ? "Backend ready" : "Needs backend"}</span>;
}

export default function Home({ onOpenSettings }: { onOpenSettings: () => void }) {
  const be = useBackend();
  return (
    <div className="fade-in">
      <div className="intro">
        <h1>What would you like to do with your PDF?</h1>
        <p>Pick a task. You will add your files, choose options, and download the result. Most tasks run entirely in this browser, so your files are not uploaded anywhere.</p>
      </div>

      {SECTIONS.map((s) => (
        <section key={s.id} aria-labelledby={`sec-${s.id}`}>
          <h2 className="section-title" id={`sec-${s.id}`}>{s.title}</h2>
          <ul className="tool-list">
            {TOOLS.filter((t) => t.section === s.id).map((t) => (
              <li key={t.id}>
                <a className="tool-link" href={`#/tool/${t.id}`}>
                  <span className="grow" style={{ minWidth: 0 }}>
                    <span className="t">{t.title}</span>
                    <span className="d" style={{ display: "block" }}>{t.summary}</span>
                  </span>
                  <AvailabilityTag tool={t} />
                  <span className="chev" aria-hidden="true">›</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <h2 className="section-title">Where are my files processed?</h2>
      <div className="card stack">
        <Note>
          <strong>In your browser</strong> means the file is read and changed on this device. It is not uploaded, logged or saved by this site.
          Closing the tab clears it from memory.
        </Note>
        <details className="more">
          <summary>Show what each tool needs</summary>
          <div style={{ overflowX: "auto" }}>
            <table className="matrix">
              <thead><tr><th scope="col">Tool</th><th scope="col">Status</th><th scope="col">What the backend adds</th></tr></thead>
              <tbody>
                {TOOLS.map((t) => (
                  <tr key={t.id}>
                    <td>{t.title}</td>
                    <td>{t.availability === "browser" ? "Available in browser" : t.availability === "browser+backend" ? "Available in browser; extra mode requires optional backend" : "Requires optional backend"}</td>
                    <td className="muted">{t.backendNote ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="small muted">
            OCR downloads its language data (not your file) from a public CDN the first time you use a language.{" "}
            {be.status === "online" ? <>A backend is connected at <strong>{be.url}</strong>.</> : <>No backend is connected. <button className="link-btn" type="button" onClick={onOpenSettings}>Set one up</button></>}
          </p>
        </details>
      </div>
    </div>
  );
}
