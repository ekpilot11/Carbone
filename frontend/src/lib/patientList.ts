import { emptyRow, isRowComplete, type EyeRowState } from "./eyeRow";
import type { EyeSide } from "./types";
import type { Grid } from "./xlsx";

/**
 * A ward list, read as a day's work.
 *
 * The clinic keeps its cataract list as a spreadsheet: one patient per pair
 * of rows, the name written once and the two eyes beneath it. Each of those
 * patients is exactly what one photograph used to be, so a list becomes the
 * same batch the app already reviews and calculates — nothing downstream
 * needs to know where the rows came from.
 *
 * The list is a working document, so it is read defensively:
 *
 * - **Decimal commas.** "22,16" is the number twenty-two point one six.
 * - **Footnote marks.** A trailing "*" flags a value the clinic annotated;
 *   it is not part of the number.
 * - **Not-measured markers.** "n/e", "n/a", "-" and blanks all mean the same
 *   thing here: there is no value.
 * - **An eye is all-or-nothing.** Missing any of axial length, K1, K2 or ACD,
 *   and the whole eye is discarded rather than half-imported — a half-filled
 *   eye is the one thing the calculator would reject, and a partially
 *   imported eye invites someone to top it up from memory.
 * - **K1 above K2 is a mistake, not a measurement.** K1 is the flatter
 *   meridian by definition, so a row where it is the larger number is a
 *   typo, a swapped pair, or two values from different eyes — and nothing
 *   in the numbers says which. That eye is refused and reported, for a
 *   person to check against the source and type in. Quietly reordering it
 *   would turn a visible error into a confident IOL power.
 */

/** Why an eye from the list can't be used as it stands. */
export type EyeProblem =
  | { side: EyeSide; kind: "incomplete"; missing: string[] }
  | { side: EyeSide; kind: "kOrder"; k1: string; k2: string };

export interface ImportedPatient {
  name: string;
  rows: Record<EyeSide, EyeRowState>;
  /** Eyes the list couldn't supply usably, and why. Never silent. */
  problems: EyeProblem[];
}

export interface ImportedList {
  patients: ImportedPatient[];
  /** Patients with no usable eye at all — listed so they aren't lost silently. */
  withoutUsableEye: string[];
  /** Eyes left out for missing measurements. */
  discardedEyes: number;
  /** Eyes left out because K1 was above K2 — these need checking, not typing. */
  suspectEyes: number;
}

/** Column headings this recognises, loosest match last. */
const HEADINGS = {
  name: [/^paciente/i, /^nome/i, /^patient/i],
  side: [/^olho/i, /^eye/i, /^lado/i],
  axialLength: [/^axl/i, /axial/i, /comprimento/i],
  k1: [/^k1/i, /^ceratometria 1/i],
  k2: [/^k2/i, /^ceratometria 2/i],
  acd: [/^acd/i, /c[âa]mara/i, /profundidade/i],
} as const;

type Column = keyof typeof HEADINGS;

const MEASUREMENTS = ["axialLength", "k1", "k2", "acd"] as const;
type Measurement = (typeof MEASUREMENTS)[number];

/** Human-facing names for what an eye was missing, in the form's own order. */
const FIELD_LABELS: Record<Measurement, string> = {
  axialLength: "AXL",
  k1: "K1",
  k2: "K2",
  acd: "ACD",
};

function normalise(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

/**
 * A number as the spreadsheet writes one, or null when the cell means "not
 * measured". Anything that isn't a plain number is treated as absent rather
 * than guessed at — a value nobody can parse must never reach a surgical
 * calculation.
 */
export function readNumber(value: string | undefined): string | null {
  const text = normalise(value).replace(/\*+$/, "").trim();
  if (text === "") return null;
  const numeric = text.replace(/\./g, "").includes(",")
    ? text.replace(/\./g, "").replace(",", ".")
    : text;
  if (!/^-?\d+(\.\d+)?$/.test(numeric)) return null;
  const parsed = Number(numeric);
  return Number.isFinite(parsed) ? parsed.toFixed(2) : null;
}

/** "OE" is how this clinic writes the left eye; the calculator calls it OS. */
export function readSide(value: string | undefined): EyeSide | null {
  const text = normalise(value).toUpperCase().replace(/[^A-Z]/g, "");
  if (text === "OD" || text === "RE" || text === "R") return "OD";
  if (text === "OE" || text === "OS" || text === "LE" || text === "L") return "OS";
  return null;
}

/** Finds the header row and which column holds what. */
function findColumns(grid: Grid): { headerRow: number; columns: Partial<Record<Column, number>> } | null {
  for (const [rowIndex, row] of grid.entries()) {
    const columns: Partial<Record<Column, number>> = {};
    for (const [cellIndex, cell] of row.entries()) {
      const text = normalise(cell);
      if (text === "") continue;
      for (const [key, patterns] of Object.entries(HEADINGS) as [Column, readonly RegExp[]][]) {
        if (columns[key] === undefined && patterns.some((pattern) => pattern.test(text))) {
          columns[key] = cellIndex;
        }
      }
    }
    // A header is only a header if it names the patient, the eye and enough
    // measurements to calculate one — otherwise it's a title or a note.
    const measured = MEASUREMENTS.filter((field) => columns[field] !== undefined).length;
    if (columns.name !== undefined && columns.side !== undefined && measured === 4) {
      return { headerRow: rowIndex, columns };
    }
  }
  return null;
}

export function readPatientList(grid: Grid): ImportedList {
  const found = findColumns(grid);
  if (!found) {
    throw new Error(
      "Couldn't find the table's headings. The sheet needs a row naming the patient and the " +
        "eye, plus AXL, K1, K2 and ACD.",
    );
  }
  const { headerRow, columns } = found;

  const patients: ImportedPatient[] = [];
  const byName = new Map<string, ImportedPatient>();
  let currentName = "";

  for (const row of grid.slice(headerRow + 1)) {
    // The name is written once, on the first of a patient's rows; the rows
    // beneath it belong to whoever was named last.
    const name = normalise(row[columns.name!]);
    if (name !== "") currentName = name;

    const side = readSide(row[columns.side!]);
    if (side === null || currentName === "") continue;

    let patient = byName.get(currentName);
    if (!patient) {
      patient = {
        name: currentName,
        rows: { OD: emptyRow("OD"), OS: emptyRow("OS") },
        problems: [],
      };
      byName.set(currentName, patient);
      patients.push(patient);
    }

    const values = {} as Record<Measurement, string | null>;
    for (const field of MEASUREMENTS) values[field] = readNumber(row[columns[field]!]);

    const missing = MEASUREMENTS.filter((field) => values[field] === null);
    if (missing.length > 0) {
      // Discarded, not half-imported: this eye stays exactly as empty as an
      // eye that was never measured.
      patient.problems.push({
        side,
        kind: "incomplete",
        missing: missing.map((field) => FIELD_LABELS[field]),
      });
      continue;
    }

    // K1 above K2 cannot be a real cornea. Refused rather than reordered:
    // whether the pair was swapped, mistyped or copied from the wrong eye is
    // not decidable here, and each of those is a different wrong answer.
    if (Number(values.k1) > Number(values.k2)) {
      patient.problems.push({ side, kind: "kOrder", k1: values.k1!, k2: values.k2! });
      continue;
    }

    patient.rows[side] = {
      ...emptyRow(side),
      axialLength: values.axialLength!,
      acd: values.acd!,
      k1: values.k1!,
      k2: values.k2!,
    };
  }

  const count = (kind: EyeProblem["kind"]) =>
    patients.reduce(
      (total, patient) => total + patient.problems.filter((problem) => problem.kind === kind).length,
      0,
    );

  return {
    patients,
    withoutUsableEye: patients
      .filter((patient) => !isRowComplete(patient.rows.OD) && !isRowComplete(patient.rows.OS))
      .map((patient) => patient.name),
    discardedEyes: count("incomplete"),
    suspectEyes: count("kOrder"),
  };
}
