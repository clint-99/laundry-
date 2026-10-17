import { h, replace } from "../shared/h.js";
import { db, query, staffEdge } from "../shared/api.js";
import {
  button,
  field,
  input,
  select,
  toast,
  errorBox,
  copy,
  modal,
} from "../shared/ui.js";
import {
  money,
  today,
  addDays,
  activeOrder,
  mapLink,
  dispatchText,
  csv,
  download,
} from "../shared/utils.js";
import {
  state,
  customer,
  shop,
  symbol,
  businessToday,
  save,
  refresh,
} from "./owner.js";
import { editableForm } from "./operations.js";
export function settingsView() {
  const s = state.settings,
    error = h("div"),
    submit = h(
      "button",
      { class: "button", type: "submit" },
      "Save business settings",
    );
  const fields = [
    ["Business name", "business_name", "text"],
    ["Currency symbol", "currency_symbol", "text"],
    ["Business timezone", "timezone", "text"],
    ["Hotline", "hotline", "text"],
    ["Facebook page URL", "facebook_url", "text"],
    ["Max kg per load", "max_kg_per_load", "number"],
    ["Delivery turnaround (days)", "default_delivery_days", "number"],
    ["Same-day booking cutoff", "same_day_cutoff", "time"],
    ["Daily pickup capacity (loads)", "daily_pickup_capacity_loads", "number"],
    ["Rider daily pay default", "rider_daily_default", "number"],
    ["Rider batch pay default", "rider_batch_default", "number"],
  ];
  const form = h(
    "form",
    {},
    h(
      "div",
      { class: "form-grid" },
      fields.map(([label, name, type]) =>
        field(
          label,
          input(name, s[name], {
            type,
            required: !["hotline", "facebook_url"].includes(name),
            ...(type === "number"
              ? {
                  min: 0,
                  step:
                    name.includes("default") && name.includes("rider")
                      ? ".01"
                      : "1",
                }
              : {}),
          }),
        ),
      ),
    ),
    field(
      "Service areas (one per line)",
      h(
        "textarea",
        { name: "service_areas", rows: 5 },
        (s.service_areas || []).join("\n"),
      ),
    ),
    field(
      "Public bookings",
      select(
        "booking_open",
        [
          ["true", "Open"],
          ["false", "Closed"],
        ],
        String(s.booking_open),
      ),
    ),
    h("h3", {}, "Message templates"),
    h(
      "p",
      {},
      "Available placeholders: {name}, {order}, {date}, {bag}, {link}",
    ),
    Object.entries(s.message_templates || {}).map(([k, v]) =>
      field(
        k.replaceAll("_", " "),
        h("textarea", { name: "template_" + k, rows: 2, maxlength: 2000 }, v),
      ),
    ),
    error,
    submit,
  );
  form.onsubmit = async (e) => {
    e.preventDefault();
    submit.disabled = true;
    try {
      const data = Object.fromEntries(new FormData(form)),
        templates = {};
      for (const k of Object.keys(data))
        if (k.startsWith("template_")) {
          templates[k.slice(9)] = data[k];
          delete data[k];
        }
      data.message_templates = templates;
      for (const k of [
        "max_kg_per_load",
        "default_delivery_days",
        "daily_pickup_capacity_loads",
        "rider_daily_default",
        "rider_batch_default",
      ])
        data[k] = Number(data[k]);
      data.service_areas = [
        ...new Set(
          data.service_areas
            .split("\n")
            .map((a) => a.trim())
            .filter(Boolean),
        ),
      ];
      data.booking_open = data.booking_open === "true";
      await save(
        query(db.from("settings").update(data).eq("id", 1)),
        "Business settings saved",
      );
    } catch (err) {
      replace(
        error,
        errorBox(err, () => form.requestSubmit()),
      );
    } finally {
      submit.disabled = false;
    }
  };
  function editService(service) {
    editableForm(
      service ? "Edit service" : "Add service",
      [
        field(
          "Service name",
          input("name", service?.name, { required: true, maxlength: 120 }),
        ),
        field(
          "Price per load",
          input("price_per_load", service?.price_per_load ?? 190, {
            type: "number",
            min: 0,
            step: 0.01,
            required: true,
          }),
        ),
        field(
          "Display order",
          input("sort", service?.sort || 0, { type: "number", required: true }),
        ),
        field(
          "Available",
          select(
            "active",
            [
              ["true", "Active"],
              ["false", "Inactive"],
            ],
            String(service?.active ?? true),
          ),
        ),
      ],
      async (v) => {
        v.price_per_load = Number(v.price_per_load);
        v.sort = Number(v.sort);
        v.active = v.active === "true";
        await save(
          query(
            service
              ? db.from("services").update(v).eq("id", service.id)
              : db.from("services").insert(v),
          ),
        );
      },
    );
  }
  return h(
    "div",
    {},
    h(
      "section",
      { class: "card" },
      h("h2", {}, "Business settings"),
      h(
        "p",
        {},
        "These settings drive the booking page. Existing orders keep their original price and shop-cost snapshots.",
      ),
      form,
    ),
    h(
      "section",
      { class: "card" },
      h(
        "div",
        { class: "section-head" },
        h("h2", {}, "Services & per-load prices"),
        button("＋ Add service", () => editService()),
      ),
      state.services.map((service) =>
        h(
          "div",
          { class: "section-head" },
          h(
            "div",
            {},
            h("strong", {}, service.name),
            h(
              "p",
              {},
              `${money(service.price_per_load, symbol())} per load · ${service.active ? "Active" : "Inactive"}`,
            ),
          ),
          button("Edit", () => editService(service), "secondary"),
        ),
      ),
    ),
  );
}
export function staffView() {
  function add() {
    editableForm(
      "Add rider",
      [
        field(
          "Full name",
          input("full_name", "", { required: true, maxlength: 120 }),
        ),
        field(
          "Email",
          input("email", "", {
            type: "email",
            required: true,
            autocomplete: "off",
          }),
        ),
        field(
          "Temporary password (12+ characters)",
          input("temp_password", "", {
            type: "password",
            required: true,
            minlength: 12,
            autocomplete: "new-password",
          }),
        ),
      ],
      async (v) => {
        await staffEdge({ action: "create_rider", ...v });
        await refresh();
        toast("Rider account created. Share the temporary password securely.");
      },
    );
  }
  function reset(p) {
    editableForm(
      "Reset rider password",
      [
        h("p", {}, "Share the new password through a private channel."),
        field(
          "New password",
          input("temp_password", "", {
            type: "password",
            required: true,
            minlength: 12,
            autocomplete: "new-password",
          }),
        ),
      ],
      async (v) => {
        await staffEdge({ action: "reset_password", user_id: p.id, ...v });
        toast("Password reset");
      },
    );
  }
  return h(
    "section",
    { class: "card" },
    h(
      "div",
      { class: "section-head" },
      h("h2", {}, "Your team"),
      button("＋ Add rider", add),
    ),
    h(
      "div",
      { class: "attention" },
      "Weekly reminder: export your CSV reports and customer/order backups. Keep backups private.",
    ),
    state.profiles.map((p) =>
      h(
        "div",
        { class: "section-head" },
        h(
          "div",
          {},
          h("strong", {}, p.full_name),
          h("p", {}, `${p.role} · ${p.active ? "Active" : "Inactive"}`),
        ),
        p.role === "rider" &&
          h(
            "div",
            { class: "inline" },
            button(
              p.active ? "Deactivate" : "Reactivate",
              async () => {
                try {
                  await staffEdge({
                    action: "set_active",
                    user_id: p.id,
                    active: !p.active,
                  });
                  await refresh();
                  toast("Staff access updated");
                } catch (e) {
                  toast(e.message);
                }
              },
              "secondary",
            ),
            button("Reset password", () => reset(p), "secondary"),
          ),
      ),
    ),
    button(
      "Export customer backup CSV",
      () =>
        download(
          "customers-private.csv",
          csv([
            [
              "Bag code",
              "Name",
              "Phone",
              "Area",
              "Address",
              "Landmark",
              "Blocked",
            ],
            ...state.customers.map((c) => [
              c.bag_code,
              c.full_name,
              c.phone,
              c.area,
              c.address,
              c.landmark,
              c.blocked,
            ]),
          ]),
        ),
      "secondary",
    ),
    button(
      "Export order backup CSV",
      () =>
        download(
          "orders-private.csv",
          csv([
            [
              "Order",
              "Customer bag",
              "Status",
              "Loads",
              "Bags",
              "Revenue",
              "Shop cost per load",
              "Pickup",
              "Due",
              "Delivered",
              "Notes",
            ],
            ...state.orders.map((o) => [
              o.order_no,
              customer(o).bag_code,
              o.status,
              o.loads,
              o.bags,
              o.total_price,
              o.shop_cost_per_load,
              o.pickup_date,
              o.due_date,
              o.delivered_at,
              o.notes,
            ]),
          ]),
        ),
      "secondary",
    ),
    h(
      "a",
      {
        href: "/api/backup",
        class: "button secondary",
        download: "laundry-backup.sqlite",
      },
      "Download full database backup",
    ),
    h(
      "p",
      { class: "help" },
      "The full SQLite backup includes accounts, passwords (hashed), orders and history. Store it privately. CSV exports are only operational reports.",
    ),
  );
}
export function dispatchView() {
  const section = h("section", { class: "card" }),
    date = input("dispatch_date", businessToday(), {
      type: "date",
      "aria-label": "Dispatch date",
    }),
    body = h("div");
  const current = () =>
    state.orders
      .filter(
        (o) =>
          (o.status === "placed" && o.pickup_date <= date.value) ||
          (o.status === "ready" && o.due_date <= date.value),
      )
      .sort((a, b) => {
        const aa =
            a.status === "ready" && a.deliver_to_other
              ? a.delivery_area
              : customer(a).area,
          bb =
            b.status === "ready" && b.deliver_to_other
              ? b.delivery_area
              : customer(b).area;
        return (
          aa.localeCompare(bb) ||
          ["Morning", "Afternoon", "Evening"].indexOf(a.pickup_window) -
            ["Morning", "Afternoon", "Evening"].indexOf(b.pickup_window)
        );
      });
  function draw() {
    const rows = current(),
      areas = [
        ...new Set(
          rows.map((o) =>
            o.status === "ready" && o.deliver_to_other
              ? o.delivery_area
              : customer(o).area,
          ),
        ),
      ];
    replace(
      body,
      ...areas.map((area) =>
        h(
          "section",
          {},
          h("h3", {}, area),
          rows
            .filter(
              (o) =>
                (o.status === "ready" && o.deliver_to_other
                  ? o.delivery_area
                  : customer(o).area) === area,
            )
            .map((o) =>
              h(
                "article",
                { class: "card" },
                h("span", { class: "bag-code" }, customer(o).bag_code),
                h("strong", {}, ` ${customer(o).full_name}`),
                h(
                  "p",
                  {},
                  `${o.status === "ready" ? "Delivery" : "Pickup"} · ${o.pickup_window} · ${o.loads} loads · ${o.bags} bags`,
                ),
                h(
                  "p",
                  {},
                  o.status === "ready" && o.deliver_to_other
                    ? o.delivery_address
                    : customer(o).address,
                ),
                h(
                  "div",
                  { class: "inline" },
                  h(
                    "a",
                    {
                      class: "button secondary",
                      href: mapLink(
                        o.status === "ready" && o.deliver_to_other
                          ? o.delivery_address
                          : customer(o).address,
                      ),
                      target: "_blank",
                      rel: "noopener noreferrer",
                    },
                    "Open map",
                  ),
                  button(
                    "Copy for Messenger",
                    () => copy(dispatchText(o, customer(o), shop(o))),
                    "secondary",
                  ),
                ),
              ),
            ),
        ),
      ),
      !rows.length &&
        h("p", {}, "No pickup or ready-delivery stops for this date."),
    );
  }
  date.onchange = draw;
  draw();
  section.append(
    h(
      "div",
      { class: "section-head" },
      h("h2", {}, "Door-to-door dispatch"),
      date,
    ),
    h(
      "p",
      {},
      "Due and overdue stops, grouped by area. Copy only operational details for riders; prices are excluded.",
    ),
    button(
      "Copy full dispatch list",
      () =>
        copy(
          current()
            .map((o) => dispatchText(o, customer(o), shop(o)))
            .join("\n\n──────────\n\n"),
        ),
      "secondary",
    ),
    body,
  );
  return section;
}
export function reportsView() {
  const from = input("from", businessToday().slice(0, 8) + "01", {
      type: "date",
      "aria-label": "Report start date",
    }),
    to = input("to", businessToday(), {
      type: "date",
      "aria-label": "Report end date",
    }),
    group = select("group", ["Day", "Week", "Month"], "Day");
  group.setAttribute("aria-label", "Report grouping");
  const result = h("div");
  let exported = [];
  let requestVersion = 0;
  async function draw() {
    const version = ++requestVersion;
    if (from.value > to.value) {
      replace(result, errorBox("Start date must come before end date."));
      return;
    }
    replace(result, h("p", { "aria-live": "polite" }, "Loading report…"));
    try {
      const data = await query(
        db.rpc("owner_report", {
          p_from: from.value,
          p_to: to.value,
          p_group: group.value.toLowerCase(),
        }),
      );
      if (version !== requestVersion) return;
      const t = data.totals;
      exported = [
        [
          "Period",
          "Orders",
          "Loads",
          "Revenue",
          "Shop cost",
          "Rider pay",
          "Margin",
          "Margin / load",
        ],
        ...data.periods.map((p) => [
          p.period,
          p.orders,
          p.loads,
          p.revenue,
          p.shop_cost,
          p.rider_cost,
          p.margin,
          p.margin_per_load,
        ]),
      ];
      const groupTable = (label, kind) =>
        h(
          "section",
          { class: "card" },
          h("h3", {}, label),
          h(
            "div",
            { class: "table-wrap" },
            h(
              "table",
              {},
              h(
                "thead",
                {},
                h(
                  "tr",
                  {},
                  [
                    "Group",
                    "Orders",
                    "Loads",
                    "Revenue",
                    "Shop cost",
                    "Contribution",
                  ].map((x) => h("th", {}, x)),
                ),
              ),
              h(
                "tbody",
                {},
                data.groups
                  .filter((g) => g.kind === kind)
                  .map((g) =>
                    h(
                      "tr",
                      {},
                      [
                        g.label,
                        g.orders,
                        g.loads,
                        money(g.revenue, symbol()),
                        money(g.shop_cost, symbol()),
                        money(g.contribution, symbol()),
                      ].map((v) => h("td", {}, v)),
                    ),
                  ),
              ),
            ),
          ),
        );
      replace(
        result,
        h(
          "div",
          { class: "stats" },
          [
            ["Delivered orders", t.orders],
            ["Loads", t.loads],
            ["Revenue", money(t.revenue, symbol())],
            ["Net margin", money(t.margin, symbol())],
          ].map(([k, v]) =>
            h(
              "article",
              { class: "stat" },
              h("small", {}, k),
              h("strong", {}, v),
            ),
          ),
        ),
        h(
          "p",
          {},
          `Shop costs ${money(t.shop_cost, symbol())} · Rider pay ${money(t.rider_cost, symbol())} · Margin/load ${money(t.margin_per_load, symbol())}`,
        ),
        t.missing_shop_cost &&
          h(
            "div",
            { class: "attention" },
            "Some delivered orders have no shop cost. Margin is provisional until these costs are assigned.",
          ),
        h(
          "div",
          { class: "card" },
          h("h3", {}, "Break-even loads per day"),
          h(
            "strong",
            {},
            t.break_even_loads == null
              ? "Not enough positive contribution data"
              : `${t.break_even_loads} loads`,
          ),
          h(
            "p",
            {},
            "Average rider pay per calendar day ÷ realized per-load contribution. Excludes other business overhead.",
          ),
        ),
        h(
          "div",
          { class: "card table-wrap" },
          h(
            "table",
            {},
            h(
              "thead",
              {},
              h(
                "tr",
                {},
                exported[0].map((v) => h("th", {}, v)),
              ),
            ),
            h(
              "tbody",
              {},
              exported.slice(1).map((row) =>
                h(
                  "tr",
                  {},
                  row.map((v, i) =>
                    h("td", {}, i >= 3 ? money(v, symbol()) : v),
                  ),
                ),
              ),
            ),
          ),
        ),
        groupTable("By shop", "shop"),
        groupTable("By area", "area"),
        groupTable("By channel", "channel"),
        h(
          "p",
          { class: "help" },
          "Calculated by the database. Revenue and shop costs use delivery dates in the business timezone; rider pay uses its pay date. Group contributions exclude unallocated rider pay.",
        ),
      );
    } catch (error) {
      if (version === requestVersion) replace(result, errorBox(error, draw));
    }
  }
  for (const n of [from, to, group]) n.onchange = draw;
  draw();
  function addPay() {
    const riders = state.profiles.filter((p) => p.role === "rider");
    if (!riders.length) return toast("Add a rider in Staff first.");
    const type = select("pay_type", ["daily", "batch"], "daily"),
      amount = input("amount", state.settings.rider_daily_default, {
        type: "number",
        min: 0,
        step: 0.01,
        required: true,
      });
    type.onchange = () =>
      (amount.value =
        type.value === "daily"
          ? state.settings.rider_daily_default
          : state.settings.rider_batch_default);
    editableForm(
      "Record rider pay",
      [
        field(
          "Pay date",
          input("date", businessToday(), { type: "date", required: true }),
        ),
        field(
          "Rider",
          select(
            "rider",
            riders.map((p) => [p.id, p.full_name]),
          ),
        ),
        field("Pay type", type),
        field("Amount", amount),
        field(
          "Stops",
          input("stops", 0, { type: "number", min: 0, required: true }),
        ),
        field("Notes", input("notes", "", { maxlength: 500 })),
      ],
      async (v) => {
        v.amount = Number(v.amount);
        v.stops = Number(v.stops);
        await save(query(db.from("rider_pay").insert(v)));
      },
    );
  }
  return h(
    "section",
    {},
    h(
      "div",
      { class: "card" },
      h(
        "div",
        { class: "section-head" },
        h("h2", {}, "Business performance"),
        button("＋ Record rider pay", addPay, "secondary"),
      ),
      h(
        "div",
        { class: "toolbar" },
        from,
        to,
        group,
        button(
          "Export CSV",
          () => download("laundry-report.csv", csv(exported)),
          "secondary",
        ),
      ),
    ),
    result,
  );
}
export function labelsView() {
  const chosen = new Set(),
    labels = h("div", { class: "labels-grid" }),
    count = input("bags", 1, {
      type: "number",
      min: 1,
      max: 20,
      "aria-label": "Labels per customer",
    });
  function draw() {
    const n = Math.max(1, Math.min(20, Number(count.value) || 1));
    replace(
      labels,
      ...state.customers
        .filter((c) => chosen.has(c.id))
        .flatMap((c) =>
          Array.from({ length: n }, (_, i) =>
            h(
              "article",
              { class: "bag-label" },
              h("span", { class: "bag-code" }, c.bag_code),
              h("h3", {}, c.full_name),
              n > 1 && h("strong", {}, `Bag ${i + 1}/${n}`),
            ),
          ),
        ),
    );
  }
  count.oninput = draw;
  return h(
    "div",
    {},
    h(
      "section",
      { class: "card no-print" },
      h("h2", {}, "Reusable bag labels"),
      h(
        "p",
        {},
        "Print the permanent customer ID and name on each reusable bag. Phone and address stay in the system, not on the bag.",
      ),
      h(
        "div",
        { class: "toolbar" },
        field("Bags per selected customer", count),
        button("Print selected labels", () => {
          if (!chosen.size) return toast("Select at least one customer.");
          window.print();
        }),
      ),
      h(
        "div",
        { class: "label-selector" },
        state.customers.map((c) => {
          const check = input("customer", c.id, { type: "checkbox" });
          check.onchange = () => {
            check.checked ? chosen.add(c.id) : chosen.delete(c.id);
            draw();
          };
          return h(
            "label",
            { class: "check" },
            check,
            h("span", {}, `${c.bag_code} · ${c.full_name}`),
          );
        }),
      ),
    ),
    labels,
  );
}
