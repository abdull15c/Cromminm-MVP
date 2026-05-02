# Browser Profiles MVP (Safe)

This project is a safe MVP for isolated browser profiles used in QA/testing workflows.

## Structure

- `desktop` - Electron + React UI for profile management
- `local-api` - Local Fastify API on `127.0.0.1` (default port **8787**, override with `PORT`)
- `shared/` - fingerprint DB (`fingerprints.json`), bundled into the desktop build
- `CromminmCore/` - optional separate Chromium patch/build pipeline (not wired into this MVP; profiles use Playwright Chromium)

## Quick start

1. Install dependencies:

   ```bash
   npm install
   npm install --prefix desktop
   npm install --prefix local-api
   ```

2. Run everything:

   ```bash
   npm run dev
   ```

3. Desktop window opens and uses local API.

### Ports

- Default API port is **8787**. Set `PORT` or `LOCAL_API_PORT` before starting Electron to match; packaged builds pass `PORT` into the forked API process automatically.

## Local API

- `GET /health`
- `GET /profiles`
- `POST /profiles` with `{ "name": "QA 1", "proxy": "socks5://host:port" }`
- `PUT /profiles/:id` with `{ "name": "Updated", "proxy": "http://host:port" }`
- `DELETE /profiles/:id`
- `POST /profiles/:id/start`
- `POST /profiles/:id/stop`
- `GET /profiles/export`
- `POST /profiles/import` with `{ "mode": "merge", "items": [{ "name": "A", "proxy": "http://host:port" }] }`
- `POST /proxy/check` with `{ "proxy": "http://host:port" }`
- `POST /automation/run` with `{ "scenario": ..., "sessionProfile": ..., "baseUrl": "https://...", "runtimeOverrides": { ... } }` — UI-triggered runs set `ALLOW_AUTOMATION` for the runner; CLI still requires `ALLOW_AUTOMATION=true` in `.env`.
- `DELETE /profiles/:id/cookies/:name?domain=...&path=...` — **`domain` required**, unless `all=true` (delete every cookie with that name)
- `GET /automation/status`
- `GET /automation/report/latest`
- `POST /automation/report/latest/open`

## Notes

- This MVP is for legal use-cases only (testing, isolated sessions, automation).
- It does not include anti-fraud bypass functionality.

## Playwright automation (safe)

This repository also includes a safe Playwright runner for allowed QA automation scenarios.

1. Copy config:

   ```bash
   copy .env.example .env
   ```

2. Enable run and set target URL in `.env`:
   - `ALLOW_AUTOMATION=true`
   - `BASE_URL=https://your-allowed-site.example`
   - `SCENARIO=visit` (`visit`, `search`, `snapshot`)
   - `SESSION_PROFILE=auto` (`auto`, `australia_desktop`, `australia_mobile`, `low_end_mobile`, `mid_range_laptop`, `high_end_desktop`, plus legacy profiles)
   - Optional realism/perf: `READING_DURATION_MS`, `DEVICE_SCALE_FACTOR`, `HAS_TOUCH`, `HARDWARE_CONCURRENCY`, `DEVICE_MEMORY`
   - Optional geolocation alignment: `GEO_LAT`, `GEO_LON`, `GEO_ACCURACY`

3. Install browser:

   ```bash
   npm run automation:install-browsers
   ```

4. Run:

   ```bash
   npm run automation:run
   ```

Outputs are stored in `automation/output/<timestamp>/` (log + screenshot).
Each run also writes `report.json` with run metadata and step-level status.
The runner includes safe UX helpers (`humanType`, `safeClick`, visibility checks) and metrics.
