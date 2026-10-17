import { h, replace } from "../shared/h.js";
import { edge } from "../shared/api.js";
import {
  brand,
  button,
  field,
  input,
  select,
  errorBox,
  skeleton,
  badge,
} from "../shared/ui.js";
import { money, phone, addDays, safeUrl, uuid } from "../shared/utils.js";
import { translate } from "../shared/i18n.js";
const root = document.getElementById("app");
let lang = "en",
  cfg,
  customer,
  step = 0,
  token = new URLSearchParams(location.hash.slice(1)).get("t"),
  challengeWidget,
  challengeId = "",
  challengeAnswer = "",
  sending = false,
  receipt = null;
if (location.hash)
  history.replaceState(null, "", location.pathname + location.search);
window.addEventListener("hashchange", () => {
  const incoming = new URLSearchParams(location.hash.slice(1)).get("t");
  if (incoming) {
    requestId = uuid();
    token = incoming;
    customer = null;
    receipt = null;
    step = 0;
    history.replaceState(null, "", location.pathname + location.search);
    start();
  }
});
let requestId = uuid();
const newDetails = () => ({
  name: "",
  phone: "",
  area: "",
  address: "",
  landmark: "",
  deliver_to_other: false,
  delivery_address: "",
  delivery_area: "",
  loads: 1,
  service_id: "",
  pickup_date: "",
  pickup_window: "Morning",
  notes: "",
  consent: false,
});
const data = newDetails();
const t = (key, args) => translate(lang, key, args);
function contact() {
  const nodes = [];
  const url = safeUrl(cfg?.facebook_url);
  if (url)
    nodes.push(
      h(
        "a",
        {
          class: "button secondary",
          href: url,
          target: "_blank",
          rel: "noopener noreferrer",
        },
        t("message"),
      ),
    );
  const number = (cfg?.hotline || "").replace(/[^+\d]/g, "");
  if (number)
    nodes.push(
      h("a", { class: "button secondary", href: "tel:" + number }, t("call")),
    );
  return h("div", { class: "inline" }, nodes);
}
function shell(...children) {
  document.documentElement.lang = lang === "fil" ? "fil" : "en";
  replace(
    root,
    h(
      "main",
      { class: "book-shell" },
      h(
        "header",
        { class: "book-header" },
        brand(cfg?.business_name),
        button(
          t("language"),
          () => {
            lang = lang === "en" ? "fil" : "en";
            render();
          },
          "secondary",
        ),
      ),
      children,
      h(
        "footer",
        { class: "customer-staff-links" },
        h("a", { href: "../owner/" }, "Owner / admin"),
        h("a", { href: "../rider/" }, "Rider"),
      ),
    ),
  );
}
function connectionError(e) {
  shell(
    h(
      "section",
      { class: "card" },
      h("h1", {}, t("setup")),
      errorBox(e, start),
      contact(),
    ),
  );
}
async function start() {
  shell(skeleton());
  try {
    cfg = await edge("public-config");
    if (!data.service_id) data.service_id = cfg.services[0]?.id || "";
    if (!data.pickup_date)
      data.pickup_date =
        cfg.dates.find((d) => d.bookable && d.capacity_left >= data.loads)
          ?.date || "";
    if (token) {
      try {
        customer = await edge("lookup", { token });
        data.loads = customer.loads || 1;
        if (cfg.services.some((s) => s.id === customer.service_id))
          data.service_id = customer.service_id;
      } catch (error) {
        if (error.status === 400) customer = { invalid: true };
        else throw error;
      }
    }
    if (!token) {
      const remembered = await edge("remembered");
      customer = remembered.customer;
      if (customer) {
        data.loads = customer.loads || 1;
        if (cfg.services.some((s) => s.id === customer.service_id))
          data.service_id = customer.service_id;
      }
    }
    render();
  } catch (e) {
    connectionError(e);
  }
}
function bind(name, type = "text", attrs = {}) {
  const node = input(name, data[name] ?? "", { type, ...attrs });
  node.addEventListener("input", () => (data[name] = node.value));
  return node;
}
function choose(name, options) {
  const node = select(name, options, data[name]);
  node.onchange = () => (data[name] = node.value);
  return node;
}
function total() {
  const service = cfg.services.find((s) => s.id === data.service_id);
  return h(
    "div",
    { class: "total" },
    h("small", {}, t("total")),
    h(
      "strong",
      {},
      money(
        data.loads * Number(service?.price_per_load || 0),
        cfg.currency_symbol,
      ),
    ),
    h(
      "div",
      {},
      t("loadCount", {
        loads: data.loads,
        price: money(service?.price_per_load, cfg.currency_symbol),
      }),
    ),
    h("small", {}, t("free")),
  );
}
function orderControls() {
  const totalNode = h("div", {}, total()),
    dateGroup = h("div"),
    out = h("output", { "aria-live": "polite" }, data.loads),
    minus = button("−", () => changeLoads(-1), "secondary"),
    plus = button("+", () => changeLoads(1), "secondary");
  minus.setAttribute("aria-label", t("loads") + " −");
  plus.setAttribute("aria-label", t("loads") + " +");
  function dates() {
    const available = cfg.dates.filter(
      (d) => d.bookable && d.capacity_left >= data.loads,
    );
    if (!available.some((d) => d.date === data.pickup_date))
      data.pickup_date = available[0]?.date || "";
    replace(
      dateGroup,
      h("span", {}, t("pickup")),
      available.length
        ? h(
            "div",
            { class: "chips", role: "group", "aria-label": t("pickup") },
            available.map((d) => {
              const first = cfg.dates[0]?.date;
              const label =
                d.date === first
                  ? t("today")
                  : d.date === addDays(first, 1)
                    ? t("tomorrow")
                    : new Intl.DateTimeFormat(
                        lang === "fil" ? "fil-PH" : "en-PH",
                        { month: "short", day: "numeric", timeZone: "UTC" },
                      ).format(new Date(d.date + "T12:00Z"));
              return buttonChip(label, d.date);
            }),
          )
        : h("p", {}, t("noDates")),
    );
  }
  function buttonChip(label, value) {
    return h(
      "button",
      {
        type: "button",
        "aria-pressed": data.pickup_date === value,
        onclick: () => {
          data.pickup_date = value;
          dates();
        },
      },
      label,
    );
  }
  function changeLoads(n) {
    data.loads = Math.max(1, Math.min(20, data.loads + n));
    out.textContent = data.loads;
    minus.disabled = data.loads === 1;
    plus.disabled = data.loads === 20;
    replace(totalNode, total());
    dates();
  }
  minus.disabled = data.loads === 1;
  plus.disabled = data.loads === 20;
  const service = choose(
    "service_id",
    cfg.services.map((s) => [
      s.id,
      `${s.name} · ${money(s.price_per_load, cfg.currency_symbol)}/${t("perLoad")}`,
    ]),
  );
  service.onchange = () => {
    data.service_id = service.value;
    replace(totalNode, total());
  };
  dates();
  return h(
    "div",
    {},
    field(
      t("loads"),
      h("div", { class: "stepper" }, minus, out, plus),
      t("basket", { kg: cfg.max_kg_per_load }),
    ),
    field(t("service"), service),
    h("div", { class: "field" }, dateGroup),
    field(
      t("window"),
      choose(
        "pickup_window",
        ["Morning", "Afternoon", "Evening"].map((w) => [w, t(w)]),
      ),
    ),
    totalNode,
  );
}
function render() {
  if (!cfg) return;
  if (receipt) return showReceipt();
  if (customer?.invalid) {
    shell(
      h(
        "section",
        { class: "card" },
        h("h1", {}, t("invalid")),
        contact(),
        button(t("notYou", { name: "" }), () => forgetCustomer(), "quiet"),
      ),
    );
    return;
  }
  if (customer?.pending_confirmation) return pendingRegistration();
  if (customer?.active_order) return returning();
  if (!cfg.booking_open || !cfg.services.length) {
    shell(
      h(
        "section",
        { class: "card" },
        customer && customerCard(),
        h("h1", {}, t("closed")),
        customer &&
          button(t("differentCustomer"), () => forgetCustomer(), "quiet"),
        contact(),
      ),
    );
    return;
  }
  if (customer) return returning();
  newCustomer();
}
function customerCard() {
  return h(
    "div",
    { class: "customer-identity" },
    h("small", {}, t("customerId")),
    h("strong", { class: "bag-code" }, customer.customer_code),
    h("p", {}, t("bagInstructions")),
  );
}
async function forgetCustomer() {
  try {
    await edge("forget");
    token = null;
    customer = null;
    receipt = null;
    for (const key of Object.keys(data)) delete data[key];
    Object.assign(data, newDetails(), {
      service_id: cfg.services[0]?.id || "",
      pickup_date:
        cfg.dates.find((d) => d.bookable && d.capacity_left >= 1)?.date || "",
    });
    step = 0;
    requestId = uuid();
    render();
  } catch (e) {
    connectionError(e);
  }
}
function pendingRegistration() {
  const request = customer.request;
  shell(
    h(
      "section",
      { class: "card" },
      h("h1", {}, t("hello", { name: customer.first_name })),
      h("h2", {}, request.order_no),
      badge(request.status),
      h(
        "p",
        {},
        request.status === "cancelled"
          ? t("requestCancelled")
          : t("rememberAfterApproval"),
      ),
      button(t("refreshStatus"), () => start()),
      button(t("differentCustomer"), () => forgetCustomer(), "quiet"),
      contact(),
    ),
  );
}
function returning() {
  if (customer.active_order) {
    shell(
      h(
        "section",
        { class: "card" },
        h("h1", {}, t("hello", { name: customer.first_name })),
        h("p", {}, t("active")),
        customerCard(),
        h("h2", {}, customer.active_order.order_no),
        badge(customer.active_order.status),
        h("p", {}, `${t("due")}: ${customer.active_order.due_date}`),
        h("p", {}, t("change")),
        button(t("differentCustomer"), () => forgetCustomer(), "quiet"),
        contact(),
      ),
    );
    return;
  }
  const error = h("div", { "aria-live": "polite" }),
    submit = button(t("bookAgain"), () => send(true, error, submit));
  submit.classList.add("primary-action");
  shell(
    h(
      "section",
      { class: "booking-title" },
      h("div", { class: "eyebrow" }, t("intro")),
      h("h1", {}, t("hello", { name: customer.first_name })),
      h("p", {}, t("ready")),
    ),
    h(
      "section",
      { class: "card" },
      customerCard(),
      h("p", {}, t("savedAddress", { area: customer.area })),
      orderControls(),
      error,
      submit,
      h("p", { class: "help" }, t("priceFinal")),
      button(
        t("notYou", { name: customer.first_name }),
        () => forgetCustomer(),
        "quiet",
      ),
    ),
    contact(),
  );
}
function newCustomer() {
  const error = h("div", { "aria-live": "polite" }),
    form = h("form"),
    titles = ["about", "address", "order", "review"];
  form.append(
    h(
      "div",
      {
        class: "progress-dots",
        "aria-label": t("progress", { step: step + 1 }),
      },
      titles.map((_, i) => h("span", { class: i <= step ? "done" : "" })),
    ),
    h("h2", {}, t(titles[step])),
  );
  if (step === 0)
    form.append(
      field(
        t("name"),
        bind("name", "text", {
          required: true,
          maxlength: 120,
          autocomplete: "name",
        }),
      ),
      field(
        t("phone"),
        bind("phone", "tel", {
          required: true,
          maxlength: 24,
          inputmode: "tel",
          autocomplete: "tel",
        }),
        t("phoneHelp"),
      ),
    );
  if (step === 1) {
    const other = bind("deliver_to_other", "checkbox", {
        checked: data.deliver_to_other,
      }),
      otherFields = h("div", { hidden: !data.deliver_to_other });
    other.oninput = () => {
      data.deliver_to_other = other.checked;
      otherFields.hidden = !other.checked;
    };
    replace(
      otherFields,
      field(
        t("delivery"),
        bind("delivery_address", "text", { maxlength: 500 }),
      ),
      field(
        t("deliveryArea"),
        choose("delivery_area", [["", t("chooseArea")], ...cfg.service_areas]),
      ),
    );
    const geo = h(
      "p",
      { class: "help" },
      data.lat != null ? t("locationSaved") : t("locationHelp"),
    );
    form.append(
      field(
        t("area"),
        choose("area", [["", t("chooseArea")], ...cfg.service_areas]),
      ),
      h("p", { class: "help" }, t("outside")),
      field(
        t("street"),
        bind("address", "text", {
          required: true,
          maxlength: 500,
          autocomplete: "street-address",
        }),
      ),
      field(t("landmark"), bind("landmark", "text", { maxlength: 300 })),
      button(
        t("location"),
        () => {
          if (!navigator.geolocation) {
            geo.textContent = t("locationError");
            return;
          }
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              data.lat = pos.coords.latitude;
              data.lng = pos.coords.longitude;
              geo.textContent = t("locationSaved");
            },
            () => (geo.textContent = t("locationError")),
            { timeout: 10000, maximumAge: 300000 },
          );
        },
        "secondary",
      ),
      geo,
      h("label", { class: "check" }, other, h("span", {}, t("different"))),
      otherFields,
    );
  }
  if (step === 2) {
    const notes = h("textarea", { name: "notes", maxlength: 1000 }, data.notes);
    notes.oninput = () => (data.notes = notes.value);
    form.append(orderControls(), field(t("notes"), notes));
  }
  if (step === 3) {
    const consent = input("consent", "true", {
      type: "checkbox",
      checked: data.consent,
      required: true,
    });
    consent.onchange = () => (data.consent = consent.checked);
    form.append(
      h("p", {}, t("check")),
      h(
        "dl",
        { class: "detail-grid" },
        [
          [t("name"), data.name],
          [t("phone"), data.phone],
          [t("address"), `${data.address}, ${data.area}`],
          [
            t("delivery"),
            data.deliver_to_other
              ? `${data.delivery_address}, ${data.delivery_area}`
              : `${data.address}, ${data.area}`,
          ],
          [t("pickup"), `${data.pickup_date} · ${t(data.pickup_window)}`],
        ].map(([k, v]) => [h("dt", {}, k), h("dd", {}, v)]),
      ),
      total(),
      h(
        "details",
        {},
        h("summary", {}, t("privacyLabel")),
        h("p", { class: "fine-print" }, t("privacy")),
      ),
      h("label", { class: "check" }, consent, h("span", {}, t("consent"))),
    );
  }
  const submit = h(
    "button",
    { type: "submit", class: "button primary-action" },
    t(step === 3 ? "request" : "next"),
  );
  form.append(error, submit);
  if (step > 0)
    form.append(
      button(
        t("back"),
        () => {
          step--;
          render();
        },
        "quiet",
      ),
    );
  form.onsubmit = async (event) => {
    event.preventDefault();
    replace(error);
    try {
      if (step === 0) data.phone = phone(data.phone);
      if (step === 1) {
        if (!data.area) throw Error(t("chooseArea"));
        if (
          data.deliver_to_other &&
          (!data.delivery_address.trim() || !data.delivery_area)
        )
          throw Error(t("delivery"));
      }
      if (step === 2 && !data.pickup_date) throw Error(t("selectDate"));
      if (step < 3) {
        step++;
        render();
      } else await send(false, error, submit);
    } catch (e) {
      replace(error, errorBox(e));
    }
  };
  shell(
    h(
      "div",
      { class: "booking-title" },
      h("div", { class: "eyebrow" }, t("intro")),
      h("h1", {}, t("newTitle")),
      h("p", {}, t("subtitle")),
    ),
    h("section", { class: "card" }, form),
    contact(),
  );
  if (step === 3) {
    const widget = h("div", {});
    challengeWidget = widget;
    form.insertBefore(widget, error);
    loadChallenge(widget, error);
  }
}
async function loadChallenge(widget, error) {
  challengeId = "";
  challengeAnswer = "";
  try {
    const check = await edge("challenge");
    if (!widget.isConnected) return;
    challengeId = check.id;
    const answer = input("human_answer", "", {
      inputmode: "numeric",
      required: true,
      autocomplete: "off",
    });
    answer.oninput = () => (challengeAnswer = answer.value);
    replace(
      widget,
      field(`${t("security")} ${check.question}`, answer),
      button(t("retry"), () => loadChallenge(widget, error), "quiet"),
    );
  } catch (e) {
    replace(
      error,
      errorBox(e, () => loadChallenge(widget, error)),
    );
  }
}
async function send(returning, error, submit) {
  if (sending) return;
  if (!data.pickup_date) {
    replace(error, errorBox(t("selectDate")));
    return;
  }
  if (!returning && (!challengeId || !challengeAnswer)) {
    replace(error, errorBox(t("securityRequired")));
    return;
  }
  sending = true;
  submit.disabled = true;
  submit.textContent = t("sending");
  try {
    const result = await edge(
      returning ? "book-again" : "book-new",
      returning
        ? {
            request_id: requestId,
            token,
            service_id: data.service_id,
            loads: data.loads,
            pickup_date: data.pickup_date,
            pickup_window: data.pickup_window,
          }
        : {
            ...data,
            request_id: requestId,
            challenge_id: challengeId,
            challenge_answer: challengeAnswer,
          },
    );
    requestId = uuid();
    receipt = { result, returning };
    showReceipt();
  } catch (e) {
    replace(
      error,
      errorBox(e, () => send(returning, error, submit)),
    );
    if (!returning && challengeWidget?.isConnected)
      loadChallenge(challengeWidget, error);
  } finally {
    sending = false;
    submit.disabled = false;
    submit.textContent = t(returning ? "bookAgain" : "request");
  }
}
start();

function showReceipt() {
  const { result, returning } = receipt;
  shell(
    h(
      "section",
      { class: "card" },
      h("div", { class: "eyebrow" }, t(returning ? "confirmed" : "done")),
      h("h1", {}, result.order_no),
      h("p", {}, returning ? t("bagReady") : t("confirmText")),
      h(
        "div",
        { class: "total" },
        h("strong", {}, money(result.total, cfg.currency_symbol)),
        h("p", {}, `${result.pickup_date} · ${t(result.pickup_window)}`),
      ),
      h("p", {}, returning ? t("free") : t("rememberAfterApproval")),
      !returning &&
        button(
          t("refreshStatus"),
          () => {
            receipt = null;
            start();
          },
          "secondary",
        ),
      contact(),
    ),
  );
}
