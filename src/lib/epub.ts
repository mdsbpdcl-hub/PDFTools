// Minimal, valid EPUB 3 writer (with EPUB 2 NCX for older readers).
export interface Chapter { title: string; paragraphs: { text: string; heading?: boolean }[] }

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
  // strip characters that are not allowed in XML 1.0
  // eslint-disable-next-line no-control-regex
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "");

export async function buildEpub(meta: { title: string; author: string; language: string }, chapters: Chapter[]): Promise<Blob> {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  const opts = { createFolders: false };
  const id = `urn:uuid:${crypto.randomUUID()}`;
  const modified = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  zip.file("mimetype", "application/epub+zip", { compression: "STORE", createFolders: false });
  zip.file("META-INF/container.xml", `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`, opts);
  zip.file("OEBPS/style.css", "body{font-family:serif;line-height:1.5;margin:0 5%}h1,h2{font-family:sans-serif;line-height:1.25}p{margin:0 0 .8em;text-indent:0}", opts);
  chapters.forEach((c, i) => {
    zip.file(`OEBPS/ch${i + 1}.xhtml`, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${esc(meta.language)}" lang="${esc(meta.language)}">
<head><meta charset="UTF-8"/><title>${esc(c.title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body><section epub:type="chapter"><h1>${esc(c.title)}</h1>
${c.paragraphs.map((p) => (p.heading ? `<h2>${esc(p.text)}</h2>` : `<p>${esc(p.text)}</p>`)).join("\n")}
</section></body></html>`, opts);
  });
  zip.file("OEBPS/nav.xhtml", `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><meta charset="UTF-8"/><title>Contents</title></head>
<body><nav epub:type="toc" id="toc"><h1>Contents</h1><ol>
${chapters.map((c, i) => `<li><a href="ch${i + 1}.xhtml">${esc(c.title)}</a></li>`).join("\n")}
</ol></nav></body></html>`, opts);
  zip.file("OEBPS/toc.ncx", `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:uid" content="${id}"/></head>
<docTitle><text>${esc(meta.title)}</text></docTitle><navMap>
${chapters.map((c, i) => `<navPoint id="n${i + 1}" playOrder="${i + 1}"><navLabel><text>${esc(c.title)}</text></navLabel><content src="ch${i + 1}.xhtml"/></navPoint>`).join("\n")}
</navMap></ncx>`, opts);
  zip.file("OEBPS/content.opf", `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="bookid">${id}</dc:identifier><dc:title>${esc(meta.title)}</dc:title>
<dc:creator>${esc(meta.author || "Unknown")}</dc:creator><dc:language>${esc(meta.language)}</dc:language>
<meta property="dcterms:modified">${modified}</meta>
</metadata>
<manifest>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
<item id="css" href="style.css" media-type="text/css"/>
${chapters.map((_, i) => `<item id="ch${i + 1}" href="ch${i + 1}.xhtml" media-type="application/xhtml+xml"/>`).join("\n")}
</manifest>
<spine toc="ncx">${chapters.map((_, i) => `<itemref idref="ch${i + 1}"/>`).join("")}</spine>
</package>`, opts);
  return zip.generateAsync({ type: "blob", mimeType: "application/epub+zip", compression: "DEFLATE" });
}
