# Door-to-door Laundry Platform

Static owner, rider and customer-booking pages for a laundry aggregator. GitHub Pages hosts the UI; Supabase supplies Postgres, Auth, RLS, Realtime and Edge Functions. No production build or application server is required.

- **Owner:** Today, order list/board and history, pending approvals, customers/personal links, shops, dispatch copy lists, server-calculated financial reports/CSV, A4 bag labels, settings, staff and rider pay.
- **Rider:** shared pickup/delivery route, large permanent bag codes, call/text/maps, constrained status actions, 60-second undo, problem reports, durable offline-action retries and refresh.
- **Customer:** no-login multi-step booking with Turnstile, private returning-customer links, live service settings, English/Filipino and server-confirmed per-load pricing.

## Start here

Follow [docs/SETUP.md](docs/SETUP.md) for account setup and deployment. This checkout has no Supabase credentials or production accounts configured. Until you connect them, staff pages show setup instructions and booking is unavailable; this is deliberate, not a demo database.

For local static development (Node.js 24+):

```sh
npm ci
npm start
```

The development server binds loopback port 3000 (`PORT` overrides it). The site is also usable from any ordinary static HTTP server. Do not open HTML through file://. Set public project values in shared/config.js after following the setup guide. No keys are needed to run local tests.

```sh
npm test                       # unit + actual edge handlers with mocked services
npm run test:db                 # temporary real PostgreSQL; Linux x64
npm run check:edge              # Deno type checks
npm start                      # keep running in another terminal for browser tests
npm run test:browser            # Chromium; API/Turnstile mocks, no real bookings
```

Browser tests default to `/usr/bin/chromium`; override CHROMIUM_PATH if needed. TEST_BASE_URL overrides the local test address. For another OS, use Supabase’s local stack or a disposable Postgres database to port the database runner; deployment itself requires no Node/Postgres installation.

Supabase JS is pinned and vendored in shared/vendor. `npm run vendor` reproduces it from package-lock.json; this is a maintenance command, not a deployment build step. `node scripts/icons.mjs` regenerates PNG icons from the SVG while the local server runs. Follow [SECURITY.md](docs/SECURITY.md) before handling real customer data.

See [DECISIONS.md](docs/DECISIONS.md) for defaults and scope and [TESTING.md](docs/TESTING.md) for tested versus untested acceptance items. Live Supabase/Turnstile/Pages acceptance and native translation/privacy reviews remain launch prerequisites.
