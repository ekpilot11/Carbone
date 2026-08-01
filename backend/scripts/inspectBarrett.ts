/**
 * Run this from a machine with normal internet access:
 *
 *   npm run inspect
 *
 * It dumps every form field and button on the live Barrett Universal II
 * calculator page — searching every frame, since a live run showed the
 * top-level page may not contain the form at all — so the selector maps in
 * src/barrett.ts can be corrected. Paste its JSON output when reporting
 * automation failures.
 */
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

  const buttons: (string | null)[] = await root.$$eval("button", (elements) =>
    elements.map((el) => el.textContent?.trim() ?? null),
  );

  const bodyTextStart = await root.$eval("body", (el) =>
    (el.innerText ?? "").replace(/\s+/g, " ").trim().slice(0, 400),
  );

  return { fields, buttons, bodyTextStart };
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(CALCULATOR_URL, { waitUntil: "networkidle", timeout: 45000 });
  // Give any late-loading frames/tabs a moment to settle.
  await page.waitForTimeout(3000);

  const report = {
    url: CALCULATOR_URL,
    finalUrl: page.url(),
    title: await page.title(),
    mainPage: await dumpRoot(page),
    frames: [] as { url: string; dump: Awaited<ReturnType<typeof dumpRoot>> }[],
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

  console.log(JSON.stringify(report, null, 2));
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
