import { describe, expect, it } from "vitest";
import {
  countBatch,
  isItemCalculable,
  isStale,
  itemSides,
  partialSides,
  runWithConcurrency,
  type BatchItem,
} from "./batch";
import { emptyRow } from "./eyeRow";

const COMPLETE = {
  k1: "44.16",
  k2: "45.06",
  axialLength: "22.98",
  acd: "2.79",
  targetRefraction: "0",
};

function item(overrides: Partial<BatchItem> = {}): BatchItem {
  return {
    id: "1",
    fileName: "photo.jpg",
    file: new File([], "photo.jpg"),
    previewUrl: "",
    status: "ready",
    patientName: "",
    rows: { OD: emptyRow("OD"), OS: emptyRow("OS") },
    ...overrides,
  };
}

describe("batch items", () => {
  it("calculates whichever eyes are complete", () => {
    const both = item({
      rows: { OD: { ...emptyRow("OD"), ...COMPLETE }, OS: { ...emptyRow("OS"), ...COMPLETE } },
    });
    expect(itemSides(both)).toEqual(["OD", "OS"]);

    const oneEye = item({
      rows: { OD: { ...emptyRow("OD"), ...COMPLETE }, OS: emptyRow("OS") },
    });
    expect(itemSides(oneEye)).toEqual(["OD"]);
    expect(isItemCalculable(oneEye)).toBe(true);
  });

  it("refuses a photo that yielded nothing usable", () => {
    expect(isItemCalculable(item())).toBe(false);
  });

  it("names an eye that was started but not finished", () => {
    const half = item({
      rows: {
        OD: { ...emptyRow("OD"), ...COMPLETE },
        OS: { ...emptyRow("OS"), k1: "43.04", k2: "44.01" },
      },
    });
    // OD still calculates; OS is reported rather than dropped in silence.
    expect(itemSides(half)).toEqual(["OD"]);
    expect(partialSides(half)).toEqual(["OS"]);
  });

  it("spots a row edited after it was calculated", () => {
    const rows = { OD: { ...emptyRow("OD"), ...COMPLETE }, OS: emptyRow("OS") };
    const calculated = item({
      status: "done",
      rows,
      submitted: {
        sides: ["OD"],
        settings: { lens: "Personal Constant", lensFactor: "1.57", aConstant: "118.4" },
        kIndex: "1.3375",
        rows,
      },
    });
    expect(isStale(calculated)).toBe(false);

    const edited = { ...calculated, rows: { ...rows, OD: { ...rows.OD, axialLength: "23.50" } } };
    expect(isStale(edited)).toBe(true);
    expect(countBatch([edited]).stale).toBe(1);
  });

  it("counts a scanned-but-unusable photo as needing attention", () => {
    const counts = countBatch([
      item({ status: "ready", rows: { OD: { ...emptyRow("OD"), ...COMPLETE }, OS: emptyRow("OS") } }),
      item({ status: "ready" }),
      item({ status: "failed" }),
      item({ status: "done" }),
    ]);
    expect(counts).toMatchObject({ total: 4, ready: 2, failed: 1, done: 1, incomplete: 1 });
  });
});

describe("runWithConcurrency", () => {
  it("runs every item without exceeding the limit", async () => {
    const items = Array.from({ length: 10 }, (_, i) => i);
    const seen: number[] = [];
    let running = 0;
    let peak = 0;

    await runWithConcurrency(items, 3, async (value) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      seen.push(value);
      running--;
    });

    expect(seen.sort((a, b) => a - b)).toEqual(items);
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1);
  });

  it("keeps going when one item throws", async () => {
    const done: number[] = [];
    await runWithConcurrency([1, 2, 3], 2, async (value) => {
      if (value === 2) throw new Error("boom");
      done.push(value);
    });
    expect(done.sort()).toEqual([1, 3]);
  });

  it("handles an empty queue", async () => {
    await expect(runWithConcurrency([], 3, async () => {})).resolves.toBeUndefined();
  });
});
