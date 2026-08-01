import { chromium, type Frame, type Locator, type Page } from "playwright";
import type { CalculateRequest, CalculateResponse, EyeInput } from "./types.js";

export const CALCULATOR_URL = "https://calc.apacrs.org/barrett_universal2105/";

/**
 * Field labels transcribed from a screenshot of the live calculator's
 * "Patient Data" tab (July 2026). The form is a single page for both eyes:
 * each measurement row has the label once per eye column — OD's "(R)" input
 * appears before OS's "(L)" in document order — while Lens Factor and
 * A Constant are form-wide singles (the form reads "Lens Factor ... or
 * A Constant": entering one may derive the other, so A Constant is filled
 * before Lens Factor to let Lens Factor win). Doctor/Patient Name and
 * Patient ID are left blank on purpose — no PHI is ever sent.
 *
 * A first live run failed to find ANY of these labels on the top-level
 * page, so the form likely renders inside a frame or behind the "Patient
 * Data" tab — lookups now search every frame, retry while the page settles,
 * and report a diagnostic snapshot of what was actually served when they
 * still fail. `npm run inspect` from an unrestricted machine remains the
 * definitive way to pin selectors (see backend/README.md).
 */
const PER_EYE_FIELDS = {
  axialLength: ["Axial Length"],
  k1: ["Measured K1"],
  k2: ["Measured K2"],
  acd: ["Optical ACD"],
  targetRefraction: ["Refraction"],
  lensThickness: ["Lens Thickness"],
} as const;

const SINGLE_FIELDS = {
  aConstant: ["A Constant"],
  lensFactor: ["Lens Factor"],
} as const;

/** Label text that must exist wherever the form actually renders. */
const FORM_ANCHOR = "Axial Length";

/** Text that only appears once the calculation has actually run. */
const RESULTS_ANCHOR = /Recommended IOL/i;

/**
 * The site appears to require the identity fields to be non-empty before
 * Calculate does anything. These get a neutral placeholder — never real
 * patient data (the app's no-PHI rule).
 */
const IDENTITY_FIELDS: readonly (readonly string[])[] = [
  ["Doctor Name"],
  ["Patient Name"],
  ["Patient ID"],
];
const IDENTITY_PLACEHOLDER = "-";

type PerEyeField = keyof typeof PER_EYE_FIELDS;
type SingleField = keyof typeof SINGLE_FIELDS;
type SearchRoot = Page | Frame;

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
    .then((t) => t.replace(/\s+/g, " ").trim().slice(0, 300))
    .catch(() => "(unreadable)");
  return (
    `page title: "${title}"; url: ${page.url()}; ` +
    `frames: [${frameUrls.join(", ") || "none"}]; visible text starts with: "${bodyText}"`
  );
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

async function fillEye(root: SearchRoot, eye: EyeInput, eyeIndex: 0 | 1): Promise<string[]> {
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
    } else {
      missing.push(`${eye.side} ${field}`);
    }
  }
  return missing;
}

async function fillSingles(root: SearchRoot, request: CalculateRequest): Promise<string[]> {
  // Both eyes carry identical fixed IOL constants; validated upstream.
  const attempts: Array<[SingleField, string]> = [
    ["aConstant", String(request.od.iol.aConstant)],
    ["lensFactor", String(request.od.iol.lensFactor)],
  ];

  const missing: string[] = [];
  for (const [field, value] of attempts) {
    const control = await locateByLabelText(root, SINGLE_FIELDS[field], 0);
    if (control) {
      await setLocatorValue(control, value);
    } else {
      missing.push(field);
    }
  }
  return missing;
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

/** Fills identity fields with a neutral placeholder; missing ones are skipped silently. */
async function fillIdentityPlaceholders(root: SearchRoot): Promise<void> {
  for (const labels of IDENTITY_FIELDS) {
    const control = await locateByLabelText(root, labels, 0);
    if (control) {
      await setLocatorValue(control, IDENTITY_PLACEHOLDER).catch(() => {});
    }
  }
}

/** Polls the page and every frame until the results text appears. */
async function findResultsRoot(page: Page, timeoutMs: number): Promise<SearchRoot | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const roots: SearchRoot[] = [page, ...page.frames()];
    for (const root of roots) {
      const count = await root
        .getByText(RESULTS_ANCHOR)
        .count()
        .catch(() => 0);
      if (count > 0) return root;
    }
    await page.waitForTimeout(500);
  }
  return null;
}

interface ExtractedResults {
  text: string;
  od?: string;
  os?: string;
}

/**
 * The results view lays out a "Right Eye (OD)" panel then a "Left Eye (OS)"
 * panel, each containing a "Recommended IOL: <power> (<optic>) for Target
 * Refraction:<n>" line and an IOL Power / Optic / Refraction table.
 */
async function extractResults(root: SearchRoot): Promise<ExtractedResults> {
  const body = (await root.locator("body").innerText()).trim();

  const odStart = body.search(/Right Eye\s*\(OD\)/i);
  const osStart = body.search(/Left Eye\s*\(OS\)/i);
  const text = odStart >= 0 ? body.slice(odStart) : body;

  const recommendedIn = (section: string): string | undefined =>
    section.match(/Recommended IOL:\s*(-?[\d.]+)/i)?.[1];

  let od: string | undefined;
  let os: string | undefined;
  if (odStart >= 0 && osStart > odStart) {
    od = recommendedIn(body.slice(odStart, osStart));
    os = recommendedIn(body.slice(osStart));
  } else {
    od = recommendedIn(text);
  }

  return { text: text.slice(0, 6000), od, os };
}

const UNVERIFIED_WARNING =
  "Field mapping was matched to a screenshot of the calculator but has not been verified " +
  "with a real end-to-end submission. Confirm every number against calc.apacrs.org before clinical use.";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export async function runBarrettCalculation(request: CalculateRequest): Promise<CalculateResponse> {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ userAgent: USER_AGENT });
    await page.goto(CALCULATOR_URL, { waitUntil: "domcontentloaded", timeout: 30000 });

    const formRoot = await findFormRoot(page, 15000);
    if (!formRoot) {
      throw new Error(
        `Couldn't find the calculator form (no "${FORM_ANCHOR}" text anywhere on the page or its ` +
          `frames). What was actually served — ${await describePage(page)}. If this text mentions ` +
          `access denied or verification, the site may be blocking automated browsers; otherwise run ` +
          `"npm run inspect" (backend/README.md) and update the selectors from its output.`,
      );
    }

    const missing = [
      ...(await fillSingles(formRoot, request)),
      ...(await fillEye(formRoot, request.od, 0)),
      ...(await fillEye(formRoot, request.os, 1)),
    ];

    if (missing.length > 0) {
      throw new Error(
        `Found the calculator form but couldn't locate these fields, so nothing was submitted: ` +
          `${missing.join(", ")}. Diagnostic — ${await describePage(page)}. Run "npm run inspect" ` +
          `(backend/README.md) and update the selectors from its output.`,
      );
    }

    await clickCalculate(formRoot);
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});

    // If no results appeared, the site's validators most likely blocked the
    // submit over empty identity fields — fill neutral placeholders (never
    // real patient data) and try once more.
    let resultsRoot = await findResultsRoot(page, 8000);
    if (!resultsRoot) {
      const retryRoot = (await findFormRoot(page, 3000)) ?? formRoot;
      await fillIdentityPlaceholders(retryRoot);
      await clickCalculate(retryRoot);
      await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
      resultsRoot = await findResultsRoot(page, 8000);
    }

    if (!resultsRoot) {
      throw new Error(
        `The form was filled and Calculate was clicked, but no "Recommended IOL" results ever ` +
          `appeared. The site may be showing a validation message instead — what it displayed: ` +
          `${await describePage(page)}.`,
      );
    }

    const { text, od, os } = await extractResults(resultsRoot);
    return { resultsText: text, recommended: { od, os }, warning: UNVERIFIED_WARNING };
  } finally {
    await browser.close();
  }
}
