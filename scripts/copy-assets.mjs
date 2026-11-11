// Copies runtime assets (pdf.js fonts/cmaps/wasm, qpdf wasm, OCR engine, OCR font)
// from node_modules into public/vendor so the app can be served from any static host
// (including a GitHub Pages sub-path) without fetching code from third-party CDNs.
import { cpSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const nm = (p) => resolve(root, "node_modules", p);
const out = resolve(root, "public", "vendor");

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const copies = [
  ["pdfjs-dist/cmaps", "pdfjs/cmaps"],
  ["pdfjs-dist/standard_fonts", "pdfjs/standard_fonts"],
  ["pdfjs-dist/wasm", "pdfjs/wasm"],
  ["pdfjs-dist/iccs", "pdfjs/iccs"],
  ["@neslinesli93/qpdf-wasm/dist/qpdf.wasm", "qpdf/qpdf.wasm"],
  ["tesseract.js/dist/worker.min.js", "tesseract/worker.min.js"],
  ["tesseract.js-core/tesseract-core-lstm.wasm.js", "tesseract/core/tesseract-core-lstm.wasm.js"],
  ["tesseract.js-core/tesseract-core-simd-lstm.wasm.js", "tesseract/core/tesseract-core-simd-lstm.wasm.js"],
  ["tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js", "tesseract/core/tesseract-core-relaxedsimd-lstm.wasm.js"],
  ["@fontsource/noto-sans-devanagari/files/noto-sans-devanagari-devanagari-400-normal.woff", "fonts/noto-sans-devanagari.woff"],
];

for (const [from, to] of copies) {
  const src = nm(from);
  if (!existsSync(src)) {
    console.error(`copy-assets: missing ${from}. Run "npm ci" first.`);
    process.exit(1);
  }
  const dest = resolve(out, to);
  mkdirSync(resolve(dest, ".."), { recursive: true });
  cpSync(src, dest, { recursive: true });
}
console.log(`copy-assets: copied ${copies.length} items to public/vendor`);
