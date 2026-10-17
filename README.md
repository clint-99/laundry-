# Fresh Fold — Laundry Platform

A laundry pickup/delivery app with **SQLite storage and local staff accounts**. No Supabase, cloud database subscription, API keys, Turnstile account, or runtime npm dependencies are required.

- **Owner:** orders and audit history, pending approvals, customers and personal booking links, shops, dispatch, financial reports, bag labels, business settings, rider accounts/pay, CSV and full database backups.
- **Rider:** pickups/deliveries, call/text/maps, constrained status actions, 60-second undo, problem reports and a durable offline-action queue.
- **Customer:** no-login booking, personal returning links, a local human check, configurable per-load prices and English/Filipino copy.

## Run it

Install **Node.js 24 LTS** from [nodejs.org](https://nodejs.org/). Download this repository (GitHub → Code → Download ZIP) and extract it. On Windows double-click `start.cmd`; on macOS/Linux run `./start.sh`. Or use a terminal:

```sh
node server/app.js
```

Open the running app on port 3000 in your browser. On first run, choose **Create owner account**, read the one-time code from `data/setup-code.txt` on the server computer, and choose your own email/password. No pre-made passwords exist. See [docs/SETUP.md](docs/SETUP.md) for exact steps.

The database lives at **`data/platform.sqlite`**. It stays on disk when the server restarts. Preserve the whole `data/` directory, and download full database backups from **Staff** regularly. Never upload the data directory or backups to GitHub.

**GitHub stores the code; it cannot run this SQLite server through GitHub Pages.** The Pages workflow publishes only a setup/download notice, not a nonworking booking screen. To use phones over Wi-Fi, run the server on an always-on computer on that network. Public internet access needs a host you control and HTTPS; SQLite itself has no subscription. Hosting, connectivity and electricity may still cost money. Do not enter real data into a publicly exposed HTTP service.

## Development and testing

No installation is required to run the app itself. Development tests use Node and Playwright:

```sh
npm ci
npm test
npm run test:browser
npm run backup
```

The browser suite starts its own temporary server/database and exercises real account setup, logins, owner/rider/customer flows, offline sync and backups without backend mocks. It defaults to `/usr/bin/chromium`; set CHROMIUM_PATH for your Chrome/Chromium executable. npm test includes real HTTP/SQLite security and persistence tests. Tests never populate the real database. Full details: [docs/TESTING.md](docs/TESTING.md).

Docker is optional: `docker compose up --build -d`. The persistent named volume stores your data. First-run instructions and HTTPS/LAN configuration are in SETUP.md. Review [docs/SECURITY.md](docs/SECURITY.md) before internet deployment. The previous Supabase version remains in Git history; it is no longer required or deployed by this version.
