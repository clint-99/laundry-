# Setup: no subscription or database account

This version uses **SQLite**, a database file on your own computer/server. There is no database bill, Supabase setup, API key or Cloudflare account. GitHub stores and lets you edit the source code. It does not run the server.

## 1. Install and start

1. Install **Node.js 22.16+ or 24 LTS** from https://nodejs.org/. **For macOS Monterey 12.7.6, install [Node.js 22.23.3 for Mac](https://nodejs.org/dist/v22.23.3/node-v22.23.3.pkg). Node 24 requires macOS 13.5 or newer.** Use the normal installer and keep “Add to PATH” enabled. Reopen your terminal if it was already open.
2. GitHub → **clint-99/laundry- → Code → Download ZIP**. Extract the ZIP somewhere you will keep it, such as Documents/Laundry. Do not run from inside the ZIP.
3. Windows: double-click **start.cmd**. macOS/Linux: open a terminal in the extracted folder and run `./start.sh`. If your system disallows script execution, run this instead:

   ```sh
   node server/app.js
   ```

   **Easy Mac Terminal method:** open Terminal (Applications → Utilities). Type `cd ` with a space, drag the extracted app folder from Finder into Terminal, and press Return. Then run `node server/app.js`. This does not require changing script permissions.

4. Keep that terminal window open. It reports the port (default **3000**) and the location of the data directory. It does not print passwords or the setup code.
5. On that same computer, type **localhost:3000** into your browser's address bar. The default page is the customer page, with no login. Use **Owner / admin** at its bottom, then **Create owner account**.
6. Open the new **data/setup-code.txt** file in a local text editor. Copy its one-time code into the setup form. Do not put the code in GitHub, screenshots or chat. This proves you control the server computer.
7. Enter your name, an email you want to use as a login name, and a unique password of **at least 12 characters**. No email service or inbox verification is needed. The app hashes your password before saving it. Create the account, then sign in at **Owner login**.
8. The setup endpoint closes permanently once the first account exists. There are no default logins. The unused code file may remain, but it cannot create another account.

You do not need `npm install` to start production: all server functions use Node's standard library and SQLite. The app initially has one active Wash, dry & fold service at ₱190/load, no customers or riders, and public bookings closed.

## 2. Configure your business

1. **Settings:** enter your business name, currency, timezone (Asia/Manila by default), hotline, Facebook URL if you use one, service areas (one per line), turnaround, cutoff, kg/load, pickup capacity and message templates. Keep bookings Closed while you test. Save.
2. **Settings → Services & per-load prices:** edit the initial ₱190 service or add others. Existing orders retain their price snapshots.
3. **Shops → Add shop:** name, phone, address, private cost/load and capacity. Target ₱125 is only a default suggestion—enter your actual partner's cost.
4. **Customers → Add customer:** enter a pretend person with a number you control, area and pickup address. A permanent CU bag code is assigned. **Copy booking link** is for that one customer; send it privately when they use another browser/device. Opening it remembers that browser. The visible CU customer/bag ID is permanent and is not a password.
5. **Staff → Add rider:** enter a separate login email, name and unique password. Communicate the password privately. It is stored as a salted hash. Staff can be deactivated immediately or have passwords reset here. Use separate browsers/browser profiles to test owner and rider; cookies are shared between tabs at the same site.
6. **New order:** choose the customer, service, loads, bags, shop, dates and window. Save and check Details/history. The server computes prices; riders see operational data only.
7. **Labels:** select customers and print reusable bag labels on A4 at 100% scale with browser headers/footers disabled. Test on plain paper before sticker sheets.
8. **Reports → Record rider pay:** record daily/batch costs; compare reports with a pretend delivered order.
9. Open public bookings and use the customer page in a separate browser. New customers enter contact/address details once, answer a small math question, and request pickup. Their device is remembered privately while the request awaits confirmation. In **Pending**, click **Assign shop**, choose the laundry shop and save, then **Approve** the request. Active orders also have **Assign shop / Change shop** in Orders and Details/history; the selected shop and address appear on the rider task. After approval, that browser can then show the customer's permanent CU bag ID. After the order is delivered, reopening the normal customer page shows **Book again**, with service/loads/date prefilled. One tap places a new order immediately without typing contact/address or logging in. A second active order is refused.
10. **Remembered customers:** use a personal device. The customer page remembers the browser automatically; optional email is saved with contact details and is not a login. To remove recognition, clear this site’s cookies in browser settings. A new device, private browsing, expired/cleared cookies needs the personal booking link; guessing a public bag ID cannot retrieve a customer's profile. If an existing phone is entered on a new signup, the request remains pending without exposing that person's saved details until an owner verifies it. Resetting the personal link invalidates remembered devices.
11. **Bags:** write the permanent CU ID on each reusable bag (or use Labels). Rider pages match that ID to the saved customer/order address. Do not write phone numbers or addresses on bags; printed labels intentionally omit them.
12. Follow TESTING.md with pretend data before sharing the app with real customers. Have Filipino copy and the privacy/retention notice reviewed locally.

## 3. Let riders use phones on your Wi-Fi

1. Keep the server computer awake and connected to your Wi-Fi. Find its local IPv4 address: Windows `ipconfig`; macOS/Linux network settings. Example only: `192.168.1.50`.
2. Stop the server (Ctrl+C). To listen on your network, run:

   Windows PowerShell:
   ```powershell
   $env:HOST="0.0.0.0"
   node server/app.js
   ```

   macOS/Linux:
   ```sh
   HOST=0.0.0.0 node server/app.js
   ```

3. If prompted, allow your operating system's firewall access on your **private network only**. Riders on the same Wi-Fi type your computer's actual address plus port **3000**, for example `192.168.1.50:3000/rider/`.
4. Ordinary HTTP on a trusted LAN is only suitable for a pretend-data trial. It is not encrypted; anyone able to intercept that network could capture logins. Use HTTPS before real staff/customer data. PWA installation, service workers and optional geolocation may be unavailable on a non-HTTPS LAN address.
5. Outside your Wi-Fi, this private address will not work. Do not open router ports directly to an HTTP service. For internet use, put the app behind an HTTPS reverse proxy on a machine/host you control, set PUBLIC_ORIGIN, and restrict direct access to the Node port. A static GitHub Pages URL cannot run SQLite or this server.

## 4. Public HTTPS deployment (optional, requires a host)

SQLite has no subscription; public hosting is separate. You can run it on an existing always-on machine, home server or hosting you already have. This task does not promise a free always-on provider or public internet deployment.

- Run Node 22.16+ or 24+, use persistent disk, keep one server process per database, and serve the whole app/API on one origin. Avoid ephemeral/serverless filesystems that erase local data.
- Put an HTTPS reverse proxy in front of the loopback-bound Node service. Set **PUBLIC_ORIGIN** to the exact external origin, e.g. `https://laundry.example.com` (no trailing slash or path). This enables Secure session cookies and checks browser write origins. Do not expose raw port 3000 to the internet.
- The server deliberately does not trust X-Forwarded-For. Behind a reverse proxy, rate limits group callers by the proxy's socket IP. This is conservative but may limit legitimate customers. Configure any per-client edge limits on a trusted proxy; do not blindly trust caller-controlled IP headers. The built-in math check is lightweight spam friction, not bot-proof verification.
- Keep TLS, operating system and Node patched. A host with persistent storage, backups and enough availability is required; stop and keep bookings closed if you cannot provide those.

## 5. Docker option

Docker is not required. If you already use it:

```sh
docker compose up --build -d
docker compose logs laundry
```

The container binds to your computer's loopback port 3000. The named **laundry-data** volume persists SQLite data across restarts/rebuilds. Read the setup code with:

```sh
docker compose exec laundry cat /app/data/setup-code.txt
```

Do not post the output. Create your owner account in the browser. For HTTPS, set PUBLIC_ORIGIN in the environment before starting Compose and terminate TLS at your reverse proxy. The default Compose origin is `http://localhost:3000`; change it to the real origin you use.

Never run `docker compose down -v` unless you deliberately want to delete the database volume and have a verified backup. Do not scale containers to multiple replicas sharing the same SQLite file. The image uses the unprivileged node user. The Node 24 base tag receives upstream patches; pin a digest in a managed deployment after verifying it for your platform.

## 6. Back up and restore

1. **Staff → Download full database backup** makes a consistent SQLite snapshot, including orders, events, customers, settings, staff password hashes and sessions. Store it privately/encrypted. Never commit it to GitHub. This snapshot can be made while the app is running.
2. CLI alternative (Node 22.16+ or 24, no npm packages needed):

   ```sh
   node scripts/backup.mjs /PRIVATE/BACKUP/FOLDER
   ```

   Or `npm run backup` saves to a sibling laundry-backups folder by default. The source data folder can be overridden with DATA_DIR. CSV downloads are useful reports but are not a complete database restore.
3. To restore: stop **all** app processes. Copy the current data directory to a separate private recovery location first. Remove the **old** `platform.sqlite-wal` and `platform.sqlite-shm` sidecars from the restoration directory, then replace `data/platform.sqlite` with the verified SQLite backup. Never combine sidecars from a different database with a restored snapshot. Start the app and verify settings, accounts, a customer and order history before reopening bookings.
4. Preserve the entire data directory for normal moves. `server-secret` salts rate-limit/challenge hashes; a newly generated secret invalidates old challenges/rate buckets. A full SQLite backup restores all business data and staff hashes. Revoke exposed/stale staff sessions if restoring a shared or old backup.
5. Keep at least one backup off the server computer and test restoration on a separate folder using `DATA_DIR` and a different PORT. A local file alone is not a backup if the disk fails.

## 7. Update code from GitHub

1. Download the updated source or `git pull` on a checkout with no conflicting edits.
2. Keep **your existing data directory**; do not replace it with an empty extracted directory. Set DATA_DIR to its absolute path if keeping data separately from code.
3. Stop the server and restart with Node 22.16+ or 24. Current SQLite tables are created automatically if missing. Future data-model upgrades must include explicit migrations; do not delete the database to resolve an update error.
4. This version deliberately replaces the previous Supabase app. No external Supabase data or credentials were supplied, so none were imported. If you already populated a hosted Supabase project, export it privately and request a migration before switching live operations. An older prototype `data/laundry.sqlite`, if present, is left untouched and is not used as `platform.sqlite`.

## 8. Tests and cloud workspace

```sh
npm ci
npm test
npm run test:browser
```

Tests use temporary folders and no live database/accounts. Browser tests start their own local server, so no separate npm start process is needed. Set CHROMIUM_PATH if Chromium/Chrome is not at `/usr/bin/chromium`. Docker/public TLS deployment and physical printing still need your own checks.

Use the existing isolated checkout in cloud tasks; do not create a worktree unless requested. The installed files/data remain; server processes must restart. Cloud test environments may be temporary and are not a production host. Publishing a cloud snapshot does not deploy a public business service.
