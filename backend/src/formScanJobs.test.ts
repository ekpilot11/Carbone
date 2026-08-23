import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Reading a form is a job for the same reason a calculation is: the first
 * real form anyone scanned came back as a Cloudflare 502, because the read
 * outlasted the tunnel's patience while an HTTP request sat open waiting
 * for it. Nothing here waits.
 */
const scanForm = vi.hoisted(() => vi.fn());
vi.mock("./scanForm.js", () => ({ scanForm }));
vi.mock("./barrett.js", () => ({ runBarrettCalculation: vi.fn() }));

const { clearJobs, readFormScanJob, startFormScan } = await import("./calcJobs.js");

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  clearJobs();
  scanForm.mockReset();
});

describe("form scans as jobs", () => {
  it("returns a ticket before the model has answered", () => {
    scanForm.mockReturnValue(new Promise(() => {}));
    const id = startFormScan("base64", "image/jpeg");
    expect(readFormScanJob(id)?.status).toBe("running");
  });

  it("holds the reading for collection afterwards", async () => {
    scanForm.mockResolvedValue({ form: { identificacao: { paciente: "Ana" } }, unread: ["x.y"] });
    const id = startFormScan("base64", "image/jpeg");
    await settle();

    const job = readFormScanJob(id);
    expect(job?.status).toBe("done");
    expect(job?.result?.unread).toEqual(["x.y"]);
  });

  it("passes a PDF through as itself, not as an image", () => {
    scanForm.mockReturnValue(new Promise(() => {}));
    startFormScan("base64", "application/pdf");
    expect(scanForm).toHaveBeenCalledWith("base64", "application/pdf");
  });

  /** The clinician has to be told why, not just that it went wrong. */
  it("keeps the reason a read failed", async () => {
    scanForm.mockRejectedValue(new Error("The vision model declined to read this image."));
    const id = startFormScan("base64", "image/jpeg");
    await settle();
    expect(readFormScanJob(id)?.status).toBe("failed");
    expect(readFormScanJob(id)?.error).toContain("declined");
  });

  it("does not mix a form scan up with a calculation", async () => {
    scanForm.mockResolvedValue({ form: {}, unread: [] });
    const scan = startFormScan("base64", "image/jpeg");
    await settle();
    expect(readFormScanJob(scan)?.status).toBe("done");
    expect(readFormScanJob("00000000-0000-0000-0000-000000000000")).toBeNull();
  });
});
