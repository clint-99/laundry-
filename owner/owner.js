import { h, replace } from "../shared/h.js";
import { db, query } from "../shared/api.js";
import {
  authGate,
  brand,
  button,
  errorBox,
  skeleton,
  toast,
  registerPWA,
} from "../shared/ui.js";
import { today } from "../shared/utils.js";
import {
  ordersView,
  orderForm,
  orderDetail,
  customersView,
  shopsView,
} from "./operations.js";
import {
  settingsView,
  staffView,
  reportsView,
  dispatchView,
  labelsView,
} from "./workspace.js";
const root = document.getElementById("app");
const tabs = [
  "Today",
  "Orders",
  "Pending",
  "Customers",
  "Shops",
  "Dispatch",
  "Reports",
  "Labels",
  "Settings",
  "Staff",
];
export const state = {
  orders: [],
  customers: [],
  shops: [],
  services: [],
  events: [],
  pay: [],
  profiles: [],
  todayReport: {},
  settings: {},
  profile: null,
  tab: "Today",
  board: false,
};
export const customer = (o) =>
  state.customers.find((c) => c.id === o.customer_id) || {};
export const shop = (o) => state.shops.find((s) => s.id === o.shop_id);
export const symbol = () => state.settings.currency_symbol || "₱";
export const businessToday = () =>
  today(state.settings.timezone || "Asia/Manila");
let content,
  nav,
  loading = false,
  rerun = false,
  first = true,
  lastOrderIds = new Set(),
  soundEnabled = false,
  notifications = false;
async function all(table) {
  let result = [];
  for (let start = 0; ; start += 1000) {
    const rows = await query(
      db
        .from(table)
        .select("*")
        .order(
          table === "settings"
            ? "id"
            : table === "rider_pay"
              ? "date"
              : table === "order_events"
                ? "at"
                : "id",
        )
        .range(start, start + 999),
    );
    result.push(...rows);
    if (rows.length < 1000) return result;
  }
}
export async function refresh() {
  if (loading) {
    rerun = true;
    return;
  }
  loading = true;
  try {
    const profile = await query(
      db.from("profiles").select("*").eq("id", state.profile.id).single(),
    );
    if (!profile.active || profile.role !== "owner") {
      await db.auth.signOut();
      return;
    }
    const [
      orders,
      customers,
      shops,
      services,
      settings,
      events,
      pay,
      profiles,
    ] = await Promise.all(
      [
        "orders",
        "customers",
        "shops",
        "services",
        "settings",
        "order_events",
        "rider_pay",
        "profiles",
      ].map(all),
    );
    const fresh = orders.filter((o) => !lastOrderIds.has(o.id));
    Object.assign(state, {
      orders: orders.sort((a, b) => b.created_at.localeCompare(a.created_at)),
      customers,
      shops,
      services,
      settings: settings[0] || {},
      events: events.sort((a, b) => b.at.localeCompare(a.at)),
      pay,
      profiles,
    });
    state.todayReport = await query(
      db.rpc("owner_report", {
        p_from: businessToday(),
        p_to: businessToday(),
        p_group: "day",
      }),
    );
    if (!first && fresh.length) {
      toast(`${fresh.length} new booking${fresh.length === 1 ? "" : "s"}`);
      if (soundEnabled) {
        try {
          const a = new AudioContext(),
            osc = a.createOscillator(),
            gain = a.createGain();
          gain.gain.value = 0.04;
          osc.connect(gain).connect(a.destination);
          osc.frequency.value = 650;
          osc.start();
          osc.stop(a.currentTime + 0.14);
          osc.onended = () => a.close();
        } catch {}
      }
      if (notifications && Notification.permission === "granted")
        new Notification("New laundry booking", {
          body: "Open the owner workspace to review.",
        });
    }
    first = false;
    lastOrderIds = new Set(orders.map((o) => o.id));
    render();
  } catch (e) {
    replace(content, errorBox(e, refresh));
  } finally {
    loading = false;
    if (rerun) {
      rerun = false;
      refresh();
    }
  }
}
export async function save(work, message = "Saved") {
  const result = await work;
  toast(message);
  await refresh();
  return result;
}
export function render() {
  if (!content) return;
  const wordmark = document.querySelector(".sidebar .brand span");
  if (wordmark && state.settings.business_name)
    wordmark.textContent = state.settings.business_name;
  const view = {
    Today: todayView,
    Orders: () => ordersView(false),
    Pending: () => ordersView(true),
    Customers: customersView,
    Shops: shopsView,
    Dispatch: dispatchView,
    Reports: reportsView,
    Labels: labelsView,
    Settings: settingsView,
    Staff: staffView,
  }[state.tab];
  replace(
    nav,
    tabs.map((tab) =>
      button(
        tab === "Pending"
          ? `${tab} (${state.orders.filter((o) => o.status === "pending_approval").length})`
          : tab,
        () => {
          state.tab = tab;
          render();
        },
        tab === state.tab ? "quiet active" : "quiet",
      ),
    ),
  );
  replace(
    content,
    h(
      "header",
      { class: "page-header" },
      h(
        "div",
        {},
        h("div", { class: "eyebrow" }, "LAUNDRY OPERATIONS"),
        h("h1", {}, state.tab),
        h(
          "p",
          {},
          state.tab === "Today"
            ? "A clear view of your day. From doorstep to freshly folded."
            : "Everything you need, all sorted.",
        ),
      ),
      button("＋ New order", () => orderForm()),
    ),
    view(),
  );
}
function todayView() {
  const date = businessToday(),
    pending = state.orders.filter((o) => o.status === "pending_approval"),
    overdue = state.orders.filter(
      (o) =>
        !["delivered", "cancelled"].includes(o.status) && o.due_date < date,
    ),
    ready = state.orders.filter((o) => o.status === "ready"),
    problems = state.events.filter(
      (e) =>
        e.kind === "problem" &&
        state.orders.some(
          (o) =>
            o.id === e.order_id &&
            !["delivered", "cancelled"].includes(o.status),
        ),
    ),
    financial = state.todayReport.totals || {},
    revenue = Number(financial.revenue || 0),
    margin = Number(financial.margin || 0);
  return h(
    "div",
    {},
    h(
      "div",
      { class: "attention" },
      h("strong", {}, "◷ Needs attention"),
      button(
        `${pending.length} pending approvals`,
        () => {
          state.tab = "Pending";
          render();
        },
        "quiet",
      ),
      h(
        "span",
        {},
        `${problems.length} problem reports · ${overdue.length} overdue · ${ready.length} ready for rider delivery`,
      ),
    ),
    h(
      "section",
      { class: "stats" },
      [
        [
          "Pickups to do",
          state.orders.filter(
            (o) => o.status === "placed" && o.pickup_date <= date,
          ).length,
          "Today and earlier",
        ],
        [
          "Deliveries due",
          state.orders.filter(
            (o) =>
              !["delivered", "cancelled", "pending_approval"].includes(
                o.status,
              ) && o.due_date <= date,
          ).length,
          "Keep the day moving",
        ],
        [
          "Loads in shops",
          state.orders
            .filter((o) => o.status === "at_shop")
            .reduce((n, o) => n + o.loads, 0),
          "With your laundry partners",
        ],
        [
          "Revenue today",
          `${symbol()}${revenue.toFixed(2)}`,
          `Margin ${symbol()}${margin.toFixed(2)}`,
        ],
      ].map(([label, value, help]) =>
        h(
          "article",
          { class: "stat" },
          h("small", {}, label),
          h("strong", {}, value),
          h("small", {}, help),
        ),
      ),
    ),
    h(
      "section",
      { class: "card" },
      h(
        "div",
        { class: "section-head" },
        h("h2", {}, "Live workspace"),
        h(
          "div",
          { class: "inline" },
          button(
            soundEnabled ? "Sound on" : "Enable booking sound",
            () => {
              soundEnabled = !soundEnabled;
              render();
            },
            "secondary",
          ),
          button(
            "Enable notifications",
            async () => {
              if (!("Notification" in window))
                return toast(
                  "Notifications are not supported in this browser.",
                );
              notifications =
                (await Notification.requestPermission()) === "granted";
              toast(
                notifications
                  ? "Notifications enabled"
                  : "Notifications are off",
              );
            },
            "secondary",
          ),
        ),
      ),
      h(
        "p",
        {},
        `Today is ${date} · ${state.settings.timezone}. Ready orders await rider delivery; no separate delivery-planning status is stored.`,
      ),
      ...problems.slice(0, 10).map((e) => {
        const o = state.orders.find((o) => o.id === e.order_id);
        return h(
          "div",
          { class: "attention" },
          h("span", {}, `⚠ ${customer(o).bag_code} · ${e.note}`),
          button("Open order", () => orderDetail(o), "quiet"),
        );
      }),
      ...overdue.slice(0, 8).map((o) =>
        h(
          "div",
          { class: "inline" },
          h(
            "p",
            {},
            `Overdue: ${o.order_no} · ${customer(o).full_name} · due ${o.due_date}`,
          ),
          button("Review", () => orderDetail(o), "quiet"),
        ),
      ),
    ),
    ordersView(false, true),
  );
}
registerPWA();
authGate(root, "owner", async (profile) => {
  state.profile = profile;
  content = h("main", { class: "main" }, skeleton());
  nav = h("nav", { "aria-label": "Owner navigation" });
  replace(
    root,
    h(
      "div",
      { class: "workspace" },
      h(
        "aside",
        { class: "sidebar" },
        brand(),
        nav,
        h(
          "div",
          { class: "sidebar-bottom" },
          h("p", {}, profile.full_name),
          h("p", {}, "Weekly reminder: export a CSV backup."),
          button("Sign out", () => db.auth.signOut(), "quiet"),
        ),
      ),
      content,
    ),
  );
  await refresh();
  let timer;
  const channel = db
    .channel("owner-live")
    .on("change", { table: "orders" }, () => {
      clearTimeout(timer);
      timer = setTimeout(refresh, 400);
    })
    .on("change", { table: "customers" }, () => {
      clearTimeout(timer);
      timer = setTimeout(refresh, 400);
    })
    .on("change", { table: "order_events" }, () => {
      clearTimeout(timer);
      timer = setTimeout(refresh, 400);
    })
    .subscribe();
  const poll = setInterval(refresh, 30000),
    focus = () => refresh();
  window.addEventListener("focus", focus);
  return () => {
    db.removeChannel(channel);
    clearInterval(poll);
    clearTimeout(timer);
    window.removeEventListener("focus", focus);
    Object.assign(state, { orders: [], customers: [], events: [], pay: [] });
  };
});
