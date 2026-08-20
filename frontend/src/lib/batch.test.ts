import { describe, expect, it } from "vitest";
import {
  countBatch,
  fromPortableBatch,
  hasWorkToHandOff,
  isItemCalculable,
  isPortableBatch,
  isStale,
  itemSides,
  partialSides,
  itemsFromPatients,
  runWithConcurrency,
  singlePatientItem,
  suspectSides,
  toPortableBatch,
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

/**
 * The handoff exists because the phone and the hospital PC can't reach each
 * other. What crosses has to be everything needed to finish the work — and
 * nothing that identifies a patient more than it must.
 */
describe("carrying a day's work to another device", () => {
  const settings = { lens: "Personal Constant", lensFactor: "1.57", aConstant: "118.4" };
  const day = [
    item({
      id: "a",
      patientName: "Ana Souza",
      status: "done",
      rows: { OD: { ...emptyRow("OD"), ...COMPLETE }, OS: emptyRow("OS") },
      result: { resultsText: "…", recommended: { od: "21.50" } },
      submitted: {
        sides: ["OD"],
        settings,
        kIndex: "1.3375",
        rows: { OD: { ...emptyRow("OD"), ...COMPLETE }, OS: emptyRow("OS") },
      },
    }),
    item({ id: "b", fileName: "two.jpg", patientName: "Bruno", note: "K values only" }),
  ];

  it("carries the values, the results and what produced them", () => {
    const restored = fromPortableBatch(toPortableBatch(day, settings, "1.3375"));
    expect(restored).toHaveLength(2);
    expect(restored[0].patientName).toBe("Ana Souza");
    expect(restored[0].rows.OD.axialLength).toBe("22.98");
    expect(restored[0].result?.recommended?.od).toBe("21.50");
    expect(restored[0].submitted?.sides).toEqual(["OD"]);
    expect(restored[1].note).toBe("K values only");
    // Still trustworthy on the other side: a restored row that matches what
    // was calculated must not be flagged as edited.
    expect(isStale(restored[0])).toBe(false);
  });

  it("leaves the photographs behind", () => {
    const portable = toPortableBatch(day, settings, "1.3375");
    expect(JSON.stringify(portable)).not.toContain("previewUrl");
    const restored = fromPortableBatch(portable);
    expect(restored[0].file).toBeNull();
    expect(restored[0].previewUrl).toBeNull();
  });

  /** A photo mid-scan has no image on the other side, so it arrives as a row to fill in. */
  it("does not hand over a scan that never finished", () => {
    const restored = fromPortableBatch(
      toPortableBatch([item({ status: "scanning" })], settings, "1.3375"),
    );
    expect(restored[0].status).toBe("ready");
  });

  it("carries the lens and K index the work was done with", () => {
    const named = { lens: "Alcon SN60WF", lensFactor: "1.88", aConstant: "118.99" };
    const portable = toPortableBatch(day, named, "1.332");
    expect(portable.settings).toEqual(named);
    expect(portable.kIndex).toBe("1.332");
  });

  it("refuses anything that isn't a day's work", () => {
    expect(isPortableBatch(toPortableBatch(day, settings, "1.3375"))).toBe(true);
    expect(isPortableBatch(null)).toBe(false);
    expect(isPortableBatch({ items: [] })).toBe(false);
    expect(isPortableBatch({ version: 2, items: [], settings, kIndex: "1.3375" })).toBe(false);
  });
});

describe("handing over a single patient", () => {
  const settings = { lens: "Personal Constant", lensFactor: "1.57", aConstant: "118.4" };

  it("travels as a batch of one, keeping name, values and result", () => {
    const one = singlePatientItem({
      patientName: "Ana Souza",
      rows: { OD: { ...emptyRow("OD"), ...COMPLETE }, OS: emptyRow("OS") },
      result: { resultsText: "…", recommended: { od: "21.50" } },
    });
    const restored = fromPortableBatch(toPortableBatch([one], settings, "1.3375"));
    expect(restored).toHaveLength(1);
    expect(restored[0].patientName).toBe("Ana Souza");
    expect(restored[0].rows.OD.k1).toBe("44.16");
    expect(restored[0].result?.recommended?.od).toBe("21.50");
    // A calculated patient arrives calculated, so the record is ready to copy.
    expect(restored[0].status).toBe("done");
  });

  it("arrives as a row to fill in when nothing was calculated yet", () => {
    const one = singlePatientItem({
      patientName: "",
      rows: { OD: { ...emptyRow("OD"), ...COMPLETE }, OS: emptyRow("OS") },
    });
    expect(one.status).toBe("ready");
    expect(one.fileName).toBe("patient");
  });

  it("has nothing to hand over until a value is entered", () => {
    expect(hasWorkToHandOff({ OD: emptyRow("OD"), OS: emptyRow("OS") })).toBe(false);
    expect(
      hasWorkToHandOff({ OD: { ...emptyRow("OD"), k1: "44.16" }, OS: emptyRow("OS") }),
    ).toBe(true);
  });
});

describe("a row whose K values contradict each other", () => {
  const reversed = item({
    id: "k",
    rows: {
      OD: { ...emptyRow("OD"), ...COMPLETE, k1: "45.06", k2: "44.16" },
      OS: { ...emptyRow("OS"), ...COMPLETE },
    },
  });

  it("is left out of the calculation even though every field is filled", () => {
    expect(itemSides(reversed)).toEqual(["OS"]);
    expect(suspectSides(reversed)).toEqual(["OD"]);
  });

  it("is counted, so a long list says how many need checking", () => {
    expect(countBatch([reversed]).suspect).toBe(1);
  });

  it("stops the row calculating at all when it is the only eye", () => {
    const onlyEye = item({
      id: "only",
      rows: {
        OD: { ...emptyRow("OD"), ...COMPLETE, k1: "45.06", k2: "44.16" },
        OS: emptyRow("OS"),
      },
    });
    expect(isItemCalculable(onlyEye)).toBe(false);
  });
});

describe("importing patients as batch rows", () => {
  it("carries each patient's problems onto the row as a note", () => {
    const items = itemsFromPatients(
      [
        {
          name: "VERA",
          rows: { OD: emptyRow("OD"), OS: emptyRow("OS") },
          problems: [
            { side: "OD", kind: "kOrder", k1: "43.34", k2: "43.23" },
            { side: "OS", kind: "incomplete", missing: ["K2"] },
          ],
        },
      ],
      (problem) =>
        problem.kind === "kOrder"
          ? `${problem.side} K1 ${problem.k1} > K2 ${problem.k2}`
          : `${problem.side} missing ${problem.missing.join(", ")}`,
    );
    expect(items[0].note).toBe("OD K1 43.34 > K2 43.23 OS missing K2");
    expect(items[0].status).toBe("ready");
    expect(items[0].file).toBeNull();
  });
});
