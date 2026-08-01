import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type Frame, type Locator, type Page } from "playwright";
import type { CalculateRequest, CalculateResponse, EyeInput, IolTableRow } from "./types.js";

export const CALCULATOR_URL = "https://calc.apacrs.org/barrett_universal2105/";

/**
 * Field labels transcribed from screenshots of the live calculator
 * ("Barrett Universal II Formula V1.05", July 2026). The form is a single
 * page for both eyes — no frames (confirmed by a live diagnostic run):
 * each measurement row has the label once per eye column, OD's "(R)" input
 * before OS's "(L)" in document order.
 *
 * Lens Factor and A Constant are form-wide singles and the form reads
 * "Lens Factor ... or A Constant" — they are alternatives, so only Lens
 * Factor is filled; the user's verified manual run shows the site pairing
 * Lens Factor 1.57 with A Constant 118.4, so the derived value matches
 * this practice's constants. Patient Name is required by the site before
 * it will render the "Recommended IOL" summary, so it is always filled
 * with a neutral "-" placeholder — never real patient data. Doctor Name
 * and Patient ID stay blank (they were blank on the successful manual run).
 */
const PER_EYE_FIELDS = {
  axialLength: ["Axial Length"],
  k1: ["Measured K1"],
  k2: ["Measured K2"],
  acd: ["Optical ACD"],
  targetRefraction: ["Refraction"],
  lensThickness: ["Lens Thickness"],
} as const;

const LENS_FACTOR_LABELS = ["Lens Factor"] as const;

/** Label text that must exist wherever the form actually renders. */
const FORM_ANCHOR = "Axial Length";

/**
 * Text that only appears once the calculation has actually run. A verified
 * live run showed the results view carries "IOL Power | Optic | Refraction"
 * tables even when the "Recommended IOL" summary line is absent (that line
 * only renders when Patient Name is filled), so the tables are the anchor.
 */
const RESULTS_ANCHOR = /IOL Power/i;

const PATIENT_NAME_LABELS = ["Patient Name"] as const;
const IDENTITY_PLACEHOLDER = "-";

/** Where failure screenshots/HTML dumps land; contains clinical numbers only, never PHI. */
const DIAGNOSTICS_DIR = "diagnostics";

type PerEyeField = keyof typeof PER_EYE_FIELDS;
type SearchRoot = Page | Frame;

/** A control that was filled, kept so the value can be read back and verified. */
interface FilledEntry {
  field: string;
  locator: Locator;
  expected: string;
}

/** Fills a located control regardless of whether it's a text input, a <select>, or a radio/checkbox. */
async function setLocatorValue(locator: Locator, value: string): Promise<void> {
  const tagName = await locator.evaluate((el) => el.tagName.toLowerCase());

  if (tagName === "select") {
    try {
      await locator.selectOption({ label: value });
    } catch {
      await locator.selectOption(value);
    }
    return;
  }

  const inputType = await locator.evaluate((el) => (el as HTMLInputElement).type ?? "");
  if (inputType === "radio" || inputType === "checkbox") {
    await locator.check();
    return;
  }

  await locator.fill(value);
}

/**
 * Finds where the form actually lives: polls the page and every (i)frame,
 * in case the form arrives late or sits in an embedded document. On the
 * first miss it also tries clicking a "Patient Data" tab in case the form
 * only renders once that tab is active.
 */
async function findFormRoot(page: Page, timeoutMs: number): Promise<SearchRoot | null> {
  const deadline = Date.now() + timeoutMs;
  let triedTabClick = false;

  while (Date.now() < deadline) {
    const roots: SearchRoot[] = [page, ...page.frames()];
    for (const root of roots) {
      const count = await root
        .getByText(FORM_ANCHOR, { exact: false })
        .count()
        .catch(() => 0);
      if (count > 0) return root;
    }

    if (!triedTabClick) {
      triedTabClick = true;
      await page
        .getByText("Patient Data", { exact: false })
        .first()
        .click({ timeout: 2000 })
        .catch(() => {});
    }

    await page.waitForTimeout(500);
  }
  return null;
}

/** Collects what the page actually served, for actionable error messages. */
async function describePage(page: Page): Promise<string> {
  const title = await page.title().catch(() => "(unreadable)");
  const frameUrls = page
    .frames()
    .map((f) => f.url())
    .filter((u) => u && u !== "about:blank");
  const bodyText = await page
    .locator("body")
    .innerText({ timeout: 3000 })
    .then((t) => t.replace(/\s+/g, " ").trim().slice(0, 800))
    .catch(() => "(unreadable)");
  return (
    `page title: "${title}"; url: ${page.url()}; ` +
    `frames: [${frameUrls.join(", ") || "none"}]; visible text starts with: "${bodyText}"`
  );
}

/** Saves a full-page screenshot + HTML dump for offline inspection; returns their paths. */
async function saveDiagnostics(page: Page, tag: string): Promise<string> {
  try {
    const dir = path.resolve(DIAGNOSTICS_DIR);
    await mkdir(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const pngPath = path.join(dir, `${tag}-${stamp}.png`);
    const htmlPath = path.join(dir, `${tag}-${stamp}.html`);
    await page.screenshot({ path: pngPath, fullPage: true });
    await writeFile(htmlPath, await page.content());
    return `saved page screenshot and HTML to ${pngPath} / ${htmlPath}`;
  } catch (err) {
    return `couldn't save diagnostics files (${err instanceof Error ? err.message : err})`;
  }
}

/**
 * Finds the Nth control for a visible label. Tries an accessible
 * label association first; the page predates those conventions, so the
 * workhorse is the fallback: anchor on the Nth occurrence of the label
 * text and take the first form control after it in document order.
 */
async function locateByLabelText(
  root: SearchRoot,
  labels: readonly string[],
  occurrence: number,
): Promise<Locator | null> {
  for (const label of labels) {
    const byLabel = root.getByLabel(label, { exact: false });
    if ((await byLabel.count()) > occurrence) {
      return byLabel.nth(occurrence);
    }

    const anchors = root.getByText(label, { exact: false });
    if ((await anchors.count()) > occurrence) {
      const control = anchors
        .nth(occurrence)
        .locator("xpath=following::*[self::input or self::select][not(@type='hidden')][1]");
      if ((await control.count()) > 0) {
        return control.first();
      }
    }
  }
  return null;
}

async function fillEye(
  root: SearchRoot,
  eye: EyeInput,
  eyeIndex: 0 | 1,
  filled: FilledEntry[],
): Promise<string[]> {
  const attempts: Array<[PerEyeField, string]> = [
    ["axialLength", String(eye.biometry.axialLength)],
    ["k1", String(eye.keratometry.k1)],
    ["k2", String(eye.keratometry.k2)],
    ["acd", String(eye.biometry.acd)],
    ["targetRefraction", String(eye.manual.targetRefraction)],
  ];
  if (eye.biometry.lensThickness !== undefined) {
    attempts.push(["lensThickness", String(eye.biometry.lensThickness)]);
  }

  const missing: string[] = [];
  for (const [field, value] of attempts) {
    const control = await locateByLabelText(root, PER_EYE_FIELDS[field], eyeIndex);
    if (control) {
      await setLocatorValue(control, value);
      filled.push({ field: `${eye.side} ${field}`, locator: control, expected: value });
    } else {
      missing.push(`${eye.side} ${field}`);
    }
  }
  return missing;
}

async function fillLensFactor(
  root: SearchRoot,
  request: CalculateRequest,
  filled: FilledEntry[],
): Promise<string[]> {
  // Only Lens Factor — see the header comment for why A Constant stays empty.
  // Validation guarantees at least one eye; both carry the same fixed IOL.
  const anyEye = request.od ?? request.os;
  if (!anyEye) return ["lensFactor"];
  const value = String(anyEye.iol.lensFactor);
  const control = await locateByLabelText(root, LENS_FACTOR_LABELS, 0);
  if (!control) return ["lensFactor"];
  await setLocatorValue(control, value);
  filled.push({ field: "lensFactor", locator: control, expected: value });
  return [];
}

async function fillPatientPlaceholder(root: SearchRoot, filled: FilledEntry[]): Promise<string[]> {
  // The site requires a non-empty Patient Name before it renders the
  // "Recommended IOL" summary. A neutral placeholder goes in — never real
  // patient data.
  const control = await locateByLabelText(root, PATIENT_NAME_LABELS, 0);
  if (!control) return ["patientName"];
  await setLocatorValue(control, IDENTITY_PLACEHOLDER);
  filled.push({ field: "patientName", locator: control, expected: IDENTITY_PLACEHOLDER });
  return [];
}

/**
 * Reads every filled control back and reports any whose value differs
 * numerically from what was written — the guard against values silently
 * landing in the wrong boxes (or being wiped by the page's own scripts).
 */
async function verifyFills(filled: FilledEntry[]): Promise<string[]> {
  const mismatches: string[] = [];
  for (const entry of filled) {
    const actual = await entry.locator.inputValue().catch(() => "(unreadable)");
    const same =
      actual === entry.expected ||
      (Number.isFinite(Number(actual)) && Number(actual) === Number(entry.expected));
    if (!same) {
      mismatches.push(`${entry.field}: wrote "${entry.expected}" but field now contains "${actual}"`);
    }
  }
  return mismatches;
}

async function clickCalculate(root: SearchRoot): Promise<void> {
  const byRole = root.getByRole("button", { name: /^calculate$/i });
  if ((await byRole.count()) > 0) {
    await byRole.first().click();
    return;
  }
  // Older pages often use <input type="submit" value="Calculate">.
  await root.locator('input[type="submit"][value*="alculate"], input[type="button"][value*="alculate"]').first().click();
}

/**
 * True when the root shows the results tables with actual numbers in them —
 * bare "IOL Power" headers on an empty results view don't count.
 */
async function resultsReady(root: SearchRoot): Promise<boolean> {
  const count = await root
    .getByText(RESULTS_ANCHOR)
    .count()
    .catch(() => 0);
  if (count === 0) return false;
  const body = await root
    .locator("body")
    .innerText({ timeout: 3000 })
    .catch(() => "");
  const start = body.search(RESULTS_ANCHOR);
  return start >= 0 && /\d/.test(body.slice(start));
}

/** Polls the page and every frame until populated results appear. */
async function findResultsRoot(page: Page, timeoutMs: number): Promise<SearchRoot | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const roots: SearchRoot[] = [page, ...page.frames()];
    for (const root of roots) {
      if (await resultsReady(root)) return root;
    }
    await page.waitForTimeout(500);
  }
  return null;
}

interface ExtractedResults {
  text: string;
  od?: string;
  os?: string;
  tables?: { od: IolTableRow[]; os: IolTableRow[] };
}

const NUMBER_TOKEN = /^-?\d+(?:\.\d+)?$/;

/**
 * Parses one table section's "power optic refraction" row triplets from a
 * whitespace token stream — resilient to innerText putting cells on one
 * line or several. Stops at the first token run that doesn't fit the
 * pattern (i.e. whatever text follows the table).
 */
function parseTableRows(section: string): IolTableRow[] {
  const tokens = section.trim().split(/\s+/);
  const rows: IolTableRow[] = [];
  let i = 0;
  while (i < tokens.length) {
    if (!NUMBER_TOKEN.test(tokens[i])) break;
    const power = tokens[i++];
    const optic: string[] = [];
    while (i < tokens.length && !NUMBER_TOKEN.test(tokens[i])) optic.push(tokens[i++]);
    if (i >= tokens.length || optic.length === 0) break;
    rows.push({ power, optic: optic.join(" "), refraction: tokens[i++] });
  }
  return rows;
}

/**
 * Splits the results text at each table header; OD's table precedes OS's in
 * document order. In a single-eye run the uncalculated side's table renders
 * with headers but no rows, so one side may legitimately come back empty.
 */
function parseTables(text: string): ExtractedResults["tables"] {
  const sections = text.split(/IOL Power\s+Optic\s+Refraction/i).slice(1);
  if (sections.length < 2) return undefined;
  const od = parseTableRows(sections[0]);
  const os = parseTableRows(sections[1]);
  if (od.length === 0 && os.length === 0) return undefined;
  return { od, os };
}

/**
 * The results view shows an OD and an OS panel (side by side — their text
 * can interleave in innerText order), each with an IOL Power / Optic /
 * Refraction table and, when Patient Name was filled, a "Recommended IOL:
 * <power> (<optic>) for Target Refraction:<n>" summary. The OD summary
 * precedes the OS one in document order — but in a single-eye run only the
 * calculated eye's summary renders at all, so the requested sides decide
 * which eye each match belongs to. The two tables always render (the
 * uncalculated one just has no rows), so table position still maps to eye.
 */
async function extractResults(
  root: SearchRoot,
  requested: { od: boolean; os: boolean },
): Promise<ExtractedResults> {
  const body = (await root.locator("body").innerText()).trim();

  const eyeStart = body.search(/(Right|Left) Eye\s*\(O[DS]\)/i);
  const tableStart = body.search(RESULTS_ANCHOR);
  const start = eyeStart >= 0 ? eyeStart : tableStart >= 0 ? tableStart : 0;
  const text = body.slice(start, start + 6000).trim();

  const recommendations = [...body.matchAll(/Recommended IOL:\s*(-?[\d.]+)/gi)].map((m) => m[1]);
  let od: string | undefined;
  let os: string | undefined;
  if (requested.od && requested.os) {
    od = recommendations[0];
    os = recommendations[1];
  } else if (requested.od) {
    od = recommendations[0];
  } else {
    os = recommendations[0];
  }

  let tables = parseTables(body);
  // Sanity: rows must appear exactly for the calculated side(s); anything
  // else means the layout changed, so fall back to the raw text.
  if (tables && (requested.od !== tables.od.length > 0 || requested.os !== tables.os.length > 0)) {
    tables = undefined;
  }

  return { text, od, os, tables };
}

/**
 * calc.apacrs.org sits behind Cloudflare bot protection (confirmed by an
 * inspect run that received the "Just a moment..." Turnstile challenge).
 * This automation deliberately does NOT try to evade that protection.
 * Runs start in an invisible browser; when Cloudflare challenges — it's
 * intermittent — the run restarts in a visible window so the clinician can
 * complete the verification by hand (a real human, present at the
 * machine), and the automation carries on once the calculator appears.
 * Set BARRETT_HEADLESS=1 to forbid the visible fallback (challenged runs
 * then fail with a clear error).
 */
const HEADLESS_ONLY = process.env.BARRETT_HEADLESS === "1";

/** How long the clinician gets to complete Cloudflare's check in the visible window. */
const CHALLENGE_WAIT_MS = 180000;

/** Raised when the invisible attempt hits Cloudflare, to trigger the visible retry. */
class CloudflareChallengedError extends Error {
  constructor() {
    super(
      "calc.apacrs.org is showing its Cloudflare security check, which an invisible browser " +
        "cannot pass. Unset BARRETT_HEADLESS to allow the visible-window fallback where the " +
        "check can be completed by hand.",
    );
  }
}

async function isChallengePage(page: Page): Promise<boolean> {
  const title = await page.title().catch(() => "");
  if (/just a moment/i.test(title)) return true;
  const text = await page
    .locator("body")
    .innerText({ timeout: 2000 })
    .catch(() => "");
  return /performing security verification|verify you are not a bot|cloudflare/i.test(text);
}

export async function runBarrettCalculation(request: CalculateRequest): Promise<CalculateResponse> {
  try {
    return await attemptCalculation(request, true);
  } catch (err) {
    if (err instanceof CloudflareChallengedError && !HEADLESS_ONLY) {
      console.log(
        "Cloudflare challenged the invisible browser — retrying in a visible window. " +
          "Click the verification checkbox when it appears.",
      );
      return await attemptCalculation(request, false);
    }
    throw err;
  }
}

async function attemptCalculation(
  request: CalculateRequest,
  headless: boolean,
): Promise<CalculateResponse> {
  const browser = await chromium.launch({ headless });
  try {
    const page = await browser.newPage();

    // Old ASP.NET validators often report problems via alert() popups that
    // never appear in the DOM — capture them so failures can name the reason.
    const dialogMessages: string[] = [];
    page.on("dialog", (dialog) => {
      dialogMessages.push(dialog.message());
      dialog.accept().catch(() => {});
    });

    await page.goto(CALCULATOR_URL, { waitUntil: "domcontentloaded", timeout: 30000 });

    let formRoot = await findFormRoot(page, 15000);
    if (!formRoot && (await isChallengePage(page))) {
      if (headless) {
        throw new CloudflareChallengedError();
      }
      // Visible window: give the clinician time to click the verification.
      console.log(
        "Cloudflare is verifying the browser — if a checkbox appears in the opened window, " +
          "click it. Waiting up to 3 minutes for the calculator to load...",
      );
      formRoot = await findFormRoot(page, CHALLENGE_WAIT_MS);
    }

    if (!formRoot) {
      throw new Error(
        `Couldn't find the calculator form (no "${FORM_ANCHOR}" text anywhere on the page or its ` +
          `frames). What was actually served — ${await describePage(page)}. If this mentions ` +
          `Cloudflare or security verification, the check wasn't completed in time — try again and ` +
          `complete it in the browser window that opens; otherwise run "npm run inspect" ` +
          `(backend/README.md) and update the selectors from its output.`,
      );
    }

    const filled: FilledEntry[] = [];
    const missing = [
      ...(await fillPatientPlaceholder(formRoot, filled)),
      ...(await fillLensFactor(formRoot, request, filled)),
      ...(request.od ? await fillEye(formRoot, request.od, 0, filled) : []),
      ...(request.os ? await fillEye(formRoot, request.os, 1, filled) : []),
    ];

    if (missing.length > 0) {
      throw new Error(
        `Found the calculator form but couldn't locate these fields, so nothing was submitted: ` +
          `${missing.join(", ")}. Diagnostic — ${await describePage(page)}. Run "npm run inspect" ` +
          `(backend/README.md) and update the selectors from its output.`,
      );
    }

    // Never submit values that didn't land where they were aimed — a wrong
    // box here means a wrong surgical calculation downstream.
    const mismatches = await verifyFills(filled);
    if (mismatches.length > 0) {
      const saved = await saveDiagnostics(page, "misfill");
      throw new Error(
        `Aborted before calculating: some values did not end up in the fields they were aimed at — ` +
          `${mismatches.join("; ")}. The selector heuristics need adjusting (${saved}; see ` +
          `backend/README.md).`,
      );
    }

    await clickCalculate(formRoot);
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});

    // Results might have been computed but left on an inactive tab.
    let resultsRoot = await findResultsRoot(page, 10000);
    if (!resultsRoot) {
      await page
        .getByText("Universal Formula", { exact: false })
        .first()
        .click({ timeout: 3000 })
        .catch(() => {});
      resultsRoot = await findResultsRoot(page, 6000);
    }

    if (!resultsRoot) {
      const saved = await saveDiagnostics(page, "no-results");
      const dialogNote = dialogMessages.length
        ? ` The site raised these popup messages: "${dialogMessages.join('", "')}".`
        : " No popup messages were raised.";
      throw new Error(
        `The form was filled (all values verified in their fields) and Calculate was clicked, but no ` +
          `"Recommended IOL" results ever appeared.${dialogNote} What the page displayed — ` +
          `${await describePage(page)}. ${saved} — open the .png to see the exact page state.`,
      );
    }

    // Verified end-to-end 2026-08-01: a live automated run returned tables
    // identical to a manual run on the official site with the same inputs.
    const { text, od, os, tables } = await extractResults(resultsRoot, {
      od: request.od !== undefined,
      os: request.os !== undefined,
    });
    return { resultsText: text, recommended: { od, os }, tables };
  } finally {
    await browser.close();
  }
}
