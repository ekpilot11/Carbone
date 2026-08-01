import { createWorker, PSM, type Worker } from "tesseract.js";

let workerPromise: Promise<Worker> | null = null;

function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = createWorker("eng");
  }
  return workerPromise;
}

export interface RecognizeOptions {
  /** Upscale + grayscale + binarize the photo before OCR (helps thermal prints). */
  preprocess?: boolean;
  /** Page segmentation: "block" suits a printout filling the frame; "auto" lets Tesseract decide. */
  psm?: "block" | "auto";
}

function otsuThreshold(histogram: number[], totalPixels: number): number {
  let sumAll = 0;
  for (let i = 0; i < 256; i++) sumAll += i * histogram[i];

  let sumBackground = 0;
  let weightBackground = 0;
  let bestBetweenVariance = 0;
  let threshold = 127;

  for (let t = 0; t < 256; t++) {
    weightBackground += histogram[t];
    if (weightBackground === 0) continue;
    const weightForeground = totalPixels - weightBackground;
    if (weightForeground === 0) break;

    sumBackground += t * histogram[t];
    const meanBackground = sumBackground / weightBackground;
    const meanForeground = (sumAll - sumBackground) / weightForeground;
    const betweenVariance =
      weightBackground * weightForeground * (meanBackground - meanForeground) ** 2;
    if (betweenVariance > bestBetweenVariance) {
      bestBetweenVariance = betweenVariance;
      threshold = t;
    }
  }
  return threshold;
}

/**
 * Upscales small photos (thermal-print digits become legible), tames huge
 * ones, converts to grayscale and applies an Otsu binarization — the
 * classic recipe for faded receipt-style printouts.
 */
async function preprocessToCanvas(blob: Blob): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(blob);
  const maxSide = Math.max(bitmap.width, bitmap.height);
  let scale = 1;
  if (maxSide < 2000) scale = Math.min(2.5, 2000 / maxSide);
  else if (maxSide > 3600) scale = 3600 / maxSide;

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = image.data;
  const pixelCount = canvas.width * canvas.height;
  const gray = new Uint8Array(pixelCount);
  const histogram = new Array<number>(256).fill(0);

  for (let i = 0; i < pixelCount; i++) {
    const o = i * 4;
    const g = Math.round(0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2]);
    gray[i] = g;
    histogram[g]++;
  }

  const threshold = otsuThreshold(histogram, pixelCount);
  for (let i = 0; i < pixelCount; i++) {
    const v = gray[i] > threshold ? 255 : 0;
    const o = i * 4;
    data[o] = v;
    data[o + 1] = v;
    data[o + 2] = v;
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

/** Runs OCR on an image entirely in the browser; the image never leaves the device. */
export async function recognizeText(
  image: Blob | string,
  options: RecognizeOptions = {},
): Promise<string> {
  const worker = await getWorker();

  let input: Blob | string | HTMLCanvasElement = image;
  if (options.preprocess && image instanceof Blob) {
    try {
      input = await preprocessToCanvas(image);
    } catch {
      input = image;
    }
  }

  await worker.setParameters({
    tessedit_pageseg_mode: options.psm === "block" ? PSM.SINGLE_BLOCK : PSM.AUTO,
  });

  const {
    data: { text },
  } = await worker.recognize(input);
  return text;
}
