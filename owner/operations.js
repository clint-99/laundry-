import { h, replace } from "../shared/h.js";
import { db, query } from "../shared/api.js";
import {
  button,
  badge,
  field,
  input,
  select,
  modal,
  errorBox,
  toast,
  empty,
  copy,
} from "../shared/ui.js";
import {
  STATUSES,
  LABELS,
  WINDOWS,
  money,
  phone,
  addDays,
  mapLink,
  activeOrder,
} from "../shared/utils.js";
import {
  state,
  customer,
  shop,
  symbol,
  businessToday,
  save,
  refresh,
  render,
} from "./owner.js";
export function editableForm(title, fields, submit) {
  const error = h("div", { "aria-live": "polite" }),
    submitButton = h("button", { type: "submit", class: "button" }, "Save");
  const form = h("form", {}, fields, error, submitButton);
  const dialog = modal(title, form);
  form.onsubmit = async (e) => {
    e.preventDefault();
    submitButton.disabled = true;
    replace(error);
    try {
      await submit(Object.fromEntries(new FormData(form)));
      dialog.close();
    } catch (err) {
      replace(
        error,
        errorBox(err, () => form.requestSubmit()),
      );
    } finally {
      submitButton.disabled = false;
    }
  };
  return { form, dialog, error };
}
export function customerForm(c) {
  return editableForm(
    c ? "Edit customer" : "New customer",
    [
      field(
        "Full name",
        input("full_name", c?.full_name, {
          required: true,
          maxlength: 120,
          autocomplete: "name",
        }),
      ),
      field(
        "Mobile number",
        input("phone", c?.phone, {
          type: "tel",
          required: true,
          autocomplete: "tel",
        }),
      ),
      field(
        "Area",
        select("area", state.settings.service_areas || [], c?.area),
      ),
      field(
        "Address",
        input("address", c?.address, {
          required: true,
          maxlength: 500,
          autocomplete: "street-address",
        }),
      ),
      field("Landmark", input("landmark", c?.landmark, { maxlength: 300 })),
      field(
        "Private customer notes",
        h("textarea", { name: "notes", maxlength: 1000 }, c?.notes || ""),
      ),
    ],
    async (values) => {
      values.phone = phone(values.phone);
      if (!values.area) throw Error("Add service areas in Settings first.");
      await save(
        query(
          c
            ? db.from("customers").update(values).eq("id", c.id)
            : db.from("customers").insert(values),
        ),
        c ? "Customer updated" : "Customer added",
      );
    },
  );
}
export function orderForm(o, approveAfterSave = false) {
  if (!state.services.some((s) => s.active) || !state.customers.length) {
    modal(
      "Before your first order",
      h(
        "div",
        {},
        h(
          "p",
          {},
          "Add an active service in Settings and a customer in Customers first.",
        ),
        button("Add customer", () => customerForm(), "secondary"),
      ),
    );
    return;
  }
  const customerSelect = select(
      "customer_id",
      state.customers.map((c) => [
        c.id,
        `${c.bag_code} · ${c.full_name} · ${c.phone}`,
      ]),
      o?.customer_id,
    ),
    find = input("find", "", {
      placeholder: "Find bag code, name or phone",
      type: "search",
    });
  find.oninput = () => {
    const matches = state.customers.filter((c) =>
      `${c.bag_code} ${c.full_name} ${c.phone}`
        .toLowerCase()
        .includes(find.value.toLowerCase()),
    );
    replace(
      customerSelect,
      matches.map((c) =>
        h(
          "option",
          { value: c.id },
          `${c.bag_code} · ${c.full_name} · ${c.phone}`,
        ),
      ),
    );
    updateSummary();
  };
  const service = select(
      "service_id",
      state.services
        .filter((s) => s.active || s.id === o?.service_id)
        .map((s) => [s.id, s.name]),
      o?.service_id,
    ),
    loads = input("loads", o?.loads || 1, {
      type: "number",
      min: 1,
      max: 20,
      required: true,
    }),
    bags = input("bags", o?.bags || 1, {
      type: "number",
      min: 1,
      max: 20,
      required: true,
    }),
    summary = h("div", { class: "total" }),
    date = input("pickup_date", o?.pickup_date || businessToday(), {
      type: "date",
      required: true,
    }),
    due = input(
      "due_date",
      o?.due_date ||
        addDays(businessToday(), state.settings.default_delivery_days),
      { type: "date", required: true },
    );
  const availability = (s) =>
    s.capacity_loads -
    state.orders
      .filter(
        (x) =>
          x.shop_id === s.id &&
          ["picked_up", "weighed", "at_shop", "ready"].includes(x.status),
      )
      .reduce((n, x) => n + x.loads, 0);
  const shops = state.shops
    .filter((s) => s.active || s.id === o?.shop_id)
    .sort((a, b) => availability(b) - availability(a));
  const shopSelect = select(
    "shop_id",
    [
      ["", "Assign later"],
      ...shops.map((s) => [s.id, `${s.name} · ${availability(s)} loads free`]),
    ],
    o?.shop_id ||
      shops.find((s) => availability(s) >= Number(loads.value))?.id ||
      "",
  );
  const different = input("deliver_to_other", "true", {
      type: "checkbox",
      checked: o?.deliver_to_other,
    }),
    delivery = input("delivery_address", o?.delivery_address, {
      maxlength: 500,
    }),
    deliveryArea = select(
      "delivery_area",
      [["", "Choose delivery area"], ...(state.settings.service_areas || [])],
      o?.delivery_area,
    );
  function updateSummary() {
    const s = state.services.find((s) => s.id === service.value),
      c = state.customers.find((c) => c.id === customerSelect.value);
    const price =
      o && o.service_id === service.value
        ? o.price_per_load
        : s?.price_per_load;
    replace(
      summary,
      h("strong", {}, money(Number(price) * Number(loads.value), symbol())),
      h(
        "small",
        {},
        `${loads.value} loads × ${money(price, symbol())} · Free pickup & delivery`,
      ),
      h(
        "p",
        {},
        c ? `${c.full_name} · ${c.address}, ${c.area}` : "Choose a customer",
      ),
    );
  }
  date.onchange = () =>
    (due.value = addDays(date.value, state.settings.default_delivery_days));
  service.onchange = loads.oninput = customerSelect.onchange = updateSummary;
  updateSummary();
  const result = editableForm(
    o ? "Edit order" : "New manual order",
    [
      field("Find customer", find),
      field("Customer", customerSelect),
      button(
        "Create customer inline",
        () => {
          const created = customerForm();
          created.dialog.addEventListener("close", () => {
            replace(
              customerSelect,
              state.customers.map((c) =>
                h(
                  "option",
                  { value: c.id },
                  `${c.bag_code} · ${c.full_name} · ${c.phone}`,
                ),
              ),
            );
            updateSummary();
          });
        },
        "secondary",
      ),
      field("Service", service),
      h(
        "div",
        { class: "form-grid" },
        field("Loads", loads),
        field("Bags expected", bags),
        field("Pickup date", date),
        field(
          "Pickup window",
          select("pickup_window", WINDOWS, o?.pickup_window),
        ),
        field("Due date", due),
        field("Partner shop", shopSelect),
      ),
      field(
        "Channel",
        select(
          "channel",
          ["Messenger", "SMS", "Call", "Walk-in", "Referral", "Website"],
          o?.channel,
        ),
      ),
      field(
        "Actual weight (kg), optional",
        input("actual_kg", o?.actual_kg ?? "", {
          type: "number",
          min: 0,
          step: 0.1,
        }),
      ),
      h(
        "label",
        { class: "check" },
        different,
        h("span", {}, "Deliver to a different address"),
      ),
      field("Other delivery address", delivery),
      field("Other delivery area", deliveryArea),
      field(
        "Order notes (riders can see these)",
        h("textarea", { name: "notes", maxlength: 1000 }, o?.notes || ""),
      ),
      summary,
    ],
    async (v) => {
      delete v.find;
      v.loads = Number(v.loads);
      v.bags = Number(v.bags);
      v.actual_kg = v.actual_kg === "" ? null : Number(v.actual_kg);
      v.shop_id = v.shop_id || null;
      v.deliver_to_other = different.checked;
      if (
        v.deliver_to_other &&
        (!v.delivery_address.trim() || !v.delivery_area)
      )
        throw Error("Add the alternate delivery address and area.");
      if (!v.customer_id) throw Error("Choose a customer.");
      await save(
        query(
          o
            ? db.from("orders").update(v).eq("id", o.id)
            : db.from("orders").insert(v),
        ),
        o ? "Order updated" : "Order created",
      );
      if (approveAfterSave)
        await status(o, "placed", "Owner edited and approved customer request");
    },
  );
  if (approveAfterSave)
    result.form.querySelector('button[type="submit"]').textContent =
      "Save & approve";
  return result;
}
async function status(o, to, note) {
  await save(
    query(db.rpc("owner_status", { p_order: o.id, p_to: to, p_note: note })),
    `Order ${LABELS[to]}`,
  );
}
function override(o) {
  editableForm(
    "Change status with audit note",
    [
      field(
        "New status",
        select(
          "status",
          STATUSES.map((s) => [s, LABELS[s]]),
          o.status,
        ),
      ),
      field(
        "Reason (required)",
        input("reason", "", { required: true, maxlength: 500 }),
      ),
    ],
    async (v) => status(o, v.status, v.reason),
  );
}
function reject(o) {
  editableForm(
    "Cancel order",
    [
      h(
        "p",
        {},
        "This order stays in history. Add a reason so the team knows what happened.",
      ),
      field(
        "Cancellation reason",
        input("reason", "", { required: true, maxlength: 500 }),
      ),
    ],
    async (v) => status(o, "cancelled", v.reason),
  );
}
export function orderDetail(o) {
  let detailDialog;
  const c = customer(o),
    s = shop(o),
    template = select(
      "message_template",
      Object.keys(state.settings.message_templates || {}).map((k) => [
        k,
        k.replaceAll("_", " "),
      ]),
    ),
    messageButton = button(
      "Copy message to customer",
      () => {
        const url = new URL("../book/", location.href);
        url.hash = "t=" + c.booking_token;
        const values = {
          name: c.full_name,
          bag: c.bag_code,
          order: o.order_no,
          date: o.pickup_date,
          link: url.href,
        };
        let text = state.settings.message_templates[template.value] || "";
        for (const [k, v] of Object.entries(values))
          text = text.replaceAll("{" + k + "}", v);
        copy(text);
      },
      "secondary",
    ),
    details = h(
      "div",
      {},
      h(
        "div",
        { class: "inline" },
        h("span", { class: "bag-code" }, c.bag_code),
        badge(o.status),
      ),
      h(
        "dl",
        { class: "detail-grid" },
        [
          ["Order", o.order_no],
          ["Customer", c.full_name],
          ["Phone", c.phone],
          ["Pickup address", `${c.address}, ${c.area}`],
          ["Landmark", c.landmark || "—"],
          [
            "Delivery",
            o.deliver_to_other
              ? `${o.delivery_address}, ${o.delivery_area}`
              : "Same as pickup",
          ],
          ["Loads / bags", `${o.loads} loads · ${o.bags} bags`],
          ["Total", money(o.total_price, symbol())],
          ["Shop", s?.name || "Not assigned"],
          [
            "Shop cost",
            o.shop_cost_per_load == null
              ? "Not assigned"
              : money(o.shop_cost_per_load * o.loads, symbol()),
          ],
          ["Pickup", `${o.pickup_date} · ${o.pickup_window}`],
          ["Due", o.due_date],
          ["Notes", o.notes || "—"],
        ].map(([k, v]) => [h("dt", {}, k), h("dd", {}, v)]),
      ),
      h(
        "div",
        { class: "inline" },
        button(
          "Edit details",
          () => {
            detailDialog.close();
            orderForm(o);
          },
          "secondary",
        ),
        button(
          "Override status",
          () => {
            detailDialog.close();
            override(o);
          },
          "secondary",
        ),
        button(
          "Cancel order",
          () => {
            detailDialog.close();
            reject(o);
          },
          "danger",
        ),
        h(
          "a",
          {
            class: "button secondary",
            target: "_blank",
            rel: "noopener noreferrer",
            href: mapLink(c.address, c.lat, c.lng),
          },
          "Open map",
        ),
      ),
      h(
        "div",
        { class: "card no-print" },
        field("Customer message template", template),
        messageButton,
      ),
      h("h3", {}, "Audit history"),
      h(
        "ul",
        { class: "timeline" },
        state.events
          .filter((e) => e.order_id === o.id)
          .map((e) =>
            h(
              "li",
              {},
              e.status && badge(e.status),
              h(
                "small",
                {},
                `${new Date(e.at).toLocaleString("en-PH", { timeZone: state.settings.timezone })} · ${state.profiles.find((p) => p.id === e.by_user)?.full_name || "Booking service"}`,
              ),
              h("p", {}, e.note || e.kind),
            ),
          ),
      ),
    );
  detailDialog = modal(`${o.order_no} · Order details`, details);
  return detailDialog;
}
let filters = { search: "", status: "", date: "", area: "", shop: "" };
export function ordersView(pending = false, compact = false) {
  const list = h("div"),
    search = input("search", filters.search, {
      type: "search",
      placeholder: "Search bag code, order, name or phone",
      "aria-label": "Search orders",
    }),
    statusFilter = select(
      "status",
      [["", "All statuses"], ...STATUSES.map((s) => [s, LABELS[s]])],
      filters.status,
    ),
    date = input("date", filters.date, {
      type: "date",
      "aria-label": "Filter pickup date",
    }),
    area = select(
      "area",
      [["", "All areas"], ...(state.settings.service_areas || [])],
      filters.area,
    ),
    shopFilter = select(
      "shop",
      [["", "All shops"], ...state.shops.map((s) => [s.id, s.name])],
      filters.shop,
    );
  statusFilter.setAttribute("aria-label", "Filter status");
  area.setAttribute("aria-label", "Filter area");
  shopFilter.setAttribute("aria-label", "Filter shop");
  function rows() {
    const matched = state.orders
      .filter((o) => {
        const c = customer(o);
        return (
          (!pending || o.status === "pending_approval") &&
          (!compact || activeOrder(o)) &&
          (!filters.search ||
            `${c.bag_code} ${o.order_no} ${c.full_name} ${c.phone}`
              .toLowerCase()
              .includes(filters.search.toLowerCase())) &&
          (!filters.status || o.status === filters.status) &&
          (!filters.date || o.pickup_date === filters.date) &&
          (!filters.area || c.area === filters.area) &&
          (!filters.shop || o.shop_id === filters.shop)
        );
      })
      .slice(0, compact ? 10 : 1000);
    if (!matched.length) {
      replace(
        list,
        empty(
          pending ? "No requests waiting" : "All clear here",
          pending
            ? "New customer bookings appear here for your review."
            : "Create an order or try a different filter.",
          button("New order", () => orderForm()),
        ),
      );
      return;
    }
    if (state.board && !pending && !compact) {
      replace(
        list,
        h(
          "div",
          { class: "board" },
          ["placed", "picked_up", "at_shop", "ready", "delivered"].map((s) =>
            h(
              "section",
              { class: "board-col" },
              h("h3", {}, LABELS[s]),
              matched
                .filter(
                  (o) =>
                    (s === "picked_up"
                      ? ["picked_up", "weighed"].includes(o.status)
                      : o.status === s) &&
                    (s !== "delivered" ||
                      (o.delivered_at &&
                        new Intl.DateTimeFormat("en-CA", {
                          timeZone: state.settings.timezone,
                          year: "numeric",
                          month: "2-digit",
                          day: "2-digit",
                        }).format(new Date(o.delivered_at)) ===
                          businessToday())),
                )
                .map((o) =>
                  h(
                    "article",
                    { class: "card" },
                    h("span", { class: "bag-code" }, customer(o).bag_code),
                    h("p", {}, customer(o).full_name),
                    h("small", {}, `${o.loads} loads · ${o.pickup_date}`),
                    button(o.order_no, () => orderDetail(o), "quiet"),
                  ),
                ),
            ),
          ),
        ),
      );
      return;
    }
    replace(
      list,
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
                "Bag / customer",
                "Loads / shop",
                "Schedule",
                "Status",
                "Action",
              ].map((t) => h("th", {}, t)),
            ),
          ),
          h(
            "tbody",
            {},
            matched.map((o) => {
              const c = customer(o),
                next = {
                  picked_up: "weighed",
                  weighed: "at_shop",
                  at_shop: "ready",
                }[o.status];
              return h(
                "tr",
                {},
                h(
                  "td",
                  {},
                  h("span", { class: "bag-code" }, c.bag_code),
                  h("div", {}, c.full_name),
                  h("small", {}, `${o.order_no} · ${c.area}`),
                ),
                h(
                  "td",
                  {},
                  `${o.loads} loads · ${o.bags} bags`,
                  h("small", {}, shop(o)?.name || "Assign shop"),
                ),
                h("td", {}, o.pickup_date, h("small", {}, `Due ${o.due_date}`)),
                h("td", {}, badge(o.status)),
                h(
                  "td",
                  {},
                  h(
                    "div",
                    { class: "stack" },
                    pending
                      ? button("Approve", async () => {
                          try {
                            await status(
                              o,
                              "placed",
                              "Owner approved customer request",
                            );
                          } catch (e) {
                            toast(e.message);
                          }
                        })
                      : next
                        ? button(LABELS[next], async () => {
                            try {
                              await status(o, next, `Owner marked ${next}`);
                            } catch (e) {
                              toast(e.message);
                            }
                          })
                        : h(
                            "small",
                            {},
                            ["placed", "ready"].includes(o.status)
                              ? "Waiting for rider"
                              : "",
                          ),
                    button("Details / history", () => orderDetail(o), "quiet"),
                    pending &&
                      button(
                        "Edit then approve",
                        () => orderForm(o, true),
                        "secondary",
                      ),
                    pending && button("Reject", () => reject(o), "quiet"),
                    pending &&
                      button(
                        "Copy confirmation",
                        () =>
                          copy(
                            (
                              state.settings.message_templates?.confirmation ||
                              "{order} confirmed for {date}"
                            )
                              .replaceAll("{name}", c.full_name)
                              .replaceAll("{order}", o.order_no)
                              .replaceAll("{date}", o.pickup_date),
                          ),
                        "quiet",
                      ),
                  ),
                ),
              );
            }),
          ),
        ),
      ),
    );
  }
  for (const [node, key] of [
    [search, "search"],
    [statusFilter, "status"],
    [date, "date"],
    [area, "area"],
    [shopFilter, "shop"],
  ])
    node.addEventListener(node === search ? "input" : "change", () => {
      filters[key] = node.value;
      rows();
    });
  rows();
  return h(
    "section",
    { class: "card" },
    h(
      "div",
      { class: "section-head" },
      h(
        "h2",
        {},
        pending
          ? "New customer requests"
          : compact
            ? "Active orders"
            : "Order workspace",
      ),
      !pending &&
        !compact &&
        button(
          state.board ? "List view" : "Board view",
          () => {
            state.board = !state.board;
            rows();
          },
          "secondary",
        ),
    ),
    pending &&
      h(
        "p",
        {},
        "Review the submitted details in the audit history before approving. Existing phone numbers keep their saved customer record; edit it only after verification.",
      ),
    !compact &&
      h(
        "div",
        { class: "toolbar" },
        search,
        !pending && statusFilter,
        date,
        area,
        shopFilter,
      ),
    list,
  );
}
export function customersView() {
  const body = h("div"),
    search = input("search", "", {
      type: "search",
      placeholder: "Find customer by bag code, name or phone",
      "aria-label": "Search customers",
    });
  function draw() {
    const matches = state.customers.filter((c) =>
      `${c.bag_code} ${c.full_name} ${c.phone}`
        .toLowerCase()
        .includes(search.value.toLowerCase()),
    );
    replace(
      body,
      matches.length
        ? h(
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
                  ["Customer", "Contact / area", "Orders", "Actions"].map((t) =>
                    h("th", {}, t),
                  ),
                ),
              ),
              h(
                "tbody",
                {},
                matches.map((c) => {
                  const orders = state.orders.filter(
                    (o) => o.customer_id === c.id,
                  );
                  const url = new URL("../book/", location.href);
                  url.hash = "t=" + c.booking_token;
                  return h(
                    "tr",
                    {},
                    h(
                      "td",
                      {},
                      h("span", { class: "bag-code" }, c.bag_code),
                      h("div", {}, c.full_name),
                      c.blocked &&
                        h("span", { class: "badge problem" }, "Blocked"),
                    ),
                    h("td", {}, c.phone, h("small", {}, c.area)),
                    h(
                      "td",
                      {},
                      orders.length,
                      h("small", {}, orders[0]?.pickup_date || "No orders yet"),
                    ),
                    h(
                      "td",
                      {},
                      h(
                        "div",
                        { class: "inline" },
                        button("Edit", () => customerForm(c), "secondary"),
                        button(
                          "Copy booking link",
                          () => copy(url.href),
                          "secondary",
                        ),
                        button(
                          "Reset link",
                          () => {
                            const panel = h(
                              "div",
                              {},
                              h(
                                "p",
                                {},
                                "The old link will stop working immediately.",
                              ),
                              button("Reset this link", async () => {
                                try {
                                  await save(
                                    query(
                                      db.rpc("reset_booking_link", {
                                        p_customer: c.id,
                                      }),
                                    ),
                                    "Booking link reset",
                                  );
                                  d.close();
                                } catch (e) {
                                  toast(e.message);
                                }
                              }),
                            );
                            const d = modal(
                              "Reset personal booking link?",
                              panel,
                            );
                          },
                          "quiet",
                        ),
                        button(
                          c.blocked ? "Unblock" : "Block",
                          async () => {
                            try {
                              await save(
                                query(
                                  db
                                    .from("customers")
                                    .update({ blocked: !c.blocked })
                                    .eq("id", c.id),
                                ),
                              );
                            } catch (e) {
                              toast(e.message);
                            }
                          },
                          "quiet",
                        ),
                      ),
                    ),
                  );
                }),
              ),
            ),
          )
        : empty(
            "Your customers, all together",
            "Each customer gets a permanent bag code and a personal booking link.",
            button("Add customer", () => customerForm()),
          ),
    );
  }
  search.oninput = draw;
  draw();
  return h(
    "section",
    { class: "card" },
    h(
      "div",
      { class: "section-head" },
      h("h2", {}, "Customer directory"),
      button("＋ Add customer", () => customerForm()),
    ),
    search,
    body,
  );
}
export function shopsView() {
  function edit(s) {
    editableForm(
      s ? "Edit partner shop" : "Add partner shop",
      [
        field(
          "Shop name",
          input("name", s?.name, { required: true, maxlength: 120 }),
        ),
        field("Phone", input("phone", s?.phone, { type: "tel" })),
        field(
          "Address",
          input("address", s?.address, { required: true, maxlength: 500 }),
        ),
        h(
          "div",
          { class: "form-grid" },
          field(
            "Private cost per load",
            input("cost_per_load", s?.cost_per_load ?? 125, {
              type: "number",
              min: 0,
              step: 0.01,
              required: true,
            }),
          ),
          field(
            "Capacity in loads",
            input("capacity_loads", s?.capacity_loads ?? 6, {
              type: "number",
              min: 1,
              required: true,
            }),
          ),
        ),
        field(
          "Active",
          select(
            "active",
            [
              ["true", "Active"],
              ["false", "Inactive"],
            ],
            String(s?.active ?? true),
          ),
        ),
      ],
      async (v) => {
        v.cost_per_load = Number(v.cost_per_load);
        v.capacity_loads = Number(v.capacity_loads);
        v.active = v.active === "true";
        await save(
          query(
            s
              ? db.from("shops").update(v).eq("id", s.id)
              : db.from("shops").insert(v),
          ),
        );
      },
    );
  }
  return h(
    "section",
    { class: "card" },
    h(
      "div",
      { class: "section-head" },
      h("h2", {}, "Laundry partners"),
      button("＋ Add shop", () => edit()),
    ),
    state.shops.length
      ? h(
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
                ["Shop", "Cost / load", "Capacity", "Actions"].map((x) =>
                  h("th", {}, x),
                ),
              ),
            ),
            h(
              "tbody",
              {},
              state.shops.map((s) => {
                const loads = state.orders
                  .filter(
                    (o) =>
                      o.shop_id === s.id &&
                      ["at_shop", "ready"].includes(o.status),
                  )
                  .reduce((n, o) => n + o.loads, 0);
                return h(
                  "tr",
                  {},
                  h(
                    "td",
                    {},
                    s.name,
                    h("small", {}, s.address),
                    h("small", {}, s.phone),
                  ),
                  h("td", {}, money(s.cost_per_load, symbol())),
                  h(
                    "td",
                    {},
                    `${loads} / ${s.capacity_loads} loads`,
                    h("small", {}, s.active ? "Active" : "Inactive"),
                  ),
                  h(
                    "td",
                    {},
                    button("Edit", () => edit(s), "secondary"),
                  ),
                );
              }),
            ),
          ),
        )
      : empty(
          "Meet your laundry partners",
          "Add shop costs and capacity. These costs are visible only to owners.",
          button("Add shop", () => edit()),
        ),
  );
}
