# Backend: Barrett Universal II automation

Express server exposing `POST /api/calculate`, which drives a headless
Chromium (via Playwright) to fill scanned/reviewed clinical values into
https://calc.apacrs.org/barrett_universal2105/ and scrape back the results.

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

## Running

```bash
npm install     # also runs `playwright install chromium` (postinstall)
npm run dev      # ts-node-style dev server on :4000, via tsx
npm run build && npm start   # compiled
```

Environment: `PORT` (default `4000`).

## Endpoints

- `POST /api/calculate` — body: `{ od: EyeInput, os: EyeInput }` (see
  `src/types.ts`). `manual` holds the one clinician-entered value (target
  refraction); `iol` holds the fixed IOL design/constants from
  `src/constants.ts` (expected to be `Biconvex` / `118.4` / `1.57` for this
  practice, but still validated per-request rather than hardcoded
  server-side, so a future frontend change doesn't require a backend
  redeploy). Returns `{ resultsText, warning? }` on success, or `{ error }`
  with a 4xx/5xx status.
- `GET /healthz` — liveness check.

## Cloudflare bot protection — why a browser window opens

An inspect run confirmed `calc.apacrs.org` sits behind Cloudflare bot
protection (the "Just a moment..." Turnstile page). This project
deliberately does **not** try to evade that protection. Instead the
automation runs a **visible** browser window by default: when Cloudflare
shows its verification, the person at the machine completes it by hand,
and the automation continues on its own once the calculator loads (it
waits up to 3 minutes). The challenge is intermittent — many runs won't
show it at all. Set `BARRETT_HEADLESS=1` to force the old invisible mode;
it will fail with a clear error whenever Cloudflare challenges. If truly
unattended automation is ever needed, ask APACRS about sanctioned
programmatic access rather than working around their protection.

## Notes

- The form reads "Lens Factor ... or A Constant" — alternatives, so only
  Lens Factor is filled (the user's verified manual run shows the site
  pairing Lens Factor 1.57 with A Constant 118.4, this practice's exact
  constants). Filling both is suspected of silently blocking Calculate.
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
