#!/bin/sh
# Starts a virtual display, then the server.
#
# The display exists for one reason: when Cloudflare challenges, the
# automation opens a *visible* browser window for a person to click in (the
# app shows it to them — see /api/challenge), and a visible browser needs
# somewhere to draw. Headless runs don't care.
#
# Deliberately not `xvfb-run`: that wrapper shells out to `xauth`, which is a
# separate Debian package, and when it is missing the wrapper exits — taking
# the whole container with it before the server ever starts. Starting Xvfb
# directly has no such dependency.
set -e

DISPLAY_NUM="${DISPLAY_NUM:-99}"
Xvfb ":${DISPLAY_NUM}" -screen 0 1280x900x24 -nolisten tcp &
export DISPLAY=":${DISPLAY_NUM}"

# Give it a moment to create its socket, then say plainly whether it came up.
# A missing display must not stop the server: every ordinary calculation is
# headless and works without one. Only the challenge window needs it, so a
# failure here is a warning, not a crash.
for _ in 1 2 3 4 5 6 7 8 9 10; do
  [ -e "/tmp/.X11-unix/X${DISPLAY_NUM}" ] && break
  sleep 0.2
done

if [ -e "/tmp/.X11-unix/X${DISPLAY_NUM}" ]; then
  echo "Virtual display ${DISPLAY} ready (for Cloudflare challenge windows)."
else
  echo "WARNING: no virtual display — calculations will still run, but a" \
       "Cloudflare challenge cannot be shown for anyone to complete."
fi

exec node backend/dist/server.js
