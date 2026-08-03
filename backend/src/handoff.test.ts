import { describe, expect, it } from "vitest";
import { collectHandoff, HANDOFF_TTL_MS, parkHandoff } from "./handoff.js";

describe("handing a day's work to the other machine", () => {
  it("gives back exactly what was parked", () => {
    const work = { version: 1, items: [{ patientName: "Ana", rows: {} }] };
    const { code } = parkHandoff(work);
    expect(collectHandoff(code)).toEqual(work);
  });

  it("expires within the working day", () => {
    const { expiresAt } = parkHandoff({});
    expect(expiresAt - Date.now()).toBeLessThanOrEqual(HANDOFF_TTL_MS);
    expect(expiresAt - Date.now()).toBeGreaterThan(HANDOFF_TTL_MS - 5000);
  });

  /**
   * A code is the only thing standing between a stranger and a patient list,
   * so it stops working the moment the work has been delivered.
   */
  it("can only be collected once", () => {
    const { code } = parkHandoff({ patients: 3 });
    expect(collectHandoff(code)).toEqual({ patients: 3 });
    expect(collectHandoff(code)).toBeNull();
  });

  it("says no to a code that was never issued", () => {
    expect(collectHandoff("ZZZZZZZZ")).toBeNull();
  });

  it("accepts a code however it was typed", () => {
    const { code } = parkHandoff({ ok: true });
    expect(collectHandoff(` ${code.toLowerCase()} `)).toEqual({ ok: true });
  });

  /** Read off one screen, typed into another — no 0/O or 1/I to confuse. */
  it("issues codes with no look-alike characters", () => {
    for (let i = 0; i < 50; i++) {
      const { code } = parkHandoff({});
      expect(code).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/);
    }
  });

  it("does not hand one person's work to another person's code", () => {
    const first = parkHandoff({ who: "first" });
    const second = parkHandoff({ who: "second" });
    expect(first.code).not.toBe(second.code);
    expect(collectHandoff(second.code)).toEqual({ who: "second" });
    expect(collectHandoff(first.code)).toEqual({ who: "first" });
  });
});
