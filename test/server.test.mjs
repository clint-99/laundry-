import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { createApp } from "../server/app.js";
import { addDays } from "../shared/utils.js";
const password = "Example-Only-Password-2026";
test("real SQLite HTTP workflows, authentication, permissions, persistence and security", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "laundry-api-"));
  let app = createApp({ directory });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  let base = `http://127.0.0.1:${app.server.address().port}`;
  const client = () => {
    let cookie = "";
    return async (path, data, options = {}) => {
      const response = await fetch(base + path, {
        method: data === undefined ? "GET" : "POST",
        headers: {
          ...(data === undefined
            ? {}
            : {
                "Content-Type": "application/json",
                "X-Laundry-Request": "1",
                Origin: base,
              }),
          ...(cookie ? { Cookie: cookie } : {}),
          ...options.headers,
        },
        body: data === undefined ? undefined : JSON.stringify(data),
      });
      if (response.headers.get("set-cookie"))
        cookie = response.headers.get("set-cookie").split(";")[0];
      return {
        status: response.status,
        data: await response.json(),
        headers: response.headers,
      };
    };
  };
  const owner = client(),
    rider = client(),
    anon = client();
  let service, shop, customer, order, action, riderId, bookingDate;
  const table = (call, table, op = "select", values, filters = {}) =>
    call("/api/table", { table, op, values, filters });
  const rpc = (call, name, args = {}) => call("/api/rpc", { name, args });
  try {
    await t.test(
      "first owner requires a private one-time code; no default login or external account",
      async () => {
        for (const path of [
          "/",
          "/owner/",
          "/rider/",
          "/book/",
          "/setup/",
          "/shared/api.js",
        ])
          assert.equal((await fetch(base + path)).status, 200);
        assert.equal((await anon("/api/setup/status")).data.needs_setup, true);
        assert.equal(
          (
            await anon("/api/setup", {
              code: "wrong",
              email: "owner@example.test",
              password,
              full_name: "Test Owner",
            })
          ).status,
          403,
        );
        const code = readFileSync(app.store.setupPath, "utf8").trim();
        const created = await anon("/api/setup", {
          code,
          email: "owner@example.test",
          password,
          full_name: "Test Owner",
        });
        assert.equal(created.status, 201);
        assert.equal("password_hash" in created.data.owner, false);
        assert.equal(
          (
            await anon("/api/setup", {
              code,
              email: "x@example.test",
              password,
              full_name: "Intruder",
            })
          ).status,
          409,
        );
        assert.equal(
          (await owner("/api/login", { email: "owner@example.test", password }))
            .status,
          200,
        );
        assert.equal(
          (await owner("/api/session")).data.session.user.role,
          "owner",
        );
        assert.ok(app.store.all("profiles")[0].password_hash.includes(":"));
        assert.notEqual(app.store.all("profiles")[0].password_hash, password);
      },
    );
    await t.test(
      "anonymous access denied; cookies are HttpOnly; same-origin write protection",
      async () => {
        for (const name of [
          "orders",
          "customers",
          "profiles",
          "shops",
          "settings",
          "services",
          "order_events",
          "rider_pay",
        ])
          assert.equal((await table(anon, name)).status, 403);
        assert.equal((await rpc(anon, "rider_tasks")).status, 403);
        assert.equal(
          (
            await anon(
              "/api/table",
              { table: "settings", op: "select" },
              { headers: { Origin: "https://evil.test" } },
            )
          ).status,
          403,
        );
        assert.equal(
          (
            await anon(
              "/api/public/public-config",
              {},
              { headers: { "X-Laundry-Request": "" } },
            )
          ).status,
          403,
        );
        assert.equal(
          (
            await anon("/api/public/public-config", {
              large: "x".repeat(33000),
            })
          ).status,
          413,
        );
        assert.equal(
          (
            await anon(
              "/api/public/public-config",
              {},
              { headers: { "Content-Type": "text/plain" } },
            )
          ).status,
          415,
        );
        const logged = await owner("/api/login", {
          email: "owner@example.test",
          password,
        });
        assert.match(
          logged.headers.get("set-cookie"),
          /HttpOnly; SameSite=Strict/,
        );
        assert.equal("token" in logged.data, false);
        for (const path of [
          "/data/platform.sqlite",
          "/server/store.js",
          "/package-lock.json",
          "/.git/config",
        ])
          assert.equal((await fetch(base + path)).status, 404);
      },
    );
    await t.test(
      "owner configures business and creates customer, shop and rider",
      async () => {
        service = (await table(owner, "services")).data[0];
        let settings = (await table(owner, "settings")).data[0];
        const updated = await table(
          owner,
          "settings",
          "update",
          {
            ...Object.fromEntries(
              Object.entries(settings).filter(([k]) => k !== "id"),
            ),
            service_areas: ["Makati", "Pasig"],
            booking_open: true,
          },
          { id: 1 },
        );
        assert.equal(updated.status, 200);
        shop = (
          await table(owner, "shops", "insert", {
            name: "Partner",
            phone: "+639171111111",
            address: "Shop Street",
            cost_per_load: 125,
            capacity_loads: 6,
            active: true,
          })
        ).data;
        assert.ok(shop.id);
        customer = (
          await table(owner, "customers", "insert", {
            full_name: "<img src=x onerror=alert(1)>",
            phone: "+639171234567",
            area: "Makati",
            address: "Pickup Street",
            landmark: "Gate",
            notes: "Private customer note",
          })
        ).data;
        assert.equal(customer.bag_code, "CU-0001");
        const staff = await owner("/api/staff-admin", {
          action: "create_rider",
          email: "rider@example.test",
          full_name: "Test Rider",
          temp_password: password,
        });
        assert.equal(staff.status, 200);
        riderId = staff.data.id;
        assert.equal(
          (await rider("/api/login", { email: "rider@example.test", password }))
            .status,
          200,
        );
      },
    );
    await t.test(
      "rider cannot read/write financial tables or call owner functions",
      async () => {
        for (const name of [
          "orders",
          "customers",
          "shops",
          "services",
          "settings",
          "rider_pay",
        ])
          for (const op of ["select", "insert", "update", "delete"])
            assert.equal((await table(rider, name, op, {}, {})).status, 403);
        for (const name of [
          "owner_report",
          "owner_status",
          "reset_booking_link",
        ])
          assert.equal(
            (
              await rpc(rider, name, {
                p_from: "2026-01-01",
                p_to: "2026-01-02",
              })
            ).status,
            403,
          );
        assert.equal(
          (
            await owner("/api/staff-admin", {
              action: "set_active",
              user_id: (await owner("/api/session")).data.session.user.id,
              active: false,
            })
          ).status,
          400,
        );
      },
    );
    await t.test(
      "server snapshots prices; direct status and price tampering rejected",
      async () => {
        const config = (await anon("/api/public/public-config", {})).data;
        bookingDate = config.dates[1].date;
        const values = {
          customer_id: customer.id,
          service_id: service.id,
          loads: 2,
          bags: 2,
          shop_id: shop.id,
          pickup_date: bookingDate,
          pickup_window: "Morning",
          deliver_to_other: true,
          delivery_address: "Delivery Street",
          delivery_area: "Pasig",
          notes: "Rider note",
        };
        assert.equal(
          (
            await table(owner, "orders", "insert", {
              ...values,
              price_per_load: 1,
            })
          ).status,
          400,
        );
        order = (await table(owner, "orders", "insert", values)).data;
        assert.equal(order.total_price, 380);
        assert.equal(order.shop_cost_per_load, 125);
        assert.equal(
          (
            await table(
              owner,
              "orders",
              "update",
              { status: "ready" },
              { id: order.id },
            )
          ).status,
          400,
        );
        const task = (await rpc(rider, "rider_tasks")).data[0];
        assert.equal(
          Object.keys(task).some((k) => /price|cost|token|margin/.test(k)),
          false,
        );
        assert.equal(task.address, "Pickup Street");
      },
    );
    await t.test(
      "all 64 rider status pairs respect the server transition allowlist",
      async () => {
        const statuses = [
          "pending_approval",
          "placed",
          "picked_up",
          "weighed",
          "at_shop",
          "ready",
          "delivered",
          "cancelled",
        ];
        for (const from of statuses)
          for (const to of statuses) {
            assert.equal(
              (
                await rpc(owner, "owner_status", {
                  p_order: order.id,
                  p_to: from,
                  p_note: "Transition reset test",
                })
              ).status,
              200,
            );
            const result = await rpc(rider, "rider_mark", {
              p_order: order.id,
              p_to: to,
              p_action: crypto.randomUUID(),
            });
            const allowed =
              (from === "placed" && to === "picked_up") ||
              (["picked_up", "weighed"].includes(from) && to === "at_shop") ||
              (from === "ready" && to === "delivered");
            assert.equal(
              result.status,
              allowed ? 200 : 400,
              `${from} -> ${to}`,
            );
          }
      },
    );
    await t.test(
      "pickup, drop-off and delivery undo, deduplicated retry and expiry",
      async () => {
        await rpc(owner, "owner_status", {
          p_order: order.id,
          p_to: "placed",
          p_note: "Start lifecycle",
        });
        action = crypto.randomUUID();
        const args = { p_order: order.id, p_to: "picked_up", p_action: action };
        assert.equal((await rpc(rider, "rider_mark", args)).status, 200);
        assert.equal((await rpc(rider, "rider_mark", args)).status, 200);
        const task = (await rpc(rider, "rider_tasks")).data[0];
        assert.equal(task.address, "Delivery Street");
        assert.equal(task.lat, null);
        assert.equal(task.landmark, null);
        assert.equal(
          (await rpc(rider, "rider_undo", { p_action: action })).status,
          200,
        );
        const expired = crypto.randomUUID();
        await rpc(rider, "rider_mark", {
          p_order: order.id,
          p_to: "picked_up",
          p_action: expired,
        });
        app.store.db
          .prepare("UPDATE rider_actions SET at=? WHERE id=?")
          .run(Date.now() - 61000, expired);
        assert.equal(
          (await rpc(rider, "rider_undo", { p_action: expired })).status,
          400,
        );
        const drop = crypto.randomUUID();
        await rpc(rider, "rider_mark", {
          p_order: order.id,
          p_to: "at_shop",
          p_action: drop,
        });
        assert.equal(
          (await rpc(rider, "rider_undo", { p_action: drop })).status,
          200,
        );
        await rpc(rider, "rider_mark", {
          p_order: order.id,
          p_to: "at_shop",
          p_action: crypto.randomUUID(),
        });
        await rpc(owner, "owner_status", {
          p_order: order.id,
          p_to: "ready",
          p_note: "Partner finished",
        });
        const delivered = crypto.randomUUID();
        await rpc(rider, "rider_mark", {
          p_order: order.id,
          p_to: "delivered",
          p_action: delivered,
        });
        assert.equal(
          (await rpc(rider, "rider_undo", { p_action: delivered })).status,
          200,
        );
        await rpc(rider, "rider_mark", {
          p_order: order.id,
          p_to: "delivered",
          p_action: crypto.randomUUID(),
        });
      },
    );
    await t.test(
      "server reports revenue, shop cost, rider pay and margin accurately",
      async () => {
        const date = new Intl.DateTimeFormat("en-CA", {
          timeZone: "Asia/Manila",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(new Date());
        assert.equal(
          (
            await table(owner, "rider_pay", "insert", {
              date,
              rider: riderId,
              pay_type: "daily",
              amount: 100,
              stops: 2,
              notes: "",
            })
          ).status,
          200,
        );
        const report = (
          await rpc(owner, "owner_report", {
            p_from: date,
            p_to: date,
            p_group: "day",
          })
        ).data;
        assert.equal(report.totals.revenue, 380);
        assert.equal(report.totals.shop_cost, 250);
        assert.equal(report.totals.rider_cost, 100);
        assert.equal(report.totals.margin, 30);
        assert.equal(report.totals.margin_per_load, 15);
      },
    );
    await t.test(
      "returning lookup is private; forged identities and money discarded; active duplicates refused",
      async () => {
        const looked = (
          await anon("/api/public/lookup", { token: customer.booking_token })
        ).data;
        assert.equal("phone" in looked, false);
        assert.equal("address" in looked, false);
        const p = {
          token: customer.booking_token,
          service_id: service.id,
          loads: 1,
          pickup_date: bookingDate,
          pickup_window: "Morning",
          request_id: crypto.randomUUID(),
          price_per_load: 1,
          address: "FORGED",
          customer_id: "other",
        };
        const result = await anon("/api/public/book-again", p);
        assert.equal(result.status, 200);
        assert.equal(result.data.total, 190);
        assert.equal(
          (await anon("/api/public/book-again", p)).data.order_no,
          result.data.order_no,
        );
        assert.equal(
          (
            await anon("/api/public/book-again", {
              ...p,
              request_id: crypto.randomUUID(),
            })
          ).status,
          400,
        );
        const invalid = await anon("/api/public/lookup", {
          token: "a".repeat(48),
        });
        assert.equal(invalid.data.error, "Link not valid");
      },
    );
    const newPayload = () => ({
      name: "New Customer",
      phone: "09178888888",
      area: "Makati",
      address: "New Address",
      service_id: service.id,
      loads: 1,
      pickup_date: bookingDate,
      pickup_window: "Afternoon",
      consent: true,
      request_id: crypto.randomUUID(),
    });
    async function human() {
      const response = await anon("/api/public/challenge", {});
      const nums = response.data.question.match(/\d+/g).map(Number);
      return {
        challenge_id: response.data.id,
        challenge_answer: String(nums[0] + nums[1]),
      };
    }
    await t.test(
      "new booking needs one-use human check; known phone never overwrites saved address",
      async () => {
        assert.equal(
          (await anon("/api/public/book-new", newPayload())).status,
          400,
        );
        const proof = await human(),
          p = { ...newPayload(), ...proof };
        const result = await anon("/api/public/book-new", p);
        assert.equal(result.status, 200);
        assert.equal(result.data.status, "pending_approval");
        assert.equal(
          (
            await anon("/api/public/book-new", {
              ...p,
              request_id: crypto.randomUUID(),
            })
          ).status,
          400,
        );
        assert.equal(
          (await anon("/api/public/book-new", p)).data.order_no,
          result.data.order_no,
        );
        const same = await anon("/api/public/book-new", {
          ...newPayload(),
          phone: "09171234567",
          address: "Unverified address",
          ...(await human()),
        });
        assert.equal(same.status, 200);
        assert.equal(
          app.store.one("customers", customer.id).address,
          "Pickup Street",
        );
        assert.equal(
          app.store.all("customers").filter((c) => c.phone === customer.phone)
            .length,
          1,
        );
      },
    );
    await t.test(
      "capacity and rate limits are enforced; customer tokens reset and blocked links rejected",
      async () => {
        const slots = app.store.publicConfig().dates;
        const date = slots[2].date;
        app.store.update("settings", 1, { daily_pickup_capacity_loads: 1 });
        const one = {
          ...newPayload(),
          phone: "09176666666",
          pickup_date: date,
          ...(await human()),
        };
        assert.equal((await anon("/api/public/book-new", one)).status, 200);
        const two = {
          ...newPayload(),
          phone: "09175555555",
          pickup_date: date,
          ...(await human()),
        };
        assert.equal((await anon("/api/public/book-new", two)).status, 400);
        app.store.rate("unit-rate", 1, 3600);
        assert.throws(() => app.store.rate("unit-rate", 1, 3600), /Too many/);
        const reset = await rpc(owner, "reset_booking_link", {
          p_customer: customer.id,
        });
        assert.equal(
          (await anon("/api/public/lookup", { token: customer.booking_token }))
            .status,
          400,
        );
        app.store.update("customers", customer.id, { blocked: true });
        assert.equal(
          (await anon("/api/public/lookup", { token: reset.data })).status,
          400,
        );
      },
    );
    await t.test(
      "full SQLite backup is owner-only and restores records consistently",
      async () => {
        assert.equal((await fetch(base + "/api/backup")).status, 403);
        const riderLogin = await rider("/api/login", {
          email: "rider@example.test",
          password,
        });
        assert.equal(
          (
            await fetch(base + "/api/backup", {
              headers: {
                Cookie: riderLogin.headers.get("set-cookie").split(";")[0],
              },
            })
          ).status,
          403,
        );
        const login = await owner("/api/login", {
          email: "owner@example.test",
          password,
        });
        const response = await fetch(base + "/api/backup", {
          headers: { Cookie: login.headers.get("set-cookie").split(";")[0] },
        });
        assert.equal(response.status, 200);
        assert.equal(response.headers.get("cache-control"), "no-store");
        const bytes = Buffer.from(await response.arrayBuffer());
        assert.equal(bytes.subarray(0, 15).toString(), "SQLite format 3");
        const path = join(directory, "backup-test.sqlite");
        writeFileSync(path, bytes);
        const restored = new DatabaseSync(path, { readOnly: true });
        assert.equal(
          restored.prepare("select count(*) n from orders").get().n,
          app.store.all("orders").length,
        );
        assert.equal(
          restored.prepare("pragma integrity_check").get().integrity_check,
          "ok",
        );
        restored.close();
      },
    );
    await t.test(
      "deactivation invalidates an existing session immediately",
      async () => {
        assert.equal(
          (
            await owner("/api/staff-admin", {
              action: "set_active",
              user_id: riderId,
              active: false,
            })
          ).status,
          200,
        );
        assert.equal((await rpc(rider, "rider_tasks")).status, 403);
        assert.equal((await rider("/api/session")).data.session, null);
      },
    );
    await t.test(
      "SQLite data, accounts, and audit events survive server restart; hard deletes blocked",
      async () => {
        assert.throws(
          () =>
            app.store.db.prepare("DELETE FROM orders WHERE id=?").run(order.id),
          /Cancel orders/,
        );
        const events = app.store.all("order_events").length;
        const count = app.store.all("orders").length;
        await app.close();
        app = createApp({ directory });
        await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
        base = `http://127.0.0.1:${app.server.address().port}`;
        assert.equal(app.store.all("orders").length, count);
        assert.equal(app.store.all("order_events").length, events);
        assert.equal(
          (await owner("/api/login", { email: "owner@example.test", password }))
            .status,
          200,
        );
        assert.ok((await table(owner, "customers")).data.length > 0);
      },
    );
  } finally {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
