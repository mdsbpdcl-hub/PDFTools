"""
PDF Desk optional backend.

Provides the features that cannot run in a browser:
  - office-to-pdf : Word/Excel/PowerPoint -> PDF (LibreOffice)
  - pdf-to-docx   : layout-preserving PDF -> Word (pdf2docx)
  - ocr           : searchable PDFs (OCRmyPDF + Tesseract)
  - compress      : Ghostscript compression
  - sign          : certificate-based PAdES signatures (pyHanko)

Privacy: every request works in a private temporary folder that is deleted before the response
is sent. File contents, passwords and certificates are never logged or stored.
"""
from __future__ import annotations

import asyncio
import logging
import os
import shutil
import subprocess
import tempfile
import secrets
from pathlib import Path

from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

MAX_MB = int(os.environ.get("MAX_UPLOAD_MB", "100"))
ALLOWED_ORIGINS = [o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "").split(",") if o.strip()]
ACCESS_KEY = os.environ.get("ACCESS_KEY", "")  # optional; set as a secret in your host, never in the repo
TIMEOUT = int(os.environ.get("JOB_TIMEOUT_SECONDS", "300"))
MAX_PARALLEL = int(os.environ.get("MAX_PARALLEL_JOBS", "2"))

app = FastAPI(title="PDF Desk backend", docs_url=None, redoc_url=None, openapi_url=None)
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS or ["http://localhost:5173", "http://localhost:4173"],
    allow_methods=["GET", "POST"],
    allow_headers=["X-Access-Key"],
    expose_headers=["Content-Disposition"],
    max_age=600,
)
slots = asyncio.Semaphore(MAX_PARALLEL)
# Keep third-party libraries from logging document details.
logging.basicConfig(level=logging.WARNING, force=True)

OFFICE_EXT = {".doc", ".docx", ".odt", ".rtf", ".xls", ".xlsx", ".ods", ".csv", ".ppt", ".pptx", ".odp"}
OCR_LANGS = {"eng", "hin", "mar", "fra", "deu", "spa", "por", "ita"}


def _has(cmd: str) -> bool:
    return shutil.which(cmd) is not None


def _module(name: str) -> bool:
    try:
        __import__(name)
        return True
    except Exception:
        return False


def features() -> list[str]:
    f = []
    if _has("soffice"):
        f.append("office-to-pdf")
    if _module("pdf2docx"):
        f.append("pdf-to-docx")
    if _has("ocrmypdf") and _has("tesseract"):
        f.append("ocr")
    if _has("gs"):
        f.append("compress")
    if _module("pyhanko"):
        f.append("sign")
    return f


def check_key(key: str | None):
    if ACCESS_KEY and not secrets.compare_digest(key or "", ACCESS_KEY):
        raise HTTPException(401, "Access key missing or wrong.")


async def save_upload(up: UploadFile, folder: Path, name: str) -> Path:
    path = folder / name
    size = 0
    with path.open("wb") as fh:
        while chunk := await up.read(1024 * 1024):
            size += len(chunk)
            if size > MAX_MB * 1024 * 1024:
                raise HTTPException(413, f"File is larger than the backend limit of {MAX_MB} MB.")
            fh.write(chunk)
    if size == 0:
        raise HTTPException(400, "The uploaded file is empty.")
    return path


def require_pdf(path: Path):
    with path.open("rb") as fh:
        if b"%PDF-" not in fh.read(1024):
            raise HTTPException(400, "The uploaded file is not a PDF.")


async def run(cmd: list[str], cwd: Path, env: dict | None = None) -> subprocess.CompletedProcess:
    def _go():
        return subprocess.run(cmd, cwd=cwd, capture_output=True, timeout=TIMEOUT, env={**os.environ, **(env or {})})
    try:
        return await asyncio.to_thread(_go)
    except subprocess.TimeoutExpired:
        raise HTTPException(504, "Processing took too long and was stopped.")


def pdf_response(path: Path, filename: str) -> Response:
    data = path.read_bytes()
    if not data.startswith(b"%PDF"):
        raise HTTPException(500, "The result was not a valid PDF.")
    return Response(data, media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="{filename}"', "Cache-Control": "no-store"})


def safe_stem(name: str | None) -> str:
    stem = Path(name or "document").stem
    return "".join(c for c in stem if c.isalnum() or c in " -_")[:80] or "document"


@app.get("/health")
async def health(x_access_key: str | None = Header(default=None)):
    check_key(x_access_key)
    return {"ok": True, "features": features(), "maxUploadMB": MAX_MB}


@app.post("/convert/office-to-pdf")
async def office_to_pdf(file: UploadFile = File(...), x_access_key: str | None = Header(default=None)):
    check_key(x_access_key)
    ext = Path(file.filename or "").suffix.lower()
    if ext not in OFFICE_EXT:
        raise HTTPException(400, f"Unsupported file type {ext or '(none)'}.")
    async with slots:
        with tempfile.TemporaryDirectory(prefix="pdfdesk-") as tmp:
            t = Path(tmp)
            src = await save_upload(file, t, "input" + ext)
            profile = t / "lo-profile"  # isolated LibreOffice profile per job
            r = await run(["soffice", f"-env:UserInstallation=file://{profile}", "--headless", "--norestore",
                           "--convert-to", "pdf", "--outdir", str(t / "out"), str(src)], t)
            out = t / "out" / "input.pdf"
            if r.returncode != 0 or not out.exists():
                raise HTTPException(422, "LibreOffice could not convert this file. It may be damaged or password-protected.")
            return pdf_response(out, safe_stem(file.filename) + ".pdf")


@app.post("/convert/pdf-to-docx")
async def pdf_to_docx(file: UploadFile = File(...), x_access_key: str | None = Header(default=None)):
    check_key(x_access_key)
    async with slots:
        with tempfile.TemporaryDirectory(prefix="pdfdesk-") as tmp:
            t = Path(tmp)
            src = await save_upload(file, t, "input.pdf")
            require_pdf(src)
            out = t / "output.docx"

            def _convert():
                from pdf2docx import Converter
                logging.getLogger().setLevel(logging.WARNING)
                cv = Converter(str(src))
                try:
                    cv.convert(str(out))
                finally:
                    cv.close()
            try:
                await asyncio.wait_for(asyncio.to_thread(_convert), TIMEOUT)
            except asyncio.TimeoutError:
                raise HTTPException(504, "Conversion took too long and was stopped.")
            except Exception:
                raise HTTPException(422, "This PDF could not be converted to Word.")
            if not out.exists() or out.stat().st_size == 0:
                raise HTTPException(422, "Conversion produced no output.")
            return Response(out.read_bytes(),
                            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                            headers={"Content-Disposition": f'attachment; filename="{safe_stem(file.filename)}.docx"', "Cache-Control": "no-store"})


@app.post("/ocr")
async def ocr(file: UploadFile = File(...), languages: str = Form("eng"), x_access_key: str | None = Header(default=None)):
    check_key(x_access_key)
    langs = [l for l in languages.split("+") if l in OCR_LANGS] or ["eng"]
    async with slots:
        with tempfile.TemporaryDirectory(prefix="pdfdesk-") as tmp:
            t = Path(tmp)
            src = await save_upload(file, t, "input.pdf")
            require_pdf(src)
            out = t / "output.pdf"
            r = await run(["ocrmypdf", "--skip-text", "--rotate-pages", "--deskew", "-l", "+".join(langs),
                           "--output-type", "pdf", "--optimize", "1", str(src), str(out)], t)
            if r.returncode == 6:  # already has text everywhere
                raise HTTPException(422, "Every page already has text; nothing to OCR.")
            if r.returncode != 0 or not out.exists():
                raise HTTPException(422, "OCR failed for this file.")
            return pdf_response(out, safe_stem(file.filename) + "_searchable.pdf")


@app.post("/compress")
async def compress(file: UploadFile = File(...), level: str = Form("ebook"), x_access_key: str | None = Header(default=None)):
    check_key(x_access_key)
    if level not in {"screen", "ebook", "printer"}:
        level = "ebook"
    async with slots:
        with tempfile.TemporaryDirectory(prefix="pdfdesk-") as tmp:
            t = Path(tmp)
            src = await save_upload(file, t, "input.pdf")
            require_pdf(src)
            out = t / "output.pdf"
            r = await run(["gs", "-q", "-dSAFER", "-dBATCH", "-dNOPAUSE", "-sDEVICE=pdfwrite", "-dCompatibilityLevel=1.6",
                           f"-dPDFSETTINGS=/{level}", "-dDetectDuplicateImages=true", f"-sOutputFile={out}", str(src)], t)
            if r.returncode != 0 or not out.exists():
                raise HTTPException(422, "Ghostscript could not compress this file (it may be encrypted or damaged).")
            return pdf_response(out, safe_stem(file.filename) + "_compressed.pdf")


@app.post("/sign")
async def sign(
    file: UploadFile = File(...),
    certificate: UploadFile = File(...),
    password: str = Form(...),
    reason: str = Form(""),
    location: str = Form(""),
    x_access_key: str | None = Header(default=None),
):
    check_key(x_access_key)
    async with slots:
        with tempfile.TemporaryDirectory(prefix="pdfdesk-") as tmp:
            t = Path(tmp)
            src = await save_upload(file, t, "input.pdf")
            require_pdf(src)
            p12 = await save_upload(certificate, t, "cert.p12")
            out = t / "signed.pdf"

            def _sign():
                from pyhanko.sign import signers
                from pyhanko.pdf_utils.incremental_writer import IncrementalPdfFileWriter
                signer = signers.SimpleSigner.load_pkcs12(str(p12), passphrase=password.encode("utf-8"))
                if signer is None:
                    raise ValueError("bad certificate")
                meta = signers.PdfSignatureMetadata(field_name="PDFDeskSignature", reason=reason or None, location=location or None)
                with src.open("rb") as inf, out.open("wb") as outf:
                    w = IncrementalPdfFileWriter(inf, strict=False)
                    signers.sign_pdf(w, meta, signer=signer, output=outf)
            try:
                await asyncio.wait_for(asyncio.to_thread(_sign), TIMEOUT)
            except asyncio.TimeoutError:
                raise HTTPException(504, "Signing took too long and was stopped.")
            except Exception:
                # Deliberately generic: never echo details that could include secrets.
                raise HTTPException(422, "Signing failed. Check the certificate file and its password, and that the PDF is not encrypted.")
            return pdf_response(out, safe_stem(file.filename) + "_signed.pdf")
