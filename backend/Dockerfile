# PDF Desk optional backend: LibreOffice, Ghostscript, Tesseract/OCRmyPDF, pdf2docx, pyHanko.
FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1

RUN apt-get update && apt-get install -y --no-install-recommends \
      libreoffice-writer libreoffice-calc libreoffice-impress \
      fonts-dejavu fonts-liberation fonts-noto-core fonts-noto-ui-core \
      ghostscript qpdf pngquant unpaper \
      tesseract-ocr tesseract-ocr-eng tesseract-ocr-hin tesseract-ocr-mar \
      tesseract-ocr-fra tesseract-ocr-deu tesseract-ocr-spa tesseract-ocr-por tesseract-ocr-ita \
    && rm -rf /var/lib/apt/lists/*

RUN useradd --create-home --uid 10001 app
WORKDIR /srv
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY app.py .

USER app
ENV HOME=/home/app PORT=8080
EXPOSE 8080
# Access logs are off so file names never reach logs.
CMD ["sh", "-c", "uvicorn app:app --host 0.0.0.0 --port ${PORT} --no-access-log --workers 1"]
