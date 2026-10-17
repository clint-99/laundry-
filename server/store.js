import { DatabaseSync } from "node:sqlite";
import {
  mkdirSync,
  readFileSync,
  existsSync,
  writeFileSync,
  chmodSync,
} from "node:fs";
import {
  randomBytes,
  randomUUID,
  createHash,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { resolve, join } from "node:path";
import { today, addDays, STATUSES, WINDOWS } from "../shared/utils.js";
import { validateBooking, token as validToken } from "./validation.js";
export class AppError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
export const hash = (value) => createHash("sha256").update(value).digest("hex");
export function passwordHash(password) {
  const salt = randomBytes(16).toString("hex");
  return salt + ":" + scryptSync(password, salt, 64).toString("hex");
}
export function verifyPassword(password, stored) {
  const [salt, key] = stored.split(":");
  return timingSafeEqual(
    scryptSync(password, salt, 64),
    Buffer.from(key, "hex"),
  );
}
const bools = new Set([
  "active",
  "blocked",
  "booking_open",
  "deliver_to_other",
  "undone",
]);
const jsons = new Set(["service_areas", "message_templates"]);
const now = () => new Date().toISOString();
const cents = (n) => Math.round(Number(n) * 100);
const money = (n) => cents(n) / 100;
const safeProfile = (p) => {
  if (!p) return null;
  const { password_hash, email, ...publicProfile } = p;
  return publicProfile;
};
function text(v, name, min = 1, max = 500) {
  if (typeof v !== "string" || v.trim().length < min || v.length > max)
    throw new AppError(`Check ${name}.`);
  return v.trim();
}
function number(v, name, min = 0, max = 1e7, integer = false) {
  if (
    typeof v !== "number" ||
    !Number.isFinite(v) ||
    v < min ||
    v > max ||
    (integer && !Number.isInteger(v))
  )
    throw new AppError(`Check ${name}.`);
  return v;
}
function date(v) {
  if (
    typeof v !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(v) ||
    !Number.isFinite(Date.parse(v)) ||
    new Date(v).toISOString().slice(0, 10) !== v
  )
    throw new AppError("Choose a valid date.");
  return v;
}
function boolean(v, name) {
  if (typeof v !== "boolean") throw new AppError(`Check ${name}.`);
  return v;
}
export class Store {
  constructor(directory) {
    this.directory = resolve(directory);
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    chmodSync(this.directory, 0o700);
    this.path = join(this.directory, "platform.sqlite");
    this.db = new DatabaseSync(this.path);
    this.db.exec(
      readFileSync(new URL("./schema.sql", import.meta.url), "utf8"),
    );
    // Additive migration keeps existing installations and customer records intact.
    if (
      !this.db
        .prepare("PRAGMA table_info(customers)")
        .all()
        .some((column) => column.name === "email")
    )
      this.db.exec(
        "ALTER TABLE customers ADD COLUMN email TEXT NOT NULL DEFAULT ''",
      );
    chmodSync(this.path, 0o600);
    this.db.exec("PRAGMA busy_timeout=5000");
    this.onChange = () => {};
    if (!this.one("settings", 1))
      this.insert("settings", {
        id: 1,
        business_name: "Fresh Fold",
        currency_symbol: "₱",
        timezone: "Asia/Manila",
        max_kg_per_load: 8,
        default_delivery_days: 1,
        same_day_cutoff: "15:00",
        daily_pickup_capacity_loads: 40,
        service_areas: [],
        booking_open: false,
        hotline: "",
        facebook_url: "",
        rider_daily_default: 0,
        rider_batch_default: 0,
        message_templates: {
          booking_link: "Hi {name}! Book your pickup here: {link}",
          confirmation: "Hi {name}, order {order} is confirmed for {date}.",
          pickup_reminder: "Please have bag {bag} ready on {date}.",
          ready: "Order {order} is ready for delivery.",
          delivered: "Order {order} delivered. Thank you!",
        },
      });
    if (!this.all("services").length)
      this.insert("services", {
        id: randomUUID(),
        name: "Wash, dry & fold",
        price_per_load: 190,
        active: true,
        sort: 0,
      });
    const secretPath = join(this.directory, "server-secret");
    if (!existsSync(secretPath))
      writeFileSync(secretPath, randomBytes(32).toString("hex"), {
        mode: 0o600,
        flag: "wx",
      });
    this.secret = readFileSync(secretPath, "utf8").trim();
    this.setupPath = join(this.directory, "setup-code.txt");
    if (!this.all("profiles").length && !existsSync(this.setupPath))
      writeFileSync(this.setupPath, randomBytes(24).toString("hex"), {
        mode: 0o600,
        flag: "wx",
      });
  }
  decode(row) {
    if (!row) return null;
    const result = { ...row };
    for (const k of Object.keys(result)) {
      if (bools.has(k)) result[k] = Boolean(result[k]);
      if (jsons.has(k)) result[k] = JSON.parse(result[k]);
    }
    return result;
  }
  all(table) {
    return this.db
      .prepare(`SELECT * FROM ${table}`)
      .all()
      .map((r) => this.decode(r));
  }
  one(table, id) {
    if (typeof id !== "string" && typeof id !== "number") return null;
    return this.decode(
      this.db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id),
    );
  }
  insert(table, row) {
    const cols = Object.keys(row);
    this.db
      .prepare(
        `INSERT INTO ${table} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`,
      )
      .run(
        ...cols.map((k) =>
          jsons.has(k)
            ? JSON.stringify(row[k])
            : typeof row[k] === "boolean"
              ? Number(row[k])
              : (row[k] ?? null),
        ),
      );
    return this.one(
      table,
      row.id ??
        Number(this.db.prepare("SELECT last_insert_rowid() id").get().id),
    );
  }
  update(table, id, row) {
    const cols = Object.keys(row).filter((k) => k !== "id");
    if (cols.length)
      this.db
        .prepare(
          `UPDATE ${table} SET ${cols.map((k) => k + "=?").join(",")} WHERE id=?`,
        )
        .run(
          ...cols.map((k) =>
            jsons.has(k)
              ? JSON.stringify(row[k])
              : typeof row[k] === "boolean"
                ? Number(row[k])
                : (row[k] ?? null),
          ),
          id,
        );
    return this.one(table, id);
  }
  transaction(fn) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  next(name, prefix) {
    this.db
      .prepare(
        "INSERT INTO counters(name,value) VALUES(?,1) ON CONFLICT(name) DO UPDATE SET value=value+1",
      )
      .run(name);
    return (
      prefix +
      String(
        this.db.prepare("SELECT value FROM counters WHERE name=?").get(name)
          .value,
      ).padStart(4, "0")
    );
  }
  rate(key, limit, seconds) {
    const k = hash(this.secret + key),
      time = Date.now();
    this.db
      .prepare(
        "INSERT INTO rate_limits(key,window_start,count) VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN window_start<=? THEN 1 ELSE count+1 END,window_start=CASE WHEN window_start<=? THEN excluded.window_start ELSE window_start END",
      )
      .run(k, time, time - seconds * 1000, time - seconds * 1000);
    if (
      this.db.prepare("SELECT count FROM rate_limits WHERE key=?").get(k)
        .count > limit
    )
      throw new AppError("Too many requests. Please try again later.", 429);
  }
  require(user, roles = ["owner"]) {
    const p = user && this.one("profiles", user.id);
    if (!p?.active || !roles.includes(p.role))
      throw new AppError("You do not have permission for this action.", 403);
    return p;
  }
  password(value) {
    return text(value, "password", 12, 128);
  }
  createStaff(data, role = "rider") {
    const email = text(data.email, "email", 3, 254).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      throw new AppError("Check the email address.");
    if (this.db.prepare("SELECT id FROM profiles WHERE email=?").get(email))
      throw new AppError(
        "Could not create this staff account. Check the email.",
      );
    return safeProfile(
      this.insert("profiles", {
        id: randomUUID(),
        email,
        password_hash: passwordHash(
          this.password(data.temp_password || data.password),
        ),
        role,
        full_name: text(data.full_name, "full name", 1, 120),
        phone: "",
        active: true,
        created_at: now(),
      }),
    );
  }
  setup(data, ip) {
    this.rate("setup:" + ip, 5, 900);
    return this.transaction(() => {
      if (this.all("profiles").length)
        throw new AppError("An owner account already exists.", 409);
      if (
        typeof data.code !== "string" ||
        hash(data.code) !== hash(readFileSync(this.setupPath, "utf8").trim())
      )
        throw new AppError("The setup code is not valid.", 403);
      return this.createStaff(data, "owner");
    });
  }
  login(data, ip) {
    this.rate("login-ip:" + ip, 20, 900);
    const email =
      typeof data.email === "string" ? data.email.toLowerCase().trim() : "";
    this.rate("login-email:" + email, 10, 900);
    if (typeof data.password !== "string" || data.password.length > 128)
      throw new AppError("Incorrect email or password.", 401);
    const p = this.db
      .prepare("SELECT * FROM profiles WHERE email=?")
      .get(email);
    const dummy = "00000000000000000000000000000000:" + "00".repeat(64);
    const valid = verifyPassword(data.password, p?.password_hash || dummy);
    if (!valid || !p?.active)
      throw new AppError("Incorrect email or password.", 401);
    const token = randomBytes(32).toString("hex");
    this.db
      .prepare(
        "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)",
      )
      .run(hash(token), p.id, Date.now() + 8 * 3600e3);
    return { token, user: safeProfile(this.decode(p)) };
  }
  session(cookie) {
    const found = this.db
      .prepare(
        "SELECT user_id FROM sessions WHERE token_hash=? AND expires_at>?",
      )
      .get(hash(cookie || ""), Date.now());
    const p = found && this.one("profiles", found.user_id);
    return p?.active ? safeProfile(p) : null;
  }
  logout(cookie) {
    this.db
      .prepare("DELETE FROM sessions WHERE token_hash=?")
      .run(hash(cookie || ""));
  }
  event(o, user, note, kind = "status") {
    return this.insert("order_events", {
      order_id: o.id,
      status: o.status,
      note,
      kind,
      by_user: user?.id || null,
      at: now(),
    });
  }
  profileView(user) {
    return safeProfile(user);
  }
  table(user, request) {
    this.require(user, ["owner", "rider"]);
    const tables = [
      "settings",
      "services",
      "shops",
      "customers",
      "orders",
      "order_events",
      "rider_pay",
      "profiles",
    ];
    const table = request.table;
    if (!tables.includes(table))
      throw new AppError("Table not available.", 404);
    if (
      user.role !== "owner" &&
      !(
        table === "profiles" &&
        request.op === "select" &&
        request.filters?.id === user.id
      )
    )
      throw new AppError("Owner access required.", 403);
    if (request.op === "select") {
      let rows = this.all(table);
      if (table === "profiles") rows = rows.map(safeProfile);
      if (request.filters) {
        if (Object.keys(request.filters).some((k) => k !== "id"))
          throw new AppError("Invalid filter.");
        if ("id" in request.filters)
          rows = rows.filter((r) => r.id === request.filters.id);
      }
      const order = request.order;
      if (order) {
        if (!["id", "date", "at"].includes(order))
          throw new AppError("Invalid sort.");
        rows.sort((a, b) => String(a[order]).localeCompare(String(b[order])));
      }
      const start = Number.isInteger(request.start)
        ? Math.max(0, request.start)
        : 0;
      const end = Number.isInteger(request.end)
        ? Math.min(start + 999, request.end)
        : start + 999;
      rows = rows.slice(start, end + 1);
      if (request.single) {
        if (rows.length !== 1) throw new AppError("Record not found.", 404);
        return rows[0];
      }
      return rows;
    }
    this.require(user);
    if (!["insert", "update"].includes(request.op))
      throw new AppError(
        "Delete is not supported. Archive or cancel instead.",
        405,
      );
    if (
      ["profiles", "order_events"].includes(table) ||
      (request.op === "insert" && table === "settings")
    )
      throw new AppError("Use the designated staff or status action.", 403);
    return this.transaction(() => {
      const old =
        request.op === "update" ? this.one(table, request.filters?.id) : null;
      if (request.op === "update" && !old)
        throw new AppError("Record not found.", 404);
      let result;
      if (table === "orders")
        result = this.writeOrder(request.values, old, user);
      else {
        const values = this.validate(table, request.values, old);
        result = old
          ? this.update(table, old.id, values)
          : this.insert(table, { id: randomUUID(), ...values });
      }
      this.onChange(table);
      return result;
    });
  }
  validate(table, data, old) {
    if (!data || typeof data !== "object" || Array.isArray(data))
      throw new AppError("Invalid record.");
    const allowed = {
      settings: [
        "business_name",
        "currency_symbol",
        "timezone",
        "max_kg_per_load",
        "default_delivery_days",
        "same_day_cutoff",
        "daily_pickup_capacity_loads",
        "service_areas",
        "booking_open",
        "hotline",
        "facebook_url",
        "rider_daily_default",
        "rider_batch_default",
        "message_templates",
      ],
      services: ["name", "price_per_load", "active", "sort"],
      shops: [
        "name",
        "phone",
        "address",
        "cost_per_load",
        "capacity_loads",
        "active",
      ],
      customers: [
        "email",
        "full_name",
        "phone",
        "area",
        "address",
        "landmark",
        "lat",
        "lng",
        "notes",
        "blocked",
      ],
      rider_pay: ["date", "rider", "pay_type", "amount", "stops", "notes"],
    }[table];
    if (!allowed || Object.keys(data).some((k) => !allowed.includes(k)))
      throw new AppError("A protected or unknown field was submitted.");
    const row = { ...old, ...data };
    const out = {};
    for (const k of allowed) if (k in row) out[k] = row[k];
    const checkText = (k, min = 1, max = 500) =>
      (out[k] = text(row[k], k, min, max));
    if (table === "settings") {
      for (const k of ["business_name", "currency_symbol", "timezone"])
        checkText(k, 1, k === "currency_symbol" ? 8 : 120);
      try {
        new Intl.DateTimeFormat("en", { timeZone: row.timezone });
      } catch {
        throw new AppError("Unknown timezone.");
      }
      for (const k of [
        "max_kg_per_load",
        "rider_daily_default",
        "rider_batch_default",
      ])
        out[k] = number(row[k], k, k === "max_kg_per_load" ? 0.1 : 0);
      for (const [k, min, max] of [
        ["default_delivery_days", 0, 30],
        ["daily_pickup_capacity_loads", 1, 100000],
      ])
        out[k] = number(row[k], k, min, max, true);
      if (!/^([01]\d|2[0-3]):[0-5]\d(?::00)?$/.test(row.same_day_cutoff))
        throw new AppError("Choose a valid cutoff time.");
      out.same_day_cutoff = row.same_day_cutoff.slice(0, 5);
      if (!Array.isArray(row.service_areas) || row.service_areas.length > 200)
        throw new AppError("Check service areas.");
      out.service_areas = [
        ...new Set(row.service_areas.map((v) => text(v, "area", 1, 120))),
      ];
      out.booking_open = boolean(row.booking_open, "booking open");
      for (const k of ["hotline", "facebook_url"])
        out[k] = text(row[k] || "", k, 0, 500);
      if (out.facebook_url && !/^https:\/\//.test(out.facebook_url))
        throw new AppError("Facebook URL must begin with https://");
      if (
        !row.message_templates ||
        Array.isArray(row.message_templates) ||
        typeof row.message_templates !== "object" ||
        Object.keys(row.message_templates).length > 20
      )
        throw new AppError("Check message templates.");
      out.message_templates = Object.fromEntries(
        Object.entries(row.message_templates).map(([k, v]) => [
          text(k, "template name", 1, 80),
          text(v, "template", 0, 2000),
        ]),
      );
    }
    if (table === "services") {
      checkText("name", 1, 120);
      out.price_per_load = money(number(row.price_per_load, "price per load"));
      out.active = boolean(row.active ?? true, "active");
      out.sort = number(row.sort ?? 0, "sort", -1000, 1000, true);
    }
    if (table === "shops") {
      checkText("name", 1, 120);
      out.phone = text(row.phone || "", "phone", 0, 40);
      out.address = text(row.address || "", "address", 0, 500);
      out.cost_per_load = money(number(row.cost_per_load, "cost per load"));
      out.capacity_loads = number(
        row.capacity_loads,
        "capacity",
        1,
        100000,
        true,
      );
      out.active = boolean(row.active ?? true, "active");
    }
    if (table === "customers") {
      out.email = text(row.email || "", "email", 0, 254).toLowerCase();
      if (out.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.email))
        throw new AppError("Check the email address.");
      checkText("full_name", 1, 120);
      out.phone = text(row.phone, "phone", 13, 13);
      if (!/^\+639\d{9}$/.test(out.phone))
        throw new AppError("Check the mobile number.");
      checkText("area", 1, 120);
      checkText("address");
      for (const k of ["landmark", "notes"])
        out[k] = text(row[k] || "", k, 0, k === "notes" ? 1000 : 300);
      out.blocked = boolean(row.blocked ?? false, "blocked");
      for (const [k, min, max] of [
        ["lat", -90, 90],
        ["lng", -180, 180],
      ])
        out[k] = row[k] == null ? null : number(row[k], k, min, max);
      if ((out.lat == null) !== (out.lng == null))
        throw new AppError("Check coordinates.");
      if (!old)
        Object.assign(out, {
          bag_code: this.next("customer", "CU-"),
          booking_token: randomBytes(24).toString("hex"),
          created_at: now(),
        });
    }
    if (table === "rider_pay") {
      out.date = date(row.date);
      if (this.one("profiles", row.rider)?.role !== "rider")
        throw new AppError("Choose a rider.");
      out.rider = row.rider;
      if (!["daily", "batch"].includes(row.pay_type))
        throw new AppError("Choose daily or batch.");
      out.amount = money(number(row.amount, "amount"));
      out.stops = number(row.stops ?? 0, "stops", 0, 100000, true);
      out.notes = text(row.notes || "", "notes", 0, 500);
    }
    return out;
  }
  writeOrder(data, old, user, publicOptions) {
    const allowed = [
      "customer_id",
      "service_id",
      "loads",
      "bags",
      "shop_id",
      "pickup_date",
      "pickup_window",
      "due_date",
      "deliver_to_other",
      "delivery_address",
      "delivery_area",
      "notes",
      "actual_kg",
      "channel",
    ];
    if (!data || Object.keys(data).some((k) => !allowed.includes(k)))
      throw new AppError("Order fields are protected. Use the status action.");
    const row = { ...old, ...data },
      settings = this.one("settings", 1),
      customer = this.one("customers", row.customer_id),
      service = this.one("services", row.service_id);
    if (
      !customer ||
      !service ||
      (!service.active && old?.service_id !== service.id)
    )
      throw new AppError("Choose an available customer and service.");
    const loads = number(row.loads, "loads", 1, 20, true),
      bags = number(row.bags ?? 1, "bags", 1, 20, true),
      pickup = date(row.pickup_date);
    if (!WINDOWS.includes(row.pickup_window))
      throw new AppError("Choose a pickup window.");
    const partner = row.shop_id ? this.one("shops", row.shop_id) : null;
    if (
      row.shop_id &&
      (!partner || (!partner.active && old?.shop_id !== partner.id))
    )
      throw new AppError("Choose an active shop.");
    const different = boolean(
      row.deliver_to_other ?? false,
      "delivery address",
    );
    if (
      different &&
      (!row.delivery_address?.trim() || !row.delivery_area?.trim())
    )
      throw new AppError("Add the alternate delivery address and area.");
    const out = {
      customer_id: customer.id,
      service_id: service.id,
      loads,
      bags,
      price_per_load:
        old?.service_id === service.id
          ? old.price_per_load
          : service.price_per_load,
      shop_id: partner?.id || null,
      shop_cost_per_load: partner
        ? old?.shop_id === partner.id
          ? old.shop_cost_per_load
          : partner.cost_per_load
        : null,
      pickup_date: pickup,
      pickup_window: row.pickup_window,
      due_date: date(
        row.due_date || addDays(pickup, settings.default_delivery_days),
      ),
      deliver_to_other: different,
      delivery_address: text(
        row.delivery_address || "",
        "delivery address",
        0,
        500,
      ),
      delivery_area: text(row.delivery_area || "", "delivery area", 0, 120),
      notes: text(row.notes || "", "notes", 0, 1000),
      actual_kg:
        row.actual_kg == null ? null : number(row.actual_kg, "actual weight"),
      channel: text(row.channel || "", "channel", 0, 100),
    };
    let result;
    if (old) {
      result = this.update("orders", old.id, out);
      this.event(result, user, "Order details updated", "note");
    } else {
      result = this.insert("orders", {
        id: randomUUID(),
        order_no: this.next("order", "LD-"),
        ...out,
        status: publicOptions?.status || "placed",
        source: publicOptions?.source || "owner",
        picked_up_at: null,
        delivered_at: null,
        cancelled_reason: null,
        created_at: now(),
      });
      this.event(result, user, "Order created");
    }
    return result;
  }
  status(order, to, user, note) {
    if (!STATUSES.includes(to)) throw new AppError("Invalid order status.");
    if (to === "at_shop" && !order.shop_id)
      throw new AppError("Assign a shop before drop-off.");
    const out = { status: to };
    if (to === "picked_up") out.picked_up_at = now();
    if (to === "placed") out.picked_up_at = null;
    if (to === "delivered") out.delivered_at = now();
    else if (order.status === "delivered") out.delivered_at = null;
    if (to === "cancelled")
      out.cancelled_reason = text(note, "cancellation reason", 1, 500);
    const result = this.update("orders", order.id, out);
    if (
      user?.role === "owner" &&
      order.status === "pending_approval" &&
      to === "placed"
    ) {
      const c = this.one("customers", result.customer_id);
      this.db
        .prepare(
          "UPDATE customer_devices SET verified=1,customer_id=?,booking_token_hash=? WHERE order_id=?",
        )
        .run(c.id, hash(c.booking_token), order.id);
    }
    if (to !== order.status) this.event(result, user, note);
    this.onChange("orders");
    return result;
  }
  rpc(user, name, args = {}) {
    if (!args || typeof args !== "object" || Array.isArray(args))
      throw new AppError("Invalid action parameters.");
    this.require(user, ["owner", "rider"]);
    if (name === "rider_tasks") return this.tasks(user);
    if (name === "owner_report") {
      this.require(user);
      return this.report(args);
    }
    if (name === "reset_booking_link") {
      this.require(user);
      const c = this.one("customers", args.p_customer);
      if (!c) throw new AppError("Customer not found.", 404);
      const t = randomBytes(24).toString("hex");
      this.update("customers", c.id, { booking_token: t });
      return t;
    }
    return this.transaction(() => {
      if (name === "owner_status") {
        this.require(user);
        const o = this.one("orders", args.p_order);
        if (!o) throw new AppError("Order not found.", 404);
        return this.status(
          o,
          args.p_to,
          user,
          text(args.p_note, "audit note", 1, 500),
        );
      }
      if (name === "rider_mark") {
        const o = this.one("orders", args.p_order);
        if (!o) throw new AppError("Order not found.", 404);
        text(args.p_action, "action ID", 36, 36);
        const previous = this.one("rider_actions", args.p_action);
        if (previous) {
          if (
            previous.by_user !== user.id ||
            previous.order_id !== o.id ||
            previous.to_status !== args.p_to
          )
            throw new AppError("Action conflict.");
          return { status: o.status, action_id: previous.id };
        }
        if (
          !(
            (o.status === "placed" && args.p_to === "picked_up") ||
            (["picked_up", "weighed"].includes(o.status) &&
              args.p_to === "at_shop") ||
            (o.status === "ready" && args.p_to === "delivered")
          )
        )
          throw new AppError("Invalid status change.");
        const result = this.status(o, args.p_to, user, "Rider action");
        const event = this.db
          .prepare(
            "SELECT max(id) id FROM order_events WHERE order_id=? AND kind='status'",
          )
          .get(o.id);
        this.insert("rider_actions", {
          id: args.p_action,
          by_user: user.id,
          order_id: o.id,
          from_status: o.status,
          to_status: args.p_to,
          at: Date.now(),
          event_id: event.id,
          undone: false,
        });
        return { status: result.status, action_id: args.p_action };
      }
      if (name === "rider_undo") {
        const a = this.one("rider_actions", args.p_action);
        if (!a || a.by_user !== user.id)
          throw new AppError("Action not found.");
        const o = this.one("orders", a.order_id);
        if (a.undone) return { status: o.status };
        if (
          Date.now() - a.at >= 60000 ||
          o.status !== a.to_status ||
          this.db
            .prepare(
              "SELECT id FROM order_events WHERE order_id=? AND kind='status' AND id>? LIMIT 1",
            )
            .get(o.id, a.event_id)
        )
          throw new AppError("Undo expired or order changed.");
        const result = this.status(o, a.from_status, user, "Rider undo");
        this.update("rider_actions", a.id, { undone: true });
        return { status: result.status };
      }
      if (name === "rider_report") {
        const o = this.one("orders", args.p_order);
        if (
          !o ||
          !["placed", "picked_up", "weighed", "at_shop", "ready"].includes(
            o.status,
          )
        )
          throw new AppError("Task is not available.");
        const reason = text(args.p_reason, "problem", 1, 300),
          key =
            "report:" +
            user.id +
            ":" +
            text(args.p_action, "action ID", 36, 36);
        if (
          !this.db.prepare("SELECT key FROM rate_limits WHERE key=?").get(key)
        ) {
          this.db
            .prepare("INSERT INTO rate_limits VALUES(?,?,1)")
            .run(key, Date.now());
          this.event(o, user, reason, "problem");
          this.onChange("order_events");
        }
        return null;
      }
      throw new AppError("Action not found.", 404);
    });
  }
  tasks(user) {
    this.require(user, ["owner", "rider"]);
    return this.all("orders")
      .filter(
        (o) =>
          ["placed", "picked_up", "weighed", "at_shop", "ready"].includes(
            o.status,
          ) ||
          (o.status === "delivered" &&
            Date.now() - Date.parse(o.delivered_at) < 60000),
      )
      .map((o) => {
        const c = this.one("customers", o.customer_id),
          s = o.shop_id && this.one("shops", o.shop_id),
          other = o.status !== "placed" && o.deliver_to_other;
        const problem = this.db
          .prepare(
            "SELECT note FROM order_events WHERE order_id=? AND kind='problem' ORDER BY id DESC LIMIT 1",
          )
          .get(o.id);
        return {
          order_id: o.id,
          order_no: o.order_no,
          bag_code: c.bag_code,
          status: o.status,
          customer_name: c.full_name,
          phone: c.phone,
          area: other ? o.delivery_area : c.area,
          address: other ? o.delivery_address : c.address,
          landmark: other ? null : c.landmark,
          lat: other ? null : c.lat,
          lng: other ? null : c.lng,
          loads: o.loads,
          bags: o.bags,
          pickup_date: o.pickup_date,
          pickup_window: o.pickup_window,
          due_date: o.due_date,
          notes: o.notes,
          shop_name: s?.name || null,
          shop_phone: s?.phone || null,
          shop_address: s?.address || null,
          delivered_at: o.delivered_at,
          latest_problem: problem?.note || null,
        };
      })
      .sort(
        (a, b) =>
          a.area.localeCompare(b.area) ||
          a.pickup_date.localeCompare(b.pickup_date) ||
          WINDOWS.indexOf(a.pickup_window) - WINDOWS.indexOf(b.pickup_window),
      );
  }
  publicConfig() {
    const s = this.one("settings", 1),
      current = today(s.timezone),
      clock = new Intl.DateTimeFormat("en-GB", {
        timeZone: s.timezone,
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).format(new Date());
    return {
      business_name: s.business_name,
      currency_symbol: s.currency_symbol,
      timezone: s.timezone,
      max_kg_per_load: s.max_kg_per_load,
      service_areas: s.service_areas,
      booking_open: s.booking_open,
      hotline: s.hotline,
      facebook_url: s.facebook_url,
      services: this.all("services")
        .filter((v) => v.active)
        .sort((a, b) => a.sort - b.sort)
        .map(({ id, name, price_per_load }) => ({ id, name, price_per_load })),
      dates: Array.from({ length: 7 }, (_, i) => {
        const day = addDays(current, i),
          used = this.db
            .prepare(
              "SELECT coalesce(sum(loads),0) used FROM orders WHERE pickup_date=? AND status<>'cancelled'",
            )
            .get(day).used;
        return {
          date: day,
          capacity_left: Math.max(0, s.daily_pickup_capacity_loads - used),
          bookable:
            s.booking_open &&
            used < s.daily_pickup_capacity_loads &&
            (i > 0 || clock < s.same_day_cutoff),
        };
      }),
    };
  }
  lookup(value) {
    let token;
    try {
      token = validToken({ token: value });
    } catch {
      throw new AppError("Link not valid");
    }
    const c = this.decode(
      this.db
        .prepare("SELECT * FROM customers WHERE booking_token=? AND blocked=0")
        .get(token),
    );
    if (!c) throw new AppError("Link not valid");
    return c;
  }
  rememberLink(token) {
    const c = this.lookup(token),
      deviceToken = hash(this.secret + ":customer-link:" + token);
    this.db
      .prepare("INSERT OR REPLACE INTO customer_devices VALUES(?,?,?,?,?,?,?)")
      .run(
        hash(deviceToken),
        c.id,
        null,
        c.full_name.split(" ")[0],
        1,
        hash(c.booking_token),
        now(),
      );
    return deviceToken;
  }
  remembered(deviceToken) {
    const device =
      typeof deviceToken === "string" && deviceToken.length === 64
        ? this.db
            .prepare("SELECT * FROM customer_devices WHERE token_hash=?")
            .get(hash(deviceToken))
        : null;
    if (!device) return null;
    const c = this.one("customers", device.customer_id);
    if (!c || c.blocked || device.booking_token_hash !== hash(c.booking_token))
      return null;
    if (!device.verified) {
      const order = this.one("orders", device.order_id);
      return {
        pending_confirmation: true,
        first_name: device.submitted_first_name,
        request: {
          order_no: order.order_no,
          status: order.status,
          due_date: order.due_date,
        },
      };
    }
    return this.publicLookup(c);
  }
  rememberedToken(deviceToken) {
    const device =
      typeof deviceToken === "string"
        ? this.db
            .prepare(
              "SELECT * FROM customer_devices WHERE token_hash=? AND verified=1",
            )
            .get(hash(deviceToken))
        : null;
    if (!device)
      throw new AppError(
        "Please use your personal booking link or wait for your first request to be confirmed.",
      );
    const c = this.one("customers", device.customer_id);
    if (!c || c.blocked || device.booking_token_hash !== hash(c.booking_token))
      throw new AppError("Link not valid");
    return c.booking_token;
  }
  publicLookup(c) {
    const orders = this.all("orders")
        .filter((o) => o.customer_id === c.id)
        .sort((a, b) => b.created_at.localeCompare(a.created_at)),
      last = orders[0],
      active = orders.find(
        (o) => !["cancelled", "delivered"].includes(o.status),
      );
    return {
      customer_code: c.bag_code,
      first_name: c.full_name.split(" ")[0],
      area: c.area,
      loads: last?.loads || 1,
      service_id: last?.service_id || null,
      active_order: active
        ? {
            status: active.status,
            order_no: active.order_no,
            due_date: active.due_date,
          }
        : null,
    };
  }
  public(name, data, ip) {
    this.rate(
      name + ":ip:" + ip,
      name === "public-config" ? 180 : name === "book-new" ? 10 : 30,
      3600,
    );
    if (name === "public-config") return this.publicConfig();
    if (name === "challenge") {
      const a = 1 + Math.floor(Math.random() * 9),
        b = 1 + Math.floor(Math.random() * 9),
        id = randomUUID();
      this.db
        .prepare("DELETE FROM challenges WHERE expires_at<?")
        .run(Date.now());
      this.db
        .prepare("INSERT INTO challenges VALUES(?,?,?,?)")
        .run(
          id,
          hash(this.secret + String(a + b)),
          hash(this.secret + ip),
          Date.now() + 10 * 60000,
        );
      return { id, question: `${a} + ${b} = ?` };
    }
    if (name === "lookup") return this.publicLookup(this.lookup(data.token));
    if (name === "track") {
      const o = this.all("orders").find((o) => o.order_no === data.order_no);
      if (
        !/^\d{4}$/.test(data.phone_last4) ||
        !o ||
        this.one("customers", o.customer_id).phone.slice(-4) !==
          data.phone_last4
      )
        throw new AppError("No matching request found.", 404);
      return { status: o.status, due_date: o.due_date };
    }
    if (!["book-new", "book-again"].includes(name))
      throw new AppError("Not found.", 404);
    const returning = name === "book-again";
    let clean;
    try {
      clean = validateBooking(data, returning);
    } catch (e) {
      throw new AppError(e.message);
    }
    const fingerprint = hash(JSON.stringify(clean));
    // Validate the one-use human check for every new attempt; receipt retries with identical UUID/payload are safe to return.
    const cached =
      clean.request_id && this.one("booking_requests", clean.request_id);
    if (cached) {
      if (cached.fingerprint !== fingerprint)
        throw new AppError("Request changed. Reload and try again.");
      const result = JSON.parse(cached.result);
      if (!returning)
        result._remember_token = hash(
          this.secret + ":customer-device:" + clean.request_id,
        );
      return result;
    }
    if (!returning) {
      if (data.website) throw new AppError("Please try again.");
      const c = this.db
        .prepare("SELECT * FROM challenges WHERE id=?")
        .get(typeof data.challenge_id === "string" ? data.challenge_id : "");
      if (
        !c ||
        c.expires_at < Date.now() ||
        c.ip_hash !== hash(this.secret + ip) ||
        c.answer_hash !==
          hash(this.secret + String(data.challenge_answer).trim())
      )
        throw new AppError("Complete the quick security check again.");
      this.db.prepare("DELETE FROM challenges WHERE id=?").run(c.id);
      this.rate("new-phone:" + clean.phone, 3, 86400);
    }
    return this.transaction(() => {
      const cfg = this.publicConfig(),
        s = this.one("settings", 1),
        slot = cfg.dates.find((d) => d.date === clean.pickup_date);
      if (!cfg.booking_open)
        throw new AppError("Bookings are closed. Please message us.");
      if (!slot?.bookable || slot.capacity_left < clean.loads)
        throw new AppError("Choose an available pickup date.");
      let c,
        existingPhone = false;
      if (returning) {
        c = this.lookup(clean.token);
        if (
          this.all("orders").some(
            (o) =>
              o.customer_id === c.id &&
              !["delivered", "cancelled"].includes(o.status),
          )
        )
          throw new AppError(
            "You already have an active order. Message us to make changes.",
          );
      } else {
        if (
          !s.service_areas.includes(clean.area) ||
          (clean.deliver_to_other &&
            !s.service_areas.includes(clean.delivery_area))
        )
          throw new AppError("Choose a service area.");
        c = this.decode(
          this.db
            .prepare("SELECT * FROM customers WHERE phone=?")
            .get(clean.phone),
        );
        existingPhone = Boolean(c);
        if (!c)
          c = this.insert("customers", {
            id: randomUUID(),
            ...this.validate(
              "customers",
              {
                full_name: clean.name,
                email: clean.email,
                phone: clean.phone,
                area: clean.area,
                address: clean.address,
                landmark: clean.landmark,
                lat: clean.lat ?? null,
                lng: clean.lng ?? null,
              },
              null,
            ),
          });
      }
      const order = this.writeOrder(
        {
          customer_id: c.id,
          service_id: clean.service_id,
          loads: clean.loads,
          bags: 1,
          pickup_date: clean.pickup_date,
          pickup_window: clean.pickup_window,
          deliver_to_other: returning ? false : clean.deliver_to_other,
          delivery_address: returning ? "" : clean.delivery_address || "",
          delivery_area: returning ? "" : clean.delivery_area || "",
          notes: returning ? "" : clean.notes,
          channel: "Website",
        },
        null,
        null,
        {
          status: returning ? "placed" : "pending_approval",
          source: returning ? "book_again" : "book_new",
        },
      );
      if (!returning)
        this.event(
          order,
          null,
          "Review submitted details: " +
            JSON.stringify({
              name: clean.name,
              email: clean.email,
              phone: clean.phone,
              address: clean.address,
              area: clean.area,
              landmark: clean.landmark,
              blocked_review: c.blocked,
              existing_phone_review: existingPhone,
              consent: true,
            }),
          "note",
        );
      const result = {
        order_no: order.order_no,
        total: order.total_price,
        pickup_date: order.pickup_date,
        pickup_window: order.pickup_window,
        status: order.status,
      };
      if (!returning) {
        const deviceToken = hash(
          this.secret + ":customer-device:" + (clean.request_id || order.id),
        );
        this.db
          .prepare("INSERT INTO customer_devices VALUES(?,?,?,?,?,?,?)")
          .run(
            hash(deviceToken),
            c.id,
            order.id,
            clean.name.split(" ")[0],
            0,
            hash(c.booking_token),
            now(),
          );
        result._remember_token = deviceToken;
      }
      if (clean.request_id)
        this.insert("booking_requests", {
          id: clean.request_id,
          fingerprint,
          result: JSON.stringify(
            Object.fromEntries(
              Object.entries(result).filter(
                ([key]) => key !== "_remember_token",
              ),
            ),
          ),
        });
      this.onChange("orders");
      return result;
    });
  }
  staff(user, data) {
    this.require(user);
    if (data.action === "create_rider") return this.createStaff(data);
    const target = this.one("profiles", data.user_id);
    if (target?.role !== "rider") throw new AppError("Choose a rider account.");
    if (data.action === "set_active") {
      this.update("profiles", target.id, {
        active: boolean(data.active, "active"),
      });
      this.db.prepare("DELETE FROM sessions WHERE user_id=?").run(target.id);
      return { ok: true };
    }
    if (data.action === "reset_password") {
      this.update("profiles", target.id, {
        password_hash: passwordHash(this.password(data.temp_password)),
      });
      this.db.prepare("DELETE FROM sessions WHERE user_id=?").run(target.id);
      return { ok: true };
    }
    throw new AppError("Unknown staff action.");
  }
  report({ p_from, p_to, p_group = "day" }) {
    date(p_from);
    date(p_to);
    if (
      p_from > p_to ||
      Date.parse(p_to) - Date.parse(p_from) > 3660 * 86400e3 ||
      !["day", "week", "month"].includes(p_group)
    )
      throw new AppError("Choose a valid report range.");
    const zone = this.one("settings", 1).timezone,
      orders = this.all("orders")
        .filter((o) => o.status === "delivered" && o.delivered_at)
        .map((o) => ({ ...o, day: today(zone, new Date(o.delivered_at)) }))
        .filter((o) => o.day >= p_from && o.day <= p_to),
      pay = this.all("rider_pay").filter(
        (p) => p.date >= p_from && p.date <= p_to,
      );
    const calc = (os, ps) => {
      const loads = os.reduce((n, o) => n + o.loads, 0),
        revenue = os.reduce((n, o) => n + cents(o.total_price), 0),
        shop = os.reduce(
          (n, o) => n + cents(o.shop_cost_per_load || 0) * o.loads,
          0,
        ),
        rider = ps.reduce((n, p) => n + cents(p.amount), 0);
      return {
        orders: os.length,
        loads,
        revenue: revenue / 100,
        shop_cost: shop / 100,
        rider_cost: rider / 100,
        margin: (revenue - shop - rider) / 100,
        margin_per_load: loads ? (revenue - shop - rider) / 100 / loads : 0,
        missing_shop_cost: os.some((o) => o.shop_cost_per_load == null),
      };
    };
    const totals = calc(orders, pay),
      contribution = totals.loads
        ? (totals.revenue - totals.shop_cost) / totals.loads
        : 0,
      days = (Date.parse(p_to) - Date.parse(p_from)) / 86400e3 + 1;
    totals.break_even_loads =
      contribution > 0
        ? Math.ceil(totals.rider_cost / days / contribution)
        : null;
    const period = (d) =>
      p_group === "month"
        ? d.slice(0, 7)
        : p_group === "week"
          ? addDays(d, -((new Date(d + "T12:00Z").getUTCDay() + 6) % 7))
          : d;
    const periods = [
      ...new Set([
        ...orders.map((o) => period(o.day)),
        ...pay.map((p) => period(p.date)),
      ]),
    ]
      .sort()
      .map((p) => ({
        period: p,
        ...calc(
          orders.filter((o) => period(o.day) === p),
          pay.filter((v) => period(v.date) === p),
        ),
      }));
    const groups = [];
    for (const [kind, key] of [
      ["shop", (o) => this.one("shops", o.shop_id || "")?.name || "Unassigned"],
      ["area", (o) => this.one("customers", o.customer_id).area],
      [
        "channel",
        (o) => (o.source === "owner" ? o.channel || "Owner" : o.source),
      ],
    ])
      for (const label of new Set(orders.map(key))) {
        const c = calc(
          orders.filter((o) => key(o) === label),
          [],
        );
        groups.push({ kind, label, ...c, contribution: c.margin });
      }
    return { totals, periods, groups };
  }
  close() {
    this.db.close();
  }
}
