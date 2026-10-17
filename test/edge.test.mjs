import { test, after } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { writeFileSync, unlinkSync } from "node:fs";
const env = {
  SUPABASE_URL: "https://edge-test.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-credential",
  ALLOWED_ORIGIN: "https://example.github.io",
  RATE_LIMIT_SALT: "local-test-salt",
  TURNSTILE_SECRET_KEY: "test-turnstile-secret",
};
globalThis.Deno = { env: { get: (key) => env[key] } };
const output = await build({
  entryPoints: ["supabase/functions/_shared/handler.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  plugins: [
    {
      name: "deno-npm",
      setup(b) {
        b.onResolve({ filter: /^npm:/ }, (args) => ({
          path: args.path.slice(4).replace(/@2\.118\.0$/, ""),
          external: true,
        }));
      },
    },
  ],
});
const path = new URL("./.edge-handler.mjs", import.meta.url);
writeFileSync(path, output.outputFiles[0].text);
const { handler } = await import(path.href);
after(() => unlinkSync(path));
let calls = [],
  captcha = true,
  limit = true,
  role = "owner";
const realFetch = globalThis.fetch;
after(() => (globalThis.fetch = realFetch));
globalThis.fetch = async (url, options = {}) => {
  url = String(url);
  const data = options.body
    ? JSON.parse(
        typeof options.body === "string" && options.body.startsWith("{")
          ? options.body
          : "{}",
      )
    : {};
  calls.push({ url, data });
  let value = {};
  if (url.includes("/siteverify"))
    value = {
      success: captcha,
      hostname: "example.github.io",
      action: "new-booking",
    };
  else if (url.includes("/rpc/consume_rate")) value = limit;
  else if (url.includes("/rpc/public_config"))
    value = { business_name: "Test" };
  else if (url.includes("/rpc/booking_lookup"))
    value = { first_name: "Ana", area: "Makati" };
  else if (url.includes("/rpc/create_booking"))
    value = { order_no: "LD-0001", total: 190 };
  else if (url.includes("/auth/v1/user"))
    value = {
      id: "00000000-0000-0000-0000-000000000001",
      aud: "authenticated",
      email: "owner@example.test",
    };
  else if (url.includes("/rest/v1/profiles")) value = { role, active: true };
  else if (url.includes("/auth/v1/admin/users"))
    value = { user: { id: "00000000-0000-0000-0000-000000000002" } };
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
const req = (body = {}, extra = {}) =>
  new Request("https://edge-test.supabase.co/functions/v1/test", {
    method: "POST",
    headers: {
      Origin: env.ALLOWED_ORIGIN,
      "Content-Type": "application/json",
      ...extra,
    },
    body: JSON.stringify(body),
  });
const payload = {
  name: "Ana",
  phone: "09171234567",
  area: "Makati",
  address: "12 Street",
  consent: true,
  service_id: "00000000-0000-0000-0000-000000000001",
  loads: 1,
  pickup_date: "2026-10-18",
  pickup_window: "Morning",
  turnstile_token: "captcha",
};
test("public edge functions enforce origin, method, JSON, body limit and friendly rate limits", async () => {
  const fn = handler("public-config");
  assert.equal(
    (await fn(req({}, { Origin: "https://evil.test" }))).status,
    403,
  );
  assert.equal(
    (
      await fn(
        new Request("https://test/", {
          headers: { Origin: env.ALLOWED_ORIGIN },
        }),
      )
    ).status,
    405,
  );
  assert.equal(
    (await fn(req({}, { "Content-Type": "text/plain" }))).status,
    415,
  );
  assert.equal((await fn(req({ big: "x".repeat(17000) }))).status, 413);
  limit = false;
  const res = await fn(req());
  assert.equal(res.status, 429);
  assert.match((await res.json()).error, /Too many/);
  limit = true;
  assert.equal((await fn(req())).status, 200);
});
test("new booking rejects absent or failed Turnstile before database booking", async () => {
  calls = [];
  assert.equal(
    (await handler("book-new")(req({ ...payload, turnstile_token: "" })))
      .status,
    400,
  );
  captcha = false;
  assert.equal((await handler("book-new")(req(payload))).status, 400);
  assert.equal(
    calls.some((c) => c.url.includes("create_booking")),
    false,
  );
  captcha = true;
  calls = [];
  assert.equal((await handler("book-new")(req(payload))).status, 200);
  assert.ok(
    calls.findIndex((c) => c.url.includes("siteverify")) <
      calls.findIndex((c) => c.url.includes("create_booking")),
  );
  assert.equal(
    calls.find((c) => c.url.includes("create_booking")).data.p_data.phone,
    "+639171234567",
  );
});
test("returning endpoint strips forged address, money and customer identity", async () => {
  calls = [];
  assert.equal(
    (
      await handler("book-again")(
        req({
          ...payload,
          token: "a".repeat(48),
          price: 1,
          address: "forged",
          customer_id: "other",
        }),
      )
    ).status,
    200,
  );
  const clean = calls.find((c) => c.url.includes("create_booking")).data.p_data;
  assert.equal("price" in clean, false);
  assert.equal("address" in clean, false);
  assert.equal("customer_id" in clean, false);
});
test("staff-admin requires a valid owner check even with a JWT header", async () => {
  calls = [];
  assert.equal(
    (await handler("staff-admin")(req({ action: "create_rider" }))).status,
    401,
  );
  role = "rider";
  assert.equal(
    (
      await handler("staff-admin")(
        req({ action: "create_rider" }, { Authorization: "Bearer rider-jwt" }),
      )
    ).status,
    403,
  );
  assert.equal(
    calls.some((c) => c.url.includes("/admin/users")),
    false,
  );
  role = "owner";
});
