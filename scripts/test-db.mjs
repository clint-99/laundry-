import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import pg from "pg";
import assert from "node:assert/strict";
const dir = mkdtempSync(join(tmpdir(), "laundry-pg-"));
const bin = resolve("node_modules/@embedded-postgres/linux-x64/native/bin");
const init = spawnSync(
  join(bin, "initdb"),
  ["-D", dir, "-U", "postgres", "-A", "trust", "--no-locale"],
  { encoding: "utf8" },
);
if (init.status !== 0) throw new Error(init.stderr);
const port = 15439;
const proc = spawn(
  join(bin, "postgres"),
  ["-D", dir, "-p", String(port), "-k", dir, "-h", "127.0.0.1"],
  { stdio: ["ignore", "ignore", "pipe"] },
);
let log = "";
proc.stderr.on("data", (d) => (log += d));
let client;
try {
  for (let i = 0; i < 100; i++) {
    try {
      client = new pg.Client({
        host: "127.0.0.1",
        port,
        user: "postgres",
        database: "postgres",
      });
      await client.connect();
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
      client = null;
    }
  }
  if (!client) throw new Error(log);
  await client.query(
    `create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$; grant usage on schema auth to authenticated,service_role; grant execute on function auth.uid() to authenticated,service_role; create publication supabase_realtime;`,
  );
  await client.query(readFileSync("supabase/migrations/001_init.sql", "utf8"));
  await client.query(readFileSync("supabase/seed.sql", "utf8"));
  const owner = "00000000-0000-0000-0000-000000000001",
    rider = "00000000-0000-0000-0000-000000000002";
  await client.query(`insert into auth.users values($1),($2)`, [owner, rider]);
  await client.query(
    `insert into profiles(id,role,full_name) values($1,'owner','Owner'),($2,'rider','Rider')`,
    [owner, rider],
  );
  const as = async (role, id, sql, args = []) => {
    await client.query(`set role ${role}`);
    await client.query(`select set_config('request.jwt.claim.sub',$1,false)`, [
      id || "",
    ]);
    try {
      return await client.query(sql, args);
    } finally {
      await client.query("reset role");
    }
  };
  let count = 0;
  const pass = (name) => {
    count++;
    console.log("PASS", name);
  };
  for (const table of [
    "settings",
    "services",
    "shops",
    "customers",
    "orders",
    "order_events",
    "profiles",
    "rider_pay",
    "rate_limits",
    "rider_actions",
    "booking_requests",
  ])
    await assert.rejects(as("anon", null, `select * from ${table}`));
  for (const { oid, name } of (
    await client.query(
      `select p.oid,p.proname name from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'`,
    )
  ).rows) {
    const allowed = await client.query(
      `select has_function_privilege('anon',$1,'execute') ok`,
      [oid],
    );
    assert.equal(allowed.rows[0].ok, false, name);
  }
  pass("anon has no table or RPC access");
  for (const table of [
    "orders",
    "customers",
    "shops",
    "services",
    "settings",
    "rider_pay",
  ]) {
    assert.equal(
      (await as("authenticated", rider, `select * from ${table}`)).rowCount,
      0,
    );
    await assert.rejects(
      as("authenticated", rider, `insert into ${table} default values`),
    );
    assert.equal(
      (
        await as(
          "authenticated",
          rider,
          `update ${table} set id=id returning id`,
        )
      ).rowCount,
      0,
    );
    try {
      assert.equal(
        (await as("authenticated", rider, `delete from ${table} returning id`))
          .rowCount,
        0,
      );
    } catch (e) {
      assert.match(e.message, /permission denied/);
    }
  }
  pass("rider cannot read or write private tables");
  const c = (await client.query("select * from customers limit 1")).rows[0],
    s = (await client.query("select * from services limit 1")).rows[0],
    shop = (await client.query("select * from shops limit 1")).rows[0];
  const o = (
    await as(
      "authenticated",
      owner,
      `insert into orders(customer_id,service_id,loads,shop_id,pickup_date,price_per_load,shop_cost_per_load) values($1,$2,2,$3,current_date,1,1) returning *`,
      [c.id, s.id, shop.id],
    )
  ).rows[0];
  assert.equal(Number(o.total_price), 380);
  assert.equal(Number(o.shop_cost_per_load), 125);
  pass("server snapshots price and shop cost, ignoring forged values");
  const tasks = (
    await as("authenticated", rider, "select * from rider_tasks()")
  ).rows;
  assert.equal(tasks.length, 1);
  assert.equal(
    Object.keys(tasks[0]).some((k) => /price|cost|margin|token/.test(k)),
    false,
  );
  await assert.rejects(
    as(
      "authenticated",
      rider,
      `select rider_mark($1,'ready',gen_random_uuid())`,
      [o.id],
    ),
  );
  const action = "00000000-0000-0000-0000-000000000010";
  await as("authenticated", rider, `select rider_mark($1,'picked_up',$2)`, [
    o.id,
    action,
  ]);
  await as("authenticated", rider, `select rider_mark($1,'picked_up',$2)`, [
    o.id,
    action,
  ]);
  assert.equal((await client.query("select * from rider_actions")).rowCount, 1);
  await as("authenticated", rider, "select rider_undo($1)", [action]);
  assert.equal(
    (await client.query("select status from orders where id=$1", [o.id]))
      .rows[0].status,
    "placed",
  );
  const a2 = "00000000-0000-0000-0000-000000000011";
  await as("authenticated", rider, `select rider_mark($1,'picked_up',$2)`, [
    o.id,
    a2,
  ]);
  await client.query(
    `update rider_actions set at=now()-interval '61 seconds' where id=$1`,
    [a2],
  );
  await assert.rejects(
    as("authenticated", rider, "select rider_undo($1)", [a2]),
  );
  pass(
    "rider transition restrictions, retry deduplication, and 60-second undo",
  );
  await client.query("update profiles set active=false where id=$1", [rider]);
  assert.equal(
    (await as("authenticated", rider, "select * from rider_tasks()")).rowCount,
    0,
  );
  await assert.rejects(
    as(
      "authenticated",
      rider,
      `select rider_mark($1,'at_shop',gen_random_uuid())`,
      [o.id],
    ),
  );
  await client.query("update profiles set active=true where id=$1", [rider]);
  pass("deactivation takes effect with the same JWT identity");
  await as(
    "authenticated",
    rider,
    `select rider_mark($1,'at_shop',gen_random_uuid())`,
    [o.id],
  );
  await as(
    "authenticated",
    owner,
    `select owner_status($1,'ready','Shop ready')`,
    [o.id],
  );
  await as(
    "authenticated",
    rider,
    `select rider_mark($1,'delivered',gen_random_uuid())`,
    [o.id],
  );
  assert.equal(
    (
      await client.query(
        "select count(*) from order_events where order_id=$1",
        [o.id],
      )
    ).rows[0].count,
    "7",
  );
  pass("full lifecycle and audit trail");
  await client.query(
    "insert into rider_pay(date,rider,pay_type,amount,stops) values(current_date,$1,'daily',100,2)",
    [rider],
  );
  const financial = (
    await as(
      "authenticated",
      owner,
      "select owner_report(current_date-1,current_date+1,'day') data",
    )
  ).rows[0].data;
  assert.equal(Number(financial.totals.revenue), 380);
  assert.equal(Number(financial.totals.shop_cost), 250);
  assert.equal(Number(financial.totals.rider_cost), 100);
  assert.equal(Number(financial.totals.margin), 30);
  assert.equal(Number(financial.totals.margin_per_load), 15);
  await assert.rejects(
    as(
      "authenticated",
      rider,
      "select owner_report(current_date,current_date,'day')",
    ),
  );
  pass("server-calculated financial reports and rider report denial");
  const lookup = (
    await as("service_role", null, "select booking_lookup($1) data", [
      c.booking_token,
    ])
  ).rows[0].data;
  assert.equal("phone" in lookup, false);
  assert.equal("address" in lookup, false);
  await assert.rejects(
    as("service_role", null, "select booking_lookup('random')"),
  );
  await client.query(
    `update settings set same_day_cutoff='23:59',daily_pickup_capacity_loads=40`,
  );
  const dates = (await as("service_role", null, "select public_config() data"))
    .rows[0].data.dates;
  const date = dates[1].date;
  const payload = {
    token: c.booking_token,
    service_id: s.id,
    loads: 1,
    pickup_date: date,
    pickup_window: "Morning",
    price_per_load: 1,
    address: "FORGED",
  };
  const booked = (
    await as("service_role", null, "select create_booking($1,true) data", [
      payload,
    ])
  ).rows[0].data;
  assert.equal(Number(booked.total), 190);
  await assert.rejects(
    as("service_role", null, "select create_booking($1,true)", [payload]),
  );
  pass(
    "private lookup, server-controlled rebooking and duplicate-active refusal",
  );
  const request = {
    name: "Different supplied name",
    phone: c.phone,
    area: c.area,
    address: "Unverified new address",
    service_id: s.id,
    loads: 1,
    pickup_date: date,
    pickup_window: "Afternoon",
    consent: true,
  };
  const pending = (
    await as("service_role", null, "select create_booking($1,false) data", [
      request,
    ])
  ).rows[0].data;
  assert.equal(pending.status, "pending_approval");
  assert.equal(
    (await client.query("select count(*) from customers")).rows[0].count,
    "1",
  );
  assert.equal(
    (await client.query("select address from customers")).rows[0].address,
    c.address,
  );
  pass(
    "known phone creates pending review without duplicating or overwriting customer",
  );
  assert.equal(
    (await as("service_role", null, "select consume_rate('test',1,3600) ok"))
      .rows[0].ok,
    true,
  );
  assert.equal(
    (await as("service_role", null, "select consume_rate('test',1,3600) ok"))
      .rows[0].ok,
    false,
  );
  pass("atomic rate limit");
  await client.query("update settings set daily_pickup_capacity_loads=1");
  await assert.rejects(
    as("service_role", null, "select create_booking($1,false)", [request]),
  );
  pass("capacity enforced in transaction");
  await client.query("update settings set daily_pickup_capacity_loads=40");
  const retryRequest = {
    ...request,
    request_id: "00000000-0000-0000-0000-000000000099",
  };
  const firstRetry = (
    await as("service_role", null, "select create_booking($1,false) data", [
      retryRequest,
    ])
  ).rows[0].data;
  const secondRetry = (
    await as("service_role", null, "select create_booking($1,false) data", [
      retryRequest,
    ])
  ).rows[0].data;
  assert.equal(firstRetry.order_no, secondRetry.order_no);
  await assert.rejects(
    as("service_role", null, "select create_booking($1,false)", [
      { ...retryRequest, loads: 2 },
    ]),
  );
  pass("public request IDs deduplicate retries and reject changed payloads");
  await client.query("select setval('customer_seq',9999)");
  const code = (
    await client.query(
      "insert into customers(full_name,phone,area,address) values('Another','+639188888888','Sample Area A','Street') returning bag_code",
    )
  ).rows[0].bag_code;
  assert.equal(code, "CU-10000");
  pass("bag codes remain unique beyond 9,999 customers");
  const other = (
    await client.query("select * from customers where phone='+639188888888'")
  ).rows[0];
  await client.query("update settings set daily_pickup_capacity_loads=1");
  const d = dates[2].date;
  const third = (
    await client.query(
      "insert into customers(full_name,phone,area,address) values('Third','+639177777777','Sample Area A','Street') returning *",
    )
  ).rows[0];
  const concurrent = await Promise.allSettled(
    [other, third].map(async (person) => {
      const cl = new pg.Client({
        host: "127.0.0.1",
        port,
        user: "postgres",
        database: "postgres",
      });
      await cl.connect();
      try {
        return await cl.query("select create_booking($1,true)", [
          { ...payload, token: person.booking_token, pickup_date: d },
        ]);
      } finally {
        await cl.end();
      }
    }),
  );
  assert.equal(concurrent.filter((x) => x.status === "fulfilled").length, 1);
  pass("concurrent public bookings cannot oversell capacity");

  const trial = (
    await as(
      "authenticated",
      owner,
      `insert into orders(customer_id,service_id,loads,shop_id,pickup_date) values($1,$2,1,$3,current_date) returning *`,
      [c.id, s.id, shop.id],
    )
  ).rows[0];
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
      await as(
        "authenticated",
        owner,
        "select owner_status($1,$2,'Transition test reset')",
        [trial.id, from],
      );
      const allowed =
        (from === "placed" && to === "picked_up") ||
        (["picked_up", "weighed"].includes(from) && to === "at_shop") ||
        (from === "ready" && to === "delivered");
      const operation = as(
        "authenticated",
        rider,
        "select rider_mark($1,$2,$3)",
        [trial.id, to, crypto.randomUUID()],
      );
      if (allowed) await operation;
      else await assert.rejects(operation);
    }
  pass("all 64 rider status pairs checked against the transition allowlist");
  await as(
    "authenticated",
    owner,
    "select owner_status($1,'picked_up','Test undo')",
    [trial.id],
  );
  const dropAction = crypto.randomUUID();
  await as("authenticated", rider, "select rider_mark($1,'at_shop',$2)", [
    trial.id,
    dropAction,
  ]);
  await as("authenticated", rider, "select rider_undo($1)", [dropAction]);
  assert.equal(
    (await client.query("select status from orders where id=$1", [trial.id]))
      .rows[0].status,
    "picked_up",
  );
  await as(
    "authenticated",
    owner,
    "select owner_status($1,'ready','Test delivery undo')",
    [trial.id],
  );
  const deliveredAction = crypto.randomUUID();
  await as("authenticated", rider, "select rider_mark($1,'delivered',$2)", [
    trial.id,
    deliveredAction,
  ]);
  await as("authenticated", rider, "select rider_undo($1)", [deliveredAction]);
  await as(
    "authenticated",
    owner,
    "select owner_status($1,'placed','Test later event')",
    [trial.id],
  );
  const olderAction = crypto.randomUUID();
  await as("authenticated", rider, "select rider_mark($1,'picked_up',$2)", [
    trial.id,
    olderAction,
  ]);
  await as(
    "authenticated",
    owner,
    "select owner_status($1,'weighed','Newer event')",
    [trial.id],
  );
  await as(
    "authenticated",
    owner,
    "select owner_status($1,'picked_up','Returned status')",
    [trial.id],
  );
  await assert.rejects(
    as("authenticated", rider, "select rider_undo($1)", [olderAction]),
  );
  await assert.rejects(
    as("authenticated", owner, "update orders set status='ready' where id=$1", [
      trial.id,
    ]),
  );
  pass(
    "drop-off/delivery undo works; later events and unaudited overrides are refused",
  );
  await assert.rejects(
    as("authenticated", rider, "select reset_booking_link($1)", [c.id]),
  );
  await assert.rejects(
    as("authenticated", rider, "select next_code('public.customer_seq','CU-')"),
  );
  await assert.rejects(
    as("authenticated", rider, "select new_booking_token()"),
  );
  const old = c.booking_token;
  const freshToken = (
    await as("authenticated", owner, "select reset_booking_link($1) token", [
      c.id,
    ])
  ).rows[0].token;
  assert.notEqual(freshToken, old);
  await assert.rejects(
    as("service_role", null, "select booking_lookup($1)", [old]),
  );
  await client.query("update customers set blocked=true where id=$1", [c.id]);
  await assert.rejects(
    as("service_role", null, "select booking_lookup($1)", [freshToken]),
  );
  pass("owner-only link reset, blocked-token denial and helper RPC protection");
  console.log(`${count} database security and workflow groups passed`);
} finally {
  if (client) await client.end();
  proc.kill("SIGTERM");
  await new Promise((r) => proc.once("exit", r));
  rmSync(dir, { recursive: true, force: true });
}
