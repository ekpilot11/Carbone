import { describe, expect, it } from "vitest";
import { readPatientList, readNumber, readSide } from "./patientList";
import { parseDelimited } from "./xlsx";

/**
 * Shaped like the clinic's own list: two title rows, a header row, then each
 * patient as a named row for OD and an unnamed row for OE, separated by a
 * blank line. Values carry decimal commas, some carry the clinic's "*"
 * annotation, and "n/e" marks a measurement that was never taken.
 */
const SHEET = [
  ["Lista de Pacientes — Cirurgia de Catarata", "", "", "", "", "", ""],
  ["Facoemulsificação · 3 pacientes", "", "", "", "", "", ""],
  ["", "", "", "", "", "", ""],
  ["#", "Paciente", "Olho", "AXL (mm)", "K1 (D)", "K2 (D)", "ACD (mm)"],
  ["1", "LEONILDA APARECIDA FIORAMONTE", "OD", "22,16", "44,60*", "45,15*", "2,89"],
  ["", "", "OE", "22,22", "44,46*", "44,89*", "2,89"],
  ["", "", "", "", "", "", ""],
  ["2", "VERA LUCIA DO NASCIMENTO", "OD", "23,09", "43,34", "43,23", "4,20"],
  ["", "", "OE", "22,88", "43,22", "", "3,50"],
  ["", "", "", "", "", "", ""],
  ["3", "CARLOS HENRIQUE MENDES", "OD", "n/e", "n/e", "n/e", "n/e"],
  ["", "", "OE", "23,50", "", "", "3,10"],
];

describe("reading the clinic's cataract list", () => {
  const list = readPatientList(SHEET);

  it("finds the table under the title rows, one patient per pair of rows", () => {
    expect(list.patients.map((patient) => patient.name)).toEqual([
      "LEONILDA APARECIDA FIORAMONTE",
      "VERA LUCIA DO NASCIMENTO",
      "CARLOS HENRIQUE MENDES",
    ]);
  });

  it("reads decimal commas and ignores the clinic's asterisks", () => {
    const eye = list.patients[0].rows.OD;
    expect(eye.axialLength).toBe("22.16");
    expect(eye.acd).toBe("2.89");
    expect(eye.k1).toBe("44.60");
    expect(eye.k2).toBe("45.15");
  });

  it("carries the name down to the second row, which the list leaves blank", () => {
    expect(list.patients[0].rows.OS.axialLength).toBe("22.22");
  });

  /** OE is how the clinic writes it; the calculator calls the left eye OS. */
  it("maps OE onto OS", () => {
    expect(readSide("OE")).toBe("OS");
    expect(readSide(" od ")).toBe("OD");
    expect(readSide("")).toBeNull();
  });

  /**
   * The list is not consistent about which column holds the steeper K, and
   * everything downstream assumes K1 is the flatter one.
   */
  it("puts the lower K in K1 whichever column the list used", () => {
    const eye = list.patients[1].rows.OD;
    expect(eye.k1).toBe("43.23");
    expect(eye.k2).toBe("43.34");
  });

  it("targets emmetropia, since the list carries no refraction target", () => {
    expect(list.patients[0].rows.OD.targetRefraction).toBe("0");
  });
});

describe("an eye is all four measurements or nothing", () => {
  const list = readPatientList(SHEET);

  it("discards an eye missing any measurement rather than half-importing it", () => {
    const partial = list.patients[1].rows.OS;
    // The list had AXL, K1 and ACD for this eye — none of them are imported.
    expect(partial.axialLength).toBe("");
    expect(partial.k1).toBe("");
    expect(partial.acd).toBe("");
  });

  it("names the discarded eye and what it lacked, so it isn't lost silently", () => {
    expect(list.patients[1].discarded).toEqual([{ side: "OS", missing: ["K2"] }]);
    expect(list.discardedEyes).toBe(3);
  });

  it("treats n/e as no value at all", () => {
    expect(readNumber("n/e")).toBeNull();
    expect(readNumber("")).toBeNull();
    expect(readNumber("  ")).toBeNull();
    expect(readNumber("22,16*")).toBe("22.16");
  });

  it("reports the patients with no usable eye instead of dropping them", () => {
    expect(list.withoutUsableEye).toEqual(["CARLOS HENRIQUE MENDES"]);
    // They are still listed, so the clinician can see who was skipped.
    expect(list.patients).toHaveLength(3);
  });

  it("keeps the eye that is complete when the other one isn't", () => {
    const vera = list.patients[1];
    expect(vera.rows.OD.axialLength).toBe("23.09");
    expect(vera.rows.OS.axialLength).toBe("");
  });
});

describe("the same list as CSV", () => {
  it("reads a semicolon-separated export, decimal commas and all", () => {
    const csv = [
      "#;Paciente;Olho;AXL (mm);K1 (D);K2 (D);ACD (mm)",
      "1;ANA SOUZA;OD;23,09;43,34;43,23;4,20",
      ";;OE;22,88;43,22;42,83;3,50",
    ].join("\n");
    const list = readPatientList(parseDelimited(csv));
    expect(list.patients).toHaveLength(1);
    expect(list.patients[0].rows.OD.axialLength).toBe("23.09");
    expect(list.patients[0].rows.OS.k1).toBe("42.83");
  });

  it("handles a comma-separated export with quoted names", () => {
    const csv = [
      "Paciente,Olho,AXL,K1,K2,ACD",
      '"SOUZA, ANA",OD,23.09,43.34,43.23,4.20',
    ].join("\n");
    const list = readPatientList(parseDelimited(csv));
    expect(list.patients[0].name).toBe("SOUZA, ANA");
    expect(list.patients[0].rows.OD.acd).toBe("4.20");
  });
});

describe("a file that isn't a patient list", () => {
  it("says what the sheet needs rather than importing nothing", () => {
    expect(() => readPatientList([["Observações"], ["Paciente", "Observação"]])).toThrow(
      /AXL, K1, K2 and ACD/,
    );
  });
});
