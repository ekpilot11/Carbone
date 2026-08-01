/**
 * Run this from a machine with normal internet access:
 *
 *   npm run inspect
 *
 * It dumps every form field and button on the live Barrett Universal II
 * calculator page (searching every frame) so the selector maps in
 * src/barrett.ts can be corrected. Output goes to the console AND to
 * inspect-output.json + inspect-page.html in the backend folder — attach
 * those files when reporting automation failures.
 */
import { writeFile } from "node:fs/promises";
import { chromium, type Frame, type Page } from "playwright";
import { CALCULATOR_URL } from "../src/barrett.js";

interface FieldInfo {
  tag: string;
  type: string | null;
  id: string | null;
  name: string | null;
  placeholder: string | null;
  ariaLabel: string | null;
  nearbyLabel: string | null;
  /** For <select> elements only — the option labels/values to pick from. */
  options: { label: string; value: string }[] | null;
}

async function dumpRoot(root: Page | Frame) {
  const fields: FieldInfo[] = await root.$$eval("input, select, textarea", (elements) =>
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

  const buttons: (string | null)[] = await root.$$eval(
    'button, input[type="submit"], input[type="button"]',
    (elements) =>
      elements.map((el) =>
        el.tagName.toLowerCase() === "button"
          ? (el.textContent?.trim() ?? null)
          : ((el as HTMLInputElement).value ?? null),
      ),
  );

  const bodyTextStart = await root
    .$eval("body", (el) => (el.innerText ?? "").replace(/\s+/g, " ").trim().slice(0, 400))
    .catch(() => "(unreadable)");

  return { fields, buttons, bodyTextStart };
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  // domcontentloaded, not networkidle: some sites keep connections open
  // forever, which times the stricter wait out.
  await page.goto(CALCULATOR_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
  // Give any late-loading frames/tabs a moment to settle.
  await page.waitForTimeout(3000);

  const report: {
    url: string;
    finalUrl: string;
    title: string;
    mainPage: Awaited<ReturnType<typeof dumpRoot>>;
    frames: { url: string; dump: Awaited<ReturnType<typeof dumpRoot>> }[];
  } = {
    url: CALCULATOR_URL,
    finalUrl: page.url(),
    title: await page.title(),
    mainPage: await dumpRoot(page),
    frames: [],
  };

  for (const frame of page.frames()) {
    if (frame === page.mainFrame() || frame.url() === "about:blank") continue;
    try {
      report.frames.push({ url: frame.url(), dump: await dumpRoot(frame) });
    } catch (err) {
      report.frames.push({
        url: frame.url(),
        dump: { fields: [], buttons: [], bodyTextStart: `(unreadable: ${err})` },
      });
    }
  }

  const json = JSON.stringify(report, null, 2);
  await writeFile("inspect-output.json", json).catch((err) => {
    console.error(`(couldn't write inspect-output.json: ${err})`);
  });
  await writeFile("inspect-page.html", await page.content()).catch((err) => {
    console.error(`(couldn't write inspect-page.html: ${err})`);
  });

  console.log(json);
  console.log("\nSaved to inspect-output.json and inspect-page.html in the backend folder.");
  await browser.close();
}

main().catch((err) => {
  console.error("Inspect failed:", err);
  console.error(
    "\nIf this is a timeout or TLS error, check that this machine can open " +
      CALCULATOR_URL +
      " in a normal browser. Paste the full error above when reporting.",
  );
  process.exitCode = 1;
});
