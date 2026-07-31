/**
 * Run this from a machine with normal internet access:
 *
 *   npm run inspect
 *
 * It dumps every form field and button on the live Barrett Universal II
 * calculator page (label text, id, name, placeholder) so the selector map in
 * src/barrett.ts can be corrected — it was written blind, without ever
 * loading the real page, because this project was built in a sandbox with
 * calc.apacrs.org blocked at the network level.
 */
import { chromium } from "playwright";
import { CALCULATOR_URL } from "../src/barrett.js";

interface FieldInfo {
  tag: string;
  type: string | null;
  id: string | null;
  name: string | null;
  placeholder: string | null;
  ariaLabel: string | null;
  nearbyLabel: string | null;
  /** For <select> elements only — the option labels/values to pick from (e.g. the Optic dropdown). */
  options: { label: string; value: string }[] | null;
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(CALCULATOR_URL, { waitUntil: "networkidle", timeout: 45000 });

  const fields: FieldInfo[] = await page.$$eval("input, select, textarea", (elements) =>
    elements.map((el) => {
      const withId = el.id ? document.querySelector(`label[for="${el.id}"]`) : null;
      const label = el.closest("label")?.textContent?.trim() ?? withId?.textContent?.trim() ?? null;
      const input = el as HTMLInputElement;
      const isSelect = el.tagName.toLowerCase() === "select";
      return {
        tag: el.tagName.toLowerCase(),
        type: input.type ?? null,
        id: el.id || null,
        name: input.name || null,
        placeholder: input.placeholder || null,
        ariaLabel: el.getAttribute("aria-label"),
        nearbyLabel: label,
        options: isSelect
          ? Array.from((el as HTMLSelectElement).options).map((o) => ({ label: o.label, value: o.value }))
          : null,
      };
    }),
  );

  const buttons: (string | null)[] = await page.$$eval("button", (elements) =>
    elements.map((el) => el.textContent?.trim() ?? null),
  );

  console.log(JSON.stringify({ url: CALCULATOR_URL, fields, buttons }, null, 2));
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
