import { describe, expect, it } from "vitest";
import { isPersonalConstant, lensConstants, PERSONAL_CONSTANT } from "./lenses";

describe("lens constants", () => {
  it("finds a lens's constants regardless of spacing or case", () => {
    expect(lensConstants("Alcon SN6ATx")).toEqual({ lensFactor: 2.02, aConstant: 119.26 });
    expect(lensConstants("  alcon   sn6atx ")).toEqual({ lensFactor: 2.02, aConstant: 119.26 });
  });

  it("reports a lens it doesn't know rather than guessing constants", () => {
    expect(lensConstants("Some Lens That Isn't Listed")).toBeUndefined();
  });

  it("recognises the personal-constant option", () => {
    expect(isPersonalConstant(PERSONAL_CONSTANT)).toBe(true);
    expect(isPersonalConstant("personal constant")).toBe(true);
    expect(isPersonalConstant("Alcon SN6ATx")).toBe(false);
  });
});
