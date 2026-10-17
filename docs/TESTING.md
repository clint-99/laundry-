# Validation and acceptance record

Validated in the coding environment on 2026-10-17. No hosted Supabase project, staff credentials, Cloudflare widget secrets or deployed GitHub Pages site were supplied. Therefore **local implementation checks passed; live end-to-end launch acceptance is not complete**. No production bookings were made. No checks are reported as skipped tests that secretly passed; the live checks below are explicitly unrun.

## Commands and evidence

| Check | Result | Scope |
|---|---|---|
| `npm ci --cache /tmp/laundry-npm-cache` | Passed | Pinned development/test tools; no production build |
| `npm test` | 11 tests passed, 0 failed, 0 skipped | Utility/validation tests and the actual Edge handler logic with mocked provider responses |
| `npm run test:db` | 17 groups passed | Real temporary PostgreSQL 18.4 on Linux x64; actual migration, RLS, grants, triggers and RPCs; minimal stub Supabase Auth roles/publication |
| `npm run check:edge` | Passed, six functions | Deno 2.9.6 type check, pinned Supabase JS 2.118.0 |
| `npm run test:browser` | 10 workflow groups passed | Chromium, actual static pages and vendored client, mocked Supabase APIs/WebSocket/Turnstile; real service-worker install/offline shell |
| `npm audit` | 0 known vulnerabilities | Registry advisories for the locked dependency tree at test time; not a security certification |
| Static runtime | Passed | Landing, owner/rider setup gates and booking setup state served from the local static server |
| Dependency integrity | Passed | Frozen npm lock/integrity verification retained; vendored client reproducible with `npm run vendor` |

Browser tests use a hostile `<img src=x onerror=alert(1)>` string as name/address/landmark/notes. It appears as text, never a DOM image or script. Captcha is a deliberate test stub; this is **not proof of Cloudflare verification in a real widget**. Screenshot artifacts, when tests run in this cloud machine, are under `/tmp/laundry-screenshots/`; they are not shipped to Pages. Dark-mode booking at 360 px and desktop/mobile owner layouts were visually inspected. Browser print CSS and labels were exercised, not a physical printer.

## Section 14 acceptance mapping

| # | Requirement | Local evidence | Live status / remaining check |
|---|---|---|---|
| 1 | Anonymous tables/RPC denied | All application tables and every public-schema function privilege tested in PostgreSQL; anon table SELECTs denied | Unrun through hosted PostgREST; use permission probes below |
| 2 | Rider cannot read/write private tables; no money columns | Real RLS SELECT/INSERT/UPDATE/DELETE probes; fixed rider_tasks output schema; no rider UI prices | Unrun with actual Auth-issued rider JWT |
| 3 | Only allowed transitions | All 64 from/to combinations tested against rider_mark; disallowed ones fail | Repeat on a disposable live order |
| 4 | Deactivation immediate | Same identity denied after active=false; tasks empty, mutations rejected | Verify same signed-in device after Staff → Deactivate |
| 5 | Tokens cannot switch customers; generic invalid response | Token chooses customer server-side; returning whitelist drops customer_id; unknown/blocked/reset tokens rejected; rate limiter tested | Real token A/B, edge IP accounting unrun |
| 6 | Turnstile and rate limits | Actual handler rejects absent/failed verification before booking; 429 test; SQL atomic limiter | Real Cloudflare success/hostname/action, invalid captcha, trusted IP and sustained rate tests unrun |
| 7 | XSS rendered safely | Browser hostile strings on owner/rider/returning/review; no alert and no injected image; source scan for unsafe DOM insertion | Repeat on live pages; no secrets or real PII in test text |
| 8 | Lookup private; returning ignores address/price | PostgreSQL lookup has no phone/address; validator/handler whitelist tests | Inspect live network JSON |
| 9 | Secrets never in repository/client traffic | Only blank public config shipped; service role read only inside Edge handler; test credentials clearly fake | Owner must verify their subsequent config commits/DevTools network after secure setup |
| 10 | Returning flow appears owner/rider | Booking UI request, SQL placed booking, owner refresh and rider tasks tested separately; mocked Realtime insertion refreshes owner | Real integrated Edge→DB→Realtime→rider poll unrun |
| 11 | New flow pending, approve to placed | Multi-step UI with test captcha, SQL pending result; mocked pending approval UI tested | Real captcha + same-phone owner review + rider refresh unrun |
| 12 | Full lifecycle/history/profit | Real DB pickup→shop→ready→delivered; audit count; server report ₱380 revenue−₱250 shop−₱100 pay=₱30 margin | Repeat with pretend live rider/customer; check actual local-time report dates |
| 13 | Duplicate-active returning refused | Real DB refusal, customer transaction lock; owner manual orders allowed | Real double-tab booking unrun |
| 14 | Undo ≤60 seconds, refuse after | Real pickup/drop-off/delivery undo, expired pickup refused; later-event conflict refused | Test delivery expiry and another rider interference live |
| 15 | Offline taps durable/retry-safe | Browser forced RPC failure saves queue, retries, reconciles and undoes; DB UUID retries do not duplicate changes | Real airplane-mode/device restart/conflict/storage-quota checks unrun |
| 16 | Live price settings without redeploy | Database snapshots/trigger read services each booking; public-config queries active current services; browser has no hardcoded price | Change live price, refresh book page and verify new receipt; existing orders unchanged |
| 17 | A4 bag labels | Browser label generation and @media print; selection/bag numbering | Physical A4 sticker sheet alignment unrun |
| 18 | Responsive/dark/keyboard | Owner widths 360/768/1440 without document overflow; dark booking 360; semantic labels, native inputs, full new-booking keyboard flow, focus CSS | Real Turnstile keyboard interaction, native mobile Safari and daylight rider usability still need human review; not a WCAG certification |

Additional DB checks cover simultaneous capacity requests, booking request-ID deduplication with payload conflict detection, helper RPC protection, preserved snapshots, bag codes beyond 9,999, and owner-only financial RPCs. PWA tests check that Cache Storage contains only known same-origin shell URLs and that the setup shell loads with the network disabled. It does not cache or restore task data offline.

## Live launch checklist: use pretend people first

Do this only after SETUP.md, in a disposable/test Supabase project or with clearly marked pretend orders and numbers you control. Keep real bookings closed until it passes. Use separate browser profiles for owner, rider and customer. Never publish a rider JWT, personal booking link, service-role key or copied customer request.

1. Owner creates a test customer, partner shop, active service and a test rider. Set actual test service areas, capacity, timezone and cutoff. Set Public bookings Open for the test. Record original settings to restore later.
2. In SQL Editor inspect anonymous grants. These should return **zero rows**:

   ```sql
   select table_name, privilege_type from information_schema.role_table_grants
   where table_schema='public' and grantee='anon';

   select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and has_function_privilege('anon',p.oid,'EXECUTE');
   ```

3. To exercise hosted RLS, sign into the **rider page as the test rider**, open browser developer tools → **Console**, and run this read-only probe. It prints only table names, result counts/errors and task field names, not customer rows or session tokens:

   ```js
   const { db } = await import('../shared/supabase.js');
   for (const table of ['orders','customers','shops','services','settings','rider_pay']) {
     const { data, error } = await db.from(table).select('id').limit(1);
     console.log(table, error ? 'DENIED' : `rows=${data.length}`);
   }
   const tasks = await db.rpc('rider_tasks');
   console.log('task fields', Object.keys(tasks.data?.[0] || {}));
   ```

   Expected: DENIED or rows=0 on every table; task field names must have no price/cost/token/margin fields. Do not log task data. For destructive permission probes, use only a disposable order and wrap raw SQL in a transaction with ROLLBACK as in the automated test runner; do not test against real customers.
4. In a separate no-login customer window, verify the anon key cannot retrieve table rows or RPCs. In that window's Console:

   ```js
   const { db } = await import('../shared/supabase.js');
   for (const table of ['profiles','settings','services','shops','customers','orders','order_events','rider_pay','rate_limits','rider_actions','booking_requests']) {
     const { data, error } = await db.from(table).select('*').limit(1);
     console.log(table, error ? 'DENIED' : `rows=${data.length}`);
   }
   console.log('rider RPC error', !!(await db.rpc('rider_tasks')).error);
   ```

   Expected: every table DENIED or empty; rider RPC error true. Ensure this browser really has no staff session. The public-config Edge Function is deliberately public; the database RPC named public_config is not.
5. Copy test customer's personal link. Open it, confirm URL fragment clears, first name/area only are shown and no phone/full address are returned by lookup. Book again. Owner receives a Realtime refresh within seconds; rider sees it after at most the next 18-second poll (or Refresh). Attempt another booking: refused without a second order. Tamper token/customer/address/price using only pretend records: no other customer can be selected and money/address stay server-controlled.
6. New-customer form: use a number you control, optional location, alternate delivery address and a hostile literal test string in notes. Try without captcha: rejected. Complete the real widget: pending request. Repeat with an existing test phone: no new customer and no saved address overwrite; owner sees submitted details in history. Approve/Edit then approve. Check the rider route, especially alternate delivery map coordinates.
7. Complete pickup → dropped at shop → owner ready → delivered. Undo each within 60 seconds. Wait over 60 seconds and attempt undo: rejected with a visible message. Try rider ready/approve/cancel/financial calls: denied. Confirm history and reports. Enter rider pay and verify the arithmetic and report period boundaries in Asia/Manila.
8. Keep the rider logged in, click Staff → Deactivate in the owner page. Next rider refresh shows no tasks; attempted RPC changes fail. Reactivate only after verifying denial. Reset the rider password, sign out/in and verify the new credential; do not share it in chat.
9. Browser/device network offline: tap pickup; Waiting to sync is visible and persists if the page is reloaded with a usable shell/session. Reconnect: one audit transition only. Simulate a conflict by changing the same order in owner view before syncing: visible error, no silent action loss. Retry or explicitly resolve. Test the storage failure warning and do not close the page when storage cannot persist.
10. Change service price and capacity in owner Settings with no Pages redeploy. Refresh the customer page: new price and available-date chips change; saved order prices do not. Fill a day to capacity and race two fresh requests: at most one fits the remaining capacity. Test after the configured cutoff, ideally in a browser whose device timezone differs.
11. Exercise 31 invalid lookup requests from one known IP in the hour; expect a friendly 429. Verify changing a caller-supplied X-Forwarded-For cannot bypass the gateway's trusted IP bucket. Test 4 legitimate-captcha new-booking attempts for one controlled phone within the window; expect the phone limit, and separately the 10/IP/hour limit. Do not spam real customers. If forwarded-header trust is not established, add a trusted gateway or change the IP extraction; do not claim per-IP enforcement from CORS alone.
12. Browser developer tools → Network: no service-role or Turnstile secret in any request/response. Inspect only public keys and the widget token (one-use token is expected). Test invalid captcha and mismatched hostname/action rejection. Check Content Security Policy errors on real Turnstile.
13. Open owner and rider on a real phone, install to home screen, verify legible dark/light layouts and 56px rider buttons. At 360/768/desktop, check search tables scroll inside their card. Complete booking using only keyboard. In Labels, print A4 at 100%, plain paper first, verify actual sticker alignment. Review Filipino copy and privacy text with qualified people.
14. Cancel test orders with a reason (retain history). Remove unreferenced demo contacts only if safe. Restore business settings, rotate test personal links if shared, take a full backup and only then send the customer URL to real customers.

## What remains external

- Creating/configuring accounts, entering public project values and provider secrets, deploying Edge Functions, pushing/publishing GitHub Pages, and running all live checklist items.
- Trusted gateway IP-header behavior and hosted Auth/PostgREST/Realtime integration have not been validated by local mocks.
- Native Filipino review, jurisdiction-specific privacy/retention review, physical label printing and real device accessibility/usability testing.
- No claim is made that the environment draft was published or restored in a new cloud task. Configuration saves persist instructions only.
