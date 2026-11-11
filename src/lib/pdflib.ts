import type { PDFDocument } from "pdf-lib";
import { UserError } from "./types";

export type PdfLib = typeof import("pdf-lib");
let p: Promise<PdfLib> | null = null;
export const getPdfLib = () => (p ??= import("pdf-lib"));

export async function loadPdf(source: File | Blob | Uint8Array, opts: { allowEncrypted?: boolean } = {}): Promise<PDFDocument> {
  const { PDFDocument } = await getPdfLib();
  const bytes = source instanceof Uint8Array ? source : new Uint8Array(await source.arrayBuffer());
  try {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: !!opts.allowEncrypted, updateMetadata: false });
    return doc;
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    if (/encrypt/i.test(msg)) {
      throw new UserError("This PDF is encrypted (it has a password or permission restrictions). Use “Unlock PDF” first if you are authorised to.");
    }
    throw new UserError("This PDF could not be read. It may be damaged or use features this tool does not support.");
  }
}

export async function savePdf(doc: PDFDocument): Promise<Uint8Array> {
  return doc.save({ useObjectStreams: true });
}
