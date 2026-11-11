import { useEffect, useState } from "react";
import type { ToolProps } from "../lib/types";
import { UserError } from "../lib/types";
import { encryptionInfo, runQpdf } from "../lib/qpdf";
import { baseName, pdfBlob } from "../lib/util";
import { Check, Note, TextField } from "../components/ui";

export default function Unlock({ files, setAction }: ToolProps) {
  const f = files[0];
  const [pw, setPw] = useState("");
  const [authorised, setAuthorised] = useState(false);
  const opensWithoutPassword = !f.encrypted && f.restricted;

  useEffect(() => {
    setAction({
      label: "Unlock PDF",
      disabled: !pw || !authorised,
      disabledReason: !pw ? (opensWithoutPassword ? "Enter the permissions password." : "Enter the password.") : "Confirm that you are authorised to unlock this file.",
      run: async ({ progress }) => {
        const input = new Uint8Array(await f.file.arrayBuffer());
        progress(0.2, "Checking the password…");
        const info = await encryptionInfo(input, pw);
        if (!info.encrypted) throw new UserError("This file is not encrypted.");
        // Lifting restrictions requires the permissions (owner) password. The open password only
        // removes the open password when the file has no further restrictions.
        if (info.suppliedIs !== "owner" && info.restrictions.length > 0) {
          throw new UserError(opensWithoutPassword
            ? "That is not the permissions password. Restrictions can only be removed with the permissions password."
            : `That password opens the file, but it also has restrictions (${info.restrictions.slice(0, 3).join("; ")}). Enter the permissions password to remove everything.`);
        }
        progress(0.5, "Removing protection…");
        const r = await runQpdf([`--password=${pw}`, "--decrypt", "--", "/in.pdf", "/out.pdf"], input);
        if (!r.result || r.code === 2) throw new UserError("The file could not be unlocked.");
        const after = await encryptionInfo(r.result, "");
        if (after.encrypted) throw new UserError("Protection could not be fully removed, so no file was produced.");
        return {
          outputs: [{ name: `${baseName(f.file.name)}_unlocked.pdf`, blob: pdfBlob(r.result) }],
          notes: [{ tone: "ok", text: "The password and restrictions were removed. Anyone with this copy can now open and edit it — store it accordingly." }],
        };
      },
    });
  }, [f, pw, authorised, opensWithoutPassword, setAction]);

  return (
    <div className="card stack-lg">
      <p className="muted">
        {f.encrypted ? "This PDF needs a password to open." : "This PDF opens without a password but has permission restrictions (for example on printing or copying)."}
      </p>
      <TextField label={opensWithoutPassword ? "Permissions password" : "Password"} type="password" value={pw} onChange={setPw} autoComplete="current-password"
        help={opensWithoutPassword ? "The password the author set to protect the permissions." : "If the file also has restrictions, use the permissions password."} />
      <Check checked={authorised} onChange={setAuthorised}>I own this document or am authorised to remove its protection.</Check>
      <Note tone="info">PDF Desk never guesses, cracks or bypasses passwords. Without the correct password the file stays locked.</Note>
    </div>
  );
}
