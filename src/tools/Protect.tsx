import { useEffect, useState } from "react";
import type { ToolProps } from "../lib/types";
import { UserError } from "../lib/types";
import { encryptionInfo, runQpdf } from "../lib/qpdf";
import { baseName, pdfBlob } from "../lib/util";
import { Check, Note, Seg, TextField } from "../components/ui";

export default function Protect({ files, setAction }: ToolProps) {
  const f = files[0];
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [owner, setOwner] = useState("");
  const [bits, setBits] = useState<"256" | "128">("256");
  const [print, setPrint] = useState(true);
  const [copy, setCopy] = useState(false);
  const [modify, setModify] = useState(false);
  const [forms, setForms] = useState(true);

  const mismatch = pw2.length > 0 && pw !== pw2;
  const weak = pw.length > 0 && pw.length < 8;
  const restrictsSomething = !print || !copy || !modify || !forms;

  useEffect(() => {
    setAction({
      label: "Protect PDF",
      disabled: !pw || pw !== pw2,
      disabledReason: !pw ? "Enter a password." : "The two passwords do not match.",
      run: async ({ progress }) => {
        progress(0.2, "Encrypting…");
        const input = new Uint8Array(await f.file.arrayBuffer());
        const ownerPw = owner || pw;
        const args = [
          "--encrypt", `--user-password=${pw}`, `--owner-password=${ownerPw}`, `--bits=${bits}`,
          `--print=${print ? "full" : "none"}`, `--extract=${copy ? "y" : "n"}`,
          `--modify=${modify ? "all" : forms ? "form" : "none"}`, `--annotate=${forms || modify ? "y" : "n"}`,
          ...(bits === "128" ? ["--use-aes=y"] : []),
          "--", "/in.pdf", "/out.pdf",
        ];
        const r = await runQpdf(args, input);
        if (!r.result || r.code === 2) throw new UserError(`The PDF could not be encrypted. ${r.output.join(" ").slice(0, 200)}`);
        progress(0.8, "Checking the result…");
        const check = await encryptionInfo(r.result, pw);
        if (!check.encrypted) throw new UserError("Encryption could not be verified, so no file was produced.");
        return {
          outputs: [{ name: `${baseName(f.file.name)}_protected.pdf`, blob: pdfBlob(r.result) }],
          summary: [{ label: "Encryption", value: `AES-${bits}` }, { label: "Opens with", value: "Your password" }],
          notes: [
            { tone: "warn", text: "Keep the password safe. If it is lost, the file cannot be opened — there is no recovery." },
            ...(owner ? [] : restrictsSomething ? [{ tone: "info" as const, text: "No separate permissions password was set, so anyone with the open password can also change the restrictions." }] : []),
          ],
        };
      },
    });
  }, [f, pw, pw2, owner, bits, print, copy, modify, forms, restrictsSomething, setAction]);

  return (
    <div className="stack-lg">
      <div className="card stack-lg">
        <h2>Password to open the file</h2>
        <div className="grid-2">
          <TextField label="Password" type="password" value={pw} onChange={setPw} autoComplete="new-password" help={weak ? "Tip: use at least 8 characters." : "Needed to open the PDF."} />
          <TextField label="Type it again" type="password" value={pw2} onChange={setPw2} autoComplete="new-password" error={mismatch ? "The passwords do not match." : undefined} />
        </div>
        <Seg<"256" | "128"> label="Encryption strength" value={bits} onChange={setBits} options={[{ value: "256", label: "AES-256 (recommended)" }, { value: "128", label: "AES-128 (for very old readers)" }]} />
      </div>
      <div className="card stack">
        <h2>What can people do after opening it?</h2>
        <Check checked={print} onChange={setPrint}>Print</Check>
        <Check checked={copy} onChange={setCopy}>Copy text and images</Check>
        <Check checked={forms} onChange={setForms}>Fill in forms and add comments</Check>
        <Check checked={modify} onChange={setModify}>Edit the document (insert, delete, rotate pages)</Check>
        <details className="more">
          <summary>Permissions password (optional)</summary>
          <TextField label="Permissions password" type="password" value={owner} onChange={setOwner} autoComplete="new-password" help="Lets you lift the restrictions later. Should differ from the open password." />
        </details>
        <Note tone="info">Restrictions are respected by mainstream PDF readers but are not a substitute for keeping the file private. The open password is what actually protects the content.</Note>
      </div>
    </div>
  );
}
