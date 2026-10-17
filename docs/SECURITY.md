# Security: self-hosted SQLite

## Storage and accounts

The app runs on a Node.js 22.16+ or 24 server using its built-in SQLite library. `data/platform.sqlite` contains business records, audit history, hashed staff passwords and hashed session tokens. The data directory is private (0700 on POSIX), the database and bootstrap secret files are 0600, and it is excluded from Git and static HTTP routes. Windows access control depends on the containing user's folder permissions. No cloud provider or database subscription is required.

First-owner creation requires a random one-time code from the server's private data directory. There is no default account/password, public signup or internet email dependency. Setup closes after the first staff account exists. Passwords are salted with random 128-bit salts and hashed with Node scrypt (64-byte derived key, N=16384/r=8/p=1); comparisons are constant-time. Login failures use a generic message and are rate-limited by socket IP and email. The server never returns password hashes in session/profile APIs.

Staff sessions use random 256-bit cookies with HttpOnly, SameSite=Strict and an eight-hour expiry; only SHA-256 token hashes are stored in SQLite. `PUBLIC_ORIGIN=https://your-domain` enables Secure cookies. All state-changing browser API requests require JSON plus X-Laundry-Request and reject a mismatching Origin. The server exposes no cross-origin CORS API. Never share the app origin with untrusted web applications.

## Server permissions

Every table/action endpoint reloads the active profile. Owners can manage business data; riders cannot call the generic table API except to read their own public profile. Rider tasks have an explicit field whitelist with no price, cost, margin, private customer notes or booking token. The backend enforces the transition allowlist, same-actor/last-event/60-second undo rules and UUID idempotency. Deactivation/password reset invalidates that rider's sessions immediately. No screen-hiding rule is relied on for authorization.

SQL identifiers are chosen only from fixed server table/field allowlists; all values use bound parameters. Orders use foreign keys and constraints, generated totals, immutable order/customer codes and server-controlled price/cost snapshots. No arbitrary SQL endpoint is exposed. SQLite triggers prohibit hard deletion of orders and modification/deletion of audit events. All mutation groups use BEGIN IMMEDIATE transactions. Price/report calculations happen server-side; browser totals are estimates.

Public bookings are the only unauthenticated business-data API. public-config returns an explicit nonprivate whitelist. Returning links are 192-bit random tokens; lookup gives first name/area/own active-order summary only. The address and customer identity come from that token on the server. Blocking/resetting a link takes effect immediately. Treat personal links like passwords: whoever holds one can rebook for that customer. Tokens are read from URL fragments and removed from the address bar.

New-customer requests require a short-lived, one-use, IP-bound math challenge, consent and bounded/validated fields. Socket-IP and phone rate limits constrain abuse; a honeypot field is also rejected if present. **Math questions are not strong bot detection.** Public internet operation needs monitoring and appropriate edge protections; a capable bot can solve arithmetic. The server ignores X-Forwarded-For rather than trusting spoofable headers. Behind a proxy, callers share that proxy's socket bucket by default; configure trusted rate limiting at your HTTPS proxy when needed.

Request UUIDs deduplicate uncertain booking retries without changing a known customer's address or duplicating the saved receipt. New requests with known phone numbers wait for owner review and preserve saved contact/address data. Public capacity and duplicate-active decisions are transactional. Owner manual orders intentionally can override capacity/multiple-active limits.

## Browser and devices

CSP, no-referrer, X-Content-Type-Options and X-Frame-Options are set. Customer text uses createElement/textContent, never innerHTML. Staff HTML is noindex (not an access control). API responses use no-store. No auth token is saved in localStorage.

The rider retry queue is keyed to the signed-in profile. It stores order/action IDs, desired actions and any queued problem note, not full address/task caches. Network failures/conflicts remain visible until sync or explicit resolution. Do not clear browser data while taps wait to sync. If localStorage is unavailable, keep the page open; crash durability cannot be promised. Signing out leaves queued actions for the same account on that device.

PWA Cache Storage contains only an allowlist of static app files, never API responses, sessions, customers or task data. Offline cold-start authentication/task lookup is unavailable; the app shows a visible connection error. Previously loaded pages can queue taps. HTTPS (or loopback) is required for service workers/geolocation. The latest undo toast replaces older toasts; the database enforces whether an undo remains possible.

## Operating safely

Use an always-on computer/server with persistent disk, OS updates, TLS and backups. Bind loopback by default; do not expose raw HTTP to the internet. Set PUBLIC_ORIGIN to the exact external HTTPS origin when using a reverse proxy. Keep one Node process per SQLite database. This cloud development environment and GitHub Pages are not production hosts for the app.

Full database backups contain personal data, staff password hashes and session hashes. Download is owner-only and uses SQLite's consistent backup API. Store snapshots encrypted and outside public source folders; test restore on a separate folder. Copying only platform.sqlite while it is being written can miss WAL data—use the backup command/button or stop the app first. Before restoring a different snapshot, preserve the current folder and do not reuse old WAL/SHM sidecars.

Have local privacy/retention and Filipino copy reviewed before real use. Do not promise deletion of required accounting/audit records without legal review. Screen lock staff devices; revoke sessions by deactivating/resetting a rider after loss. There is no online password-reset email service. If the owner password is lost, a trusted server administrator must perform an audited offline password reset; do not erase business data or reopen setup as a workaround.

If source code was publicly deployed under the old Supabase version, it contained blank public configuration only. This migration removes the SDK/Edge Functions. If you independently added real Supabase data or credentials, preserve/export it privately before retiring that project. This task did not import any hosted records.

## Customer recognition without accounts

The public customer page uses a separate HttpOnly/SameSite=Strict cookie scoped to /api/public, with a one-year browser lifetime (Secure under HTTPS). Only its hash is stored in customer_devices. It is a private rebooking capability, not a staff session. No customer login/password is introduced and the printed CU ID cannot authenticate a customer.

A new request creates a pending device record. Before owner approval, remembered responses reveal only that request's number/status and the first name submitted by that device—never an existing customer's bag code, phone, address or profile. Explicit owner approval binds the device to the approved order's customer and enables rebooking. A known-phone signup therefore cannot silently claim that customer's identity. Owner review must verify the submitted identity; the audit note flags existing_phone_review.

Opening an existing private booking link also remembers the device. Recognized responses include only permanent bag ID, first name, area, last service/loads and own active-order summary. The server supplies the saved address and prices when rebooking. Resetting the customer booking token or blocking the customer invalidates device capabilities at the next request. Forgetting the customer clears only that browser's customer cookie and form details, not staff sessions or the customer's permanent database record.

Printed labels contain only ID/name/bag numbering, not phone/address. Users on shared devices must use the visible different-customer control; cookies can remember identity until cleared/expired. Full database backups include device capability hashes.
