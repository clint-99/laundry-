# Owner’s setup guide

You need your own GitHub, Supabase and Cloudflare accounts. This guide does not assume you are a programmer. Do not send passwords, API secrets or customer files in chat. The account screens below are external services and can change; use the named feature if a menu has moved. Review current pricing/limits on each provider before launch.

## 1. Put the files in GitHub and enable Pages

1. Use your existing **clint-99/laundry-** repository. The app files have been created locally; they have not been pushed. In your Git client review the changes, commit them, and push to `main`. If using a terminal in this checkout, the equivalent commands are:

   ```sh
   cd /workspace/laundry-
   git add .
   git diff --cached --stat
   git commit -m "Build static laundry platform with Supabase"
   git push origin HEAD:main
   ```

   Run the push only when you have reviewed the changes and are ready to publish the code. Check that shared/config.js contains **public values only**. data/, node_modules/ and .env files are ignored. The previous local prototype archive is outside this checkout and is not uploaded.
2. GitHub → **clint-99/laundry- → Settings → Pages**. Under **Build and deployment → Source**, choose **GitHub Actions**.
3. GitHub → **Actions → Deploy static laundry platform → Run workflow** (branch main), or push a commit to main. Wait for the deploy job to complete.
4. The expected project site is `https://clint-99.github.io/laundry-/`. Use the actual URL shown in **Settings → Pages**. The customer page is `…/laundry-/book/`, owner `…/owner/`, rider `…/rider/`. Only the static public folders are uploaded, not SQL, tests, development tools or documentation.
5. For a new repository instead: GitHub top-right **+ → New repository**, choose a name and create it, add its remote to a reviewed copy of these files, and repeat the Pages steps. Relative asset URLs support a repository subpath. A dedicated custom domain is recommended if other sites under your GitHub account are untrusted.

## 2. Create Supabase and copy only public configuration

1. Sign in to [Supabase Dashboard](https://supabase.com/dashboard) → **New project**. Choose your organization, project name, strong database password and a suitable region. Save the database password in a password manager, not this repository. Wait until the project is provisioned.
2. Project → **Settings → API** (some dashboards call this **API Keys** / **Data API**). Copy **Project URL** and the browser **anon public** key from the legacy API keys section. A modern publishable browser key may also work with the client, but this implementation was written for the anon-key flow. **Never copy service_role or a secret key to a web page.**
3. Open `shared/config.js`. Fill SUPABASE_URL and SUPABASE_ANON_KEY between the quotes. Optionally replace BRAND_NAME and LOGO. The first two values are public by design. Leave TURNSTILE_SITE_KEY blank until step 5.
4. Commit and push this public config change when ready. Test account keys are not prefilled in this repository.

## 3. Install the database and lock down Auth

1. Supabase → **SQL Editor → New query**. Open `supabase/migrations/001_init.sql`, copy its **entire contents**, paste into the editor and click **Run**. Run this once in a fresh project. It creates tables, RLS, functions and the Realtime publication entries. Do not re-run it on an established database; use a new migration for changes.
2. If you see an error, do not skip the failed section or disable RLS. Save the error text without secrets and investigate. The migration is transactional, so a failure rolls back its changes.
3. Supabase → **Authentication → Sign In / Providers → Email** (or **Providers → Email**). Turn **Allow new users to sign up** off. Keep email/password sign-in enabled. Configure **Confirm email** according to your staff onboarding; staff-admin explicitly confirms owner-created rider email addresses so they can use their initial password. These are private staff accounts, not customer accounts.
4. **Authentication → URL Configuration → Site URL**: enter your full Pages address, e.g. `https://clint-99.github.io/laundry-/`. Under **Redirect URLs**, add the full owner and rider URLs. Do not use unrestricted wildcard origins. The app uses password sign-in, not public signup links.
5. **Authentication → Settings / Security and Protection**: set minimum password length to at least **12**, enable available strong-password/leaked-password protections, and use unique staff passwords. Under the project's **JWT settings**, set access-token lifetime to approximately **1800 seconds** with session refresh enabled. The exact controls depend on the project's JWT-key version; follow the dashboard’s guidance. Deactivation does not wait for JWT expiry because policies check profiles.active every request.
6. Optional demo: in a disposable test project only, run `supabase/seed.sql` in SQL Editor. It adds a sample ₱190 service, ₱125 shop and one **Demo Customer**, plus sample area names. Do not treat these names/numbers as real contacts. For production, skip the seed and enter your actual services/shops in the owner page.

## 4. Create the first owner

1. Supabase → **Authentication → Users → Add user → Create new user**. Enter your email and a strong password. Use **Auto Confirm User** for this owner-created account if that option is present. Do not use public signup.
2. Open the new user row and copy the **User UID** (UUID).
3. **SQL Editor → New query**. Replace the two placeholder strings below, then **Run**:

   ```sql
   insert into public.profiles (id, role, full_name)
   values ('PASTE-USER-UUID-HERE', 'owner', 'Your name');
   ```

4. Repeat these steps for a second trusted owner if needed. The staff page creates riders only. Do not manually assign an owner role to a rider.
5. Visit your owner page and sign in after the public configuration is deployed. With the migration installed, you should see Today and the owner navigation. If not, verify the user's UUID and active profile; do not remove permission checks to make login work.

## 5. Create the Turnstile widget

1. Sign in to [Cloudflare Dashboard](https://dash.cloudflare.com/) → **Turnstile → Add widget**.
2. Give it a name and add the site hostname, e.g. `clint-99.github.io` (no `https://`, path or port). Choose **Managed** mode. Create the widget.
3. Copy **Site Key** into TURNSTILE_SITE_KEY in shared/config.js. This key is public. Commit/push when ready.
4. Keep the **Secret Key** private. Supabase → **Edge Functions → Secrets → Add new secret**: name `TURNSTILE_SECRET_KEY`, value the Cloudflare secret. Save it there, never in GitHub or chat.
5. In the same Supabase Secrets screen add:
   - `ALLOWED_ORIGIN`: the site's origin **only**, e.g. `https://clint-99.github.io`. Do **not** include `/laundry-/` or a trailing slash.
   - `RATE_LIMIT_SALT`: a long random string from your password manager. Do not publish it. Changing it starts new rate-limit buckets.
6. Supabase automatically supplies SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to deployed functions. Reuse these built-in secrets; do not copy the service-role key into local web files. If your deployment uses a different secret-key mechanism, keep it inside Supabase function secrets and adapt the function’s server-only binding.

## 6. Deploy the Edge Functions

Use a terminal on a machine with Node.js 24+ and this repository. Supabase CLI 2.121.0 was installed and its deployment flags checked; account access/deployment still needs your own login. You do not need to install a web framework or build the static app.

1. Open the repository in a terminal:

   ```sh
   cd /workspace/laundry-
   npx --yes supabase@2.121.0 --version
   npx --yes supabase@2.121.0 login
   ```

   In this cloud machine, if the CLI reports a read-only home/cache directory, run these supported tool-directory overrides before the commands above (your own computer normally does not need them):

   ```sh
   export SUPABASE_HOME=/tmp/laundry-supabase-cli
   export npm_config_cache=/tmp/laundry-npm-cache
   ```

   Follow the browser login prompt. Never put the resulting access token in shared/config.js.
2. Supabase Dashboard → **Settings → General** → copy **Reference ID**. Link the project:

   ```sh
   npx --yes supabase@2.121.0 link --project-ref YOUR_PROJECT_REFERENCE
   ```

   Enter the database password only when the CLI securely prompts. If SQL was already run manually, do not also push it blindly through `db push`; keep the migration history consistent before adopting automated migrations.
3. Secrets can be entered through the Dashboard in step 5. For CLI-based secret setup instead, create a private file **outside the repository**, e.g. `/tmp/laundry-edge.env`, in your local editor. Put these names with your real values there (never commit or paste the completed file):

   ```dotenv
   ALLOWED_ORIGIN=https://clint-99.github.io
   RATE_LIMIT_SALT=YOUR_LONG_RANDOM_PRIVATE_STRING
   TURNSTILE_SECRET_KEY=YOUR_PRIVATE_CLOUDFLARE_SECRET
   ```

   Then:

   ```sh
   chmod 600 /tmp/laundry-edge.env
   npx --yes supabase@2.121.0 secrets set --env-file /tmp/laundry-edge.env
   rm /tmp/laundry-edge.env
   ```

4. Deploy all six functions from the checkout:

   ```sh
   npx --yes supabase@2.121.0 functions deploy public-config --no-verify-jwt --use-api
   npx --yes supabase@2.121.0 functions deploy lookup --no-verify-jwt --use-api
   npx --yes supabase@2.121.0 functions deploy book-again --no-verify-jwt --use-api
   npx --yes supabase@2.121.0 functions deploy book-new --no-verify-jwt --use-api
   npx --yes supabase@2.121.0 functions deploy track --no-verify-jwt --use-api
   npx --yes supabase@2.121.0 functions deploy staff-admin --no-verify-jwt --use-api
   ```

   Public functions accept no customer login, so gateway JWT verification is disabled. **staff-admin is not public administration:** its handler explicitly validates the caller's JWT with Auth and requires an active owner profile. Do not remove these checks. config.toml records the same gateway configuration. If the CLI requests a deployment method, use its supported remote/API bundling; don't weaken TLS verification.
5. In **Edge Functions**, check that all names appear and have no deployment errors. No deployed endpoint has been verified by the coding task without your account setup.
6. Visit the live booking page. A configuration/captcha error means setup is still incomplete. Check URL/key, function names, allowed origin, widget hostname/action and secrets. Supabase → **Edge Functions → function → Logs** helps diagnose errors; do not log customer payloads or secrets.

## 7. First run with your real business settings

1. Owner page → **Settings**. Set business name, PHP symbol, **Asia/Manila** (change if your business uses another timezone), hotline, Facebook URL, max kg/load, turnaround, cutoff, daily capacity and real service areas (one per line). Save. Keep Public bookings **Closed** while testing.
2. **Settings → Services & per-load prices → Add service**: enter the service name and price (default business assumption ₱190/load). Mark it active. Pickup/delivery are free; there are no batch discounts. Existing orders keep their original per-load price.
3. **Shops → Add shop**: enter a real shop, phone, address, private cost/load and capacity. Demo target ₱125 is not a promise of real shop pricing. Archive a partner by setting it inactive; do not delete historical cost records.
4. **Customers → Add customer**: use a pretend person with a test mobile number you control and an address you can inspect. The permanent bag code appears automatically. **Copy booking link** gives the private returning link. Do not post it publicly.
5. **New order**: find that bag code or phone, choose service, loads/bags, shop, date/window and channel. Save. **Details / history** shows every change; customer-message templates can be copied there. Owner-only cost fields should never be sent in rider dispatch text.
6. **Staff → Add rider**: create a pretend rider with a distinct email and unique temporary password. Share the password privately. Use a separate browser profile/incognito window for rider login; owner and rider sessions on the same origin share browser storage.
7. Run the live checklist in TESTING.md, including deliberate anonymous/rider permission probes. Open bookings only after testing. Delete demo customers/shops only if unreferenced; cancel demo orders rather than deleting their audit trail.
8. **Labels**: select customers, choose bags/customer, **Print selected labels**. In the browser print dialog choose **A4**, disable browser headers/footers and use **100%** scale. Print on plain paper first to match your sticker sheet. Put the permanent bag code, name and address label on each reusable bag.
9. **Reports → Record rider pay**: record the daily/batch amount. Reports use delivered dates and these pay entries, not an assumed rider cost. Check warnings about missing shop costs before relying on margin.
10. Have a native speaker review Filipino copy in shared/i18n.js. Have the privacy text and retention/deletion process checked for local data-protection requirements.

## 8. Staff changes, backup and recovery

1. **Staff → Add rider** creates a rider through the owner-only function. **Deactivate** immediately denies that rider's next database/RPC call, even if their access token has not expired. **Reset password** sets a new strong password for a rider; communicate it privately. Supabase Auth can also revoke sessions if a device is lost.
2. **Customers → Reset link** invalidates the old personal booking token. Copy and privately send the new link. **Block** disables returning-token lookups/bookings; same-phone new requests still wait for owner review and are explicitly flagged. Do not approve them without resolving the issue.
3. Each week: **Staff → Export customer backup CSV**, **Export order backup CSV**, and **Reports → Export CSV**. Store them in an encrypted/private location. Operational CSVs are not a full restore of events, settings, tokens and Auth users.
4. For a full database backup, use Supabase's **Database → Backups** features available on your plan, or the official CLI:

   ```sh
   npx --yes supabase@2.121.0 db dump --linked -f /PRIVATE/BACKUP/PATH/laundry-schema.sql
   npx --yes supabase@2.121.0 db dump --linked --data-only --use-copy -f /PRIVATE/BACKUP/PATH/laundry-data.sql
   ```

   Replace the path with a private location outside the repository. Check current Supabase backup guidance for Auth roles/users, extensions and storage; a public-schema dump alone is not a complete platform restore. Test restoration in a separate project before relying on it. Do not publish backups to GitHub.
5. If a service-role or Turnstile secret leaks, follow SECURITY.md immediately: rotate/revoke through the provider, update server-only secrets, redeploy and review activity. Removing the key from config.js or Git history alone is not enough.
6. Rider device offline: keep the page open. “Waiting to sync” means the server has not confirmed the tap. Retry when online. A conflict stays visible until resolved; never clear browser storage until queued actions have synced. Undo lasts 60 seconds from server acceptance, not indefinitely while offline.

## 9. Local development and cloud environment

No local Postgres/Supabase project is required just to view the public static shell. Staff and booking workflows need a configured backend; no insecure fake login is shipped.

```sh
cd /workspace/laundry-
npm ci --cache /tmp/laundry-npm-cache
npm test
npm run test:db
npm run check:edge
npm start
```

Keep the last command running, then use another terminal for `npm run test:browser`. The server is for internal validation only; production is GitHub Pages. Cloud environments retain files/dependencies, but running processes do not survive publication/restoration. The saved environment startup instructions start this static server again. Use the existing checkout; a new worktree is unnecessary.

For a local backend, follow the official Supabase CLI local-development guide (Docker is required). Use **separate test keys**, a local allowed origin, and Cloudflare's official test widget credentials only in a local configuration. Never deploy test captcha credentials. This task's database tests use a real temporary PostgreSQL binary with stub Auth roles, and its browser tests mock APIs; they do not claim your hosted project is configured.
