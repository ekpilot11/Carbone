# Backend: Barrett Universal II automation

Express server exposing `POST /api/calculate`, which drives a headless
Chromium (via Playwright) to fill scanned/reviewed clinical values into
https://calc.apacrs.org/barrett_universal2105/ and scrape back the results.

## ⚠️ Field mapping is screenshot-derived, not yet verified end-to-end

This code was written in a sandbox where outbound requests to
`calc.apacrs.org` were blocked at the network level. The field mapping in
`src/barrett.ts` (`PER_EYE_FIELDS` / `SINGLE_FIELDS`) was transcribed from
a screenshot of the live form's "Patient Data" tab (July 2026): per-eye
rows labeled Axial Length / Measured K1 / Measured K2 / Optical ACD /
Refraction / Lens Thickness with the (R) input before the (L) one, plus
form-wide Lens Factor and A Constant singles. Because the page likely has
no programmatic label-input association, the locator anchors on the visible
label text and takes the next form control in document order — plausible,
but unconfirmed against the real DOM. Before trusting this in any real use:

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

5. Run an end-to-end request against the real site and read the response
   `resultsText` to confirm it's sane before removing/relying past the
   `warning` field the API currently always returns.

Until this verification happens, every `/api/calculate` response includes
a `warning` telling the caller to double-check results manually — don't
remove that until step 5 above is actually done.

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

## Notes

- A live run showed the form fills fine but Calculate silently does
  nothing until the identity fields are non-empty. The automation first
  clicks Calculate as-is; if no "Recommended IOL" text appears, it fills
  Doctor Name / Patient Name / Patient ID with a neutral "-" placeholder
  (never real patient data) and clicks once more. Results are then
  scraped from the "Right Eye (OD)" panel onward, and the per-eye
  "Recommended IOL" powers are parsed into the response's `recommended`
  field.
- No database, no request logging of clinical values — the process is
  stateless by design (see the privacy section in the root README).
- CORS is open (`cors()` with defaults) since this is meant to sit behind
  your own frontend's origin config; tighten this before exposing it
  publicly.
