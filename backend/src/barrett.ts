import { chromium, type Page } from "playwright";
import type { CalculateRequest, CalculateResponse, EyeInput } from "./types.js";

export const CALCULATOR_URL = "https://calc.apacrs.org/barrett_universal2105/";

/**
 * Candidate accessible-label text for each logical field, tried in order.
 *
 * IMPORTANT: these were written from general knowledge of the Barrett
 * Universal II calculator's typical layout, NOT verified against the live
 * page — this environment's outbound network is blocked from
 * calc.apacrs.org. Before relying on this in production, run `npm run
 * inspect` from a machine with normal internet access and update this map
 * (and the eye-column heuristic below) to match what it prints. See
 * backend/README.md.
 */
const FIELD_LABELS = {
  axialLength: ["Axial Length", "AL"],
  acd: ["ACD", "Anterior Chamber Depth"],
  lensThickness: ["Lens Thickness", "LT"],
  k1: ["K1", "Flat K", "K Flat"],
  k2: ["K2", "Steep K", "K Steep"],
  iolConstant: ["A-Constant", "A Constant", "pACD", "Surgeon Factor", "Lens Factor"],
  targetRefraction: ["Target Refraction", "Refraction"],
} as const;

type LogicalField = keyof typeof FIELD_LABELS;

/**
 * The calculator's OD/OS inputs are assumed to share the same labels, with
 * OD's field appearing before OS's in DOM order (a common left-to-right
 * layout convention) — index 0 for OD, 1 for OS. Unverified; confirm with
 * `npm run inspect`.
 */
async function fillFieldForEye(
  page: Page,
  field: LogicalField,
  eyeIndex: 0 | 1,
  value: string,
): Promise<boolean> {
  for (const label of FIELD_LABELS[field]) {
    const locator = page.getByLabel(label, { exact: false });
    const count = await locator.count();
    if (count > eyeIndex) {
      await locator.nth(eyeIndex).fill(value);
      return true;
    }
  }
  return false;
}

async function fillEye(page: Page, eye: EyeInput, eyeIndex: 0 | 1): Promise<string[]> {
  const attempts: Array<[LogicalField, string]> = [
    ["k1", String(eye.keratometry.flatK)],
    ["k2", String(eye.keratometry.steepK)],
    ["axialLength", String(eye.biometry.axialLength)],
    ["acd", String(eye.biometry.acd)],
    ["iolConstant", String(eye.manual.iolConstant)],
    ["targetRefraction", String(eye.manual.targetRefraction)],
  ];
  if (eye.biometry.lensThickness !== undefined) {
    attempts.push(["lensThickness", String(eye.biometry.lensThickness)]);
  }

  const missing: string[] = [];
  for (const [field, value] of attempts) {
    const filled = await fillFieldForEye(page, field, eyeIndex, value);
    if (!filled) missing.push(`${eye.side} ${field}`);
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
  "This automation's field selectors were written without access to the live calculator " +
  "and have not been verified end-to-end. Confirm every number against calc.apacrs.org before clinical use.";

export async function runBarrettCalculation(request: CalculateRequest): Promise<CalculateResponse> {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(CALCULATOR_URL, { waitUntil: "domcontentloaded", timeout: 30000 });

    const missing = [
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

    await page.getByRole("button", { name: /calculate/i }).click();
    await page.waitForTimeout(2000);

    const resultsText = await extractResultsText(page);
    return { resultsText, warning: UNVERIFIED_WARNING };
  } finally {
    await browser.close();
  }
}
