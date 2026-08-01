# Backend: photo scanning + Barrett Universal II automation

Express server exposing two routes:

- `POST /api/scan` — reads **one** photograph containing the keratometry
  strip, the A-scan printout, or both, and returns range-validated clinical
  values for whichever it finds.
- `POST /api/calculate` — drives a headless Chromium (via Playwright) to
  fill those values into https://calc.apacrs.org/barrett_universal2105/ and
  scrape back the results.

## Photo scanning (`POST /api/scan`)

Body: `{ imageBase64, mediaType }` (JPEG/PNG/WebP). Returns
`{ keratometry: [{side, k1, k2}], biometry: [{side, axialLength, acd}], patientName?, warning? }`
— each array holds one entry per eye that could be read, and is empty when
that printout isn't in the photo. A single prompt covers both formats, so
one wide shot of the two strips side by side works, and so does a close-up
of either one alone.

The calculator's optional values (lens thickness, WTW) are deliberately
**not** read: they are entered by hand, so a scan can never overwrite or
blank what the clinician typed.

`patientName` is returned when a name is printed legibly, to head the
clinic's PDF record. It is never sent on to the calculator (Patient Name
there stays a neutral "-"), and the prompt excludes every other identifier
— ID/record number, CPF, date of birth, address, phone.

Set `ANTHROPIC_API_KEY` to enable it; without it the route returns **503**
and the frontend falls back to in-browser OCR (saying so in the UI).
Override the model with `SCAN_MODEL` (default `claude-opus-5`).

**The photograph is sent to the Anthropic API** — see the privacy section of
the root README before using this with real patients. Whatever is in frame is
transmitted, so keep out anything the record doesn't need (the name is read
for the record; ID numbers, CPF, date of birth and address are not). The
image is held in memory for the request and never written to disk or logged.

Two safeguards sit on the response, not the request: the prompt limits what
comes back to the clinical numbers plus the patient's name, and every value is checked against the
physiologic ranges in `src/ranges.ts` (K 30–60 D, AL 12–38 mm, ACD
0.5–6 mm). Out-of-range values are dropped with a warning rather than
passed on — a misread digit must never reach a surgical calculation. The
K1-is-lower convention is re-applied server-side rather than trusted from
the model.

## Field mapping — verified 2026-08-01, re-verify if the site changes

The field mapping in `src/barrett.ts` was built from screenshots of the
live form's "Patient Data" tab and **verified end-to-end on 2026-08-01**:
a live automated run returned IOL Power tables identical to a manual run
on the official site with the same inputs. The page has no programmatic
label-input association, so the locator anchors on visible label text and
takes the next form control in document order. If the site's layout ever
changes and runs start failing, re-verify with the steps below:

1. From a machine with normal internet access, run:

   ```bash
   npm install
   npm run inspect
   ```

   This prints every input/select/textarea on the live page (its label
   text, `id`, `name`, `placeholder`) plus every button's text, as JSON.

2. Compare that output against `PER_EYE_FIELDS` / `SINGLE_FIELDS` in
   `src/barrett.ts` and against `locateByLabelText`'s
   label-text-then-next-control heuristic. If the dump shows stable input
   `id`s/`name`s (an ASP.NET-style page usually has them), prefer replacing
   the text-anchored lookup with direct id/name selectors — that's far more
   robust than any label heuristic.

3. Check how the form links "Lens Factor ... or A Constant": if typing in
   one autocalculates the other via a postback, filling both (A Constant
   first, Lens Factor second, the current order) may need to become
   fill-one-only.

4. Also confirm the "Calculate" button's accessible name and how results
   are rendered, and adjust `extractResultsText` in `barrett.ts` if the
   heuristics there (look for an "IOL Power" heading, else the last
   `<table>`, else the whole page) don't land on the right content.

5. Run an end-to-end request against the real site and confirm the
   response's tables match a manual run with the same inputs.

## Speed — what a run waits on

A run used to take ~12s against a stand-in site whose calculation itself
takes 0.8s; it now takes ~5.9s cold and ~2.7s once the browser is warm.
Almost all of the difference was time spent waiting for nothing:

- **The readiness signal.** After Calculate the code waited for the network
  to fall idle (up to 15s), then polled the *form* tab for results that only
  ever render on the "Universal Formula" tab — burning that timeout too
  before finally switching tabs. It now watches for the site's own tell:
  "Enter Data and Calculate" becomes **"View Formula"** the moment the
  results exist. As soon as that appears it switches tabs and reads them.
  The signal is only trusted if it wasn't already showing before Calculate
  was clicked; otherwise the old poll-for-results path still applies.
- **One browser, many runs.** Chromium is launched once and reused, which is
  most of the cold/warm difference. Every run still gets a **fresh context**,
  so no cookie or leftover field value can carry from one patient to the
  next. A visible (Cloudflare) window is always its own process, and the
  shared one is closed on SIGINT/SIGTERM.
- **No redundant postback.** Selecting the lens is skipped when the dropdown
  already shows it — the common case, since both it and the site default to
  "Personal Constant" — which also skips waiting for the page to settle.
- **Concurrent lookups.** Locating a field costs several round trips to the
  browser; all the lookups for an eye now happen at once, and every filled
  value is read back at once. The fills themselves stay ordered, since
  typing can trigger the page's own handlers.
- Polling intervals went from 500ms to 120ms.

## Exercising it offline (`npm run mock`)

`scripts/mockCalculator.ts` serves a stand-in for the calculator: the same
field labels and table layout, the tabbed results, the linked Lens
Factor/A Constant pair, the K-index radios, and the "View Formula" switch
after a simulated delay. It exists to test the automation without touching
the live site (and from machines that can't reach it).

```bash
npm run mock                      # serves http://127.0.0.1:4100/
BARRETT_URL=http://127.0.0.1:4100/ npm run dev
```

`BARRETT_URL` exists for this; leave it unset and every run goes to the
official calculator. **The mock's IOL powers are invented** — it proves the
plumbing, never the arithmetic.

## Running

```bash
npm install     # also runs `playwright install chromium` (postinstall)
npm run dev      # ts-node-style dev server on :4000, via tsx
npm run build && npm start   # compiled
```

Environment: `PORT` (default `4000`).

## Endpoints

- `POST /api/calculate` — body: `{ od?: EyeInput, os?: EyeInput }`, at
  least one eye required; a single eye calculates that side only (see
  `src/types.ts`). In single-eye runs the "Recommended IOL" match maps to
  the requested side, and the uncalculated side's table comes back empty.
  `biometry.lensThickness` / `biometry.wtw` are optional and simply skipped
  when absent. `manual` holds the one clinician-entered value (target
  refraction); `iol` holds the IOL design/constants from
  `src/constants.ts` (expected to be `Biconvex` / `118.4` / `1.57` for this
  practice, but still validated per-request rather than hardcoded
  server-side, so a future frontend change doesn't require a backend
  redeploy) plus `iol.lens`. Returns
  `{ resultsText, recommended?, tables?, lens?, warning? }` on success, or
  `{ error }` with a 4xx/5xx status.
  `kIndex` is form-wide and optional (`"1.3375"` — the site's default — or
  `"1.332"`); it comes back on the response as the index the form actually
  had selected.
- `GET /api/lenses` — the lens dropdown's options, read off the live
  calculator and cached for the process lifetime. Headless-only and
  best-effort: it returns 502 when the site is unreachable or challenged,
  and the frontend then keeps its own bundled list.
- `GET /healthz` — liveness check.

## Lens selection

`iol.lens` is the exact option text of the calculator's own lens dropdown
("Personal Constant", "Alcon SN60WF", …). The automation finds that
`<select>` by the options it offers — it is the one containing "Personal
Constant" — and selects the requested option before anything else is typed,
because selecting a lens rewrites the constants boxes and can post back.

Two rules keep a wrong lens from producing a plausible wrong power:

- A name that doesn't match any option **aborts the run** and the error
  lists every option the site actually offers. It never falls back to
  another lens.
- With a named lens, neither constant is filled — the site's own values
  for that lens stand. A "Personal Constant" run types both, A Constant
  first so that Lens Factor is written last (the ordering of the run that
  was verified end-to-end). No manufacturer constants are transcribed into
  this codebase; whatever the site held at submit time is read back and
  returned as `lens.lensFactor` / `lens.aConstant`, the only record of
  what actually produced the numbers.

The page derives one constant from the other, so a typed value can come
back changed. That is not treated as a misfilled field: verification
accepts a rewritten constant as long as it still falls in its own band, and
the response carries a `warning` naming what the site changed. Requests are
range-checked first (Lens Factor -2 to 5, A Constant 112 to 125 — the bands
the form prints beside its fields).

Reading the A Constant back needs care, because the form labels its two
constants in one breath ("Lens Factor ... or A Constant") and a
label-anchored lookup can land on the Lens Factor box. Both the labelled
lookup and the fallback (scan the form's values) accept a number only if it
falls in the A-constant band above — no other field on the form comes
near it — and an ambiguous read is reported as unknown rather than guessed.
A wrong constant printed on a clinical record is worse than a missing one.

Both eyes must carry the same lens and constants — the dropdown is
form-wide, so a mismatched request is rejected rather than half-honoured.

## K Index

The keratometric index radio is set before anything else is typed, since it
governs how the site reads the K values. Its two labels ("K Index 1.3375" /
"K Index 1.332") can share a single DOM node, in which case a label-anchored
lookup resolves both to the same radio — so `locateKIndexRadio` tries, in
order: the `value` attribute; the labels, but only when they resolve to
different controls; and document order, but only when the form's radios are
exactly that pair. If none of those decide it, a **non-default** index
aborts the run rather than let the site calculate against its default and
return plausible wrong powers; failing to confirm the default only adds a
warning, since that is the state the page loads in. Verified against mock
forms in all three shapes plus an undecidable one.

## Cloudflare bot protection — why a browser window sometimes opens

An inspect run confirmed `calc.apacrs.org` sits behind Cloudflare bot
protection (the "Just a moment..." Turnstile page). This project
deliberately does **not** try to evade that protection. Runs start in an
invisible browser; when Cloudflare challenges (it's intermittent), the run
automatically restarts in a **visible** window so the person at the
machine can complete the verification by hand, and the automation
continues on its own once the calculator loads (it waits up to 3
minutes). Most runs never show a window at all. Set `BARRETT_HEADLESS=1`
to forbid the visible fallback; challenged runs then fail with a clear
error. If truly unattended automation is ever needed, ask APACRS about
sanctioned programmatic access rather than working around their
protection.

## Notes

- The form reads "Lens Factor ... or A Constant" — alternatives, so only
  Lens Factor is filled (the user's verified manual run shows the site
  pairing Lens Factor 1.57 with A Constant 118.4, this practice's exact
  constants). Filling both is suspected of silently blocking Calculate.
  With a named lens neither is filled — see "Lens selection" above.
- Lens Thickness and WTW are per-eye fields in the form's "Optional:"
  block and are filled only when the request carries them (they are typed
  by hand in the frontend, never scanned).
- After filling, every value is read back and compared; if anything landed
  in the wrong box the run aborts *before* clicking Calculate — a wrong box
  means a wrong surgical calculation.
- Patient Name is always filled with a neutral "-" placeholder (never
  real patient data): the site requires it before rendering the
  "Recommended IOL" summary line. Doctor Name / Patient ID stay blank
  (they were blank on the successful manual run). alert()-style validator
  popups are captured and included in error messages.
- Success is detected by the populated "IOL Power | Optic | Refraction"
  results tables (a verified live run showed these render even when the
  "Recommended IOL" summary is absent); the summary values are parsed
  into `recommended` when present, OD's line before OS's in document
  order.
- On failure, a full-page screenshot + HTML dump land in
  `backend/diagnostics/` (gitignored; contains the entered clinical
  numbers, never PHI) — the error message names the exact files.
- Results are scraped from the "Right Eye (OD)" panel onward, and the
  per-eye "Recommended IOL" powers are parsed into the response's
  `recommended` field.
- No database, no request logging of clinical values — the process is
  stateless by design (see the privacy section in the root README).
- CORS is open (`cors()` with defaults) since this is meant to sit behind
  your own frontend's origin config; tighten this before exposing it
  publicly.
