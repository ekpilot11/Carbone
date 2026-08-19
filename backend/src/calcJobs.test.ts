import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The job store is what keeps a calculation alive after the request that
 * started it has ended — the whole point being that no connection has to
 * survive the run.
 */
const runBarrettCalculation = vi.hoisted(() => vi.fn());
vi.mock("./barrett.js", () => ({ runBarrettCalculation }));

const { clearJobs, readJob, startCalculation } = await import("./calcJobs.js");

const REQUEST = {
  od: {
    side: "OD",
    keratometry: { k1: 43.23, k2: 43.34 },
    biometry: { axialLength: 23.09, acd: 4.2 },
    manual: { targetRefraction: 0 },
    iol: { iolModel: "Biconvex", lens: "Personal Constant", lensFactor: 1.57, aConstant: 118.4 },
  },
} as never;

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  clearJobs();
  runBarrettCalculation.mockReset();
});

describe("calculations as jobs", () => {
  it("reports running before the automation has answered", () => {
    runBarrettCalculation.mockReturnValue(new Promise(() => {}));
    const id = startCalculation(REQUEST);
    expect(readJob(id)?.status).toBe("running");
  });

  it("holds the result for collection afterwards", async () => {
    runBarrettCalculation.mockResolvedValue({ resultsText: "x", recommended: { od: "21.50" } });
    const id = startCalculation(REQUEST);
    await settle();
    const job = readJob(id);
    expect(job?.status).toBe("done");
    expect(job?.result?.recommended?.od).toBe("21.50");
  });

  /** The app has to be able to show why, not just that it went wrong. */
  it("keeps the reason a run failed", async () => {
    runBarrettCalculation.mockRejectedValue(new Error("Couldn't find the calculator form"));
    const id = startCalculation(REQUEST);
    await settle();
    expect(readJob(id)?.status).toBe("failed");
    expect(readJob(id)?.error).toContain("Couldn't find the calculator form");
  });

  it("can be read more than once, since the app polls", async () => {
    runBarrettCalculation.mockResolvedValue({ resultsText: "x" });
    const id = startCalculation(REQUEST);
    await settle();
    expect(readJob(id)?.status).toBe("done");
    expect(readJob(id)?.status).toBe("done");
  });

  it("says nothing about a job it never had", () => {
    expect(readJob("00000000-0000-0000-0000-000000000000")).toBeNull();
  });

  it("does not mix two runs up", async () => {
    runBarrettCalculation.mockResolvedValueOnce({ resultsText: "first", recommended: { od: "20.00" } });
    const first = startCalculation(REQUEST);
    runBarrettCalculation.mockResolvedValueOnce({ resultsText: "second", recommended: { od: "25.00" } });
    const second = startCalculation(REQUEST);
    await settle();
    expect(readJob(first)?.result?.recommended?.od).toBe("20.00");
    expect(readJob(second)?.result?.recommended?.od).toBe("25.00");
  });
});
