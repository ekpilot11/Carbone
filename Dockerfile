# One image, one port, one URL: the backend serves the built frontend, so the
# phone and the hospital PC open the same address and there is no CORS to
# configure. Built from node + `playwright install` rather than Microsoft's
# prebuilt image, so it also builds on the ARM machines the free cloud tiers
# hand out.

# --- the app --------------------------------------------------------------
FROM node:22-bookworm-slim AS frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# --- the server -----------------------------------------------------------
FROM node:22-bookworm-slim AS backend
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json* ./
# --ignore-scripts skips Playwright's browser download here; the runtime
# stage below installs the browser once, where it is actually used.
RUN npm install --ignore-scripts
COPY backend/ ./
RUN npm run build

# --- what actually runs ---------------------------------------------------
FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app

COPY backend/package.json backend/package-lock.json* ./backend/
RUN cd backend && npm install --omit=dev --ignore-scripts

# Chromium plus its system libraries, and Xvfb: when Cloudflare challenges,
# the automation opens a *visible* browser for a person to click in, and a
# visible browser needs a display even on a headless server. The app shows
# that window to whoever is using it (see /api/challenge).
#
# xauth comes with it deliberately. It is a separate package from xvfb, and
# anything that wraps Xvfb (xvfb-run) dies without it — which took the whole
# container down before the server could start. The entrypoint no longer
# depends on it, but X tooling reaches for it often enough to be worth the
# few hundred kilobytes.
RUN cd backend && npx playwright install --with-deps chromium \
    && apt-get update && apt-get install -y --no-install-recommends xvfb xauth \
    && rm -rf /var/lib/apt/lists/*

COPY --from=backend /app/backend/dist ./backend/dist
COPY --from=frontend /app/frontend/dist ./frontend/dist
COPY start-lens.sh /usr/local/bin/start-lens.sh
RUN chmod +x /usr/local/bin/start-lens.sh

ENV FRONTEND_DIST=/app/frontend/dist
# Mount a volume here: this is where a Cloudflare clearance a human earned
# survives a restart. Losing it costs another verification, nothing more.
ENV BARRETT_PROFILE_DIR=/app/browser-profile
ENV PORT=4000
EXPOSE 4000

CMD ["/usr/local/bin/start-lens.sh"]
