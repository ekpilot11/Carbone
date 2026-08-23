import type { EyeInput, EyeSide } from "./types";

/** At least one eye must be present; a single eye calculates that side only. */
export interface CalculateRequest {
  od?: EyeInput;
  os?: EyeInput;
  /** The calculator's keratometric index radio, form-wide: "1.3375" or "1.332". */
  kIndex?: string;
}

export interface IolTableRow {
  power: string;
  optic: string;
  refraction: string;
}

export interface CalculateResponse {
  /** The calculator's results panel text, from "Right Eye (OD)" onward. */
  resultsText: string;
  /** Recommended IOL power per eye, parsed out of resultsText when present. */
  recommended?: { od?: string; os?: string };
  /** The per-eye "IOL Power | Optic | Refraction" tables, when both parsed cleanly. */
  tables?: { od: IolTableRow[]; os: IolTableRow[] };
  /** The lens the calculator actually had selected, with the constants it used. */
  lens?: { name: string; lensFactor?: string; aConstant?: string };
  /** The keratometric index the form had selected when Calculate was clicked. */
  kIndex?: string;
  /** Set when the automation could not confirm it read the page it expected (see backend README). */
  warning?: string;
}

// Defaults to a same-origin relative path so Vite's dev proxy (see
// vite.config.ts) or a same-origin production deployment can route it;
// set VITE_API_BASE_URL to override when frontend and backend are hosted
// on different origins.
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

export interface ScannedKeratometry {
  side: EyeSide;
  k1: number;
  k2: number;
}

export interface ScannedBiometry {
  side: EyeSide;
  axialLength: number;
  acd: number;
}

/** One photo yields whichever of the two printouts it happens to contain. */
export interface ScanResponse {
  keratometry: ScannedKeratometry[];
  biometry: ScannedBiometry[];
  /** Read from the photo for the PDF record only; absent when it wasn't legible. */
  patientName?: string;
  warning?: string;
}

/** Raised when the server has no vision model configured, so the caller can fall back to on-device OCR. */
export class ScanUnavailableError extends Error {}

export async function scanPhoto(imageBase64: string, mediaType: string): Promise<ScanResponse> {
  const res = await fetch(`${API_BASE}/api/scan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imageBase64, mediaType }),
  });

  if (res.status === 503) {
    throw new ScanUnavailableError("Photo scanning is not configured on the server.");
  }
  if (!res.ok) throw new Error(await describeFailure(res, "read that photo"));
  return res.json();
}

/**
 * The lens names the live calculator offers. Best-effort: the caller keeps
 * its bundled list when this fails (the backend has to reach the site to
 * answer, which can be blocked or challenged).
 */
export async function fetchLensOptions(): Promise<string[]> {
  const res = await fetch(`${API_BASE}/api/lenses`);
  if (!res.ok) throw new Error(`Lens list unavailable (${res.status}).`);
  const body = (await res.json()) as { lenses?: unknown };
  if (!Array.isArray(body.lenses) || body.lenses.some((name) => typeof name !== "string")) {
    throw new Error("Lens list came back in an unexpected shape.");
  }
  return body.lenses as string[];
}

/**
 * A Cloudflare check waiting for a human, on the machine running the
 * automation. When the app is on a server, that machine is not the one in
 * front of you — so the check comes here instead: a picture of the real
 * browser window, and your clicks sent back to it. Nothing is answered
 * automatically; this only carries a person's hand to where the window is.
 */
export interface ChallengeStatus {
  id: string;
  ageSeconds: number;
  width: number;
  height: number;
}

export async function fetchChallenge(): Promise<ChallengeStatus | null> {
  const res = await fetch(`${API_BASE}/api/challenge`);
  if (!res.ok) return null;
  const body = (await res.json()) as { challenge?: ChallengeStatus | null };
  return body.challenge ?? null;
}

/** `nonce` defeats caching — the window changes as the person interacts with it. */
export function challengeFrameUrl(id: string, nonce: number): string {
  return `${API_BASE}/api/challenge/${id}/frame.jpg?n=${nonce}`;
}

export async function sendChallengeInput(
  id: string,
  input: { x: number; y: number } | { text: string },
): Promise<void> {
  await fetch(`${API_BASE}/api/challenge/${id}/input`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

/**
 * What the calculator turns one constant into.
 *
 * The Lens Factor and A Constant are one value in two units, and only the
 * calculator knows the exact conversion — a line fitted through its
 * published lens table agrees in the middle of the range and drifts at the
 * edges, which is how the form came to show a Lens Factor the site would
 * never produce. So the site is asked. Answers are cached server-side, so
 * the same value costs one page load once.
 */
export interface ConstantPair {
  lensFactor?: string;
  aConstant?: string;
}

export async function convertConstant(
  input: { aConstant: number } | { lensFactor: number },
): Promise<ConstantPair> {
  const query =
    "aConstant" in input ? `aConstant=${input.aConstant}` : `lensFactor=${input.lensFactor}`;
  const res = await fetch(`${API_BASE}/api/constants?${query}`);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? "The calculator didn't answer.");
  }
  return res.json();
}

/**
 * Parks a day's work on the server under a short code, so it can be picked
 * up on the other machine. The server keeps it in memory only, for the
 * working day, and forgets it the moment it is collected.
 */
export async function parkHandoff(payload: unknown): Promise<{ code: string; expiresAt: number }> {
  const res = await fetch(`${API_BASE}/api/handoff`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `Couldn't save the work (${res.status}).`);
  }
  return res.json();
}

export async function collectHandoff(code: string): Promise<unknown> {
  const res = await fetch(`${API_BASE}/api/handoff/${encodeURIComponent(code.trim())}`);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `Couldn't open that code (${res.status}).`);
  }
  const body = (await res.json()) as { payload?: unknown };
  return body.payload;
}

/** How often the app asks whether a calculation has finished. */
const JOB_POLL_MS = 1500;

/**
 * Long enough for the three minutes a security check is allowed to wait,
 * plus the run itself and some slack.
 */
const JOB_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Runs a calculation without holding a connection open while it happens.
 *
 * The automation needs 10–30 seconds normally, and up to three minutes when
 * the calculator's site raises a security check and waits for someone to
 * complete it. A single request held open that long survives on localhost
 * and nowhere else: a tunnel, a proxy or a firewall cuts it, and what comes
 * back is the proxy's error page rather than a result — which is what a
 * Cloudflare tunnel did, returning its own 502 after about a hundred
 * seconds.
 *
 * So the server is asked to *start* a calculation, and then asked every
 * couple of seconds how it went. Every exchange is short, which is the only
 * thing anything in between cares about. The signature is unchanged, so
 * callers neither know nor care.
 */
export async function calculateBarrett(payload: CalculateRequest): Promise<CalculateResponse> {
  const started = await fetch(`${API_BASE}/api/calculate/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!started.ok) {
    const body = await started.text().catch(() => "");
    throw new Error(`Backend returned ${started.status}${body ? `: ${body}` : ""}`);
  }
  const { jobId } = (await started.json()) as { jobId?: string };
  if (!jobId) throw new Error("The server did not start the calculation.");

  const deadline = Date.now() + JOB_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, JOB_POLL_MS));

    const res = await fetch(`${API_BASE}/api/calculate/jobs/${jobId}`);
    if (!res.ok) {
      // A poll that fails is not a failed calculation — a phone changing
      // network, or a tunnel blinking, must not discard a run that is still
      // going. Keep asking until the deadline.
      if (res.status === 404) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "The server lost track of that calculation.");
      }
      continue;
    }

    const job = (await res.json()) as { status: string; result?: CalculateResponse; error?: string };
    if (job.status === "done" && job.result) return job.result;
    if (job.status === "failed") throw new Error(job.error ?? "The calculation failed.");
  }

  throw new Error(
    "The calculation is taking longer than five minutes. It may still be running on the " +
      "server — check the calculator site, or press Calculate again.",
  );
}

/**
 * The consultation form: reading one, and storing a reviewed one.
 *
 * The field list is fetched rather than duplicated here — the backend
 * generates the extraction schema from the same list, so a field added to
 * the paper form turns up in the review screen without anything being kept
 * in step by hand.
 */
export interface FormFieldSpec {
  key: string;
  label: string;
  kind?: "text" | "number";
  options?: string[];
  detailFor?: string;
}

export interface FormSectionSpec {
  key: string;
  title: string;
  coded: FormFieldSpec[];
  text: FormFieldSpec[];
  perEye?: FormFieldSpec[];
}

export async function fetchFormFields(): Promise<FormSectionSpec[]> {
  const res = await fetch(`${API_BASE}/api/forms/fields`);
  if (!res.ok) throw new Error(`Couldn't load the form's fields (${res.status}).`);
  const body = (await res.json()) as { sections?: FormSectionSpec[] };
  return body.sections ?? [];
}

export interface FormScanResult {
  form: Record<string, Record<string, unknown>>;
  /** `section.field` keys the model couldn't read — shown as "not read". */
  unread: string[];
}

/**
 * Reads a photographed or uploaded form, as a job.
 *
 * It used to be one long request, and the first real form anyone tried came
 * back as **"Couldn't read that form (502)."** — which was not our server
 * answering at all. The read outlasted the tunnel's patience and Cloudflare
 * served its own error page; the app, finding no JSON in it, fell back to
 * printing the status code. Now the submit returns at once and this polls,
 * so nothing in between has a long connection to give up on.
 */
export async function scanFormPhoto(
  imageBase64: string,
  mediaType: string,
): Promise<FormScanResult> {
  const started = await fetch(`${API_BASE}/api/forms/scan/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imageBase64, mediaType }),
  });
  if (started.status === 503) {
    throw new ScanUnavailableError("Reading forms is not configured on the server.");
  }
  if (!started.ok) throw new Error(await describeFailure(started, "start reading that form"));

  const { id } = (await started.json()) as { id?: string };
  if (!id) throw new Error("The server did not start reading the form.");

  const deadline = Date.now() + JOB_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, JOB_POLL_MS));

    const res = await fetch(`${API_BASE}/api/forms/scan/jobs/${id}`);
    if (!res.ok) {
      // A failed poll is not a failed read — a phone changing network, or a
      // tunnel blinking, must not discard work that is still going.
      if (res.status === 404) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "The server lost track of that form.");
      }
      continue;
    }

    const job = (await res.json()) as { status: string; result?: FormScanResult; error?: string };
    if (job.status === "done" && job.result) return job.result;
    if (job.status === "failed") throw new Error(job.error ?? "Could not read that form.");
  }

  throw new Error(
    "Reading this form is taking longer than five minutes. Try a clearer photo, or type the " +
      "form in by hand.",
  );
}

/**
 * Says which thing went wrong, rather than only that something did.
 *
 * Our own errors are JSON with a sentence in them. A gateway that gave up
 * answers with an HTML page, and printing "(502)" for that tells the
 * clinician nothing they can act on — the two have completely different
 * remedies, so they get completely different sentences.
 */
async function describeFailure(res: Response, attempting: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  if (body?.error) return body.error;
  if (res.status === 502 || res.status === 503 || res.status === 504) {
    return (
      `The connection to the server gave up while trying to ${attempting}. ` +
      "Nothing was lost — wait a moment and try again. If it keeps happening, the tunnel may " +
      "need restarting on the computer running the app."
    );
  }
  return `Couldn't ${attempting} (${res.status}).`;
}

export interface StoredPatient {
  id: number;
  /** Digits only. `formatCpf` in lib/cpf.ts puts the punctuation back. */
  cpf?: string;
  name: string;
  dateOfBirth?: string;
  ageYears?: number;
  updatedAt: string;
}

/**
 * What a scanned identity means.
 *
 * Says *how* it matched, because the two keys are different things: `cpf` is
 * a number with check digits, `nameAndBirth` is the clinic's second key for
 * a patient whose CPF is blank or unreadable. "The CPF matches a patient
 * whose name doesn't" has its own answer on purpose: it is one misread digit
 * away from filing this consultation under somebody else, and it must reach
 * a person rather than be resolved.
 */
export type PatientMatch =
  | { kind: "none" }
  | { kind: "match"; patient: StoredPatient; by: "cpf" | "nameAndBirth" }
  | { kind: "nameMismatch"; patient: StoredPatient; scannedName: string }
  | { kind: "byNameOnly"; candidates: StoredPatient[] };

/**
 * The answer also carries `cpfValid`, so the screen can say a CPF's check
 * digits don't add up without a second copy of the mod-11 rule living here.
 */
export async function lookupPatient(query: {
  cpf?: string;
  name?: string;
  dateOfBirth?: string;
}): Promise<PatientMatch & { cpfValid?: boolean }> {
  const params = new URLSearchParams();
  if (query.cpf) params.set("cpf", query.cpf);
  if (query.name) params.set("name", query.name);
  if (query.dateOfBirth) params.set("dob", query.dateOfBirth);
  const res = await fetch(`${API_BASE}/api/patients?${params}`);
  if (!res.ok) throw new Error(`Couldn't check that patient (${res.status}).`);
  return res.json();
}

/**
 * Thrown when the CPF is already stored against a different name.
 *
 * Not an error to report and move past: the screen shows both names, and
 * saving again with `confirmMerge` is a person deciding they are the same
 * patient. Nothing merges two people on the strength of a number alone.
 */
export class NameMismatchError extends Error {
  readonly patient: StoredPatient | undefined;
  readonly scannedName: string;

  constructor(message: string, patient: StoredPatient | undefined, scannedName: string) {
    super(message);
    this.name = "NameMismatchError";
    this.patient = patient;
    this.scannedName = scannedName;
  }
}

export async function savePatient(input: {
  cpf?: string;
  name: string;
  dateOfBirth?: string;
  ageYears?: number;
  prontuario?: string;
  seenOn?: string;
  /** Omit to register the patient without recording a visit. */
  form?: unknown;
  confirmMerge?: boolean;
}): Promise<{ patient: StoredPatient; cpfValid?: boolean }> {
  const res = await fetch(`${API_BASE}/api/patients`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (res.status === 409) {
    const body = await res.json().catch(() => null);
    throw new NameMismatchError(
      body?.error ?? "This CPF is stored under a different name.",
      body?.patient,
      body?.scannedName ?? input.name,
    );
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `Couldn't save this consultation (${res.status}).`);
  }
  return res.json();
}

export interface StoredConsultation {
  id: number;
  seenOn?: string;
  prontuario?: string;
  form: Record<string, Record<string, unknown>>;
  createdAt: string;
}

export interface StoredExam {
  id: number;
  measuredOn?: string;
  exam: unknown;
  createdAt: string;
}

/** One patient with both halves of their record. */
export async function fetchPatient(id: number): Promise<{
  patient: StoredPatient;
  consultations: StoredConsultation[];
  exams: StoredExam[];
}> {
  const res = await fetch(`${API_BASE}/api/patients/${id}`);
  if (!res.ok) throw new Error(`Couldn't load that patient (${res.status}).`);
  return res.json();
}

/**
 * Stores what was measured, against the patient it belongs to.
 *
 * Until this existed the calculation left the app as a download and nothing
 * here remembered it, so a stored patient was a consultation with a gap
 * after it.
 */
export async function saveExam(
  patientId: number,
  input: { measuredOn?: string; exam: unknown },
): Promise<StoredExam> {
  const res = await fetch(`${API_BASE}/api/patients/${patientId}/exams`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `Couldn't save this exam (${res.status}).`);
  }
  return res.json();
}

/** The whole database as one file — the backup, until there's a better one. */
export function databaseExportUrl(): string {
  return `${API_BASE}/api/export`;
}
