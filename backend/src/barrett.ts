import { chromium, type Locator, type Page } from "playwright";
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
 * Still not verified end-to-end against a real submission; `npm run
 * inspect` from an unrestricted machine remains the way to confirm
 * (see backend/README.md).
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

type PerEyeField = keyof typeof PER_EYE_FIELDS;
type SingleField = keyof typeof SINGLE_FIELDS;

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
 * Finds the Nth control for a visible label. Tries an accessible
 * label association first; the page predates those conventions, so the
 * workhorse is the fallback: anchor on the Nth occurrence of the label
 * text and take the first form control after it in document order.
 */
async function locateByLabelText(
  page: Page,
  labels: readonly string[],
  occurrence: number,
): Promise<Locator | null> {
  for (const label of labels) {
    const byLabel = page.getByLabel(label, { exact: false });
    if ((await byLabel.count()) > occurrence) {
      return byLabel.nth(occurrence);
    }

    const anchors = page.getByText(label, { exact: false });
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

async function fillEye(page: Page, eye: EyeInput, eyeIndex: 0 | 1): Promise<string[]> {
  const attempts: Array<[PerEyeField, string]> = [
    ["axialLength", String(eye.biometry.axialLength)],
    ["k1", String(eye.keratometry.flatK)],
    ["k2", String(eye.keratometry.steepK)],
    ["acd", String(eye.biometry.acd)],
    ["targetRefraction", String(eye.manual.targetRefraction)],
  ];
  if (eye.biometry.lensThickness !== undefined) {
    attempts.push(["lensThickness", String(eye.biometry.lensThickness)]);
  }

  const missing: string[] = [];
  for (const [field, value] of attempts) {
    const control = await locateByLabelText(page, PER_EYE_FIELDS[field], eyeIndex);
    if (control) {
      await setLocatorValue(control, value);
    } else {
      missing.push(`${eye.side} ${field}`);
    }
  }
  return missing;
}

async function fillSingles(page: Page, request: CalculateRequest): Promise<string[]> {
  // Both eyes carry identical fixed IOL constants; validated upstream.
  const attempts: Array<[SingleField, string]> = [
    ["aConstant", String(request.od.iol.aConstant)],
    ["lensFactor", String(request.od.iol.lensFactor)],
  ];

  const missing: string[] = [];
  for (const [field, value] of attempts) {
    const control = await locateByLabelText(page, SINGLE_FIELDS[field], 0);
    if (control) {
      await setLocatorValue(control, value);
    } else {
      missing.push(field);
    }
  }
  return missing;
}

async function extractResultsText(page: Page): Promise<string> {
  const iolPowerHeading = page.locator("text=/IOL Power/i").first();
  if (await iolPowerHeading.count()) {
    const table = iolPowerHeading.locator("xpath=ancestor::table[1]");
    if (await table.count()) {
      const text = await table.first().innerText().catch(() => null);
      if (text?.trim()) return text.trim();
    }
  }

  const lastTable = page.locator("table").last();
  if (await lastTable.count()) {
    const text = await lastTable.innerText().catch(() => null);
    if (text?.trim()) return text.trim();
  }

  return (await page.locator("body").innerText()).trim();
}

const UNVERIFIED_WARNING =
  "Field mapping was matched to a screenshot of the calculator but has not been verified " +
  "with a real end-to-end submission. Confirm every number against calc.apacrs.org before clinical use.";

export async function runBarrettCalculation(request: CalculateRequest): Promise<CalculateResponse> {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(CALCULATOR_URL, { waitUntil: "domcontentloaded", timeout: 30000 });

    const missing = [
      ...(await fillSingles(page, request)),
      ...(await fillEye(page, request.od, 0)),
      ...(await fillEye(page, request.os, 1)),
    ];

    if (missing.length > 0) {
      throw new Error(
        `Could not locate these fields on the calculator page, so nothing was submitted: ` +
          `${missing.join(", ")}. The site's form has likely changed since these selectors were ` +
          `written — see backend/README.md to update them with "npm run inspect".`,
      );
    }

    await page.getByRole("button", { name: /^calculate$/i }).click();
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});

    const resultsText = await extractResultsText(page);
    return { resultsText, warning: UNVERIFIED_WARNING };
  } finally {
    await browser.close();
  }
}
