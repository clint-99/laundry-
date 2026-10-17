import { test } from "node:test";
import assert from "node:assert/strict";
import {
  phone,
  today,
  addDays,
  csv,
  dispatchText,
  mapLink,
  safeUrl,
} from "../shared/utils.js";
import {
  normalizePhone,
  validateBooking,
  token,
} from "../supabase/functions/_shared/validation.js";
import { readFileSync, readdirSync, statSync } from "node:fs";
const payload = {
  token: "a".repeat(48),
  service_id: "00000000-0000-0000-0000-000000000001",
  loads: 2,
  pickup_date: "2026-10-18",
  pickup_window: "Morning",
};
test("normalizes PH mobile formats and rejects invalid numbers", () => {
  for (const fn of [phone, normalizePhone]) {
    assert.equal(fn("0917 123 4567"), "+639171234567");
    assert.equal(fn("639171234567"), "+639171234567");
    assert.throws(() => fn("123"));
  }
});
test("timezone and date math ignore the device timezone", () => {
  assert.equal(
    today("Asia/Manila", new Date("2026-10-17T17:00Z")),
    "2026-10-18",
  );
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
});
test("returning booking whitelist discards client prices, addresses, and customer IDs", () => {
  assert.deepEqual(
    validateBooking(
      { ...payload, address: "FORGED", price: 1, customer_id: "other" },
      true,
    ),
    payload,
  );
  assert.throws(() => validateBooking({ ...payload, loads: 1.5 }, true));
  assert.throws(() =>
    validateBooking({ ...payload, pickup_date: "2026-02-30" }, true),
  );
  assert.throws(() => token({ token: "random" }));
});
test("new bookings require consent, validated coordinates and bounded text", () => {
  const p = {
    ...payload,
    name: "Ana",
    phone: "09171234567",
    area: "Makati",
    address: "12 Street",
    consent: true,
  };
  assert.equal(validateBooking(p, false).phone, "+639171234567");
  for (const change of [
    { consent: false },
    { name: "a".repeat(121) },
    { lat: 91, lng: 121 },
    { lat: 12 },
    { deliver_to_other: true },
  ])
    assert.throws(() => validateBooking({ ...p, ...change }, false));
});
test("dispatch excludes financial and token fields; alternate delivery uses correct location", () => {
  const text = dispatchText(
    {
      status: "ready",
      deliver_to_other: true,
      delivery_address: "Other address",
      delivery_area: "Pasig",
      loads: 2,
      bags: 2,
      pickup_window: "Morning",
      total_price: 380,
    },
    {
      bag_code: "CU-0001",
      full_name: "Ana",
      phone: "+639171234567",
      address: "Pickup only",
      lat: 14,
      lng: 121,
      booking_token: "secret",
    },
    { name: "Shop", cost_per_load: 125, address: "Shop Street" },
  );
  assert.match(text, /Other address/);
  assert.doesNotMatch(text, /380|125|secret|Pickup only|14%2C121/);
  assert.equal(safeUrl("javascript:alert(1)"), null);
  assert.match(mapLink("A & B"), /A%20%26%20B/);
});
test("CSV neutralizes spreadsheet formulas and quotes embedded data", () => {
  assert.match(
    csv([['=HYPERLINK("x")', "Hello, world"]]),
    /"'=HYPERLINK\(""x""\)"/,
  );
});
test("our pages use CSP, safe DOM rendering and no inline scripts", () => {
  for (const path of [
    "index.html",
    "owner/index.html",
    "rider/index.html",
    "book/index.html",
  ]) {
    const page = readFileSync(path, "utf8");
    assert.match(page, /Content-Security-Policy/);
    assert.match(page, /no-referrer/);
    assert.doesNotMatch(page, /<script(?![^>]*src=)[^>]*>/);
    if (path.startsWith("owner") || path.startsWith("rider"))
      assert.match(page, /noindex/);
  }
  for (const folder of ["owner", "rider", "book", "shared"])
    for (const file of readdirSync(folder)) {
      if (!file.endsWith(".js") || !statSync(folder + "/" + file).isFile())
        continue;
      const code = readFileSync(folder + "/" + file, "utf8");
      assert.doesNotMatch(
        code,
        /\.innerHTML|insertAdjacentHTML|window\.(confirm|alert)\s*\(/,
      );
    }
});
