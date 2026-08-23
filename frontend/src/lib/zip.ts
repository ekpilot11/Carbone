/**
 * Just enough ZIP to read the Office formats this app is handed.
 *
 * Both `.xlsx` and `.docx` are ZIPs of XML, and browsers can inflate on
 * their own (`DecompressionStream`), so these are read directly rather than
 * by pulling in a library — the same trade the PDF writer makes. Meaning
 * belongs to the callers: `xlsx.ts` for a patient list, `docx.ts` for a
 * filled consultation form.
 */

export interface ZipEntry {
  name: string;
  compressed: boolean;
  offset: number;
  size: number;
}

const utf8 = new TextDecoder();

/**
 * Reads the ZIP central directory. Only the fields this needs are decoded:
 * name, compression method, and where the data starts.
 */
export function readCentralDirectory(data: DataView): ZipEntry[] {
  // The end-of-central-directory record is at the end, after a comment of
  // unknown length, so it is found by scanning backwards for its signature.
  let end = -1;
  for (let i = data.byteLength - 22; i >= 0; i--) {
    if (data.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error("That file isn't a ZIP-based document (no directory found).");

  const count = data.getUint16(end + 10, true);
  let pointer = data.getUint32(end + 16, true);
  const entries: ZipEntry[] = [];

  for (let i = 0; i < count; i++) {
    if (data.getUint32(pointer, true) !== 0x02014b50) break;
    const method = data.getUint16(pointer + 10, true);
    const compressedSize = data.getUint32(pointer + 20, true);
    const nameLength = data.getUint16(pointer + 28, true);
    const extraLength = data.getUint16(pointer + 30, true);
    const commentLength = data.getUint16(pointer + 32, true);
    const localOffset = data.getUint32(pointer + 42, true);
    const name = utf8.decode(
      new Uint8Array(data.buffer, data.byteOffset + pointer + 46, nameLength),
    );

    entries.push({ name, compressed: method === 8, offset: localOffset, size: compressedSize });
    pointer += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

export async function readEntry(data: DataView, entry: ZipEntry): Promise<string> {
  // The local header repeats the name and extra fields, with its own lengths.
  const nameLength = data.getUint16(entry.offset + 26, true);
  const extraLength = data.getUint16(entry.offset + 28, true);
  const start = entry.offset + 30 + nameLength + extraLength;
  const bytes = new Uint8Array(data.buffer, data.byteOffset + start, entry.size);

  if (!entry.compressed) return utf8.decode(bytes);

  // Fed straight into the decompressor rather than via a Blob, whose
  // .stream() is missing from some non-browser environments this code is
  // tested in. The copy is one XML file's worth, and detaches the chunk from
  // the document buffer that backs it.
  const chunk = new Uint8Array(entry.size);
  chunk.set(bytes);
  const source = new ReadableStream<BufferSource>({
    start(controller) {
      controller.enqueue(chunk);
      controller.close();
    },
  });
  const inflated = source.pipeThrough(new DecompressionStream("deflate-raw"));

  const chunks: Uint8Array[] = [];
  const reader = inflated.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return utf8.decode(out);
}

export function parseXml(text: string): Document {
  return new DOMParser().parseFromString(text, "application/xml");
}
