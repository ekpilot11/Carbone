/**
 * A very small PDF writer — enough for a one-page, text-and-rules clinical
 * record, and nothing more.
 *
 * Why hand-rolled rather than a PDF library: the record carries the
 * patient's name and their measurements, so it is built and saved entirely
 * in the browser and never touches the network. Keeping that path free of a
 * large third-party dependency (and of anything that could phone home) is
 * worth the ~150 lines here. Only the standard Helvetica faces are used, so
 * no font has to be embedded.
 */

export interface PdfText {
  text: string;
  /** Points from the left edge. */
  x: number;
  /** Points from the *top* edge — PDF's own origin is bottom-left, converted on write. */
  y: number;
  size?: number;
  bold?: boolean;
}

export interface PdfRule {
  x1: number;
  x2: number;
  /** Points from the top edge. */
  y: number;
  width?: number;
  /** 0 = black, 1 = white. */
  gray?: number;
}

export interface PdfDocument {
  title: string;
  texts: PdfText[];
  rules?: PdfRule[];
  /** Defaults to A4 portrait. */
  pageWidth?: number;
  pageHeight?: number;
}

export const A4_WIDTH = 595.28;
export const A4_HEIGHT = 841.89;

/** PDF string literals are delimited by parentheses, so those must be escaped. */
function escapeText(value: string): string {
  return value.replace(/[\\()]/g, (char) => `\\${char}`);
}

/**
 * Encodes to WinAnsi (Latin-1 for everything this record can contain, which
 * covers Portuguese accents). Characters outside it become "?" rather than
 * corrupting the byte stream.
 */
function latin1Bytes(value: string): number[] {
  const bytes: number[] = [];
  for (const char of value) {
    const code = char.codePointAt(0) ?? 63;
    bytes.push(code <= 0xff ? code : 63);
  }
  return bytes;
}

function round(value: number): string {
  return (Math.round(value * 100) / 100).toString();
}

function buildContentStream(doc: PdfDocument, height: number): string {
  const parts: string[] = [];

  for (const rule of doc.rules ?? []) {
    const gray = rule.gray ?? 0;
    parts.push(
      `${round(gray)} G ${round(rule.width ?? 0.5)} w ` +
        `${round(rule.x1)} ${round(height - rule.y)} m ${round(rule.x2)} ${round(height - rule.y)} l S`,
    );
  }

  for (const item of doc.texts) {
    if (item.text === "") continue;
    parts.push(
      `BT /${item.bold ? "F2" : "F1"} ${round(item.size ?? 10)} Tf ` +
        `1 0 0 1 ${round(item.x)} ${round(height - item.y)} Tm (${escapeText(item.text)}) Tj ET`,
    );
  }

  return parts.join("\n");
}

export function buildPdf(doc: PdfDocument): Uint8Array {
  const width = doc.pageWidth ?? A4_WIDTH;
  const height = doc.pageHeight ?? A4_HEIGHT;
  const content = buildContentStream(doc, height);
  const contentLength = latin1Bytes(content).length;

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${round(width)} ${round(height)}] ` +
      "/Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${contentLength} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    `<< /Title (${escapeText(doc.title)}) /Producer (IOL Power Calculator Assistant) >>`,
  ];

  const bytes: number[] = [];
  const push = (value: string) => bytes.push(...latin1Bytes(value));

  push("%PDF-1.4\n");
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(bytes.length);
    push(`${index + 1} 0 obj\n${body}\nendobj\n`);
  });

  const xrefOffset = bytes.length;
  push(`xref\n0 ${objects.length + 1}\n`);
  push("0000000000 65535 f \n");
  for (const offset of offsets) {
    push(`${offset.toString().padStart(10, "0")} 00000 n \n`);
  }
  push(
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${objects.length} 0 R >>\n` +
      `startxref\n${xrefOffset}\n%%EOF\n`,
  );

  return Uint8Array.from(bytes);
}

/** Hands the finished document to the browser as a download. */
export function downloadPdf(pdf: Uint8Array, fileName: string): void {
  const blob = new Blob([pdf as unknown as BlobPart], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoked on the next tick so the click has taken the URL first.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
