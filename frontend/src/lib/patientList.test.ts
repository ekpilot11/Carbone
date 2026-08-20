import { describe, expect, it } from "vitest";
import { readPatientList, readNumber, readSide } from "./patientList";
import { parseDelimited } from "./xlsx";

/**
 * Shaped like the clinic's own list: two title rows, a header row, then each
 * patient as a named row for OD and an unnamed row for OE, separated by a
 * blank line. Values carry decimal commas, some carry the clinic's "*"
 * annotation, and "n/e" marks a measurement that was never taken.
 *
 * Patient 2's OD is taken from the real list, where K1 is written above K2.
 */
const SHEET = [
  ["Lista de Pacientes — Cirurgia de Catarata", "", "", "", "", "", ""],
  ["Facoemulsificação · 4 pacientes", "", "", "", "", "", ""],
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
  ["", "", "", "", "", "", ""],
  ["4", "JOSE NARCISO MAXIMO", "OD", "23,87", "41,36", "41,86", "3,17"],
  ["", "", "OE", "24,42", "42,32", "43,25", ""],
];

describe("reading the clinic's cataract list", () => {
  const list = readPatientList(SHEET);

  it("finds the table under the title rows, one patient per pair of rows", () => {
    expect(list.patients.map((patient) => patient.name)).toEqual([
      "LEONILDA APARECIDA FIORAMONTE",
      "VERA LUCIA DO NASCIMENTO",
      "CARLOS HENRIQUE MENDES",
      "JOSE NARCISO MAXIMO",
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

  it("keeps K1 and K2 exactly as the list wrote them", () => {
    const eye = list.patients[0].rows.OD;
    expect(eye.k1).toBe("44.60");
    expect(eye.k2).toBe("45.15");
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
    expect(list.patients[1].problems).toContainEqual({
      side: "OS",
      kind: "incomplete",
      missing: ["K2"],
    });
    // Vera's OE, both of Carlos's eyes, and Jose's OE.
    expect(list.discardedEyes).toBe(4);
  });

  it("treats n/e as no value at all", () => {
    expect(readNumber("n/e")).toBeNull();
    expect(readNumber("")).toBeNull();
    expect(readNumber("  ")).toBeNull();
    expect(readNumber("22,16*")).toBe("22.16");
  });

  it("reports the patients with no usable eye instead of dropping them", () => {
    expect(list.withoutUsableEye).toEqual([
      "VERA LUCIA DO NASCIMENTO",
      "CARLOS HENRIQUE MENDES",
    ]);
    // They are still listed, so the clinician can see who was skipped.
    expect(list.patients).toHaveLength(4);
  });

  it("keeps the eye that is complete when the other one isn't", () => {
    const jose = list.patients[3];
    expect(jose.rows.OD.axialLength).toBe("23.87");
    expect(jose.rows.OS.axialLength).toBe("");
    expect(jose.problems).toEqual([{ side: "OS", kind: "incomplete", missing: ["ACD"] }]);
  });
});

/**
 * K1 is the flatter meridian by definition. A row where it is the larger
 * number is a transcription error — a swapped pair, a typo, or two values
 * from different eyes — and no rule can tell which. Reordering it silently
 * would turn a visible mistake into a confident IOL power, so the eye is
 * refused and reported for a person to check and type in.
 */
describe("K1 above K2 is a mistake, not a measurement", () => {
  const list = readPatientList(SHEET);

  it("refuses the eye rather than swapping the values round", () => {
    const eye = list.patients[1].rows.OD;
    expect(eye.k1).toBe("");
    expect(eye.k2).toBe("");
    // The other three values were fine, and go too: an eye is all or nothing.
    expect(eye.axialLength).toBe("");
    expect(eye.acd).toBe("");
  });

  it("reports it as a suspect pair, quoting both values back", () => {
    expect(list.patients[1].problems).toContainEqual({
      side: "OD",
      kind: "kOrder",
      k1: "43.34",
      k2: "43.23",
    });
    expect(list.suspectEyes).toBe(1);
  });

  it("leaves the other patients' eyes alone", () => {
    expect(list.patients[0].rows.OD.k1).toBe("44.60");
    expect(list.patients[3].rows.OD.k1).toBe("41.36");
  });

  it("allows a perfectly spherical cornea, where the two are equal", () => {
    const spherical = readPatientList([
      ["Paciente", "Olho", "AXL", "K1", "K2", "ACD"],
      ["ANA", "OD", "23,09", "43,50", "43,50", "4,20"],
    ]);
    expect(spherical.suspectEyes).toBe(0);
    expect(spherical.patients[0].rows.OD.k1).toBe("43.50");
  });
});

describe("the same list as CSV", () => {
  it("reads a semicolon-separated export, decimal commas and all", () => {
    const csv = [
      "#;Paciente;Olho;AXL (mm);K1 (D);K2 (D);ACD (mm)",
      "1;ANA SOUZA;OD;23,09;43,23;43,34;4,20",
      ";;OE;22,88;42,83;43,22;3,50",
    ].join("\n");
    const list = readPatientList(parseDelimited(csv));
    expect(list.patients).toHaveLength(1);
    expect(list.patients[0].rows.OD.axialLength).toBe("23.09");
    expect(list.patients[0].rows.OS.k1).toBe("42.83");
  });

  it("handles a comma-separated export with quoted names", () => {
    const csv = [
      "Paciente,Olho,AXL,K1,K2,ACD",
      '"SOUZA, ANA",OD,23.09,43.23,43.34,4.20',
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
