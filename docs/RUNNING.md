# Setting it up on a Windows PC, from nothing

The runbook for putting the app on the machine that will host it. Written
for the clinic PC, where nothing is installed yet.

Two things to settle before you start:

- **You need administrator rights on that machine.** Docker Desktop and WSL
  both need them, and a managed hospital PC often won't grant them without
  IT. Find out before you plan a morning around this.
- **The app handles patient data.** Photos go to the Anthropic API for
  reading (unless you leave the key out), records pass through the server,
  and the address it gets is reachable from the internet. That's your
  institution's decision to make, not this file's.

---

## 1. Install Git

Download from [git-scm.com/download/win](https://git-scm.com/download/win)
and install with the defaults.

## 2. Install Docker Desktop

In **PowerShell as Administrator**:

```powershell
wsl --install
```

Reboot if it asks. Then install **Docker Desktop** from
[docker.com/products/docker-desktop](https://www.docker.com/products/docker-desktop),
launch it, and wait until it says *Engine running*.

In Docker Desktop's **Settings → General**, tick **Start Docker Desktop when
you log in**. That is what brings the app back after a Windows update
reboots the machine.

## 3. Get the code

Open a **new, normal** PowerShell window (not the admin one — and new, so it
knows about the programs you just installed):

```powershell
cd $HOME
git clone -b claude/eye-test-lens-calculator-d2ow2m https://github.com/ekpilot11/LensCalc.git
cd LensCalc
```

## 4. Put the API key in a file

```powershell
notepad .env
```

Say yes to creating it. One line, then save and close:

```
ANTHROPIC_API_KEY=sk-ant-api03-...
```

Get a key from [console.anthropic.com](https://console.anthropic.com). Leave
this file out entirely and the app still works — it falls back to reading
photos in the browser, which is much weaker on faded printouts, but no image
leaves the machine.

`.env` is ignored by Git, so the key can't be committed by accident.

**If port 80 is already taken** on this machine (managed PCs often run
something on it), add a second line and use `http://localhost:8080`
everywhere below instead of `http://localhost`:

```
HOST_PORT=8080
```

## 5. Build and start

```powershell
docker compose up -d --build
```

Five to ten minutes the first time — it compiles the app and downloads
Chromium. Afterwards it's seconds.

## 6. Check it

```powershell
docker compose ps
docker compose logs --tail 20
```

`ps` must say **running** (not `Restarting`). The logs should end with:

```
Virtual display :99 ready (for Cloudflare challenge windows).
Backend listening on :4000
Serving the built frontend from /app/frontend/dist
```

Now open **http://localhost** in the browser. The app should be there.

At this point the PC itself is finished — that address works every day,
forever, with nothing to retype.

## 7. Give the phone a way in

The phone can't reach this PC directly. A tunnel gives it a public HTTPS
address that points here.

```powershell
winget install --id Cloudflare.cloudflared
```

Then, in a **new** PowerShell window:

```powershell
cloudflared tunnel --url http://127.0.0.1:80
```

It prints a boxed address:

```
+--------------------------------------------------+
|  https://some-random-words.trycloudflare.com     |
+--------------------------------------------------+
```

Open that on the phone. **Leave the window open** — closing it kills the
tunnel, and the address is different every time you start it.

---

## Using it

**On the phone** (the tunnel address): photograph the exam, upload it — one
photo, or several at once for a day's worth. Review the values. Press
**Continue on another device** and read the eight-character code.

**On the PC** (`http://localhost`): type that code under *Or pick up work
from another device*. The patients arrive with their values and any results.
Calculate, then **Copy as source code (HTML)** and paste into the hospital
system's *Código-Fonte* view.

You can also do the whole thing on one device — the handoff is there for
when the photographing and the typing happen in different places.

If the calculator site asks for a security check, it appears **inside the
app**, wherever you are. Tick "Verify you are human" and the calculation
carries on. The clearance is remembered afterwards.

## Every day after that: one double-click

**`Start Lens.cmd`**, in the project folder. It does the whole routine in
order: starts Docker Desktop if it isn't running and waits for the engine,
fetches the latest version, rebuilds, waits until the app genuinely answers,
opens it in the browser, then opens the tunnel and prints the phone address —
copying it to the clipboard as it goes.

Leave that window open while you work. Closing it stops only the phone
address; the app itself keeps running, and this computer can still use
`http://localhost`.

**Put it on the desktop:** right-click `Start Lens.cmd` → **Show more
options** → **Send to** → **Desktop (create shortcut)**. Right-click the
shortcut → Properties → Change Icon if you want it to look like an app.

The script explains itself when a step fails, and it is plain text —
`scripts/start-lens.ps1` — so it can be read and edited.

### Doing it by hand

Same thing, if you'd rather see each step:

```powershell
cd $HOME\LensCalc
git pull
docker compose up -d --build
cloudflared tunnel --url http://127.0.0.1:80
```

If `git pull` ever complains that the repository has moved, the project was
renamed on GitHub and this clone still points at the old name. GitHub
redirects for a while, but not forever:

```powershell
git remote set-url origin https://github.com/ekpilot11/LensCalc.git
```

After an update, reload the browser with **Ctrl+Shift+R** — otherwise it may
keep showing the page it had cached.

## When something is wrong

| What you see | What it is |
| --- | --- |
| `docker` / `cloudflared` *não é reconhecido* | The PowerShell window opened before the program was installed. Open a new one. |
| `ERR_CONNECTION_REFUSED` on localhost | The container isn't running. `docker compose ps`, then `docker compose logs --tail 30`. |
| `ps` says `Restarting` | It's crash-looping. The logs name the reason. |
| `port is already allocated` / `Bind for 0.0.0.0:80 failed` | Something else on that PC holds port 80. `Start Lens.cmd` offers to switch to 8080 and remembers it; by hand, add `HOST_PORT=8080` to `.env`. |
| The tunnel says *unable to reach the origin service* | The tunnel is fine; the app behind it isn't. Check `http://localhost` first. |
| A **502 Bad gateway** page appearing inside the app | Cloudflare gave up waiting. Calculations no longer hold a connection open, so this should not happen — if it does, `http://localhost` on the PC bypasses the tunnel entirely. |
| Changes don't appear after `git pull` | Ctrl+Shift+R. If that fails, `docker compose build --no-cache` then `docker compose up -d`. |

## What this setup still doesn't have

- **A login.** Anyone who has the tunnel address can use the app, and a
  handoff code is the only thing in front of a day's patient list.
- **A permanent address.** The tunnel's URL changes every time it starts. A
  fixed one needs a Cloudflare account and a domain name.
