/**
 * Downscales a photo to the vision model's maximum useful resolution and
 * encodes it for transport. Phone photos are far larger than the model can
 * use, so sending them untouched costs upload time and tokens for no gain in
 * accuracy.
 */
const MAX_EDGE = 2576;
const JPEG_QUALITY = 0.92;

export interface PreparedImage {
  base64: string;
  mediaType: "image/jpeg";
}

export async function prepareImage(blob: Blob): Promise<PreparedImage> {
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const encoded = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (out) => (out ? resolve(out) : reject(new Error("Could not encode the image."))),
      "image/jpeg",
      JPEG_QUALITY,
    );
  });

  return { base64: bytesToBase64(new Uint8Array(await encoded.arrayBuffer())), mediaType: "image/jpeg" };
}

function bytesToBase64(buffer: Uint8Array): string {
  let binary = "";
  // Chunked to stay well clear of the argument-count limit on large inputs.
  for (let i = 0; i < buffer.length; i += 8192) {
    binary += String.fromCharCode(...buffer.subarray(i, i + 8192));
  }
  return btoa(binary);
}

/**
 * A file as base64, untouched.
 *
 * For a PDF, which is sent to the model as the document it is — there is no
 * downscaling to do, and re-encoding it would only lose the text layer that
 * makes a PDF read better than a photograph in the first place.
 */
export async function fileToBase64(file: Blob): Promise<string> {
  return bytesToBase64(new Uint8Array(await file.arrayBuffer()));
}
