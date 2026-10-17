import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox"],
});
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:3000";
const id = "00000000-0000-0000-0000-000000000001",
  rid = "00000000-0000-0000-0000-000000000002",
  cid = "00000000-0000-0000-0000-000000000003",
  sid = "00000000-0000-0000-0000-000000000004",
  shopid = "00000000-0000-0000-0000-000000000005";
const attack = "<img src=x onerror=alert(1)>";
const settings = {
  id: 1,
  business_name: "Fresh Fold",
  currency_symbol: "₱",
  timezone: "Asia/Manila",
  max_kg_per_load: 8,
  default_delivery_days: 1,
  same_day_cutoff: "15:00",
  daily_pickup_capacity_loads: 40,
  service_areas: ["Makati", "Pasig"],
  booking_open: true,
  hotline: "+639171234567",
  facebook_url: "https://facebook.com/example",
  rider_daily_default: 500,
  rider_batch_default: 100,
  message_templates: {
    confirmation: "Hi {name}, {order} confirmed for {date}.",
    booking_link: "Hi {name}: {link}",
    ready: "Ready {order}",
  },
};
const fixture = {
  settings: [settings],
  profiles: [
    { id, role: "owner", full_name: "Owner", active: true },
    { id: rid, role: "rider", full_name: "Rider", active: true },
  ],
  customers: [
    {
      id: cid,
      bag_code: "CU-0001",
      full_name: attack,
      phone: "+639171234567",
      area: "Makati",
      address: attack,
      landmark: attack,
      booking_token: "a".repeat(48),
      blocked: false,
    },
  ],
  services: [
    {
      id: sid,
      name: "Wash, dry & fold",
      price_per_load: 190,
      active: true,
      sort: 0,
    },
  ],
  shops: [
    {
      id: shopid,
      name: "Partner A",
      phone: "+639171111111",
      address: "Shop Street",
      cost_per_load: 125,
      capacity_loads: 6,
      active: true,
    },
  ],
  orders: [],
  order_events: [],
  rider_pay: [],
};
const day = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Manila",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());
let posted = [],
  riderStatus = "placed",
  offlineFailure = false;
const mkOrder = () => ({
  id: crypto.randomUUID(),
  order_no: "LD-0001",
  customer_id: cid,
  service_id: sid,
  loads: 2,
  bags: 2,
  price_per_load: 190,
  total_price: 380,
  shop_id: shopid,
  shop_cost_per_load: 125,
  status: "placed",
  pickup_date: day,
  pickup_window: "Morning",
  due_date: day,
  notes: attack,
  created_at: new Date().toISOString(),
  source: "owner",
  channel: "Messenger",
});
const config = readFileSync("shared/config.js", "utf8")
  .replace(
    /SUPABASE_URL: ["']{2}/,
    'SUPABASE_URL: "https://laundry-test.supabase.co"',
  )
  .replace(/SUPABASE_ANON_KEY: ["']{2}/, 'SUPABASE_ANON_KEY: "public-test-key"')
  .replace(
    /TURNSTILE_SITE_KEY: ["']{2}/,
    'TURNSTILE_SITE_KEY: "test-site-key"',
  );
let groups = 0;
async function setup(role) {
  const context = await browser.newContext({ serviceWorkers: "block" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", () => {
    throw Error("Unexpected alert / confirm");
  });
  await page.route("**/shared/config.js", (r) =>
    r.fulfill({ contentType: "text/javascript", body: config }),
  );
  await page.route("https://fonts.googleapis.com/**", (r) => r.abort());
  await page.route("https://challenges.cloudflare.com/**", (r) =>
    r.fulfill({
      contentType: "text/javascript",
      body: `window.turnstile={render:(element,options)=>{element.textContent='Security check passed (test stub)';setTimeout(()=>options.callback('test-captcha'),10);return 1;},reset:()=>{},remove:()=>{}};`,
    }),
  );
  let live;
  await page.routeWebSocket("wss://laundry-test.supabase.co/**", (ws) =>
    ws.onMessage((message) => {
      const raw = JSON.parse(message);
      const array = Array.isArray(raw);
      const d = array
        ? {
            join_ref: raw[0],
            ref: raw[1],
            topic: raw[2],
            event: raw[3],
            payload: raw[4],
          }
        : raw;
      const filters = (d.payload?.config?.postgres_changes || []).map(
        (f, i) => ({ ...f, id: i + 1 }),
      );
      if (d.event === "phx_join")
        live = { ws, topic: d.topic, join_ref: d.join_ref, filters, array };
      const payload = { status: "ok", response: { postgres_changes: filters } };
      ws.send(
        JSON.stringify(
          array
            ? [d.join_ref, d.ref, d.topic, "phx_reply", payload]
            : {
                topic: d.topic,
                event: "phx_reply",
                payload,
                ref: d.ref,
                join_ref: d.join_ref,
              },
        ),
      );
    }),
  );
  await page.addInitScript(
    ({ role, id, rid }) => {
      if (!role) return;
      const user = {
        id: role === "owner" ? id : rid,
        email: role + "@example.test",
        aud: "authenticated",
        role: "authenticated",
        app_metadata: {},
        user_metadata: {},
        created_at: new Date().toISOString(),
      };
      const payload = btoa(
        JSON.stringify({
          sub: user.id,
          exp: Math.floor(Date.now() / 1000) + 3600,
          role: "authenticated",
        }),
      );
      localStorage.setItem(
        "sb-laundry-test-auth-token",
        JSON.stringify({
          access_token: "eyJhbGciOiJIUzI1NiJ9." + payload + ".signature",
          refresh_token: "test-refresh",
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          expires_in: 3600,
          token_type: "bearer",
          user,
        }),
      );
    },
    { role, id, rid },
  );
  await page.route("https://laundry-test.supabase.co/**", async (r) => {
    const req = r.request(),
      url = new URL(req.url());
    if (offlineFailure && url.pathname.includes("/rpc/"))
      return r.abort("failed");
    const data = req.postDataJSON?.() || {};
    let response;
    if (url.pathname.startsWith("/functions/v1/")) {
      const name = url.pathname.split("/").pop();
      posted.push({ name, data });
      if (name === "public-config")
        response = {
          ...settings,
          services: fixture.services,
          dates: [0, 1, 2].map((n) => {
            const d = new Date(day + "T12:00Z");
            d.setUTCDate(d.getUTCDate() + n);
            return {
              date: d.toISOString().slice(0, 10),
              capacity_left: 40,
              bookable: true,
            };
          }),
        };
      else if (name === "lookup")
        response = {
          first_name: attack,
          area: "Makati",
          loads: 2,
          service_id: sid,
          active_order: null,
        };
      else if (name === "book-again" || name === "book-new")
        response = {
          order_no: "LD-0042",
          total: data.loads * 190,
          pickup_date: data.pickup_date,
          pickup_window: data.pickup_window,
        };
      else response = { ok: true };
    } else if (url.pathname.includes("/rpc/")) {
      const name = url.pathname.split("/").pop();
      if (name === "owner_report")
        response = {
          totals: {
            orders: 0,
            loads: 0,
            revenue: 0,
            shop_cost: 0,
            rider_cost: 0,
            margin: 0,
            margin_per_load: 0,
            missing_shop_cost: false,
            break_even_loads: null,
          },
          periods: [],
          groups: [],
        };
      else if (name === "rider_tasks")
        response = [
          {
            order_id: "task-1",
            order_no: "LD-0001",
            bag_code: "CU-0001",
            status: riderStatus,
            customer_name: attack,
            phone: "+639171234567",
            area: "Makati",
            address: attack,
            landmark: attack,
            lat: null,
            lng: null,
            loads: 2,
            bags: 2,
            pickup_date: day,
            pickup_window: "Morning",
            due_date: day,
            notes: attack,
            shop_name: "Partner A",
            shop_phone: "+639171111111",
            shop_address: "Shop Street",
          },
        ];
      else if (name === "rider_mark") {
        posted.push({ name, data });
        riderStatus = data.p_to;
        response = { status: riderStatus, action_id: data.p_action };
      } else if (name === "rider_undo") {
        riderStatus = "placed";
        response = { status: riderStatus };
      } else if (name === "owner_status") {
        const o = fixture.orders.find((o) => o.id === data.p_order);
        o.status = data.p_to;
        response = o;
      } else response = {};
    } else if (url.pathname.startsWith("/rest/v1/")) {
      const table = url.pathname.split("/").pop();
      let rows = fixture[table] || [];
      const eq = url.searchParams.get("id");
      if (eq?.startsWith("eq."))
        rows = rows.filter((x) => x.id === eq.slice(3));
      if (req.method() === "POST") {
        if (table === "orders") {
          const o = { ...mkOrder(), ...data };
          fixture.orders.unshift(o);
          response = o;
        } else {
          fixture[table].push({ id: crypto.randomUUID(), ...data });
          response = null;
        }
      } else if (req.method() === "PATCH") {
        rows.forEach((o) => Object.assign(o, data));
        response = null;
      } else
        response = req.headers()["accept"]?.includes("vnd.pgrst.object")
          ? rows[0]
          : rows;
    } else response = {};
    await r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(response),
    });
  });
  return {
    context,
    page,
    errors,
    emit: async (record) => {
      for (let n = 0; n < 30 && !live; n++)
        await new Promise((r) => setTimeout(r, 100));
      assert.ok(live, "Realtime subscription should join");
      const payload = {
        ids: live.filters.filter((f) => f.table === "orders").map((f) => f.id),
        data: {
          schema: "public",
          table: "orders",
          type: "INSERT",
          columns: [],
          record,
          old_record: {},
          commit_timestamp: new Date().toISOString(),
        },
      };
      live.ws.send(
        JSON.stringify(
          live.array
            ? [live.join_ref, null, live.topic, "postgres_changes", payload]
            : { topic: live.topic, event: "postgres_changes", payload },
        ),
      );
    },
  };
}
const pass = (name) => {
  groups++;
  console.log("PASS", name);
};
try {
  const unconfigured = await browser.newPage();
  await unconfigured.goto(base + "/owner/");
  await unconfigured
    .getByRole("heading", { name: "Connect your workspace" })
    .waitFor();
  pass("unconfigured pages show actionable setup state");
  await unconfigured.close();
  const owner = await setup("owner");
  await owner.page.goto(base + "/owner/");
  await owner.page
    .getByRole("heading", { name: "Today", exact: true })
    .waitFor();
  await owner.page
    .getByRole("button", { name: "＋ New order", exact: true })
    .click();
  await owner.page.getByRole("dialog").waitFor();
  await owner.page.getByLabel("Loads", { exact: true }).fill("2");
  await owner.page.getByRole("button", { name: "Save", exact: true }).click();
  await owner.page.getByRole("dialog").waitFor({ state: "hidden" });
  assert.equal(fixture.orders.length, 1);
  await owner.page.getByRole("button", { name: "Orders", exact: true }).click();
  await owner.page.getByText("CU-0001", { exact: true }).waitFor();
  await owner.page.getByRole("button", { name: "Details / history" }).click();
  await owner.page.getByRole("dialog").waitFor();
  assert.equal(await owner.page.getByRole("dialog").locator("img").count(), 0);
  assert.match(
    await owner.page.getByRole("dialog").textContent(),
    /onerror=alert/,
  );
  await owner.page
    .getByRole("dialog")
    .getByRole("button", { name: "×", exact: true })
    .click();
  pass("owner creates orders and renders hostile customer text safely");
  const pendingOrder = {
    ...mkOrder(),
    id: crypto.randomUUID(),
    status: "pending_approval",
    source: "book_new",
  };
  fixture.orders.unshift(pendingOrder);
  await owner.emit(pendingOrder);
  await owner.page
    .getByRole("button", { name: "Pending (1)", exact: true })
    .waitFor();
  await owner.page
    .getByRole("button", { name: "Pending (1)", exact: true })
    .click();
  await owner.page
    .getByRole("button", { name: "Approve", exact: true })
    .click();
  await owner.page
    .getByRole("button", { name: "Pending (0)", exact: true })
    .waitFor();
  assert.equal(pendingOrder.status, "placed");
  pass("mocked Realtime insertion refreshes pending queue and owner approval");

  for (const tab of [
    "Customers",
    "Shops",
    "Dispatch",
    "Reports",
    "Labels",
    "Settings",
    "Staff",
  ]) {
    await owner.page.getByRole("button", { name: tab, exact: true }).click();
    await owner.page.getByRole("heading", { name: tab, exact: true }).waitFor();
  }
  await owner.page.getByRole("button", { name: "Labels", exact: true }).click();
  await owner.page.getByRole("checkbox").check();
  assert.equal(await owner.page.locator(".bag-label").count(), 1);
  await owner.page.emulateMedia({ media: "print" });
  assert.equal(await owner.page.locator(".sidebar").isVisible(), false);
  await owner.page.emulateMedia({ media: "screen" });
  pass("owner navigation, reports, dispatch and A4 label generation");
  await owner.page.getByRole("button", { name: "Orders", exact: true }).click();
  mkdirSync("/tmp/laundry-screenshots", { recursive: true });
  for (const width of [360, 768, 1440]) {
    await owner.page.setViewportSize({ width, height: 1000 });
    await owner.page.screenshot({
      path: `/tmp/laundry-screenshots/owner-${width}.png`,
      fullPage: true,
    });
    assert.equal(
      await owner.page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
  }
  assert.deepEqual(owner.errors, []);
  await owner.context.close();
  pass("owner layouts at 360, 768 and desktop widths");
  const returning = await setup();
  await returning.page.goto(base + "/book/#t=" + "a".repeat(48));
  await returning.page
    .getByRole("button", { name: "Book again", exact: true })
    .waitFor();
  assert.equal(new URL(returning.page.url()).hash, "");
  assert.equal(await returning.page.locator(".book-shell img").count(), 1);
  await returning.page
    .getByRole("button", { name: "Book again", exact: true })
    .click();
  await returning.page.getByRole("heading", { name: "LD-0042" }).waitFor();
  const again = posted.find((p) => p.name === "book-again");
  assert.equal(again.data.loads, 2);
  assert.equal("address" in again.data, false);
  assert.equal("price" in again.data, false);
  assert.deepEqual(returning.errors, []);
  await returning.context.close();
  pass("returning booking flow, fragment clearing and minimal payload");
  const fresh = await setup();
  await fresh.page.goto(base + "/book/");
  await fresh.page.setViewportSize({ width: 360, height: 900 });
  await fresh.page.emulateMedia({ colorScheme: "dark" });
  await fresh.page
    .getByLabel("Full name", { exact: true })
    .fill("Test Customer");
  await fresh.page
    .getByLabel("Mobile number", { exact: true })
    .fill("09171234567");
  await fresh.page.getByRole("button", { name: "Continue →" }).click();
  await fresh.page
    .getByLabel("Service area", { exact: true })
    .selectOption("Makati");
  await fresh.page
    .getByLabel("Building, street, unit or house number")
    .fill(attack);
  await fresh.page.getByRole("button", { name: "Continue →" }).click();
  await fresh.page.getByRole("button", { name: "Continue →" }).click();
  await fresh.page.getByRole("checkbox").focus();
  await fresh.page.keyboard.press("Space");
  await fresh.page.screenshot({
    path: "/tmp/laundry-screenshots/booking-dark-360.png",
    fullPage: true,
  });
  assert.equal(
    await fresh.page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await fresh.page.getByText("Security check passed (test stub)").waitFor();
  await fresh.page.waitForTimeout(30);
  await fresh.page
    .getByRole("button", { name: "Request pickup", exact: true })
    .click();
  await fresh.page.getByRole("heading", { name: "LD-0042" }).waitFor();
  assert.equal(posted.find((p) => p.name === "book-new").data.consent, true);
  assert.deepEqual(fresh.errors, []);
  await fresh.context.close();
  pass("new-customer multi-step booking with a stubbed Turnstile widget");

  const keyboard = await setup();
  await keyboard.page.goto(base + "/book/");
  async function tabTo(locator) {
    for (let n = 0; n < 35; n++) {
      if (await locator.evaluate((el) => document.activeElement === el)) return;
      await keyboard.page.keyboard.press("Tab");
    }
    throw Error("Keyboard could not reach field");
  }
  const fullName = keyboard.page.getByLabel("Full name", { exact: true });
  await fullName.waitFor();
  await tabTo(fullName);
  await keyboard.page.keyboard.type("Keyboard Customer");
  await keyboard.page.keyboard.press("Tab");
  await keyboard.page.keyboard.type("09171234567");
  await tabTo(keyboard.page.getByRole("button", { name: "Continue →" }));
  await keyboard.page.keyboard.press("Enter");
  const area = keyboard.page.getByLabel("Service area", { exact: true });
  await area.waitFor();
  await tabTo(area);
  await keyboard.page.keyboard.press("ArrowDown");
  await keyboard.page.keyboard.press("Tab");
  await keyboard.page.keyboard.type("Keyboard street");
  await tabTo(keyboard.page.getByRole("button", { name: "Continue →" }));
  await keyboard.page.keyboard.press("Enter");
  await keyboard.page.getByLabel("Service", { exact: true }).waitFor();
  await tabTo(keyboard.page.getByRole("button", { name: "Continue →" }));
  await keyboard.page.keyboard.press("Enter");
  const consent = keyboard.page.getByRole("checkbox");
  await consent.waitFor();
  await tabTo(consent);
  await keyboard.page.keyboard.press("Space");
  await keyboard.page.getByText("Security check passed (test stub)").waitFor();
  await tabTo(
    keyboard.page.getByRole("button", { name: "Request pickup", exact: true }),
  );
  await keyboard.page.keyboard.press("Enter");
  await keyboard.page.getByRole("heading", { name: "LD-0042" }).waitFor();
  assert.deepEqual(keyboard.errors, []);
  await keyboard.context.close();
  pass("complete new-customer form using only keyboard navigation and typing");
  const rider = await setup("rider");
  await rider.page.setViewportSize({ width: 360, height: 900 });
  await rider.page.goto(base + "/rider/");
  await rider.page
    .getByRole("button", { name: "Picked up ✓", exact: true })
    .waitFor();
  assert.equal(await rider.page.locator(".stop-card img").count(), 0);
  assert.equal(
    await rider.page.getByText(/₱|margin|cost per load/i).count(),
    0,
  );
  offlineFailure = true;
  await rider.page
    .getByRole("button", { name: "Picked up ✓", exact: true })
    .click();
  await rider.page
    .getByText("◷ Waiting to sync · 1 action", { exact: true })
    .waitFor();
  assert.equal(
    await rider.page.evaluate(
      (id) => JSON.parse(localStorage.getItem("laundry-queue:" + id)).length,
      rid,
    ),
    1,
  );
  offlineFailure = false;
  await rider.page
    .getByRole("button", { name: "Refresh", exact: true })
    .click();
  await rider.page
    .getByRole("button", { name: "Deliveries (1)", exact: true })
    .click();
  await rider.page
    .getByRole("button", { name: "Dropped at shop ✓", exact: true })
    .waitFor();
  await rider.page.getByRole("button", { name: "Undo", exact: true }).click();
  await rider.page
    .getByRole("button", { name: "Pickups (1)", exact: true })
    .waitFor();
  assert.deepEqual(rider.errors, []);
  await rider.page.screenshot({
    path: "/tmp/laundry-screenshots/rider-360.png",
    fullPage: true,
  });
  await rider.context.close();
  pass("rider text safety, no prices, offline queue retry and undo");
  const pwaContext = await browser.newContext();
  const pwaPage = await pwaContext.newPage();
  await pwaPage.goto(base + "/owner/");
  await pwaPage.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await pwaPage.reload();
  await pwaPage
    .getByRole("heading", { name: "Connect your workspace" })
    .waitFor();
  const cached = await pwaPage.evaluate(async () => {
    const cache = await caches.open("laundry-shell-v2");
    return (await cache.keys()).map((r) => r.url);
  });
  assert.ok(cached.length >= 15);
  assert.ok(
    cached.every(
      (url) =>
        new URL(url).origin === locationOrigin(base) &&
        !url.includes("/api/") &&
        !url.includes("/functions/") &&
        !url.includes("/rest/"),
    ),
  );
  await pwaContext.setOffline(true);
  await pwaPage.reload();
  await pwaPage
    .getByRole("heading", { name: "Connect your workspace" })
    .waitFor();
  await pwaContext.close();
  pass("PWA caches only static shell and loads that shell offline");
  console.log(
    `${groups} browser workflow groups passed. API and Turnstile responses were mocked, not live Supabase.`,
  );
} finally {
  await browser.close();
}

function locationOrigin(url) {
  return new URL(url).origin;
}
