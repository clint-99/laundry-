# SQLite validation record

This replaces the previous Supabase-only acceptance record. Tests run against a real temporary SQLite database and the real HTTP server. Browser tests use actual password login/session cookies, the local booking challenge and real APIs, with **no backend/auth/captcha mocks**. They do not add sample accounts or customers to the normal data directory.

## Results (2026-10-17)

| Command / check | Result | What it demonstrates |
|---|---|---|
| `npm ci` | Passed | Only development tools installed; runtime needs no npm packages |
| `npm test` | 22 passed; 0 failed/skipped | 14 real HTTP/SQLite integration subtests, their parent test and 7 unit/source checks |
| `npm run test:browser` | 10 real workflow groups passed | First-owner setup, login, CRUD, actual rider/public booking flows, local verification, SSE, offline sync, printing and PWA |
| `npm audit` | No known vulnerabilities | Locked development dependencies at test time; not a complete security audit |
| Static/runtime checks | Passed | All app pages/assets load; private data/server/Git paths denied |
| Backup and restore validation | Passed | Owner-only consistent SQLite backup opens independently, integrity_check=ok, correct order count |
| Persistence | Passed | Accounts, business records and audit history remain after closing/reopening the server/database |

The current branch has no Supabase client, SQL/RLS migrations, Edge Functions, cloud API keys, or Turnstile dependency. Old SQL tests are intentionally superseded by the actual API-role tests. The working app uses the Node server. GitHub Pages publishes only an informational setup/download notice.

## macOS Monterey compatibility

The full 22-test suite and 10 real browser workflow groups also passed using **Node.js 22.23.3** on Linux. Node 22.16 is the minimum because the full-backup API was introduced in that release. Official Node 22 x64 binaries support macOS 11+, while Node 24 binaries require macOS 13.5+. This gives Monterey 12.7.6 an official Node runtime option. The specific late-2015 Mac was not available for physical testing. On Node 22, the SQLite ExperimentalWarning is expected and is not a failed test.

## Integration coverage

- Owner bootstrap needs the private one-time code. Wrong codes fail; setup closes after first account. No default owner credentials are shipped.
- Passwords are hashed, session cookies are HttpOnly/SameSite, and session API does not reveal tokens/hashes. Anonymous tables/actions are denied. Cross-origin writes, missing custom request headers, non-JSON requests and oversized bodies are rejected.
- Every rider table read/insert/update/delete on orders/customers/shops/services/settings/pay is denied, as are owner-only status/report/link functions. Rider tasks have no money/token fields. Private customer notes are not returned.
- Owner configures business rules, partner shop, customer and a rider; creates a real order; server generates its price/cost snapshot and total. Forged prices and direct status changes fail.
- All **64** from/to rider status combinations are checked. Only placed→picked_up, picked_up/weighed→at_shop and ready→delivered succeed. Undo tests cover pickup/drop-off/delivery, expiry and retry deduplication.
- Alternate-delivery tasks use delivery address/area and omit pickup coordinates/landmarks. Full pickup→shop→ready→delivery history is recorded. The report verifies ₱380 revenue − ₱250 shop − ₱100 rider = ₱30 margin, ₱15/load.
- Returning lookup exposes no phone/full address; address/customer/money tampering is discarded. A second active rebooking is refused. A request UUID returns the same receipt on a retry.
- New booking fails without a correct, IP-bound, short-lived challenge; one successful challenge cannot create a second new request. Known phones do not duplicate customers or overwrite their saved address. New orders wait for approval.
- Pickup capacity, an atomic rate-limit counter, invalid/reset/blocked personal links, owner-only backup and immediate rider deactivation are tested.
- A complete backup opens as SQLite independently with integrity_check=ok. Restart preserves rows. Triggers refuse hard deletion of orders. Public routes cannot fetch the database, server files or Git metadata.

## Browser workflow groups

1. Fresh installation → first-owner setup → real cookie-based login.
2. Owner settings, customer, shop and rider creation through actual forms/API.
3. Manual order and server price; hostile `<img src=x onerror=alert(1)>` is rendered as literal text, not an image/script.
4. Rider login and permission-safe route; a real offline browser queues a tap, reconnects, syncs and undoes it.
5. Rider pickup/drop-off, owner ready, rider delivered; live owner refresh and report values.
6. New customer multi-step form → local human answer → SQLite pending order → live owner approval through EventSource.
7. Personal link rebooking in the same already-open customer tab; fragment clears and a real order is created.
8. Owner downloads an actual full SQLite backup through the Staff page.
9. Owner layout at 360/768/1440 pixels, dark booking at 360, and A4 print CSS/label generation.
10. Service worker caches static shell only; an offline cold-start sign-in gives a visible error and caches no API/customer data.

Two defects found by these tests were corrected: stacked undo toasts covering rider buttons, and same-tab personal-link navigation retaining an old receipt/request ID. Screenshot artifacts are under `/tmp/laundry-sqlite-screenshots/` in this development machine; they are not committed or deployed.

## Pretend-data trial before real use

1. Follow SETUP.md on the intended host. Create your own owner account, a test rider and a pretend customer with a number you control. Use separate browser profiles for owner and rider.
2. Keep the host awake. Configure actual areas, services, shops and timezone; temporarily open bookings for the trial. Start on the same computer before testing phones.
3. Create a manual order, match the bag code on the rider screen, complete pickup→shop→ready→delivered and inspect history/reports. Try Undo within 60 seconds, then try after it expires. A rider must not mark an order ready/cancelled or see money/costs.
4. Use a private personal link: correct first name/area, no full saved address/phone. Book once and try again: the active-order check must refuse a duplicate. Reset/block the link and verify the old link fails generically.
5. New customer request: fill the form, test a wrong/missing math answer, then a correct answer. It must appear only in Pending until approved. Repeat with an existing test phone and verify the saved address is unchanged; review submitted details in history before approval.
6. On a phone, disable the network with a task page already open, tap pickup, confirm Waiting to sync. Reconnect and verify one audit transition only. Test a competing owner change before syncing: the conflicting tap must stay visible until retry/resolution. Do not clear storage while actions are pending.
7. Deactivate/reset the test rider while signed in. Next server request must be denied. Test sign-out, a wrong password and successful login; no stored raw passwords or browser auth tokens should appear.
8. Change price/capacity/cutoff in Settings. Refresh booking without redeploying: available dates/prices must reflect the server. Previously saved order snapshots must remain unchanged.
9. Download a full backup. Restore it into a **different** DATA_DIR/PORT, preserving the original data directory and never mixing another database's WAL/SHM sidecars. Verify an account, settings, a customer and order history. Delete test restore copies only after verification; keep encrypted off-host backups.
10. Check full keyboard navigation, Filipino copy, actual phone readability, Safari/Chrome and physical A4 sticker alignment. Have privacy/retention reviewed locally. Cancel pretend orders with audit reasons; do not delete business history.
11. For real LAN/internet use, verify HTTPS on actual devices before entering real customer data/passwords. Configure PUBLIC_ORIGIN, persistent storage, firewall/reverse proxy, availability and recovery. The math check is not bot-proof; add monitored trusted-edge protections if internet traffic requires them.

## Not claimed / not run here

- Public internet hosting, real HTTPS/domain/firewall setup, OS service installation or availability after your computer sleeps.
- Real phones on the owner's Wi-Fi, physical printer alignment, native Filipino review, legal/privacy review or a WCAG certification.
- Docker build/run on a production host (configuration can be checked separately). Docker is optional; Node tests exercise the actual application.
- Migration of an independently populated Supabase project. No such project/data was supplied. An old SQLite prototype file is left untouched and not imported.
- Restore/publish validation in a new cloud task. A saved environment draft is not public deployment or a guaranteed permanent host.
