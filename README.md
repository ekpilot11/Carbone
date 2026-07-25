# IOL Power Calculator Assistant

Scans an ophthalmology biometry/topography printout with a phone camera,
reads the keratometry (K1/K2) and biometry (axial length, ACD) values with
on-device OCR, and — after you review and complete the remaining clinical
inputs — drives the [Barrett Universal II calculator](https://calc.apacrs.org/barrett_universal2105/)
to compute IOL power recommendations for cataract surgery.

## ⚠️ Medical disclaimer

This is a data-entry convenience tool, not a clinical decision system. It
does not replace clinical judgment, and every value — especially anything
read by OCR — must be verified before being used in surgical planning. The
app enforces a manual review step before any calculation runs, and always
shows a manual fallback (copy values / open the calculator yourself) in
case the automation fails.

## Privacy

Biometry/topography photos are OCR'd **entirely in the browser** (via
Tesseract.js) — the images themselves are never uploaded anywhere. Only the
confirmed numeric clinical values (K1/K2, axial length, ACD, IOL
model/constant, target refraction) are sent to the backend, which discards
them once the calculation completes; nothing is logged or persisted.
Patient-identifying information (name, ID, date of birth, address, etc.)
that may appear elsewhere on a printout is never read or transmitted by
this app — keep those photos off any device/session you don't control, and
handle them per your clinic's data protection policy (e.g. LGPD in Brazil).

## Architecture

- **`frontend/`** — React + Vite app. Camera capture (live `getUserMedia`
  view or native photo upload), client-side OCR, regex-based parsing of the
  two printout formats into structured values, an editable review form, and
  the results view.
- **`backend/`** — Express server with a Playwright automation
  (`POST /api/calculate`) that fills the confirmed values into the Barrett
  Universal II calculator and scrapes back the results.

## Important limitation: the Barrett automation is unverified

This project was built in a sandboxed environment whose outbound network
was policy-blocked from reaching `calc.apacrs.org`. The Playwright
automation in `backend/src/barrett.ts` was therefore written from general
knowledge of the calculator's typical layout, not from the live page — its
field selectors need to be confirmed before you rely on it. See
[`backend/README.md`](backend/README.md) for how to do that with `npm run
inspect`. Until then, treat any `warning` in the API response as a hard
requirement to double-check results manually, and use the app's "Copy
values" / "Open calculator manually" buttons as your primary path if in
doubt.

## Setup

### Backend

```bash
cd backend
npm install   # also downloads a Chromium build for Playwright
npm run dev   # listens on :4000
```

See [`backend/README.md`](backend/README.md) for selector verification and
deployment notes.

### Frontend

```bash
cd frontend
npm install
npm run dev   # listens on :5173, proxies /api to the backend on :4000
```

`Upload photo` and the live camera both work at `http://localhost:5173` on
the machine you're running this on, no extra setup needed.

## Using it on your phone (temporary link)

Browsers only allow camera access over HTTPS (or on `localhost` itself), so
reaching the dev server from your phone over plain LAN HTTP (`http://192.168.x.x:5173`)
won't let it use the camera. The fix is a single HTTPS tunnel to the
frontend's port — the frontend's dev server proxies `/api` calls to the
backend internally, so you only need to tunnel one port, not two.

With both `npm run dev` commands above running, in a third terminal:

```bash
npx ngrok http 5173
```

(No ngrok account needed for a quick anonymous session; sign up at
ngrok.com and run `ngrok config add-authtoken <token>` first if prompted.
Any HTTPS tunnel tool — Cloudflare Tunnel, etc. — works the same way.)

Open the `https://....ngrok-free.app` URL it prints on your phone. The link
stops working once you kill the `ngrok` process or the `npm run dev`
servers — it's meant for trying the app out, not for daily clinical use.
For that, deploy the frontend and backend properly (e.g. Vercel + Render)
so you get a stable HTTPS URL — ask if you'd like help setting that up.

## Testing

```bash
cd frontend && npm test    # OCR parsing + form-state unit tests
cd frontend && npm run build
cd backend && npm run build
```
