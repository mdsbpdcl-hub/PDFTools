# PDF Desk

A simple, browser-based PDF application. Merge, split, organise, compress, convert, protect, redact, sign, watermark, OCR, fill forms, number pages and compare — from one clean home page.

**Most tools run entirely in your browser.** Files are read and changed on your device; they are not uploaded, logged, or saved by the site. A few optional modes need a separately deployed backend, and the app always asks before any file leaves the device.

---

## Contents

1. [Feature availability](#feature-availability)
2. [File privacy](#file-privacy)
3. [Run it on your computer](#run-it-on-your-computer)
4. [Put it on GitHub](#put-it-on-github)
5. [Publish with GitHub Pages](#publish-with-github-pages)
6. [Optional backend](#optional-backend)
7. [Browser support](#browser-support)
8. [Limits and known limitations](#limits-and-known-limitations)
9. [Troubleshooting](#troubleshooting)
10. [Project structure](#project-structure)
11. [Libraries and licences](#libraries-and-licences)

---

## Feature availability

| Section | Tool | Status | Backend adds |
|---|---|---|---|
| Organise | Merge PDFs | Available in browser | — |
| Organise | Split PDF (ranges, extract, one per page, every N pages) | Available in browser | — |
| Organise | Organise pages (thumbnails, drag, rotate, delete, extract) | Available in browser | — |
| Organise | Compress PDF | Available in browser | Ghostscript mode (often smaller for mixed documents) |
| Convert | PDF to Word | Available in browser (text & headings, or exact-look pictures) | pdf2docx mode that keeps tables, columns and images |
| Convert | PDF to Excel (with review/edit step) | Available in browser | — |
| Convert | PDF to Text | Available in browser | — |
| Convert | PDF to Images (PNG/JPEG, 72–600 dpi) | Available in browser | — |
| Convert | PDF to ePub | Available in browser | — |
| Convert | Images to PDF | Available in browser | — |
| Convert | Word / Excel / PowerPoint to PDF | **Requires optional backend** (LibreOffice) | — |
| Security | Protect PDF (AES-256/128, permissions) | Available in browser | — |
| Security | Unlock PDF (with the correct password only) | Available in browser | — |
| Security | Redact PDF (true removal + automatic check) | Available in browser | — |
| Security | Handwritten signature (draw, type, upload) | Available in browser | — |
| Security | Digital (certificate) signature | **Requires optional backend** (pyHanko) | — |
| Security | Watermark (text or image) | Available in browser | — |
| Advanced | OCR (searchable PDF) | Available in browser (Tesseract.js) | OCRmyPDF mode (faster, deskews) |
| Advanced | PDF forms (fill + create fields) | Available in browser | — |
| Advanced | Page numbers and Bates numbering | Available in browser | — |
| Advanced | Compare PDFs (text + visual, report) | Available in browser | — |

If no backend is connected, backend-only options are shown **disabled with an explanation** — never as buttons that silently do nothing.

## File privacy

- **In-browser tools**: the file is opened in the tab's memory, processed with JavaScript/WebAssembly, and offered back as a download. Nothing is sent to any server. Closing the tab clears it.
- **No storage of documents**: no analytics, no logs, no cookies, and no browser storage of files or extracted text. The only thing remembered on the device is the backend address you type into *Backend settings* (not files, not keys).
- **OCR language data**: the first time you OCR in a language, the *language model* (not your file) is downloaded from the jsDelivr CDN and cached by the browser. You can self-host it — see `VITE_TESSDATA_URL` below.
- **Backend options**: before anything is sent, a dialog lists exactly which files will go to which server and why. Nothing is sent without you pressing *Send and continue*. The provided backend processes each request in a temporary folder that is deleted before the response is returned, and runs with access logging switched off.
- The page sets a Content Security Policy that blocks third-party scripts.

## Run it on your computer

You need [Node.js](https://nodejs.org) 20 or newer.

```bash
npm ci          # install the exact pinned versions
npm run dev     # open the address it prints (usually http://localhost:5173)
```

To build the production site into `dist/`:

```bash
npm run build
npm run preview # serves dist/ at http://localhost:4173
```

`npm run dev` and `npm run build` first run `scripts/copy-assets.mjs`, which copies the PDF engine fonts, WebAssembly files and the OCR engine from `node_modules` into `public/vendor/` so the site does not load code from other servers. (`public/vendor/` is generated and ignored by Git.)

## Put it on GitHub

1. Sign in to GitHub and click **New repository**. Give it a name such as `pdf-desk`. Leave “Add a README” unticked. Click **Create repository**.
2. On your computer, in this project folder:

   ```bash
   git init
   git add .
   git commit -m "PDF Desk"
   git branch -M main
   git remote add origin https://github.com/YOUR-USERNAME/pdf-desk.git
   git push -u origin main
   ```

   *Without Git:* on the empty repository page choose **uploading an existing file**, drag in everything in this folder **except** `node_modules`, `dist` and `public/vendor`, then **Commit changes**. (Make sure the hidden `.github` folder is included — on Windows enable “Hidden items” in File Explorer; on macOS press Cmd+Shift+.)

## Publish with GitHub Pages

The workflow in `.github/workflows/deploy.yml` builds and publishes the site on every push to `main`.

1. In your repository, open **Settings → Pages**.
2. Under **Build and deployment → Source**, choose **GitHub Actions**.
3. Open the **Actions** tab. The *Deploy to GitHub Pages* run starts automatically after your push (or click it and press **Run workflow**).
4. When it shows a green tick, your site is at `https://YOUR-USERNAME.github.io/pdf-desk/`.

The app uses relative paths and hash-based links (`#/tool/merge`), so it works from any repository name or sub-folder without extra configuration.

### Optional build settings (public values, not secrets)

Set these under **Settings → Secrets and variables → Actions → Variables** (the *Variables* tab, not *Secrets*):

| Variable | Purpose |
|---|---|
| `VITE_BACKEND_URL` | Address of your backend, e.g. `https://pdf-backend.example.org`. Users can also enter it in *Backend settings*. |
| `VITE_TESSDATA_URL` | Optional self-hosted OCR language folder (containing `eng.traineddata.gz`, etc.). |

These values are compiled into the public website, so **never put passwords or API keys in them**. For local builds, copy `.env.example` to `.env`.

## Optional backend

The `backend/` folder is a small FastAPI service that adds: Office → PDF (LibreOffice), high-fidelity PDF → Word (pdf2docx), OCR (OCRmyPDF), Ghostscript compression, and certificate-based digital signatures (pyHanko). Deploy it **separately** from GitHub Pages — GitHub Pages can only serve static files.

### Run with Docker

```bash
cd backend
cp .env.example .env            # then edit ALLOWED_ORIGINS (and ACCESS_KEY if you want one)
docker build -t pdf-desk-backend .
docker run --rm -p 8080:8080 --env-file .env pdf-desk-backend
```

Check it: `curl http://localhost:8080/health` → `{"ok":true,"features":[...]}`. In the app, open **Backend: off** in the header, enter the address, and press **Save and test**.

### Host it

Any service that runs a Docker container over HTTPS works (for example Google Cloud Run, Azure Container Apps, Render, Railway, Fly.io, or an internal server behind your organisation's reverse proxy). Set environment variables in the host's dashboard:

| Variable | Default | Meaning |
|---|---|---|
| `ALLOWED_ORIGINS` | localhost only | Comma-separated site origins allowed to call the backend, e.g. `https://your-username.github.io`. |
| `ACCESS_KEY` | empty (off) | Optional shared key. Users enter it in *Backend settings*; it is kept in memory for that tab only. Store it as a **secret** in your host, never in the repository. |
| `MAX_UPLOAD_MB` | 100 | Per-file upload limit. |
| `JOB_TIMEOUT_SECONDS` | 300 | Stops long jobs. |
| `MAX_PARALLEL_JOBS` | 2 | Jobs processed at once (LibreOffice and OCR are memory-hungry; allow ~1 GB RAM per job). |

**Security notes**

- The backend must be served over **HTTPS** (browsers block calls from an HTTPS page to an HTTP backend).
- Because the website is public, anything compiled into it is public. That is why the access key is typed by users rather than built in. For organisation-only use, put the backend behind your single sign-on or VPN.
- Digital signing sends the user's `.p12/.pfx` certificate and its password to the backend for the duration of the request. Only offer this on a backend your organisation controls. USB-token certificates (e.g. Class 3 DSC tokens) cannot be exported as `.pfx`; use the token vendor's signing software for those.

### Run without Docker (development)

Requires LibreOffice, Ghostscript, Tesseract and OCRmyPDF's system dependencies installed locally.

```bash
cd backend
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
ALLOWED_ORIGINS=http://localhost:5173 uvicorn app:app --port 8080 --no-access-log
```

## Browser support

Current versions of **Chrome, Edge, Firefox and Safari** (desktop and mobile). The app needs WebAssembly, ES2022 and `DecompressionStream`, available in Chrome/Edge 103+, Firefox 113+ and Safari 16.4+.

- Phones work for all tools, but large files and OCR are slower and limited by the device's memory.
- Safari limits canvas size to about 16 megapixels; very large pages are rendered at reduced resolution (the app tells you when this happens).

## Limits and known limitations

- **Upload limits**: per-file limits are shown on each tool (100–200 MB), with 500 MB in total per task. They keep the browser responsive; larger files may run out of memory, especially on phones.
- **Conversions** are approximations. Complex layouts, multi-column text, tables, fonts and page breaks may not convert exactly. Scanned PDFs contain pictures of text — run **OCR** first.
- **PDF to Word (browser)** keeps paragraphs and headings but not tables, columns or images. Use the backend mode or the “exact look” mode when layout matters.
- **PDF to Excel** finds tables from text positions. Merged or wrapped cells may split; always review the preview (cells are editable).
- **Compress** is honest: if a file cannot be made smaller, you get the original back with a message. “Maximum” turns pages into pictures (text stops being selectable).
- **Redaction** rebuilds affected pages as images so hidden text cannot survive; text on those pages stops being selectable. After redacting, the app re-reads the output and confirms no text remains on redacted pages and your search words are gone. Always look through the result yourself.
- **Protect**: permission flags (print/copy/edit) are honoured by mainstream readers but not by every program; the open password is real AES encryption.
- **Unlock** never guesses or cracks passwords. Removing permission restrictions needs the permissions (owner) password.
- **Handwritten signatures** are images. They are not cryptographic signatures. Any edit to a digitally signed PDF invalidates its signature.
- **OCR in the browser** takes ~3–15 s per page. For Hindi/Marathi, copied text may show some vowel signs out of order (a known limitation of PDF text layers for Indic scripts).
- **Forms**: XFA (Adobe LiveCycle) forms are not supported; form scripts are not run. Filled text must use characters covered by Helvetica.
- **Page numbers and watermarks** use the built-in Helvetica font, so text must use Western characters.
- **Compare** aligns pages by position; inserted pages make later pages look changed. The visual view shows pixel differences.
- Bookmarks (outline) are not carried over by Merge or Redact.

## Troubleshooting

| Problem | What to do |
|---|---|
| The GitHub Pages site is blank or 404 | Settings → Pages → Source must be **GitHub Actions**. Check the Actions tab for a failed run. |
| Workflow fails at `npm ci` | Make sure `package-lock.json` was committed. |
| “This PDF is password-protected” | Use **Unlock PDF** first (you need the password). |
| “Has permission restrictions” | Use **Unlock PDF** with the permissions password, if you are authorised. |
| OCR stuck on “Preparing” | The language data downloads from cdn.jsdelivr.net the first time. Check your connection or firewall, or self-host it with `VITE_TESSDATA_URL`. |
| Backend shows “not reachable” | Check the address uses `https://`, the service is running, and `ALLOWED_ORIGINS` contains your site's origin exactly (e.g. `https://your-username.github.io`, no trailing slash or path). |
| Backend returns 401 | Enter the access key in Backend settings. |
| The tab becomes slow or crashes | The file is too large for the device's memory. Split it first, use a lower resolution, or use a desktop browser. |
| Downloads do nothing on iPhone | Long-press the Download button or use “Download all (ZIP)”; check Settings → Safari → Downloads. |
| Text in the Word/Excel output is garbled | Some PDFs embed fonts without a proper text mapping. Run OCR on the PDF and convert the OCR result. |

## Project structure

```
pdf-desk/
├─ .github/workflows/deploy.yml   GitHub Pages build and deploy
├─ backend/                       Optional FastAPI backend (Docker)
│  ├─ app.py  Dockerfile  requirements.txt  .env.example
├─ scripts/copy-assets.mjs        Copies engine files into public/vendor
├─ src/
│  ├─ App.tsx                     Header, hash routing, backend status
│  ├─ components/
│  │  ├─ Home.tsx                 Tool list and feature matrix
│  │  ├─ ToolPage.tsx             Shared flow: add files → options → download
│  │  ├─ BackendSettings.tsx      Backend address / access key
│  │  ├─ PageCanvas.tsx           Page viewer with drawing overlay
│  │  └─ ui.tsx                   Small accessible UI building blocks
│  ├─ lib/                        pdf.js, pdf-lib, qpdf, backend client, writers (xlsx, epub)
│  ├─ tools/                      One file per tool + registry.ts (titles, limits, availability)
│  └─ styles.css                  Application style
├─ index.html  package.json  vite.config.ts  tsconfig.json
```

**Adding a tool**: create `src/tools/MyTool.tsx` exporting a component that receives `files` and calls `setAction({ label, run })`, then add an entry to `TOOLS` in `src/tools/registry.ts`. The shell handles uploads, validation, progress, cancellation, errors, consent for backend use and downloads. Heavy libraries are loaded only when a tool needs them.

## Libraries and licences

All versions are pinned in `package.json` / `package-lock.json` and `backend/requirements.txt`.

| Library | Used for | Licence |
|---|---|---|
| pdf.js (`pdfjs-dist`) | Rendering, text extraction | Apache-2.0 |
| pdf-lib, @pdf-lib/fontkit | Editing and creating PDFs | MIT |
| qpdf (via `@neslinesli93/qpdf-wasm`) | Encryption, decryption, structural optimisation | Apache-2.0 (qpdf), ISC (wrapper) |
| Tesseract.js | In-browser OCR | Apache-2.0 |
| docx | Word output | MIT |
| JSZip | ZIP, XLSX and EPUB packaging | MIT / GPLv3 dual — used under MIT |
| jsdiff (`diff`) | Text comparison | BSD-3-Clause |
| Noto Sans Devanagari (`@fontsource`) | Hindi/Marathi OCR text layer | SIL OFL 1.1 |
| React, Vite, TypeScript | App framework and build | MIT / Apache-2.0 |
| Backend: FastAPI, Uvicorn | API | MIT / BSD |
| Backend: pdf2docx | PDF → Word | MIT |
| Backend: pyHanko | Digital signatures | MIT |
| Backend: OCRmyPDF | OCR | MPL-2.0 |
| Backend: LibreOffice | Office → PDF | MPL-2.0 |
| Backend: Ghostscript | Compression | **AGPL-3.0** — if you offer the backend as a network service to others, review AGPL obligations or remove the `compress` endpoint. |

The application code in this repository is released under the MIT licence (see `LICENSE`).
