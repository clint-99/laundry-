# Security model and launch requirements

Only SUPABASE_URL, SUPABASE_ANON_KEY (legacy anon/publishable browser credential), and TURNSTILE_SITE_KEY belong in shared/config.js. They are public. The Supabase service-role/secret key and TURNSTILE_SECRET_KEY belong **only in Supabase Edge Function secrets**. Do not put either in GitHub Pages files, GitHub Actions variables, browser requests, chat, screenshots, or the repository. Supabase normally supplies SUPABASE_SERVICE_ROLE_KEY inside Edge Functions automatically. Never copy it to config.js.

## Permissions

- Anonymous users have no table, sequence or function grants. Every public request goes through an Edge Function using a strictly validated whitelist.
- Active owner checks protect RLS and owner RPCs. Rider JWTs cannot read customer, price, shop, service, settings or pay tables. The only profile row riders can read is their own. Rider operational RPCs return a fixed set of fields without tokens, prices, shop costs or financial aggregates.
- Deactivation is checked against profiles on each request, rather than trusting a cached JWT role. Postgres enforces transitions, undo age and event ordering. Owner overrides require an audit reason. No application grant deletes orders or audit events.
- SECURITY DEFINER functions set an empty search_path and qualify data objects. Public and authenticated grants are revoked first, then explicitly opened. New objects need an explicit grant/policy. Random-token/sequence helper calls also require owner access for authenticated callers.
- Public bookings serialize capacity and duplicate-active checks. Prices and costs come from triggers, with generated total_price. Returning address/identity/price fields sent by a malicious client are discarded. Unknown and blocked personal tokens have the same message.
- New bookings verify Cloudflare Turnstile success, hostname and action before phone validation and booking. All public functions enforce exact CORS origin, POST, JSON, bounded bodies and rate limits. Staff administration verifies the JWT with Auth and looks up the active owner profile server-side.

## Browser and device data

Every page has CSP and no-referrer metadata. Staff pages are noindex (this is not access control). Customer text is rendered through createElement/textContent; no application innerHTML. Links are protocol-checked or safely encoded. Booking tokens are read from fragments and immediately removed from the address bar; never put them in query strings or send them to analytics. Treat a personal link like a bearer credential: anyone holding it can rebook for that customer.

Auth sessions are maintained by Supabase in localStorage. Do not use staff accounts on shared/untrusted devices. Sign out when finished. The rider offline queue is keyed by account and can include order IDs and problem notes, but not full task/address caches; clear it only after confirming all actions synced. Logout keeps pending actions for the same account to avoid losing work. Service-worker Cache Storage includes only allowlisted static shell files. It never caches API responses or customer data. Clearing site data while offline loses unsynced actions; warn riders of this before using browser cleanup tools.

GitHub project Pages share an origin across repositories. Prefer a dedicated custom domain if other applications on the same account/origin are untrusted; browser storage cannot isolate projects by path. Keep device screens locked and CSV exports private. Browser notifications contain only “New booking”, not customer data.

## Before launch

Complete docs/SETUP.md and the live tests in docs/TESTING.md. Disable public sign-ups, configure a strong password policy, choose short JWT lifetime with refresh, check email/redirect URLs, and verify the trusted client-IP header at your Supabase gateway. Never broaden ALLOWED_ORIGIN to `*`. CORS alone cannot stop nonbrowser requests; actual captcha, rate limits, token validation and permissions must be tested.

Have the privacy notice, retention and deletion procedure reviewed for your jurisdiction. Do not promise deletion of accounting records without determining lawful retention. Customer reports and backups contain personal data. The demo seed must not be confused with real orders or service coverage. Check current Supabase, GitHub Pages, Google Fonts and Cloudflare product limits/terms yourself; this repository does not claim a free-tier service guarantee.

## If a secret leaks

1. Stop accepting bookings if exposure may affect integrity (Settings → Public bookings → Closed).
2. Supabase → Project Settings → API Keys: use the key rotation/revoke controls appropriate for the leaked key. If using legacy JWT-based service-role keys, follow the project's **JWT Keys** rotation process; it can affect anon keys and staff sessions. Follow the dashboard’s current rotation guidance rather than simply deleting a string in Git.
3. Update Edge Function secret bindings if required. Update the browser anon key if rotation changed it. Redeploy functions and Pages; invalidate staff sessions as directed by Supabase.
4. Cloudflare → Turnstile → widget → Settings: rotate the secret when relevant; update TURNSTILE_SECRET_KEY in Supabase. Test a new booking.
5. Remove the secret from repository history and logs, but regard it as compromised even after removal. Review Auth users, profiles, orders/events and access logs for unexpected activity.
