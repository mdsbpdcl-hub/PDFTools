// qpdf (Apache-2.0) compiled to WebAssembly by @neslinesli93/qpdf-wasm (ISC).
// Used for encryption, decryption with a known password, and lossless structural optimisation.
import { vendorUrl } from "./pdfjs";
import { UserError } from "./types";

export interface QpdfRun { code: number; output: string[]; result?: Uint8Array }

export async function runQpdf(args: string[], input: Uint8Array, wantsOutput = true): Promise<QpdfRun> {
  const { default: createModule } = await import("@neslinesli93/qpdf-wasm");
  const output: string[] = [];
  // This qpdf build writes messages with console.log/console.error bound at module creation,
  // so we capture the console while the module is created and run (all synchronous after load).
  const orig = { log: console.log, error: console.error };
  const capture = (...a: unknown[]) => output.push(a.map(String).join(" "));
  console.log = capture;
  console.error = capture;
  let code: number;
  try {
    const qpdf = await (createModule as unknown as (o: object) => Promise<{
      FS: { writeFile(p: string, d: Uint8Array): void; readFile(p: string): Uint8Array };
      callMain(a: string[]): number;
    }>)({
      locateFile: () => vendorUrl("qpdf/qpdf.wasm"),
      noInitialRun: true,
    });
    qpdf.FS.writeFile("/in.pdf", input);
    try {
      code = qpdf.callMain(args);
    } catch (e) {
      code = typeof (e as { status?: number })?.status === "number" ? (e as { status: number }).status : 2;
    }
    if (wantsOutput && code !== 2) {
      try { return { code, output, result: qpdf.FS.readFile("/out.pdf") }; } catch { /* no output */ }
    }
  } finally {
    console.log = orig.log;
    console.error = orig.error;
  }
  return { code, output };
}
export interface EncryptionInfo {
  encrypted: boolean;
  suppliedIs: "owner" | "user" | "none";
  restrictions: string[];
}

/** Reads encryption details. Throws a UserError when the password is wrong. */
export async function encryptionInfo(input: Uint8Array, password: string): Promise<EncryptionInfo> {
  const args = password ? [`--password=${password}`, "--show-encryption", "/in.pdf"] : ["--show-encryption", "/in.pdf"];
  const r = await runQpdf(args, input, false);
  const text = r.output.join("\n");
  if (/invalid password/i.test(text)) throw new UserError("That password is not correct for this file.");
  if (r.code === 2) throw new UserError("This file could not be read as a PDF.");
  if (/File is not encrypted/i.test(text)) return { encrypted: false, suppliedIs: "none", restrictions: [] };
  const suppliedIs = /Supplied password is owner password/i.test(text) ? "owner" : /Supplied password is user password/i.test(text) ? "user" : "none";
  const restrictions = text.split("\n").filter((l) => /: not allowed/.test(l)).map((l) => l.split(":")[0].trim());
  return { encrypted: true, suppliedIs, restrictions };
}
