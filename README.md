# IOL Power Calculator Assistant

Photograph the ophthalmology exam printouts once — keratometry strip and
A-scan biometry together — and a vision model reads the keratometry (K1/K2)
and biometry (axial length, ACD, plus lens thickness and WTW when they're
printed) for both eyes. After you review and complete the remaining
clinical inputs, the app drives the
[Barrett Universal II calculator](https://calc.apacrs.org/barrett_universal2105/)
to compute IOL power recommendations for cataract surgery, and can save the
whole thing as a PDF record.

## ⚠️ Medical disclaimer

This is a data-entry convenience tool, not a clinical decision system. It
does not replace clinical judgment, and every value — especially anything
read by OCR — must be verified before being used in surgical planning. The
app enforces a manual review step before any calculation runs, and always
shows a manual fallback (copy values / open the calculator yourself) in
case the automation fails.

## ⚠️ Privacy — photos leave the device when scanning is enabled

**Read this before pointing the app at real patients.**

Photos are read by a vision model through the Anthropic API. **The
photograph is transmitted off the clinician's machine.** In-browser OCR
could not read photographed thermal printouts reliably, and this was the
deliberate trade made to fix that.

What this means in practice:

- The image is sent as it was captured. If the frame includes a patient
  name, record number, CPF, or date of birth, **that is transmitted too.**
  A single wide shot of both printouts makes this easy to do by accident —
  frame on the two measurement strips and keep the patient's paperwork out
  of the picture.
- The prompt instructs the model to return only clinical numbers and never
  a patient identifier, and the server validates the response against
  physiologic ranges — but that constrains what comes *back*, not what is
  *sent*.
- Nothing is written to disk or logged by this app: the image is held in
  memory for the duration of the request and discarded.
- **Check this against your institution's data protection rules (LGPD in
  Brazil) before clinical use.** Sending identifiable patient data to a
  third-party processor is a decision for your institution, not one this
  README can make for you.

**To keep photos on-device instead**, leave `ANTHROPIC_API_KEY` unset. The
app falls back to in-browser OCR (Tesseract.js) automatically — no image
leaves the machine, at the cost of much weaker reading of faded printouts;
expect to type more values by hand.

Either way, the confirmed numeric values (K1/K2, axial length, ACD, target
refraction) are sent to the Barrett calculator to compute IOL power, and
nothing is persisted anywhere.

## Architecture

- **`frontend/`** — React + Vite app. A single camera capture (live
  `getUserMedia` view or native photo upload), image downscaling, an
  editable review form laid out like the calculator's own (measurements,
  then its "Optional:" block), the results view, and the PDF record.
  Carries the on-device OCR fallback (Tesseract.js plus format-specific
  parsers) used when no vision model is configured.
- **`backend/`** — Express server: `POST /api/scan` reads one photograph of
  the printouts with a vision model and returns range-validated values for
  both eyes, `POST /api/calculate` drives a Playwright automation that
  fills those values into the Barrett Universal II calculator and scrapes
  back the results, and `GET /api/lenses` reads the calculator's lens list
  so the app's dropdown matches the site exactly.

## Lens choice

The lens dropdown mirrors the calculator's own "Personal Constant" menu.
Picking a lens here makes the automation pick the same option on the site,
so **the site applies that lens's constants itself** — no manufacturer
A-constants are stored in this app, where they could quietly go out of
date. "Personal Constant" (the default) is the one case where this
practice's own A-Constant 118.4 / Lens Factor 1.57 are sent. Whichever was
used is read back off the page and shown with the results.

If a lens name ever stops matching the site's list, the run stops and the
error names every option the site offers — it never silently substitutes a
different lens.

## Medical record (PDF)

After a calculation, the results view offers a one-page PDF holding K1/K2,
axial length, ACD, the optional values, the lens and constants used, and
each eye's IOL power table with the option closest to plano marked. The
patient's name is typed in for the record — the scan deliberately refuses
to read identifiers off the photograph — and **the PDF is built and saved
entirely in the browser**, so nothing in it is transmitted anywhere.

## Status: verified working (2026-08-01)

The automation was verified end-to-end against the live calculator: an
automated run returned IOL Power tables identical to a manual run with the
same inputs. Two operational notes:

- `calc.apacrs.org` sits behind Cloudflare bot protection. Runs are
  invisible by default; when Cloudflare challenges (intermittently), a
  **visible** browser window opens so the person at the machine can
  complete the verification by hand — this project deliberately does not
  evade bot protection. See [`backend/README.md`](backend/README.md).
- If the site's form layout ever changes and runs start failing, re-pin
  the selectors with `npm run inspect` per the backend README, and fall
  back to the app's "Copy values" / "Open calculator manually" buttons
  meanwhile.

## Setup

### Backend

```bash
cd backend
npm install   # also downloads a Chromium build for Playwright

# Optional — enables vision-model photo scanning. Leave unset to keep photos
# on-device (weaker reading; see the privacy section above).
export ANTHROPIC_API_KEY=sk-ant-...

npm run dev   # listens on :4000
```

Get an API key from [console.anthropic.com](https://console.anthropic.com).
Scanning costs a few cents per photo.

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
