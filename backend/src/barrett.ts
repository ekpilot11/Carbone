import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type BrowserContext, type Frame, type Locator, type Page } from "playwright";
import { DEFAULT_K_INDEX, K_INDEX_OPTIONS, PERSONAL_CONSTANT } from "./constants.js";
import type { CalculateRequest, CalculateResponse, EyeInput, IolTableRow } from "./types.js";

/**
 * Overridable only so the automation can be exercised against a local
 * stand-in for the site (see scripts/mockCalculator.ts) — every real run
 * uses the official calculator.
 */
export const CALCULATOR_URL =
  process.env.BARRETT_URL ?? "https://calc.apacrs.org/barrett_universal2105/";

/**
 * Field labels transcribed from screenshots of the live calculator
 * ("Barrett Universal II Formula V1.05", July 2026). The form is a single
 * page for both eyes — no frames (confirmed by a live diagnostic run):
 * each measurement row has the label once per eye column, OD's "(R)" input
 * before OS's "(L)" in document order.
 *
 * The lens dropdown, Lens Factor and A Constant are form-wide singles, and
 * the form reads "Lens Factor ... or A Constant" — the page derives one
 * from the other. Both are filled on a personal-constant run, A Constant
 * first so the Lens Factor is written last (that ordering is what the
 * end-to-end verified run did); if the page rewrites either, the value it
 * settled on is read back and reported rather than treated as an error.
 * Choosing a named lens instead leaves both boxes to the site, which fills
 * them with that lens's constants — none of those constants are
 * transcribed into this codebase, where they could go stale.
 * Patient Name is required by the site before
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
  // The form's "Optional:" block, below the measurements.
  lensThickness: ["Lens Thickness"],
  wtw: ["WTW", "White to White"],
} as const;

const LENS_FACTOR_LABELS = ["Lens Factor"] as const;

/** The keratometric index radio pair at the top of the form. */
const K_INDEX_LABEL = (kIndex: string) => `K Index ${kIndex}`;
const A_CONSTANT_LABELS = ["A Constant", "A-Constant"] as const;

/**
 * The bands the form prints beside its two constants: "(-2.0~5.0)" for the
 * Lens Factor and "(112~125)" for the A Constant. They do more than reject
 * bad input — the form labels the pair together ("Lens Factor ... or A
 * Constant"), so a label-anchored lookup can land on the wrong box, and the
 * value itself is what tells them apart. Nothing else on the form comes
 * near the A-constant band (axial lengths ~22, K ~44, ACD ~3).
 */
const CONSTANT_RANGES = {
  lensFactor: { min: -2, max: 5 },
  aConstant: { min: 112, max: 125 },
} as const;

function inConstantRange(value: string, range: { min: number; max: number }): boolean {
  const parsed = Number(value);
  return (
    value.trim() !== "" && Number.isFinite(parsed) && parsed >= range.min && parsed <= range.max
  );
}

function looksLikeAConstant(value: string): boolean {
  return inConstantRange(value, CONSTANT_RANGES.aConstant);
}

/**
 * The lens dropdown carries no usable label of its own, so it is found by
 * its contents instead: it is the one <select> offering the "Personal
 * Constant" option (the site's own name for "use the constants I typed").
 */
const LENS_OPTION_MARKER = /personal constant/i;

/** Label text that must exist wherever the form actually renders. */
const FORM_ANCHOR = "Axial Length";

/**
 * Text that only appears once the calculation has actually run. A verified
 * live run showed the results view carries "IOL Power | Optic | Refraction"
 * tables even when the "Recommended IOL" summary line is absent (that line
 * only renders when Patient Name is filled), so the tables are the anchor.
 */
const RESULTS_ANCHOR = /IOL Power/i;

/**
 * The site's own "the results are ready" tell: the control reading "Enter
 * Data and Calculate" becomes "View Formula" once the calculation is done.
 */
const CALCULATION_DONE_ANCHOR = /view\s+formula/i;

/** The tab the results are rendered on. */
const RESULTS_TAB_ANCHOR = "Universal Formula";

/** How often the page is re-checked while waiting for it to catch up. */
const POLL_INTERVAL_MS = 120;

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
  /**
   * Set for the two constants only. The site derives one from the other, so
   * a value that changed after being typed is the page doing its job — but
   * a value that left its own band means the text landed in the wrong box,
   * which still has to stop the run.
   */
  tolerate?: { min: number; max: number };
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

    await page.waitForTimeout(POLL_INTERVAL_MS);
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
  if (eye.biometry.wtw !== undefined) {
    attempts.push(["wtw", String(eye.biometry.wtw)]);
  }

  // Locating is read-only and by far the chatty part (several round trips
  // per field), so all of it happens at once; the fills themselves stay in
  // order, since typing into this form can trigger the page's own handlers.
  const controls = await Promise.all(
    attempts.map(([field]) => locateByLabelText(root, PER_EYE_FIELDS[field], eyeIndex)),
  );

  const missing: string[] = [];
  for (const [i, [field, value]] of attempts.entries()) {
    const control = controls[i];
    if (control) {
      await setLocatorValue(control, value);
      filled.push({ field: `${eye.side} ${field}`, locator: control, expected: value });
    } else {
      missing.push(`${eye.side} ${field}`);
    }
  }
  return missing;
}

/**
 * Empties every measurement box this run is not filling.
 *
 * Runs used to get a brand-new browser context each time, which made this
 * unnecessary — nothing could reach the form from the previous patient.
 * Keeping the profile so a Cloudflare clearance survives keeps the site's
 * session cookie and Chromium's own form memory with it, and either can put
 * the last run's numbers back on the page. A leftover axial length in the
 * eye we deliberately left out is the dangerous case: the site would
 * calculate that eye too, and hand back a confident power for an eye nobody
 * measured. So every box we aren't filling is emptied by hand and verified
 * with the rest.
 *
 * A required box that can't even be found on a skipped eye is reported like
 * any other missing field — it stops the run. The two optional boxes are
 * best-effort: they aren't on every version of the form, and a form that
 * never had a WTW field has no stale WTW to leave behind.
 */
async function clearUnusedFields(
  root: SearchRoot,
  request: CalculateRequest,
  filled: FilledEntry[],
): Promise<string[]> {
  const targets: Array<{ side: string; field: PerEyeField; eyeIndex: 0 | 1; required: boolean }> = [];
  for (const [eyeIndex, eye] of [request.od, request.os].entries()) {
    const side = eyeIndex === 0 ? "OD" : "OS";
    for (const field of Object.keys(PER_EYE_FIELDS) as PerEyeField[]) {
      const optional = field === "lensThickness" || field === "wtw";
      const supplied = eye !== undefined && !optional;
      const suppliedOptional =
        eye !== undefined &&
        (field === "lensThickness"
          ? eye.biometry.lensThickness !== undefined
          : field === "wtw"
            ? eye.biometry.wtw !== undefined
            : false);
      if (supplied || suppliedOptional) continue;
      targets.push({
        side,
        field,
        eyeIndex: eyeIndex as 0 | 1,
        required: eye === undefined && !optional,
      });
    }
  }

  const controls = await Promise.all(
    targets.map((target) => locateByLabelText(root, PER_EYE_FIELDS[target.field], target.eyeIndex)),
  );

  const missing: string[] = [];
  for (const [i, target] of targets.entries()) {
    const control = controls[i];
    if (!control) {
      if (target.required) missing.push(`${target.side} ${target.field} (to be cleared)`);
      continue;
    }
    // Only touch a box that actually holds something: an empty one needs no
    // clearing, and typing into it could wake the page's own handlers.
    const current = (await control.inputValue().catch(() => "")).trim();
    if (current === "") continue;
    await control.fill("");
    filled.push({ field: `${target.side} ${target.field} (cleared)`, locator: control, expected: "" });
  }
  return missing;
}

/**
 * Finds the radio for one keratometric index, by three routes in order of
 * how much they prove.
 *
 * The label-anchored route needs a guard the other fields don't: "K Index
 * 1.3375" and "K Index 1.332" can live in a single DOM node, and then both
 * lookups resolve to the same first radio — checking it would silently
 * calculate against the wrong index. So that route is used only when the
 * two options resolve to different controls.
 */
async function locateKIndexRadio(root: SearchRoot, kIndex: string): Promise<Locator | null> {
  // 1. The value attribute carries the index itself.
  const byValue = root.locator(`input[type=radio][value="${kIndex}"]`);
  if ((await byValue.count().catch(() => 0)) === 1) return byValue.first();

  const wanted = (K_INDEX_OPTIONS as readonly string[]).indexOf(kIndex);
  if (wanted < 0) return null;

  // 2. Label text, but only when the two labels are distinguishable.
  const located = await Promise.all(
    K_INDEX_OPTIONS.map((option) => locateByLabelText(root, [K_INDEX_LABEL(option)], 0)),
  );
  const identities = await Promise.all(
    located.map((control) =>
      control
        ? control
            .evaluate((el) => {
              const input = el as HTMLInputElement;
              return `${el.tagName}#${input.id}|${input.name}|${input.value}`;
            })
            .catch(() => null)
        : Promise.resolve(null),
    ),
  );
  if (located[wanted] && identities[0] !== null && identities[0] !== identities[1]) {
    return located[wanted];
  }

  // 3. Document order, only when the form's radios are exactly this pair.
  const radios = root.locator("input[type=radio]");
  if ((await radios.count().catch(() => 0)) === K_INDEX_OPTIONS.length) {
    return radios.nth(wanted);
  }
  return null;
}

/**
 * Selects the keratometric index radio.
 *
 * A non-default index that cannot be set aborts the run: the site would
 * quietly calculate with 1.3375 and the powers would be wrong in a way
 * nothing downstream could detect. Failing to confirm the default is only
 * reported, since that is the state the page already loads in.
 */
async function selectKIndex(root: SearchRoot, kIndex: string): Promise<string | undefined> {
  const control = await locateKIndexRadio(root, kIndex);
  if (control) {
    await control.check().catch(() => {});
    if (await control.isChecked().catch(() => false)) return undefined;
  }

  const problem =
    `Couldn't select "K Index ${kIndex}" on the calculator — the radio for it ` +
    `wasn't found, or wouldn't take the click.`;
  if (kIndex !== DEFAULT_K_INDEX) {
    throw new Error(
      `${problem} Nothing was submitted: the site would have calculated with its ` +
        `default ${DEFAULT_K_INDEX} instead, which would change every power it returned.`,
    );
  }
  return `${problem} The calculator's own default is ${DEFAULT_K_INDEX}, so the results should still be correct — but confirm the K Index on the site.`;
}

/** The lens dropdown, identified by the options it offers rather than by a label. */
async function locateLensSelect(root: SearchRoot): Promise<Locator | null> {
  const selects = root.locator("select");
  const count = await selects.count().catch(() => 0);
  for (let i = 0; i < count; i++) {
    const select = selects.nth(i);
    const texts = await select
      .locator("option")
      .allTextContents()
      .catch(() => [] as string[]);
    if (texts.some((text) => LENS_OPTION_MARKER.test(text))) return select;
  }
  return null;
}

function normaliseLensName(name: string): string {
  return name.replace(/\s+/g, " ").trim().toLowerCase();
}

export function isPersonalConstant(lens: string | undefined): boolean {
  return lens === undefined || normaliseLensName(lens) === normaliseLensName(PERSONAL_CONSTANT);
}

/**
 * Picks the requested lens in the calculator's own dropdown, so the site
 * applies that lens's constants exactly as it would for a manual run.
 *
 * Matching is exact after whitespace/case normalisation, and an unmatched
 * name aborts the run listing what the site actually offers: silently
 * falling back to another lens would return a plausible — and wrong — IOL
 * power. Returns the option text the site has selected.
 */
async function selectLens(root: SearchRoot, lens: string): Promise<string> {
  const select = await locateLensSelect(root);
  if (!select) {
    throw new Error(
      `Couldn't find the calculator's lens dropdown (no <select> offering a "${PERSONAL_CONSTANT}" ` +
        `option), so the lens "${lens}" could not be selected and nothing was submitted. Run ` +
        `"npm run inspect" (backend/README.md) and update the selectors from its output.`,
    );
  }

  const options = await select.locator("option").evaluateAll((nodes) =>
    nodes.map((node) => ({
      value: (node as HTMLOptionElement).value,
      text: (node as HTMLOptionElement).textContent ?? "",
    })),
  );
  const wanted = normaliseLensName(lens);
  const match = options.find((option) => normaliseLensName(option.text) === wanted);
  if (!match) {
    throw new Error(
      `The calculator's lens list has no option matching "${lens}", so nothing was submitted. ` +
        `It offers: ${options.map((o) => o.text.trim()).filter(Boolean).join(" | ")}.`,
    );
  }

  // Re-selecting what is already selected still fires the page's change
  // handler (and its postback), so the common case — the site loads on
  // "Personal Constant", which is also our default — skips both.
  const current = await select.inputValue().catch(() => null);
  if (current === match.value) return match.text.trim();

  await select.selectOption(match.value);
  // Selecting a lens makes the page write that lens's constants into the
  // Lens Factor / A Constant boxes, sometimes via a postback — let that
  // settle before anything else is typed, so it can't wipe the fills.
  await select
    .page()
    .waitForLoadState("networkidle", { timeout: 5000 })
    .catch(() => {});
  return match.text.trim();
}

/**
 * Where Chromium keeps its profile between runs.
 *
 * The point is the Cloudflare clearance cookie: when a person completes the
 * verification in the visible window, the cookie that proves it lands in
 * this directory and is still there after a restart, so the next run isn't
 * challenged again. Nothing is evaded — a human still solves every
 * challenge; the profile only stops the answer being thrown away.
 *
 * The clearance is bound to the IP that earned it and expires on the site's
 * schedule, so this reduces interruptions rather than removing them. The
 * directory holds calc.apacrs.org's cookies and nothing else — no patient
 * data ever reaches this browser beyond the clinical numbers typed into the
 * form — but it is still per-machine state: don't commit it or copy it
 * between hosts.
 */
const PROFILE_DIR = process.env.BARRETT_PROFILE_DIR ?? path.resolve("browser-profile");

/**
 * Launching Chromium costs the better part of a second, so headless runs
 * share one process and one profile; each run gets its own page. A visible
 * (challenge) window has to take the profile over — Chromium allows only
 * one process per profile directory, and the window solving the challenge
 * is the one whose cookie has to be kept — so the shared browser hands it
 * back first and reopens on the next run with the clearance in it.
 */
let sharedContext: BrowserContext | null = null;

/** Headless runs currently holding a page open on the shared profile. */
let activeSharedRuns = 0;

/**
 * Pinned rather than left to the window size: a challenge window is also
 * screenshotted and clicked remotely (see ActiveChallenge), and that only
 * lines up if the picture and the mouse agree on the coordinate space.
 */
const VIEWPORT = { width: 1280, height: 900 } as const;

/**
 * Opens Chromium on the persistent profile, falling back to a throwaway
 * one if the directory can't be used (another server already holds it, or
 * the disk is read-only). A run that can't keep its cookies is worth far
 * less than a run that doesn't happen.
 */
async function launchContext(headless: boolean): Promise<BrowserContext> {
  try {
    return await chromium.launchPersistentContext(PROFILE_DIR, { headless, viewport: VIEWPORT });
  } catch (err) {
    const reason = err instanceof Error ? err.message.split("\n")[0] : String(err);
    console.warn(
      `Couldn't open the browser profile at ${PROFILE_DIR} (${reason}) — continuing without it. ` +
        `Any Cloudflare verification will have to be completed again.`,
    );
    const browser = await chromium.launch({ headless });
    return await browser.newContext({ viewport: VIEWPORT });
  }
}

/** Closes a context and, when it came from a throwaway browser, that too. */
async function closeContext(context: BrowserContext): Promise<void> {
  const browser = context.browser();
  await context.close().catch(() => {});
  await browser?.close().catch(() => {});
}

async function openContext(headless: boolean): Promise<{ context: BrowserContext; shared: boolean }> {
  if (!headless) {
    // Let the runs already in flight finish before taking the profile from
    // under them; then hand it to the window the clinician will click in.
    const deadline = Date.now() + 20000;
    while (activeSharedRuns > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
    await closeSharedBrowser();
    return { context: await launchContext(false), shared: false };
  }

  if (sharedContext && sharedContext.browser()?.isConnected() !== false) {
    return { context: sharedContext, shared: true };
  }
  const context = await launchContext(true);
  // A browser that crashed or was handed over must never be handed out again.
  context.once("close", () => {
    if (sharedContext === context) sharedContext = null;
  });
  sharedContext = context;
  return { context, shared: true };
}

/** Lets the server hand the shared Chromium back on shutdown. */
export async function closeSharedBrowser(): Promise<void> {
  const context = sharedContext;
  sharedContext = null;
  if (context) await closeContext(context);
}

let cachedLensOptions: string[] | null = null;

/**
 * The lens dropdown's options, read off the live calculator so the app can
 * offer exactly the names the site accepts (its bundled list is only a
 * transcription). Cached for the process lifetime and headless-only: a lens
 * list is not worth opening a Cloudflare challenge window for, so a
 * challenged attempt just fails and the caller keeps its own list.
 */
export async function fetchLensOptions(): Promise<string[]> {
  if (cachedLensOptions) return cachedLensOptions;

  const { context, shared } = await openContext(true);
  if (shared) activeSharedRuns++;
  let page: Page | null = null;
  try {
    page = await context.newPage();
    await page.goto(CALCULATOR_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
    const root = await findFormRoot(page, 15000);
    if (!root) {
      throw new Error(`Couldn't load the calculator form — ${await describePage(page)}`);
    }
    const select = await locateLensSelect(root);
    if (!select) {
      throw new Error(`Couldn't find the lens dropdown on the calculator page`);
    }
    const options = (await select.locator("option").allTextContents())
      .map((text) => text.replace(/\s+/g, " ").trim())
      .filter((text) => text !== "");
    if (options.length === 0) throw new Error("The lens dropdown came back empty");

    cachedLensOptions = options;
    return options;
  } finally {
    await page?.close().catch(() => {});
    if (shared) activeSharedRuns--;
    else await closeContext(context);
  }
}

/**
 * What the calculator turns one constant into.
 *
 * The two boxes are one value in two units, and the conversion between them
 * is the site's, not ours. Reproducing it from a formula is how the form
 * came to show a Lens Factor that disagreed with the calculator's: a line
 * fitted through the published lens table matches near the middle and drifts
 * at the edges, so a clinician who moved the A Constant saw one number here
 * and a different one there.
 *
 * So the question is put to the calculator itself: type the value into its
 * own box, let it recompute, and read back what it decided. The answer is
 * right by construction and stays right if APACRS ever changes the
 * relationship — no table here to go stale.
 *
 * Answers are cached for the life of the process: the mapping doesn't move
 * while the server is up, and a clinician nudging a constant shouldn't wait
 * for a page load twice for the same number.
 */
const conversionCache = new Map<string, ConstantPair>();

export interface ConstantPair {
  lensFactor?: string;
  aConstant?: string;
}

export async function convertConstant(input: {
  aConstant?: number;
  lensFactor?: number;
}): Promise<ConstantPair> {
  const from: "aConstant" | "lensFactor" =
    input.aConstant !== undefined ? "aConstant" : "lensFactor";
  const value = input.aConstant ?? input.lensFactor;
  if (value === undefined || !Number.isFinite(value)) {
    throw new Error("Give either aConstant or lensFactor as a number.");
  }
  const range = CONSTANT_RANGES[from];
  if (value < range.min || value > range.max) {
    throw new Error(
      `${from === "aConstant" ? "A Constant" : "Lens Factor"} must be between ` +
        `${range.min} and ${range.max} — the band the calculator prints beside it.`,
    );
  }

  const key = `${from}:${value}`;
  const cached = conversionCache.get(key);
  if (cached) return cached;

  const { context, shared } = await openContext(true);
  if (shared) activeSharedRuns++;
  let page: Page | null = null;
  try {
    page = await context.newPage();
    await page.goto(CALCULATOR_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
    const root = await findFormRoot(page, 15000);
    if (!root) {
      throw new Error(`Couldn't load the calculator form — ${await describePage(page)}`);
    }

    const labels = from === "aConstant" ? A_CONSTANT_LABELS : LENS_FACTOR_LABELS;
    const control = await locateConstantInput(root, labels, range);
    if (!control) throw new Error(`Couldn't find the calculator's ${from} box.`);

    await setLocatorValue(control, String(value));
    // The page recomputes the partner on input, sometimes through a postback.
    await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});

    const pair: ConstantPair = {
      lensFactor: await readLensFactor(root),
      aConstant: await readAConstant(root),
    };
    if (pair.lensFactor === undefined || pair.aConstant === undefined) {
      throw new Error("The calculator didn't show both constants after the change.");
    }

    conversionCache.set(key, pair);
    return pair;
  } finally {
    await page?.close().catch(() => {});
    if (shared) activeSharedRuns--;
    else await closeContext(context);
  }
}

/**
 * Types both constants for a personal-constant run.
 *
 * A Constant goes in first and Lens Factor second, deliberately: the page
 * derives one from the other, and Lens Factor last preserves the exact
 * behaviour of the run that was verified end-to-end against the live site.
 * Whatever the page settles on is read back afterwards and reported.
 */
async function fillConstants(
  root: SearchRoot,
  request: CalculateRequest,
  filled: FilledEntry[],
): Promise<string[]> {
  // Validation guarantees at least one eye, and that both carry the same IOL.
  const anyEye = request.od ?? request.os;
  if (!anyEye) return ["lensFactor"];

  // Exactly one of the two is typed, never both.
  //
  // The form's boxes are one value in two units: typing into either makes
  // the page recompute the other. Filling both therefore means the second
  // one silently overwrites the first — which it did, in this order, so a
  // clinician who changed only the A Constant watched it revert to the value
  // derived from an untouched Lens Factor of 1.57. It looked like the field
  // did nothing, and a run went off with the wrong constant.
  //
  // So the caller says which one it means, and the site derives its partner
  // — the site's own arithmetic, not a copy of it here. Both are read back
  // afterwards and reported, so whatever it derived is visible.
  const source = anyEye.iol.constantSource ?? "lensFactor";
  const target =
    source === "aConstant"
      ? {
          field: "aConstant",
          labels: A_CONSTANT_LABELS,
          value: String(anyEye.iol.aConstant),
          tolerate: CONSTANT_RANGES.aConstant,
        }
      : {
          field: "lensFactor",
          labels: LENS_FACTOR_LABELS,
          value: String(anyEye.iol.lensFactor),
          tolerate: CONSTANT_RANGES.lensFactor,
        };

  const control = await locateConstantInput(root, target.labels, target.tolerate);
  if (!control) return [target.field];

  await setLocatorValue(control, target.value);
  // The page recomputes the partner box on input, sometimes via a postback;
  // let that settle before the measurements are typed around it.
  await control
    .page()
    .waitForLoadState("networkidle", { timeout: 5000 })
    .catch(() => {});

  filled.push({
    field: target.field,
    locator: control,
    expected: target.value,
    tolerate: target.tolerate,
  });
  return [];
}

/**
 * Finds one of the two constant boxes. Both labels live in the same node
 * ("Lens Factor ... or A Constant"), so the label-anchored control is
 * accepted only when the value it already holds belongs to that constant's
 * band; otherwise the search walks the following inputs for one that does.
 */
async function locateConstantInput(
  root: SearchRoot,
  labels: readonly string[],
  range: { min: number; max: number },
): Promise<Locator | null> {
  const labelled = await locateByLabelText(root, labels, 0);

  // Candidates, nearest-label-first: the label-anchored control, then the
  // handful of inputs that follow each label in document order. The
  // label-anchored one can be wrong when the label text sits in an ancestor
  // of the box (then "the next input" is the one *after* the whole block),
  // which is why the value decides between them.
  const candidates: Locator[] = labelled ? [labelled] : [];
  for (const label of labels) {
    const anchors = root.getByText(label, { exact: false });
    if ((await anchors.count().catch(() => 0)) === 0) continue;
    const anchor = anchors.first();
    // Both axes are needed: XPath's following:: skips descendants, so a
    // label matched on a container that *wraps* the boxes would otherwise
    // offer only the inputs after the whole block.
    for (const axis of ["descendant", "following"]) {
      const inputs = anchor.locator(`xpath=${axis}::input[not(@type='hidden')]`);
      const count = Math.min(await inputs.count().catch(() => 0), 4);
      for (let i = 0; i < count; i++) candidates.push(inputs.nth(i));
    }
  }

  // A box already holding a value of this kind identifies itself; that beats
  // any label heuristic. Only if nothing does is an empty box accepted.
  for (const candidate of candidates) {
    const value = (await candidate.inputValue().catch(() => "")).trim();
    if (inConstantRange(value, range)) return candidate;
  }
  for (const candidate of candidates) {
    const value = (await candidate.inputValue().catch(() => "")).trim();
    if (value === "") return candidate;
  }
  return labelled;
}

/**
 * The Lens Factor the page holds at submit time — typed by us for a
 * personal constant, written by the site itself for a named lens. Recorded
 * so the results can state which constant actually produced them.
 */
async function readLensFactor(root: SearchRoot): Promise<string | undefined> {
  const control = await locateByLabelText(root, LENS_FACTOR_LABELS, 0);
  if (!control) return undefined;
  const value = await control.inputValue().catch(() => "");
  return value.trim() === "" ? undefined : value.trim();
}

/**
 * The A Constant the page holds at submit time — derived by the site from
 * the Lens Factor we typed, or brought in by the named lens that was
 * selected. The record has to state it, since for a named lens it is the
 * site's number and appears nowhere else.
 *
 * Both routes to it are checked against the A-constant band, so a read that
 * lands on the wrong box comes back as unknown rather than as a wrong
 * constant printed on a clinical record.
 */
async function readAConstant(root: SearchRoot): Promise<string | undefined> {
  const labelled = await locateByLabelText(root, A_CONSTANT_LABELS, 0);
  if (labelled) {
    const value = (await labelled.inputValue().catch(() => "")).trim();
    if (looksLikeAConstant(value)) return value;
  }

  // The label sits in the same node as "Lens Factor" on this form, so fall
  // back to the values themselves: exactly one field should be in the band.
  const values = await root
    .locator("input:not([type=hidden])")
    .evaluateAll((nodes) => nodes.map((node) => (node as HTMLInputElement).value))
    .catch(() => [] as string[]);
  const candidates = [...new Set(values.map((value) => value.trim()).filter(looksLikeAConstant))];
  return candidates.length === 1 ? candidates[0] : undefined;
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
  const actuals = await Promise.all(
    filled.map((entry) => entry.locator.inputValue().catch(() => "(unreadable)")),
  );

  const mismatches: string[] = [];
  for (const [i, entry] of filled.entries()) {
    const actual = actuals[i];
    // A box that was cleared has to be empty, not merely numerically equal:
    // Number("") is 0, so the numeric comparison below would accept a
    // leftover "0" as a successful clear.
    if (entry.expected === "") {
      if (actual.trim() !== "") {
        mismatches.push(`${entry.field}: cleared it, but the field now contains "${actual}"`);
      }
      continue;
    }
    const same =
      actual === entry.expected ||
      (Number.isFinite(Number(actual)) && Number(actual) === Number(entry.expected)) ||
      // The constants are linked on the page; a value the site recalculated
      // is fine as long as it is still a value of the right kind.
      (entry.tolerate !== undefined && inConstantRange(actual, entry.tolerate));
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
  do {
    const roots: SearchRoot[] = [page, ...page.frames()];
    for (const root of roots) {
      if (await resultsReady(root)) return root;
    }
    await page.waitForTimeout(POLL_INTERVAL_MS);
  } while (Date.now() < deadline);
  return null;
}

async function hasText(page: Page, pattern: RegExp): Promise<boolean> {
  for (const root of [page, ...page.frames()]) {
    const count = await root
      .getByText(pattern)
      .count()
      .catch(() => 0);
    if (count > 0) return true;
  }
  return false;
}

/**
 * Waits for the calculation itself to finish.
 *
 * The site flips its "Enter Data and Calculate" control to "View Formula"
 * the moment the results exist — an exact signal, where waiting for the
 * network to fall idle just burned its whole timeout on a page that never
 * goes quiet. Returns false if the signal never appears, so the caller can
 * fall back to polling for the results themselves.
 */
async function waitForCalculationDone(page: Page, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  do {
    if (await hasText(page, CALCULATION_DONE_ANCHOR)) return true;
    await page.waitForTimeout(POLL_INTERVAL_MS);
  } while (Date.now() < deadline);
  return false;
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

/**
 * The visible window, published so it can be reached from somewhere else.
 *
 * On a clinician's own machine the window simply appears and they click the
 * checkbox in it. On a hosted server nobody is sitting in front of that
 * window — and the clearance is bound to the server's IP, so it cannot be
 * solved anywhere else. So while a visible attempt is running, its page is
 * offered as frames the app can display and clicks it can forward: a person
 * still solves the challenge with their own eyes and hand, from wherever
 * they happen to be. Nothing is answered automatically.
 *
 * Only one visible attempt exists at a time (see `queueVisible`), so this
 * is a single slot rather than a table.
 */
interface ActiveChallenge {
  id: string;
  page: Page;
  startedAt: number;
}

let activeChallenge: ActiveChallenge | null = null;

export interface ChallengeStatus {
  id: string;
  /** Seconds the window has been open, so the app can show it giving up. */
  ageSeconds: number;
  width: number;
  height: number;
}

export function currentChallenge(): ChallengeStatus | null {
  if (!activeChallenge) return null;
  const size = activeChallenge.page.viewportSize() ?? { width: 1280, height: 720 };
  return {
    id: activeChallenge.id,
    ageSeconds: Math.round((Date.now() - activeChallenge.startedAt) / 1000),
    width: size.width,
    height: size.height,
  };
}

/** A JPEG of what the window currently shows, or null if it has closed. */
export async function challengeFrame(id: string): Promise<Buffer | null> {
  if (activeChallenge?.id !== id) return null;
  return await activeChallenge.page
    .screenshot({ type: "jpeg", quality: 65 })
    .catch(() => null);
}

/** Forwards one real click, in the frame's own coordinates. */
export async function challengeClick(id: string, x: number, y: number): Promise<boolean> {
  if (activeChallenge?.id !== id) return false;
  const size = activeChallenge.page.viewportSize() ?? { width: 1280, height: 720 };
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  if (x < 0 || y < 0 || x > size.width || y > size.height) return false;
  await activeChallenge.page.mouse.click(x, y).catch(() => {});
  return true;
}

/** Forwards typed text, for the rare challenge that asks for more than a click. */
export async function challengeType(id: string, text: string): Promise<boolean> {
  if (activeChallenge?.id !== id) return false;
  await activeChallenge.page.keyboard.type(text.slice(0, 200)).catch(() => {});
  return true;
}

/**
 * Serialises visible attempts. Two challenged runs (the batch view calculates
 * two at a time) must not open two windows: only one process may hold the
 * browser profile, and a person can only solve one challenge at a time.
 */
let visibleQueue: Promise<unknown> = Promise.resolve();

/** When a visible attempt last got through, i.e. when a person last solved one. */
let lastClearedAt = 0;

function queueVisible<T>(work: () => Promise<T>): Promise<T> {
  const run = visibleQueue.then(work, work);
  visibleQueue = run.catch(() => {});
  return run;
}

export async function runBarrettCalculation(request: CalculateRequest): Promise<CalculateResponse> {
  const challengedAt = Date.now();
  try {
    return await attemptCalculation(request, true);
  } catch (err) {
    if (!(err instanceof CloudflareChallengedError) || HEADLESS_ONLY) throw err;

    return await queueVisible(async () => {
      // If someone solved a challenge while this run waited its turn, that
      // clearance is in the shared profile now — try invisibly once more
      // rather than asking a second person for a second click. Only then:
      // when nothing has changed, retrying blind just adds a wait before
      // showing the check that has to be completed anyway.
      if (lastClearedAt > challengedAt) {
        try {
          return await attemptCalculation(request, true);
        } catch (retry) {
          if (!(retry instanceof CloudflareChallengedError)) throw retry;
        }
      }
      console.log(
        "Cloudflare challenged the invisible browser — retrying in a visible window. " +
          "Click the verification checkbox when it appears (in the window itself, or in the " +
          "app, which shows it while it is open).",
      );
      const result = await attemptCalculation(request, false);
      // Got through, so a person completed the check: the runs queued behind
      // this one can try invisibly on the clearance it earned.
      lastClearedAt = Date.now();
      return result;
    });
  }
}

async function attemptCalculation(
  request: CalculateRequest,
  headless: boolean,
): Promise<CalculateResponse> {
  const { context, shared } = await openContext(headless);
  if (shared) activeSharedRuns++;
  let openPage: Page | null = null;
  try {
    // A fresh page per run. The profile behind it is deliberately not fresh
    // (see PROFILE_DIR), so a value left in a field we don't fill can no
    // longer be ruled out by construction — clearUnusedFields below empties
    // every box this run isn't filling.
    const page = await context.newPage();
    openPage = page;

    // A visible attempt only happens because a challenge is expected, so the
    // window goes on offer for the whole attempt — the app can show it and
    // forward the clicks of whoever is using it.
    if (!headless) {
      activeChallenge = { id: randomUUID(), page, startedAt: Date.now() };
    }

    // Old ASP.NET validators often report problems via alert() popups that
    // never appear in the DOM — capture them so failures can name the reason.
    const dialogMessages: string[] = [];
    page.on("dialog", (dialog) => {
      dialogMessages.push(dialog.message());
      dialog.accept().catch(() => {});
    });

    await page.goto(CALCULATOR_URL, { waitUntil: "domcontentloaded", timeout: 30000 });

    // Two-stage wait rather than one 15-second one: a challenged page is
    // recognised in about 8, and every second past that is a second the
    // clinician spends staring at "Calculating…" before the check they have
    // to complete is even shown to them. A merely slow site still gets the
    // full 15 seconds.
    let formRoot = await findFormRoot(page, 8000);
    if (!formRoot && !(await isChallengePage(page))) {
      formRoot = await findFormRoot(page, 7000);
    }
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

    // The K index goes in before any measurement: it governs how the site
    // reads the K values, and setting it first keeps that unambiguous.
    const kIndex = request.kIndex ?? DEFAULT_K_INDEX;
    const kIndexWarning = await selectKIndex(formRoot, kIndex);

    // The lens goes next: picking one rewrites the constants boxes (and may
    // post back), which would undo anything typed before it.
    const requestedLens = (request.od ?? request.os)?.iol.lens;
    const usePersonalConstant = isPersonalConstant(requestedLens);
    const selectedLens = await selectLens(formRoot, requestedLens ?? PERSONAL_CONSTANT);

    const filled: FilledEntry[] = [];
    const missing = [
      // Emptying first: a box the previous patient left filled must not be
      // read by the page's own handlers while this run types around it.
      ...(await clearUnusedFields(formRoot, request, filled)),
      ...(await fillPatientPlaceholder(formRoot, filled)),
      // A named lens brings the manufacturer's own constants with it — typing
      // this practice's Lens Factor over them would calculate the wrong lens.
      ...(usePersonalConstant ? await fillConstants(formRoot, request, filled) : []),
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

    // Read the constants off the page while the form is still on screen.
    const lensUsed = {
      name: selectedLens,
      lensFactor: await readLensFactor(formRoot),
      aConstant: await readAConstant(formRoot),
    };
    // The page derives one constant from the other, so a value typed in can
    // come back changed. That is the site's answer and it is what the
    // calculation uses — but the clinician has to be told it happened.
    const requestedIol = usePersonalConstant ? (request.od ?? request.os)?.iol : undefined;
    const rewritten = [
      requestedIol && lensUsed.lensFactor !== undefined &&
      Number(lensUsed.lensFactor) !== requestedIol.lensFactor
        ? `Lens Factor ${requestedIol.lensFactor} → ${lensUsed.lensFactor}`
        : null,
      requestedIol && lensUsed.aConstant !== undefined &&
      Number(lensUsed.aConstant) !== requestedIol.aConstant
        ? `A Constant ${requestedIol.aConstant} → ${lensUsed.aConstant}`
        : null,
    ].filter((part): part is string => part !== null);
    const constantsWarning =
      rewritten.length > 0
        ? `The calculator recalculated the constants you entered (${rewritten.join("; ")}) — ` +
          `it derives one from the other, and the results below use its values.`
        : undefined;
    const warning = [kIndexWarning, constantsWarning].filter(Boolean).join(" ") || undefined;

    // Only trust the "View Formula" signal if it isn't already showing —
    // otherwise a page that always carries that text would look "done"
    // before Calculate had run at all.
    const doneSignalUsable = !(await hasText(page, CALCULATION_DONE_ANCHOR));

    await clickCalculate(formRoot);
    const calculationDone = doneSignalUsable && (await waitForCalculationDone(page, 30000));

    // The results live on the "Universal Formula" tab. Once the site says
    // it has finished, switch straight there rather than polling the form
    // tab for results that were never going to appear on it.
    const switchTab = () =>
      page
        .getByText(RESULTS_TAB_ANCHOR, { exact: false })
        .first()
        .click({ timeout: 3000 })
        .catch(() => {});

    let resultsRoot: SearchRoot | null = null;
    if (calculationDone) {
      await switchTab();
      resultsRoot = await findResultsRoot(page, 8000);
    } else {
      resultsRoot = await findResultsRoot(page, 8000);
      if (!resultsRoot) {
        await switchTab();
        resultsRoot = await findResultsRoot(page, 6000);
      }
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
    return {
      resultsText: text,
      recommended: { od, os },
      tables,
      lens: lensUsed,
      kIndex,
      warning,
    };
  } finally {
    if (activeChallenge?.page === openPage) activeChallenge = null;
    await openPage?.close().catch(() => {});
    if (shared) activeSharedRuns--;
    // The visible window is closed too — its whole job was to earn the
    // clearance cookie, and that now lives in the profile on disk.
    else await closeContext(context);
  }
}
