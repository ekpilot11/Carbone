import type { CalculateResponse } from "./api";
import {
  emptyRow,
  isRowComplete,
  isRowEmpty,
  type EyeRowState,
  type LensSettings,
} from "./eyeRow";
import type { EyeSide } from "./types";

/**
 * A day's worth of photos, one patient per photo.
 *
 * The review step is not skipped in bulk: every photo becomes an editable
 * row that the clinician looks over before anything is calculated. What
 * batching removes is the repetition — uploading, waiting and downloading
 * thirty times — not the checking.
 */

export type BatchStatus =
  | "scanning"
  | "ready"
  | "calculating"
  | "done"
  | "failed";

export interface BatchItem {
  id: string;
  fileName: string;
  /** Null for a row that arrived by handoff: the photo stayed on the phone. */
  file: File | null;
  previewUrl: string | null;
  status: BatchStatus;
  /** Read from the photo when legible; editable either way. */
  patientName: string;
  rows: Record<EyeSide, EyeRowState>;
  /** What the scan wants the clinician to know (missing eye, low-confidence read). */
  note?: string;
  /** Why this photo couldn't be scanned or calculated. */
  error?: string;
  result?: CalculateResponse;
  /** Exactly what produced `result`, so a later edit can't rewrite history. */
  submitted?: {
    sides: EyeSide[];
    settings: LensSettings;
    kIndex: string;
    rows: Record<EyeSide, EyeRowState>;
  };
}

/**
 * A batch stripped to what can cross a network: the values, not the photos.
 *
 * `file` and `previewUrl` are browser objects and cannot be sent anywhere;
 * more to the point, the photographs are the most identifying thing this app
 * touches, and the handoff is deliberately built without them. What arrives
 * on the other device is what the clinician already reviewed — names, values,
 * results — and the photo stays on the phone that took it.
 */
export interface PortableBatchItem {
  fileName: string;
  status: BatchStatus;
  patientName: string;
  rows: Record<EyeSide, EyeRowState>;
  note?: string;
  error?: string;
  result?: CalculateResponse;
  submitted?: BatchItem["submitted"];
}

export interface PortableBatch {
  version: 1;
  items: PortableBatchItem[];
  settings: LensSettings;
  kIndex: string;
}

export function toPortableBatch(
  items: BatchItem[],
  settings: LensSettings,
  kIndex: string,
): PortableBatch {
  return {
    version: 1,
    settings,
    kIndex,
    items: items.map((item) => ({
      fileName: item.fileName,
      // A photo still being scanned can't be handed over — there is no image
      // on the other side to finish scanning. It arrives as a row to fill in.
      status: item.status === "scanning" ? "ready" : item.status,
      patientName: item.patientName,
      rows: item.rows,
      note: item.note,
      error: item.error,
      result: item.result,
      submitted: item.submitted,
    })),
  };
}

/** Rebuilds rows from a handoff. Photoless, so nothing can be re-scanned. */
export function fromPortableBatch(batch: PortableBatch): BatchItem[] {
  return batch.items.map((item, index) => ({
    id: `handoff-${index}-${item.fileName}`,
    fileName: item.fileName,
    file: null,
    previewUrl: null,
    status: item.status,
    patientName: item.patientName,
    rows: item.rows,
    note: item.note,
    error: item.error,
    result: item.result,
    submitted: item.submitted,
  }));
}

export function isPortableBatch(value: unknown): value is PortableBatch {
  if (typeof value !== "object" || value === null) return false;
  const batch = value as Partial<PortableBatch>;
  return (
    batch.version === 1 &&
    Array.isArray(batch.items) &&
    typeof batch.kIndex === "string" &&
    typeof batch.settings === "object" &&
    batch.settings !== null
  );
}

export function createBatchItems(files: File[]): BatchItem[] {
  return files.map((file, index) => ({
    id: `${index}-${file.name}-${file.lastModified}`,
    fileName: file.name,
    file,
    previewUrl: URL.createObjectURL(file),
    status: "scanning",
    patientName: "",
    rows: { OD: emptyRow("OD"), OS: emptyRow("OS") },
  }));
}

/** An item is calculable when at least one eye is complete and none is half-filled. */
export function itemSides(item: BatchItem): EyeSide[] {
  return (["OD", "OS"] as const).filter((side) => isRowComplete(item.rows[side]));
}

export function isItemCalculable(item: BatchItem): boolean {
  return itemSides(item).length > 0;
}

/**
 * Eyes that are started but not finished. The single-patient form refuses to
 * calculate at all in this state; a batch can't hold up a day's work for one
 * photo, so instead the row says so and that eye is left out — but it is
 * never left out silently.
 */
export function partialSides(item: BatchItem): EyeSide[] {
  return (["OD", "OS"] as const).filter(
    (side) => !isRowEmpty(item.rows[side]) && !isRowComplete(item.rows[side]),
  );
}

/** True when the values on screen no longer match the ones that were calculated. */
export function isStale(item: BatchItem): boolean {
  if (!item.submitted) return false;
  return JSON.stringify(item.submitted.rows) !== JSON.stringify(item.rows);
}

export interface BatchCounts {
  total: number;
  scanning: number;
  ready: number;
  calculating: number;
  done: number;
  failed: number;
  /** Scanned, but not enough values to calculate — these need typing in. */
  incomplete: number;
  /** Calculated, then edited — the shown result no longer matches the values. */
  stale: number;
}

export function countBatch(items: BatchItem[]): BatchCounts {
  const counts: BatchCounts = {
    total: items.length,
    scanning: 0,
    ready: 0,
    calculating: 0,
    done: 0,
    failed: 0,
    incomplete: 0,
    stale: 0,
  };
  for (const item of items) {
    counts[item.status]++;
    if (item.status === "ready" && !isItemCalculable(item)) counts.incomplete++;
    if (item.status === "done" && isStale(item)) counts.stale++;
  }
  return counts;
}

/**
 * Runs `worker` over every item, at most `limit` at a time.
 *
 * The limit matters twice over: the scan is a paid API call, and the
 * calculation drives someone else's website — thirty at once would be both
 * expensive and rude. Workers report their own failures; one rejecting must
 * not abandon the rest of the queue.
 */
export async function runWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let next = 0;
  const lanes = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const index = next++;
      await worker(items[index], index).catch(() => {});
    }
  });
  await Promise.all(lanes);
}

/** How many photos are scanned at once (a paid API call each). */
export const SCAN_CONCURRENCY = 3;

/**
 * How many calculations run at once against calc.apacrs.org. Deliberately
 * small: this is a third-party site being driven by a browser, and a burst
 * of parallel runs is both impolite and more likely to trip its bot check.
 */
export const CALCULATE_CONCURRENCY = 2;
