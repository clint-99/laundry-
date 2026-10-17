import { h, replace } from "../shared/h.js";
import { db, query } from "../shared/supabase.js";
import {
  authGate,
  brand,
  button,
  badge,
  input,
  field,
  select,
  toast,
  modal,
  errorBox,
  empty,
  skeleton,
  registerPWA,
} from "../shared/ui.js";
import { mapLink } from "../shared/utils.js";
const root = document.getElementById("app");
let tasks = [],
  tab = "pickups",
  profile,
  content,
  lastUpdated = "",
  queue = [],
  syncing = false,
  active = false,
  errorMessage = "",
  storageKey = "",
  generation = 0,
  deliveryTimer;
function persist() {
  try {
    localStorage.setItem(storageKey, JSON.stringify(queue));
    return true;
  } catch {
    errorMessage =
      "Your device cannot save pending taps. Keep this page open and retry. Do not close it until everything is synced.";
    return false;
  }
}
function loadQueue() {
  try {
    const data = JSON.parse(localStorage.getItem(storageKey) || "[]");
    return Array.isArray(data)
      ? data.filter(
          (a) => ["mark", "undo", "report"].includes(a.kind) && a.id && a.order,
        )
      : [];
  } catch {
    errorMessage =
      "Could not read saved taps. Check device storage before continuing.";
    return [];
  }
}
async function enqueue(action) {
  queue.push(action);
  persist();
  draw();
  await sync();
}
async function sync() {
  if (syncing || !active || !navigator.onLine) return;
  syncing = true;
  const currentGeneration = generation;
  try {
    while (queue.length && active) {
      const a = queue[0];
      if (a.blocked) break;
      const name = {
        mark: "rider_mark",
        undo: "rider_undo",
        report: "rider_report",
      }[a.kind];
      const args =
        a.kind === "mark"
          ? { p_order: a.order, p_to: a.to, p_action: a.id }
          : a.kind === "undo"
            ? { p_action: a.action }
            : { p_order: a.order, p_reason: a.reason, p_action: a.id };
      const { error } = await db.rpc(name, args);
      if (!active || generation !== currentGeneration) return;
      if (error) {
        a.error = error.message || "Could not sync this action.";
        if (
          navigator.onLine &&
          !/fetch|network|connection|timeout/i.test(a.error)
        )
          a.blocked = true;
        persist();
        errorMessage = a.blocked
          ? "An action needs your attention. Nothing was silently discarded."
          : "Waiting for a connection. Your taps are saved on this device.";
        break;
      }
      queue.shift();
      persist();
      if (a.kind === "mark") {
        toast("Saved ✓", {
          label: "Undo",
          run: () =>
            enqueue({
              kind: "undo",
              id: crypto.randomUUID(),
              order: a.order,
              action: a.id,
            }),
        });
      } else toast(a.kind === "undo" ? "Undone ✓" : "Problem reported ✓");
    }
    await refresh(false);
  } finally {
    if (generation === currentGeneration) {
      syncing = false;
      draw();
    }
  }
}
async function refresh(shouldSync = true) {
  if (!active) return;
  const currentGeneration = generation;
  try {
    const result = await query(db.rpc("rider_tasks"));
    if (!active || generation !== currentGeneration) return;
    tasks = result;
    lastUpdated = new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
    if (!queue.length) errorMessage = "";
  } catch (e) {
    errorMessage = navigator.onLine
      ? e.message
      : "You’re offline. Your last task list is shown; taps will wait to sync.";
  }
  draw();
  if (shouldSync) await sync();
}
function report(task) {
  const reason = select(
      "reason",
      [
        "No one home",
        "Wrong address",
        "Customer asked to reschedule",
        "Bag not ready",
        "Other",
      ],
      "No one home",
    ),
    note = input("note", "", {
      maxlength: 200,
      placeholder: "Short note (optional)",
    }),
    error = h("div");
  const dialog = modal(
    "Report a problem",
    h(
      "form",
      {},
      field("Reason", reason),
      field("Extra details", note),
      error,
      button("Send report", async () => {
        try {
          if (reason.value === "Other" && !note.value.trim())
            throw Error("Add a short note.");
          await enqueue({
            kind: "report",
            id: crypto.randomUUID(),
            order: task.order_id,
            reason: `${reason.value}${note.value.trim() ? ": " + note.value.trim() : ""}`,
          });
          dialog.close();
        } catch (e) {
          replace(error, errorBox(e));
        }
      }),
    ),
  );
}
function stop(task) {
  const queued = queue.filter((a) => a.order === task.order_id),
    pending = queued.length > 0;
  const to = {
    placed: "picked_up",
    picked_up: "at_shop",
    weighed: "at_shop",
    ready: "delivered",
  }[task.status];
  const actionLabel = {
    picked_up: "Picked up ✓",
    at_shop: "Dropped at shop ✓",
    delivered: "Delivered ✓",
  }[to];
  const waiting = ["at_shop", "picked_up", "weighed"].includes(task.status);
  return h(
    "article",
    {
      class: `stop-card ${waiting ? "waiting" : ""} ${pending ? "pending-sync" : ""}`,
    },
    h(
      "div",
      { class: "section-head" },
      h("span", { class: "bag-code" }, task.bag_code),
      badge(task.status),
    ),
    h("h3", {}, task.customer_name),
    h(
      "div",
      { class: "inline" },
      h("a", { class: "button secondary", href: "tel:" + task.phone }, "Call"),
      h("a", { class: "button secondary", href: "sms:" + task.phone }, "Text"),
      h(
        "a",
        {
          class: "button secondary",
          href: mapLink(task.address, task.lat, task.lng),
          target: "_blank",
          rel: "noopener noreferrer",
        },
        "Open in Maps ↗",
      ),
    ),
    h("p", {}, task.address),
    task.landmark && h("p", {}, `Landmark: ${task.landmark}`),
    h(
      "strong",
      {},
      `${task.loads} loads · Expect ${task.bags} bag${task.bags === 1 ? "" : "s"}`,
    ),
    h(
      "p",
      {},
      task.status === "placed"
        ? `${task.pickup_date} · ${task.pickup_window}`
        : `Due ${task.due_date}`,
    ),
    task.notes && h("p", {}, task.notes),
    h(
      "div",
      { class: "shop-line" },
      h(
        "strong",
        {},
        `${task.status === "ready" ? "Collect from" : task.status === "placed" ? "Then take to" : task.status === "at_shop" ? "At shop, waiting" : "Take to"}: ${task.shop_name || "Not assigned yet"}`,
      ),
      task.shop_address && h("p", {}, task.shop_address),
      h(
        "div",
        { class: "inline" },
        task.shop_phone &&
          h(
            "a",
            { href: "tel:" + task.shop_phone, class: "button quiet" },
            "Call shop",
          ),
        task.shop_address &&
          h(
            "a",
            {
              href: mapLink(task.shop_address),
              target: "_blank",
              rel: "noopener noreferrer",
              class: "button quiet",
            },
            "Shop map",
          ),
      ),
    ),
    task.latest_problem &&
      h("div", { class: "attention" }, `⚠ ${task.latest_problem}`),
    pending &&
      h(
        "p",
        { class: "warning", "aria-live": "polite" },
        `◷ Waiting to sync · ${queued.length} action${queued.length === 1 ? "" : "s"}`,
      ),
    to
      ? Object.assign(
          button(actionLabel, () =>
            enqueue({
              kind: "mark",
              id: crypto.randomUUID(),
              order: task.order_id,
              to,
            }),
          ),
          { disabled: pending || (to === "at_shop" && !task.shop_name) },
        )
      : h(
          "p",
          { class: "muted" },
          task.status === "delivered"
            ? "Delivered ✓ · Undo is available for 60 seconds."
            : "⏳ Not ready yet",
        ),
    button("Report a problem", () => report(task), "quiet"),
  );
}
function draw() {
  if (!content || !active) return;
  clearTimeout(deliveryTimer);
  const expiries = tasks
    .filter((t) => t.status === "delivered" && t.delivered_at)
    .map((t) => Date.parse(t.delivered_at) + 60000 - Date.now())
    .filter((ms) => ms > 0);
  if (expiries.length)
    deliveryTimer = setTimeout(draw, Math.min(...expiries) + 20);
  const pickups = tasks.filter((t) => t.status === "placed"),
    deliveries = tasks.filter(
      (t) =>
        t.status !== "placed" &&
        (t.status !== "delivered" ||
          Date.now() - Date.parse(t.delivered_at) < 60000),
    ),
    visible = tab === "pickups" ? pickups : deliveries,
    areas = [...new Set(visible.map((t) => t.area))];
  replace(
    content,
    h(
      "header",
      { class: "rider-header" },
      brand(),
      button(
        "Sign out",
        () => {
          if (queue.length) {
            const d = modal(
              "Taps are waiting to sync",
              h(
                "div",
                {},
                h(
                  "p",
                  {},
                  "Keep this device signed in until your taps sync. They remain saved for your account on this device.",
                ),
                button("Retry sync", async () => {
                  await sync();
                  d.close();
                }),
                button(
                  "Sign out with taps saved",
                  async () => {
                    active = false;
                    await db.auth.signOut();
                    d.close();
                  },
                  "secondary",
                ),
              ),
            );
          } else {
            active = false;
            db.auth.signOut();
          }
        },
        "quiet",
      ),
    ),
    h("div", { class: "eyebrow" }, "YOUR DOOR-TO-DOOR ROUTE"),
    h("h1", {}, "Let’s keep it moving."),
    h("p", {}, `Hello, ${profile.full_name}. Match the code on every bag.`),
    h(
      "div",
      { class: "tabs", role: "group", "aria-label": "Task lists" },
      button(
        `Pickups (${pickups.length})`,
        () => {
          tab = "pickups";
          draw();
        },
        tab === "pickups" ? "active" : "secondary",
      ),
      button(
        `Deliveries (${deliveries.length})`,
        () => {
          tab = "deliveries";
          draw();
        },
        tab === "deliveries" ? "active" : "secondary",
      ),
    ),
    h(
      "div",
      { class: "section-head" },
      h(
        "span",
        { class: "sync-line", "aria-live": "polite" },
        `${navigator.onLine ? "Online" : "Offline"} · Last updated ${lastUpdated || "—"} · ${queue.length} waiting to sync`,
      ),
      button("Refresh", () => refresh(), "quiet"),
    ),
    errorMessage &&
      errorBox(errorMessage, () => {
        queue.forEach((a) => (a.blocked = false));
        persist();
        refresh();
      }),
    ...queue
      .filter((a) => a.error)
      .map((a) =>
        h(
          "div",
          { class: "error" },
          h("span", {}, `Action ${a.id.slice(0, 8)}: ${a.error}`),
          button(
            "Retry",
            () => {
              a.blocked = false;
              delete a.error;
              persist();
              sync();
            },
            "secondary",
          ),
          button(
            "Resolve",
            () => {
              const d = modal(
                "Resolve queued action",
                h(
                  "div",
                  {},
                  h(
                    "p",
                    {},
                    "Review the current task first. Removing this action means it will not be retried. The server may already have saved it; refresh to check.",
                  ),
                  button(
                    "Remove from retry queue",
                    () => {
                      queue = queue.filter((x) => x.id !== a.id);
                      persist();
                      d.close();
                      refresh();
                    },
                    "danger",
                  ),
                ),
              );
            },
            "quiet",
          ),
        ),
      ),
    visible.length
      ? h(
          "div",
          {},
          areas.map((area) =>
            h(
              "section",
              {},
              h("h2", {}, area),
              visible.filter((t) => t.area === area).map(stop),
            ),
          ),
        )
      : empty(
          "All clear for now",
          tab === "pickups"
            ? "New pickups will appear here after approval."
            : "Your delivery and shop stops will appear here.",
          button("Refresh tasks", () => refresh(), "secondary"),
        ),
  );
}
registerPWA();
authGate(root, "rider", async (user) => {
  generation++;
  profile = user;
  storageKey = "laundry-queue:" + user.id;
  queue = loadQueue();
  active = true;
  tasks = [];
  content = h("main", { class: "rider-shell" }, skeleton());
  replace(root, content);
  await refresh();
  const timer = setInterval(() => refresh(), 18000),
    focus = () => refresh(),
    online = () => refresh();
  window.addEventListener("focus", focus);
  window.addEventListener("online", online);
  let startY = 0;
  const start = (e) => {
      if (window.scrollY === 0) startY = e.touches[0].clientY;
      else startY = 0;
    },
    end = (e) => {
      if (startY && e.changedTouches[0].clientY - startY > 100) refresh();
      startY = 0;
    };
  window.addEventListener("touchstart", start, { passive: true });
  window.addEventListener("touchend", end, { passive: true });
  return () => {
    active = false;
    generation++;
    syncing = false;
    tasks = [];
    queue = [];
    clearInterval(timer);
    window.removeEventListener("focus", focus);
    window.removeEventListener("online", online);
    window.removeEventListener("touchstart", start);
    window.removeEventListener("touchend", end);
  };
});
