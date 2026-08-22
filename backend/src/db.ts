import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";

/**
 * The patient database.
 *
 * Everything else in this app is deliberately stateless — photos are read
 * and discarded, handoffs live in memory for a day, nothing reaches disk.
 * This is the exception, and it exists for one reason: the clinic's workflow
 * spans two visits. The consultation happens on one day and the biometry on
 * another, and until now the two halves never met.
 *
 * One SQLite file, so that a backup is a file copy and a restore is copying
 * it back. `node:sqlite` is built into Node, so this adds no dependency —
 * the same trade the PDF writer and the spreadsheet reader make.
 *
 * **No photographs are stored**, only the values read from them.
 */

/** Where the file lives. The container sets this to its own volume. */
const DB_PATH = process.env.LENS_DB ?? path.resolve("data/lens.db");

let db: DatabaseSync | null = null;
let dbPath: string | null = null;

/**
 * Normalises a name for matching: uppercase, accents stripped, punctuation
 * dropped, runs of whitespace collapsed.
 *
 * "José Maria  da Silva" and "JOSE MARIA DA SILVA" are the same person
 * written twice, and a clinic list contains both. This is only ever used to
 * *find* candidates and to notice that a prontuário's stored name disagrees
 * with a scanned one — never to decide a match on its own.
 */
export function nameKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Prontuários are written by hand and read from a photo, so they arrive with
 * stray spaces, dots and dashes. Comparing them needs one spelling.
 */
export function prontuarioKey(prontuario: string): string {
  return prontuario.replace(/[^0-9A-Za-z]/g, "").toUpperCase();
}

const MIGRATIONS: string[] = [
  `CREATE TABLE patients (
     id            INTEGER PRIMARY KEY AUTOINCREMENT,
     prontuario    TEXT NOT NULL UNIQUE,
     name          TEXT NOT NULL,
     name_key      TEXT NOT NULL,
     age_years     INTEGER,
     created_at    TEXT NOT NULL,
     updated_at    TEXT NOT NULL
   );
   CREATE INDEX patients_name_key ON patients(name_key);

   CREATE TABLE consultations (
     id            INTEGER PRIMARY KEY AUTOINCREMENT,
     patient_id    INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
     seen_on       TEXT,
     data          TEXT NOT NULL,
     created_at    TEXT NOT NULL
   );
   CREATE INDEX consultations_patient ON consultations(patient_id);

   CREATE TABLE exams (
     id            INTEGER PRIMARY KEY AUTOINCREMENT,
     patient_id    INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
     measured_on   TEXT,
     data          TEXT NOT NULL,
     created_at    TEXT NOT NULL
   );
   CREATE INDEX exams_patient ON exams(patient_id);`,
];

/**
 * Opens the database, creating it and applying any missing migrations.
 *
 * WAL mode because the one failure a restart cannot undo is a power cut in
 * the middle of a write; WAL plus a clean close on shutdown makes that very
 * unlikely. Foreign keys on, so deleting a patient takes their consultations
 * and exams with them rather than leaving orphans behind.
 */
export function openDatabase(file: string = DB_PATH): DatabaseSync {
  // Re-open when asked for a different file. In the app that never happens
  // — the path is fixed — but it lets each test have its own database
  // instead of sharing one and interfering with the next.
  if (db && dbPath === file) return db;
  if (db) closeDatabase();

  if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
  const opened = new DatabaseSync(file);
  opened.exec("PRAGMA journal_mode = WAL");
  opened.exec("PRAGMA foreign_keys = ON");

  opened.exec("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)");
  const row = opened.prepare("SELECT version FROM schema_version").get() as
    | { version: number }
    | undefined;
  let version = row?.version ?? 0;
  if (row === undefined) opened.prepare("INSERT INTO schema_version VALUES (0)").run();

  for (let i = version; i < MIGRATIONS.length; i++) {
    opened.exec(MIGRATIONS[i]);
    version = i + 1;
  }
  opened.prepare("UPDATE schema_version SET version = ?").run(version);

  db = opened;
  dbPath = file;
  return db;
}

/**
 * The connection already in use.
 *
 * Deliberately not `openDatabase()`: that one *chooses* a file, and calling
 * it with the default from inside a query would silently abandon whichever
 * database the caller had opened — which is exactly what happened, and made
 * every test quietly share one file.
 */
function connection(): DatabaseSync {
  return db ?? openDatabase();
}

/** Lets the server hand the file back on shutdown, so WAL is checkpointed. */
export function closeDatabase(): void {
  const open = db;
  db = null;
  dbPath = null;
  try {
    open?.close();
  } catch {
    // Already closed, or never opened. Nothing useful to do on the way out.
  }
}

export interface PatientRecord {
  id: number;
  prontuario: string;
  name: string;
  ageYears?: number;
  createdAt: string;
  updatedAt: string;
}

function toPatient(row: Record<string, unknown>): PatientRecord {
  return {
    id: row.id as number,
    prontuario: row.prontuario as string,
    name: row.name as string,
    ageYears: (row.age_years as number | null) ?? undefined,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

/**
 * Saves a consultation, creating the patient or updating the one that
 * already holds this prontuário.
 *
 * The prontuário is the hospital's own key, assigned at a patient's first
 * attendance, so a second form bearing the same number is the same person
 * returning — not a new record. The name is refreshed from the newer form
 * (people marry, and earlier readings of the handwriting may have been
 * worse), which is why {@link findByProntuario} exists to check the two
 * against each other *before* anything is written.
 */
export function saveConsultation(input: {
  prontuario: string;
  name: string;
  ageYears?: number;
  seenOn?: string;
  form: unknown;
}): PatientRecord {
  const conn = connection();
  const now = new Date().toISOString();
  const key = prontuarioKey(input.prontuario);

  conn
    .prepare(
      `INSERT INTO patients (prontuario, name, name_key, age_years, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(prontuario) DO UPDATE SET
         name = excluded.name,
         name_key = excluded.name_key,
         age_years = COALESCE(excluded.age_years, patients.age_years),
         updated_at = excluded.updated_at`,
    )
    .run(key, input.name, nameKey(input.name), input.ageYears ?? null, now, now);

  const patient = findByProntuario(input.prontuario)!;
  conn
    .prepare(
      `INSERT INTO consultations (patient_id, seen_on, data, created_at) VALUES (?, ?, ?, ?)`,
    )
    .run(patient.id, input.seenOn ?? null, JSON.stringify(input.form), now);

  return patient;
}

export function saveExam(input: {
  patientId: number;
  measuredOn?: string;
  exam: unknown;
}): void {
  const conn = connection();
  conn
    .prepare(`INSERT INTO exams (patient_id, measured_on, data, created_at) VALUES (?, ?, ?, ?)`)
    .run(input.patientId, input.measuredOn ?? null, JSON.stringify(input.exam), new Date().toISOString());
}

export function findByProntuario(prontuario: string): PatientRecord | null {
  const conn = connection();
  const row = conn
    .prepare("SELECT * FROM patients WHERE prontuario = ?")
    .get(prontuarioKey(prontuario)) as Record<string, unknown> | undefined;
  return row ? toPatient(row) : null;
}

/** The fallback when the number couldn't be read: everyone with that name. */
export function findByName(name: string): PatientRecord[] {
  const conn = connection();
  const rows = conn
    .prepare("SELECT * FROM patients WHERE name_key = ? ORDER BY updated_at DESC")
    .all(nameKey(name)) as Record<string, unknown>[];
  return rows.map(toPatient);
}

/**
 * What a scanned prontuário and name together mean.
 *
 * Deliberately not a boolean. A number that matches a stored patient whose
 * name does not is the most dangerous thing this feature can encounter —
 * one misread digit away from attaching this patient's biometry to someone
 * else's consultation — so it gets its own answer, and the caller has to
 * show it to a person rather than resolve it.
 */
export type MatchResult =
  | { kind: "none" }
  | { kind: "match"; patient: PatientRecord }
  | { kind: "nameMismatch"; patient: PatientRecord; scannedName: string }
  | { kind: "byNameOnly"; candidates: PatientRecord[] };

export function matchPatient(input: { prontuario?: string; name?: string }): MatchResult {
  const prontuario = input.prontuario?.trim();
  const name = input.name?.trim();

  if (prontuario) {
    const patient = findByProntuario(prontuario);
    if (patient) {
      if (name && nameKey(patient.name) !== nameKey(name)) {
        return { kind: "nameMismatch", patient, scannedName: name };
      }
      return { kind: "match", patient };
    }
  }

  if (name) {
    const candidates = findByName(name);
    if (candidates.length > 0) return { kind: "byNameOnly", candidates };
  }

  return { kind: "none" };
}

export interface StoredConsultation {
  id: number;
  seenOn?: string;
  form: unknown;
  createdAt: string;
}

export function consultationsFor(patientId: number): StoredConsultation[] {
  const conn = connection();
  const rows = conn
    .prepare("SELECT * FROM consultations WHERE patient_id = ? ORDER BY created_at DESC")
    .all(patientId) as Record<string, unknown>[];
  return rows.map((row) => ({
    id: row.id as number,
    seenOn: (row.seen_on as string | null) ?? undefined,
    form: JSON.parse(row.data as string),
    createdAt: row.created_at as string,
  }));
}

export function listPatients(): PatientRecord[] {
  const conn = connection();
  const rows = conn
    .prepare("SELECT * FROM patients ORDER BY updated_at DESC")
    .all() as Record<string, unknown>[];
  return rows.map(toPatient);
}

export function deletePatient(id: number): void {
  connection().prepare("DELETE FROM patients WHERE id = ?").run(id);
}

/**
 * Everything, as one JSON document.
 *
 * The backup story until something better exists: a button that hands the
 * whole database over as a file. Most of the ways this data can be lost —
 * `docker compose down -v`, a Docker Desktop reset, the PC dying — are
 * undone by having taken one of these recently.
 */
export function exportAll(): unknown {
  const patients = listPatients();
  return {
    exportedAt: new Date().toISOString(),
    version: 1,
    patients: patients.map((patient) => ({
      ...patient,
      consultations: consultationsFor(patient.id),
    })),
  };
}
