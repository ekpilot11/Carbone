import { createWorker, PSM, type Worker } from "tesseract.js";

let workerPromise: Promise<Worker> | null = null;

function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = createWorker("eng");
  }
  return workerPromise;
}

/**
 * No single image treatment reads a whole thermal printout: measured
 * against real photos, a plain upscale recovered one eye's keratometry
 * while a thresholded pass recovered the other's, and the axial-length
 * label alternated between "AVGAXL", "AUGAXL" and "AVUGAXL" depending on
 * the treatment. So the page is read several ways and the results are
 * merged by the caller.
 */
export type Treatment = "plain" | "contrast" | "threshold";

const TREATMENTS: Treatment[] = ["plain", "contrast", "threshold"];

function drawUpscaled(bitmap: ImageBitmap): HTMLCanvasElement {
  const maxSide = Math.max(bitmap.width, bitmap.height);
  // Small photos gain from interpolation; very large ones only cost time.
  let scale = 1;
  if (maxSide < 1800) scale = Math.min(3, 1800 / maxSide);
  else if (maxSide > 3200) scale = 3200 / maxSide;

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** Grayscale, then stretch the 1st–99th percentile to full black-to-white. */
function toNormalizedGray(canvas: HTMLCanvasElement): {
  gray: Uint8ClampedArray;
  histogram: number[];
} {
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = image.data;
  const pixels = canvas.width * canvas.height;

  const gray = new Uint8ClampedArray(pixels);
  const counts = new Array<number>(256).fill(0);
  for (let i = 0; i < pixels; i++) {
    const o = i * 4;
    const g = Math.round(0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2]);
    gray[i] = g;
    counts[g]++;
  }

  let low = 0;
  let high = 255;
  const tail = pixels * 0.01;
  for (let seen = 0, v = 0; v < 256; v++) {
    seen += counts[v];
    if (seen > tail) {
      low = v;
      break;
    }
  }
  for (let seen = 0, v = 255; v >= 0; v--) {
    seen += counts[v];
    if (seen > tail) {
      high = v;
      break;
    }
  }

  const span = Math.max(1, high - low);
  const histogram = new Array<number>(256).fill(0);
  for (let i = 0; i < pixels; i++) {
    const stretched = Math.max(0, Math.min(255, Math.round(((gray[i] - low) * 255) / span)));
    gray[i] = stretched;
    histogram[stretched]++;
  }
  return { gray, histogram };
}

/** Otsu's method: the threshold that best separates ink from paper. */
function otsuThreshold(histogram: number[], totalPixels: number): number {
  let sumAll = 0;
  for (let i = 0; i < 256; i++) sumAll += i * histogram[i];

  let sumBackground = 0;
  let weightBackground = 0;
  let bestVariance = 0;
  let threshold = 127;

  for (let t = 0; t < 256; t++) {
    weightBackground += histogram[t];
    if (weightBackground === 0) continue;
    const weightForeground = totalPixels - weightBackground;
    if (weightForeground === 0) break;

    sumBackground += t * histogram[t];
    const meanBackground = sumBackground / weightBackground;
    const meanForeground = (sumAll - sumBackground) / weightForeground;
    const variance =
      weightBackground * weightForeground * (meanBackground - meanForeground) ** 2;
    if (variance > bestVariance) {
      bestVariance = variance;
      threshold = t;
    }
  }
  return threshold;
}

function writeGray(canvas: HTMLCanvasElement, gray: Uint8ClampedArray): void {
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = image.data;
  for (let i = 0; i < gray.length; i++) {
    const o = i * 4;
    data[o] = gray[i];
    data[o + 1] = gray[i];
    data[o + 2] = gray[i];
    data[o + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
}

async function prepare(blob: Blob, treatment: Treatment): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(blob);
  const canvas = drawUpscaled(bitmap);
  bitmap.close();

  if (treatment === "plain") return canvas;

  const { gray, histogram } = toNormalizedGray(canvas);
  if (treatment === "threshold") {
    const cut = otsuThreshold(histogram, gray.length);
    for (let i = 0; i < gray.length; i++) gray[i] = gray[i] > cut ? 255 : 0;
  }
  writeGray(canvas, gray);
  return canvas;
}

/**
 * Reads the image once per treatment, yielding each result so the caller
 * can stop as soon as it has everything it needs. OCR runs entirely in the
 * browser — the photo never leaves the device.
 */
export async function* recognizeVariants(blob: Blob): AsyncGenerator<string> {
  const worker = await getWorker();
  await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });

  for (const treatment of TREATMENTS) {
    let input: Blob | HTMLCanvasElement = blob;
    try {
      input = await prepare(blob, treatment);
    } catch {
      // Fall back to the untouched photo if canvas processing fails.
    }
    const {
      data: { text },
    } = await worker.recognize(input);
    yield text;
  }
}
