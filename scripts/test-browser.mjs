import { chromium } from "playwright";
import { createApp } from "../server/app.js";
import { mkdtempSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
const dir = mkdtempSync(join(tmpdir(), "laundry-browser-"));
const app = createApp({ directory: dir });
await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${app.server.address().port}`;
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox"],
});
const password = "Example-Only-Password-2026",
  attack = "<img src=x onerror=alert(1)>",
  errors = [];
let count = 0;
const pass = (name) => {
  count++;
  console.log("PASS", name);
};
async function page(context) {
  const p = await context.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("dialog", () => {
    throw Error("Unexpected alert/confirm");
  });
  return p;
}
async function login(p, role, email) {
  await p.goto(base + "/" + role + "/");
  await p.getByLabel("Email", { exact: true }).fill(email);
  await p.getByLabel("Password", { exact: true }).fill(password);
  await p.getByRole("button", { name: "Sign in", exact: true }).click();
  await p.getByRole("button", { name: "Sign out", exact: true }).waitFor();
}
async function nav(p, name) {
  await p
    .getByRole("navigation")
    .getByRole("button", { name, exact: true })
    .click();
}
try {
  const ownerContext = await browser.newContext({ serviceWorkers: "block" }),
    owner = await page(ownerContext);
  await owner.goto(base + "/owner/");
  await owner.getByRole("link", { name: "Create owner account" }).click();
  await owner
    .getByLabel("One-time setup code", { exact: true })
    .fill(readFileSync(app.store.setupPath, "utf8").trim());
  await owner.getByLabel("Your name", { exact: true }).fill("Test Owner");
  await owner.getByLabel("Email", { exact: true }).fill("owner@example.test");
  await owner
    .getByLabel("Password (at least 12 characters)", { exact: true })
    .fill(password);
  await owner
    .getByRole("button", { name: "Create owner account", exact: true })
    .click();
  await owner.getByRole("heading", { name: "Welcome back" }).waitFor();
  await login(owner, "owner", "owner@example.test");
  pass("first-run owner setup and real cookie-based sign-in");
  await nav(owner, "Settings");
  await owner.getByLabel("Service areas (one per line)").fill("Makati\nPasig");
  await owner
    .getByLabel("Public bookings", { exact: true })
    .selectOption("true");
  await owner.getByRole("button", { name: "Save business settings" }).click();
  await owner.getByText("Business settings saved", { exact: true }).waitFor();
  await nav(owner, "Customers");
  await owner
    .getByRole("button", { name: "＋ Add customer", exact: true })
    .click();
  await owner.getByLabel("Full name", { exact: true }).fill(attack);
  await owner.getByLabel("Mobile number", { exact: true }).fill("09171234567");
  await owner.getByLabel("Address", { exact: true }).fill(attack);
  await owner
    .getByRole("dialog")
    .getByRole("button", { name: "Save", exact: true })
    .click();
  await owner.getByRole("dialog").waitFor({ state: "hidden" });
  await nav(owner, "Shops");
  await owner.getByRole("button", { name: "＋ Add shop", exact: true }).click();
  await owner.getByLabel("Shop name", { exact: true }).fill("Test Partner");
  await owner.getByLabel("Address", { exact: true }).fill("Shop Street");
  await owner
    .getByRole("dialog")
    .getByRole("button", { name: "Save", exact: true })
    .click();
  await owner.getByRole("dialog").waitFor({ state: "hidden" });
  await nav(owner, "Staff");
  await owner
    .getByRole("button", { name: "＋ Add rider", exact: true })
    .click();
  await owner.getByLabel("Full name", { exact: true }).fill("Test Rider");
  await owner.getByLabel("Email", { exact: true }).fill("rider@example.test");
  await owner.getByLabel("Temporary password (12+ characters)").fill(password);
  await owner
    .getByRole("dialog")
    .getByRole("button", { name: "Save", exact: true })
    .click();
  await owner.getByRole("dialog").waitFor({ state: "hidden" });
  pass(
    "owner settings, customer, shop and rider creation through the real API",
  );
  await owner
    .getByRole("button", { name: "＋ New order", exact: true })
    .click();
  await owner.getByLabel("Loads", { exact: true }).fill("2");
  await owner
    .getByRole("dialog")
    .getByRole("button", { name: "Save", exact: true })
    .click();
  await owner.getByRole("dialog").waitFor({ state: "hidden" });
  assert.equal(app.store.all("orders").length, 1);
  assert.equal(app.store.all("orders")[0].total_price, 380);
  await nav(owner, "Orders");
  await owner.getByRole("button", { name: "Details / history" }).click();
  assert.match(await owner.getByRole("dialog").textContent(), /onerror=alert/);
  assert.equal(await owner.getByRole("dialog").locator("img").count(), 0);
  await owner
    .getByRole("dialog")
    .getByRole("button", { name: "×", exact: true })
    .click();
  pass(
    "real order creation with server pricing and safe hostile-text rendering",
  );
  const riderContext = await browser.newContext({ serviceWorkers: "block" }),
    rider = await page(riderContext);
  await rider.setViewportSize({ width: 360, height: 900 });
  await login(rider, "rider", "rider@example.test");
  await rider
    .getByRole("button", { name: "Picked up ✓", exact: true })
    .waitFor();
  assert.equal(await rider.getByText(/₱|margin|cost per load/i).count(), 0);
  await riderContext.setOffline(true);
  await rider.getByRole("button", { name: "Picked up ✓", exact: true }).click();
  await rider
    .getByText("◷ Waiting to sync · 1 action", { exact: true })
    .waitFor();
  const riderId = app.store.all("profiles").find((p) => p.role === "rider").id;
  assert.equal(
    await rider.evaluate(
      (id) => JSON.parse(localStorage.getItem("laundry-queue:" + id)).length,
      riderId,
    ),
    1,
  );
  await riderContext.setOffline(false);
  await rider.getByRole("button", { name: "Refresh", exact: true }).click();
  await rider
    .getByRole("button", { name: "Deliveries (1)", exact: true })
    .click();
  await rider
    .getByRole("button", { name: "Dropped at shop ✓", exact: true })
    .waitFor();
  await rider.getByRole("button", { name: "Undo", exact: true }).click();
  await rider
    .getByRole("button", { name: "Pickups (1)", exact: true })
    .waitFor();
  pass(
    "real rider permission-safe route, offline tap persistence, sync and undo",
  );
  await rider.getByRole("button", { name: "Pickups (1)", exact: true }).click();
  await rider.getByRole("button", { name: "Picked up ✓", exact: true }).click();
  await rider
    .getByRole("button", { name: "Deliveries (1)", exact: true })
    .click();
  await rider
    .getByRole("button", { name: "Dropped at shop ✓", exact: true })
    .click();
  await nav(owner, "Orders");
  await owner.getByRole("button", { name: "✓ Ready", exact: true }).click();
  await rider.getByRole("button", { name: "Refresh", exact: true }).click();
  await rider.getByRole("button", { name: "Delivered ✓", exact: true }).click();
  await nav(owner, "Reports");
  await owner.getByText("₱380.00", { exact: true }).first().waitFor();
  pass(
    "real pickup-to-delivery lifecycle, owner live update and financial report",
  );
  const customerContext = await browser.newContext({ serviceWorkers: "block" }),
    book = await page(customerContext);
  await book.setViewportSize({ width: 360, height: 900 });
  await book.emulateMedia({ colorScheme: "dark" });
  await book.goto(base + "/book/");
  await book.getByLabel("Full name", { exact: true }).fill("New Test Customer");
  await book.getByLabel("Mobile number", { exact: true }).fill("09178888888");
  await book.getByRole("button", { name: "Continue →" }).click();
  await book.getByLabel("Service area", { exact: true }).selectOption("Makati");
  await book.getByLabel("Building, street, unit or house number").fill(attack);
  await book.getByRole("button", { name: "Continue →" }).click();
  await book.getByRole("button", { name: "Continue →" }).click();
  await book.getByRole("checkbox").check();
  const answer = book.getByLabel(/Complete the security check/);
  await answer.waitFor();
  const label = await answer.getAttribute("id");
  const question = await book.locator(`label[for="${label}"]`).textContent();
  const numbers = question.match(/\d+/g).map(Number);
  await answer.fill(String(numbers[0] + numbers[1]));
  mkdirSync("/tmp/laundry-sqlite-screenshots", { recursive: true });
  await book.screenshot({
    path: "/tmp/laundry-sqlite-screenshots/book-dark-360.png",
    fullPage: true,
  });
  await book
    .getByRole("button", { name: "Request pickup", exact: true })
    .click();
  await book.getByRole("heading", { name: /LD-/ }).waitFor();
  assert.equal(
    app.store.all("orders").filter((o) => o.status === "pending_approval")
      .length,
    1,
  );
  await owner
    .getByRole("navigation")
    .getByRole("button", { name: "Pending (1)", exact: true })
    .waitFor();
  await nav(owner, "Pending (1)");
  await owner.getByRole("button", { name: "Assign shop", exact: true }).click();
  const partner = app.store.all("shops").find((s) => s.name === "Test Partner");
  await owner
    .getByLabel("Laundry shop", { exact: true })
    .selectOption(partner.id);
  await owner
    .getByRole("dialog")
    .getByRole("button", { name: "Save", exact: true })
    .click();
  await owner.getByRole("dialog").waitFor({ state: "hidden" });
  const pendingOrder = app.store
    .all("orders")
    .find((o) => o.status === "pending_approval");
  assert.equal(pendingOrder.shop_id, partner.id);
  await owner.getByRole("button", { name: "Approve", exact: true }).click();
  await owner
    .getByRole("navigation")
    .getByRole("button", { name: "Pending (0)", exact: true })
    .waitFor();
  await rider.reload();
  await rider.getByText("Shop Street", { exact: true }).waitFor();
  pass(
    "owner assigns a shop directly on a pending customer order; rider sees the drop-off address after approval",
  );
  pass(
    "real customer booking, local human check, SQLite pending record and live owner approval",
  );
  const registered = app.store
    .all("customers")
    .find((c) => c.phone === "+639178888888");
  await book.reload();
  await book.getByText(registered.bag_code, { exact: true }).waitFor();
  assert.equal(await book.getByLabel("Full name", { exact: true }).count(), 0);
  assert.equal(
    await book.getByRole("button", { name: "Sign in", exact: true }).count(),
    0,
  );
  const rememberedCookie = (await customerContext.cookies()).find(
    (c) => c.name === "laundry_customer",
  );
  assert.ok(rememberedCookie.httpOnly);
  const registeredOrder = app.store
    .all("orders")
    .find((o) => o.customer_id === registered.id);
  const completion = await owner.evaluate(async (id) => {
    const response = await fetch("/api/rpc", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Laundry-Request": "1" },
      body: JSON.stringify({
        name: "owner_status",
        args: {
          p_order: id,
          p_to: "delivered",
          p_note: "Completed first trial order",
        },
      }),
    });
    return response.status;
  }, registeredOrder.id);
  assert.equal(completion, 200);
  await book.goto(base + "/");
  await book.getByRole("button", { name: "Book again", exact: true }).waitFor();
  await book.getByText(registered.bag_code, { exact: true }).waitFor();
  assert.equal(
    await book.getByLabel("Mobile number", { exact: true }).count(),
    0,
  );
  await book.getByRole("button", { name: "Book again", exact: true }).click();
  await book.getByRole("heading", { name: /LD-/ }).waitFor();
  const repeated = app.store
    .all("orders")
    .filter(
      (o) => o.customer_id === registered.id && o.source === "book_again",
    );
  assert.equal(repeated.length, 1);
  assert.equal(repeated[0].status, "placed");
  pass(
    "same-device customer ID recognition and one-tap rebooking from the default page, with no login/details",
  );
  const c = app.store.all("customers").find((c) => c.phone === "+639171234567");
  await book.goto(base + "/book/#t=" + c.booking_token);
  await book.getByRole("button", { name: "Book again", exact: true }).click();
  await book.getByRole("heading", { name: /LD-/ }).waitFor();
  assert.equal(new URL(book.url()).hash, "");
  assert.equal(
    app.store
      .all("orders")
      .filter((o) => o.source === "book_again" && o.customer_id === c.id)
      .length,
    1,
  );
  pass("real token rebooking without customer login or external services");
  await book.goto(base + "/book/");
  await book
    .getByRole("button", {
      name: "Use this device for a different customer",
      exact: true,
    })
    .click();
  const blankName = book.getByLabel("Full name", { exact: true });
  await blankName.waitFor();
  assert.equal(await blankName.inputValue(), "");
  assert.equal(
    await book.getByLabel("Mobile number", { exact: true }).inputValue(),
    "",
  );
  assert.equal(
    (await customerContext.cookies()).some(
      (c) => c.name === "laundry_customer",
    ),
    false,
  );
  pass(
    "shared-device switch clears customer recognition and previously typed personal details",
  );
  await nav(owner, "Staff");
  const downloadPromise = owner.waitForEvent("download");
  await owner
    .getByRole("link", { name: "Download full database backup" })
    .click();
  const download = await downloadPromise;
  const backupPath = await download.path();
  assert.equal(
    readFileSync(backupPath).subarray(0, 15).toString(),
    "SQLite format 3",
  );
  pass("owner downloads a consistent SQLite backup through the real UI");
  await nav(owner, "Orders");
  for (const width of [360, 768, 1440]) {
    await owner.setViewportSize({ width, height: 1000 });
    assert.equal(
      await owner.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
  }
  await owner.screenshot({
    path: "/tmp/laundry-sqlite-screenshots/owner-1440.png",
    fullPage: true,
  });
  await nav(owner, "Labels");
  await owner.getByRole("checkbox").first().check();
  await owner.emulateMedia({ media: "print" });
  assert.equal(await owner.locator(".bag-label").count(), 1);
  assert.doesNotMatch(await owner.locator(".bag-label").textContent(), /\+639/);
  assert.equal(await owner.locator(".bag-label p").count(), 0);
  assert.equal(await owner.locator(".sidebar").isVisible(), false);
  await owner.emulateMedia({ media: "screen" });
  pass("responsive owner layouts and printable A4 labels");
  assert.ok(
    (await ownerContext.cookies()).find((c) => c.name === "laundry_session")
      ?.httpOnly,
  );
  assert.equal(
    await owner.evaluate(() =>
      Object.keys(localStorage).some((k) => k.includes("auth-token")),
    ),
    false,
  );
  await ownerContext.close();
  await riderContext.close();
  await customerContext.close();
  const pwa = await browser.newContext(),
    shell = await page(pwa);
  await shell.goto(base + "/rider/");
  await shell.getByRole("heading", { name: "Welcome back" }).waitFor();
  await shell.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await shell.reload();
  const keys = await shell.evaluate(async () => {
    const cache = await caches.open("laundry-shell-v3");
    return (await cache.keys()).map((r) => r.url);
  });
  assert.ok(keys.length > 10);
  assert.ok(keys.every((k) => !k.includes("/api/")));
  await pwa.setOffline(true);
  await shell.reload();
  await shell.getByRole("alert").waitFor();
  await pwa.close();
  pass(
    "PWA shell caches only static files and gives a visible offline sign-in error",
  );
  assert.deepEqual(errors, []);
  console.log(
    `${count} real browser workflow groups passed; no backend, auth or captcha mocks.`,
  );
} finally {
  await browser.close();
  await app.close();
  rmSync(dir, { recursive: true, force: true });
}
