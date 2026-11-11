import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import type { FileKind, ToolProps } from "../lib/types";

export type SectionId = "organize" | "convert" | "security" | "advanced";

export const SECTIONS: { id: SectionId; title: string }[] = [
  { id: "organize", title: "Organise and manage" },
  { id: "convert", title: "Convert to and from PDF" },
  { id: "security", title: "Security and document controls" },
  { id: "advanced", title: "Advanced and productivity" },
];

/**
 * Where the work happens:
 *  - "browser": entirely on this device.
 *  - "browser+backend": works on this device; an optional backend adds a better or extra mode.
 *  - "backend": needs the optional backend.
 */
export type Availability = "browser" | "browser+backend" | "backend";

export interface ToolDef {
  id: string;
  section: SectionId;
  title: string;
  summary: string;
  question: string; // page heading, in plain language
  availability: Availability;
  /** Backend feature names (from GET /health) this tool can use. */
  backendFeatures?: string[];
  /** Plain-language explanation of what needs the backend. */
  backendNote?: string;
  accept: FileKind[];
  minFiles: number;
  maxFiles: number;
  maxFileMB: number;
  allowEncrypted?: boolean;
  allowRestricted?: boolean;
  limitations?: string[];
  component: LazyExoticComponent<ComponentType<ToolProps>>;
}

const L = (f: () => Promise<{ default: ComponentType<ToolProps> }>) => lazy(f);

export const TOOLS: ToolDef[] = [
  // ---------------------------------------------------------------- organise
  {
    id: "merge", section: "organize", title: "Merge PDFs", summary: "Combine several PDFs into one, in the order you choose.",
    question: "Which PDFs do you want to combine?", availability: "browser",
    accept: ["pdf"], minFiles: 2, maxFiles: 50, maxFileMB: 200,
    component: L(() => import("./Merge")),
  },
  {
    id: "split", section: "organize", title: "Split PDF", summary: "Split by page ranges, pull out pages, or make one file per page.",
    question: "Which PDF do you want to split?", availability: "browser",
    accept: ["pdf"], minFiles: 1, maxFiles: 1, maxFileMB: 200,
    component: L(() => import("./Split")),
  },
  {
    id: "organize", section: "organize", title: "Organise pages", summary: "See every page, drag to reorder, rotate, delete or extract.",
    question: "Which PDF do you want to rearrange?", availability: "browser",
    accept: ["pdf"], minFiles: 1, maxFiles: 1, maxFileMB: 150,
    component: L(() => import("./Organize")),
  },
  {
    id: "compress", section: "organize", title: "Compress PDF", summary: "Make a PDF smaller while keeping it readable.",
    question: "Which PDFs do you want to make smaller?", availability: "browser+backend",
    backendFeatures: ["compress"], backendNote: "The backend option uses Ghostscript, which usually compresses text-heavy files further.",
    accept: ["pdf"], minFiles: 1, maxFiles: 20, maxFileMB: 200,
    limitations: [
      "How much a file shrinks depends on its contents. Files that are mostly text are often already small.",
      "Image compression in the browser handles standard colour and greyscale photos; unusual image types are left unchanged.",
    ],
    component: L(() => import("./Compress")),
  },
  // ---------------------------------------------------------------- convert
  {
    id: "pdf-to-word", section: "convert", title: "PDF to Word", summary: "Turn a PDF into an editable Word (.docx) file.",
    question: "Which PDF do you want to turn into a Word file?", availability: "browser+backend",
    backendFeatures: ["pdf-to-docx"], backendNote: "The backend option (pdf2docx) keeps tables, columns and images much closer to the original.",
    accept: ["pdf"], minFiles: 1, maxFiles: 1, maxFileMB: 100,
    limitations: [
      "In the browser, text, headings and paragraphs are kept, but complex layouts, columns, tables and exact fonts are not.",
      "Scanned PDFs contain pictures of text, not text. Run OCR first.",
      "Page breaks and spacing may not match exactly.",
    ],
    component: L(() => import("./PdfToWord")),
  },
  {
    id: "pdf-to-excel", section: "convert", title: "PDF to Excel", summary: "Pull tables out into an Excel (.xlsx) file, with a review step.",
    question: "Which PDF has the tables you need?", availability: "browser",
    accept: ["pdf"], minFiles: 1, maxFiles: 1, maxFileMB: 100,
    limitations: [
      "Tables are detected from the position of the text, so merged cells, wrapped cell text and tables without clear columns may come out split or shifted. Check the preview before downloading.",
      "Scanned PDFs need OCR first.",
    ],
    component: L(() => import("./PdfToExcel")),
  },
  {
    id: "pdf-to-text", section: "convert", title: "PDF to Text", summary: "Extract the text into a plain .txt file.",
    question: "Which PDFs do you want the text from?", availability: "browser",
    accept: ["pdf"], minFiles: 1, maxFiles: 20, maxFileMB: 200,
    limitations: ["Scanned PDFs have no text layer; run OCR first.", "Reading order in multi-column pages may be mixed."],
    component: L(() => import("./PdfToText")),
  },
  {
    id: "pdf-to-images", section: "convert", title: "PDF to Images", summary: "Save pages as PNG or JPEG pictures.",
    question: "Which PDF do you want as pictures?", availability: "browser",
    accept: ["pdf"], minFiles: 1, maxFiles: 1, maxFileMB: 200,
    limitations: ["Very large pages at high resolution are reduced to fit browser limits (about 16 megapixels per page)."],
    component: L(() => import("./PdfToImages")),
  },
  {
    id: "pdf-to-epub", section: "convert", title: "PDF to ePub", summary: "Make a reflowable e-book from the text of a PDF.",
    question: "Which PDF do you want as an e-book?", availability: "browser",
    accept: ["pdf"], minFiles: 1, maxFiles: 1, maxFileMB: 100,
    limitations: [
      "Only text is carried over: images, tables and page layout are not.",
      "Headings are guessed from larger text. Headers, footers and page numbers may appear inside the text.",
      "Scanned PDFs need OCR first.",
    ],
    component: L(() => import("./PdfToEpub")),
  },
  {
    id: "to-pdf", section: "convert", title: "Office or images to PDF", summary: "Turn pictures (in the browser) or Word, Excel and PowerPoint files (backend) into PDF.",
    question: "Which files do you want to turn into PDF?", availability: "browser+backend",
    backendFeatures: ["office-to-pdf"], backendNote: "Word, Excel and PowerPoint need a conversion engine (LibreOffice) on the optional backend. Images are converted in your browser.",
    accept: ["image", "office"], minFiles: 1, maxFiles: 50, maxFileMB: 100,
    limitations: [
      "Office files: fonts that are not installed on the backend are substituted, which can change line and page breaks.",
      "Images: HEIC/HEIF photos are only supported if your browser can open them.",
    ],
    component: L(() => import("./ToPdf")),
  },
  // ---------------------------------------------------------------- security
  {
    id: "protect", section: "security", title: "Protect PDF", summary: "Add a password and choose what others may do.",
    question: "Which PDF do you want to protect?", availability: "browser",
    accept: ["pdf"], minFiles: 1, maxFiles: 1, maxFileMB: 200,
    limitations: ["Permission settings (printing, copying, editing) are honoured by most PDF readers but cannot be enforced by every program. The open password is real encryption."],
    component: L(() => import("./Protect")),
  },
  {
    id: "unlock", section: "security", title: "Unlock PDF", summary: "Remove a password you know, or restrictions you are authorised to lift.",
    question: "Which PDF do you want to unlock?", availability: "browser",
    accept: ["pdf"], minFiles: 1, maxFiles: 1, maxFileMB: 200, allowEncrypted: true, allowRestricted: true,
    limitations: ["This tool never guesses or cracks passwords. You must enter the correct password."],
    component: L(() => import("./Unlock")),
  },
  {
    id: "redact", section: "security", title: "Redact PDF", summary: "Permanently remove text or areas so they cannot be recovered.",
    question: "Which PDF do you want to redact?", availability: "browser",
    accept: ["pdf"], minFiles: 1, maxFiles: 1, maxFileMB: 100,
    limitations: [
      "Pages that contain a redaction are rebuilt as images, so all text on those pages stops being selectable or searchable. Other pages are not changed.",
      "Links, form fields and comments on redacted pages are removed. Bookmarks elsewhere may still mention redacted words.",
    ],
    component: L(() => import("./Redact")),
  },
  {
    id: "sign", section: "security", title: "Sign PDF", summary: "Place a handwritten signature, or apply a certificate-based digital signature.",
    question: "Which PDF do you want to sign?", availability: "browser+backend",
    backendFeatures: ["sign"], backendNote: "Certificate-based (cryptographic) signing uses pyHanko on the optional backend. Handwritten signatures are added in your browser.",
    accept: ["pdf"], minFiles: 1, maxFiles: 1, maxFileMB: 100,
    component: L(() => import("./Sign")),
  },
  {
    id: "watermark", section: "security", title: "Watermark PDF", summary: "Add text or an image across your pages.",
    question: "Which PDFs do you want to watermark?", availability: "browser",
    accept: ["pdf"], minFiles: 1, maxFiles: 20, maxFileMB: 200,
    limitations: ["A watermark is added on top of the page. It discourages copying but can be removed with editing software."],
    component: L(() => import("./Watermark")),
  },
  // ---------------------------------------------------------------- advanced
  {
    id: "ocr", section: "advanced", title: "OCR (make searchable)", summary: "Recognise text in scanned PDFs so it can be searched and copied.",
    question: "Which scanned PDF do you want to make searchable?", availability: "browser+backend",
    backendFeatures: ["ocr"], backendNote: "The backend option uses OCRmyPDF, which is faster on long documents and handles skewed scans better.",
    accept: ["pdf"], minFiles: 1, maxFiles: 1, maxFileMB: 100,
    limitations: [
      "Accuracy depends on scan quality. Expect mistakes on faint, handwritten or skewed pages.",
      "In-browser OCR takes roughly 3–15 seconds per page.",
      "For Hindi and Marathi, copied text may show some vowel signs in a different order.",
    ],
    component: L(() => import("./Ocr")),
  },
  {
    id: "forms", section: "advanced", title: "PDF forms", summary: "Fill in existing form fields, or add new text boxes, tick boxes and options.",
    question: "Which PDF form do you want to work on?", availability: "browser",
    accept: ["pdf"], minFiles: 1, maxFiles: 1, maxFileMB: 100,
    limitations: ["XFA forms (an older Adobe-only format) cannot be filled here.", "Calculation and validation scripts in the form are not run."],
    component: L(() => import("./Forms")),
  },
  {
    id: "page-numbers", section: "advanced", title: "Page numbers and Bates", summary: "Add page numbers or Bates numbers with your own format and position.",
    question: "Which PDF needs numbering?", availability: "browser",
    accept: ["pdf"], minFiles: 1, maxFiles: 1, maxFileMB: 200,
    component: L(() => import("./PageNumbers")),
  },
  {
    id: "compare", section: "advanced", title: "Compare PDFs", summary: "See what text was added, removed or changed between two versions.",
    question: "Which two versions do you want to compare?", availability: "browser",
    accept: ["pdf"], minFiles: 2, maxFiles: 2, maxFileMB: 100,
    limitations: [
      "Text comparison looks at words only; the visual view looks at pixels. A change can appear in one view but not the other (for example, moved text or a new font).",
      "Scanned PDFs need OCR before their text can be compared.",
    ],
    component: L(() => import("./Compare")),
  },
];

export const toolById = (id: string) => TOOLS.find((t) => t.id === id);

export const ACCEPT: Record<FileKind, { ext: string[]; mime: string[]; label: string }> = {
  pdf: { ext: [".pdf"], mime: ["application/pdf"], label: "PDF" },
  image: { ext: [".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".avif", ".heic", ".heif"], mime: ["image/"], label: "images (JPG, PNG, WebP, GIF, BMP)" },
  office: {
    ext: [".doc", ".docx", ".odt", ".rtf", ".xls", ".xlsx", ".ods", ".csv", ".ppt", ".pptx", ".odp"],
    mime: [],
    label: "Word, Excel or PowerPoint",
  },
  other: { ext: [], mime: [], label: "" },
};

export function kindOf(file: File): FileKind {
  const name = file.name.toLowerCase();
  const ext = name.slice(name.lastIndexOf("."));
  if (ext === ".pdf" || file.type === "application/pdf") return "pdf";
  if (ACCEPT.image.ext.includes(ext) || file.type.startsWith("image/")) return "image";
  if (ACCEPT.office.ext.includes(ext)) return "office";
  return "other";
}
