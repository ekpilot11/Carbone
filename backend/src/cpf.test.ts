import { describe, expect, it } from "vitest";
import { cpfDigits, formatCpf, isValidCpf } from "./cpf.js";

describe("reading a CPF off a form", () => {
  it("takes the punctuation people write it with", () => {
    expect(cpfDigits("111.444.777-35")).toBe("11144477735");
    expect(cpfDigits(" 111 444 777 35 ")).toBe("11144477735");
    expect(isValidCpf("111.444.777-35")).toBe(true);
    expect(isValidCpf("11144477735")).toBe(true);
  });

  it("writes it back the way the form prints it", () => {
    expect(formatCpf("11144477735")).toBe("111.444.777-35");
    // Not eleven digits: nothing sensible to format, so nothing is invented.
    expect(formatCpf("1114447")).toBe("1114447");
  });
});

describe("catching a misread", () => {
  /**
   * The whole reason the CPF is the key rather than the prontuário: a digit
   * read wrong off handwriting stops being invisible.
   */
  it("rejects a single transposed digit in an otherwise valid number", () => {
    expect(isValidCpf("111.444.777-35")).toBe(true);
    expect(isValidCpf("111.447.477-35")).toBe(false);
  });

  it("rejects swapped check digits", () => {
    expect(isValidCpf("111.444.777-53")).toBe(false);
  });

  it("rejects the wrong number of digits", () => {
    expect(isValidCpf("1114447773")).toBe(false);
    expect(isValidCpf("111444777350")).toBe(false);
    expect(isValidCpf("")).toBe(false);
  });

  /**
   * These satisfy the arithmetic but are issued to nobody. They are what
   * gets written when someone needs to get past a required field.
   */
  it("rejects a repeated digit even though the maths works out", () => {
    for (const digit of "0123456789") {
      expect(isValidCpf(digit.repeat(11))).toBe(false);
    }
  });

  it("accepts other well-formed numbers", () => {
    expect(isValidCpf("123.456.789-09")).toBe(true);
    expect(isValidCpf("529.982.247-25")).toBe(true);
  });
});
