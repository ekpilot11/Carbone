# Backend: Barrett Universal II automation

Express server exposing `POST /api/calculate`, which drives a headless
Chromium (via Playwright) to fill scanned/reviewed clinical values into
https://calc.apacrs.org/barrett_universal2105/ and scrape back the results.

## ⚠️ Selectors are unverified — do this first

This code was written in a sandbox where outbound requests to
`calc.apacrs.org` were blocked at the network level, so the field selectors
in `src/barrett.ts` (`FIELD_LABELS`) are a best guess based on the
calculator's typical layout, not a confirmed match to the live DOM. Before
trusting this in any real use:

1. From a machine with normal internet access, run:

   ```bash
   npm install
   npm run inspect
   ```

   This prints every input/select/textarea on the live page (its label
   text, `id`, `name`, `placeholder`) plus every button's text, as JSON.

2. Compare that output against `FIELD_LABELS` in `src/barrett.ts`. Update
   the label strings so `page.getByLabel(...)` actually matches, and
   confirm the assumption that OD's inputs come before OS's in DOM order
   (search for `eyeIndex` in `barrett.ts` — if the site's layout puts OS
   first, or nests OD/OS in separate containers instead of relying on
   document order, rewrite `fillFieldForEye` to scope by container instead).

3. Also confirm the "Calculate" button's accessible name and how results
   are rendered, and adjust `extractResultsText` in `barrett.ts` if the
   heuristics there (look for an "IOL Power" heading, else the last
   `<table>`, else the whole page) don't land on the right content.

4. Run an end-to-end request against the real site and read the response
   `resultsText` to confirm it's sane before removing/relying past the
   `warning` field the API currently always returns.

Until this verification happens, every `/api/calculate` response includes
a `warning` telling the caller to double-check results manually — don't
remove that until step 4 above is actually done.

## Running

```bash
npm install     # also runs `playwright install chromium` (postinstall)
npm run dev      # ts-node-style dev server on :4000, via tsx
npm run build && npm start   # compiled
```

Environment: `PORT` (default `4000`).

## Endpoints

- `POST /api/calculate` — body: `{ od: EyeInput, os: EyeInput }` (see
  `src/types.ts`). Returns `{ resultsText, warning? }` on success, or
  `{ error }` with a 4xx/5xx status.
- `GET /healthz` — liveness check.

## Notes

- No database, no request logging of clinical values — the process is
  stateless by design (see the privacy section in the root README).
- CORS is open (`cors()` with defaults) since this is meant to sit behind
  your own frontend's origin config; tighten this before exposing it
  publicly.
