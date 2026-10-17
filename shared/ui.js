import { h, replace } from "./h.js";
import { LABELS } from "./utils.js";
import { db, query, configured } from "./supabase.js";
import { CONFIG } from "./config.js";
export const button = (text, fn, kind = "primary") =>
  h("button", { type: "button", class: `button ${kind}`, onclick: fn }, text);
export const badge = (status) =>
  h("span", { class: `badge ${status}` }, LABELS[status] || status);
let fieldId = 0;
export function field(label, input, help) {
  const id = input.id || `field-${++fieldId}`;
  input.id = id;
  const isControl = ["INPUT", "SELECT", "TEXTAREA"].includes(input.tagName);
  if (!isControl) {
    input.setAttribute("role", "group");
    input.setAttribute("aria-label", label);
  }
  if (help) input.setAttribute("aria-describedby", id + "-help");
  return h(
    "div",
    { class: "field" },
    isControl ? h("label", { for: id }, label) : h("span", {}, label),
    input,
    help && h("small", { id: id + "-help" }, help),
  );
}
export function input(name, value = "", attrs = {}) {
  return h("input", { name, value, ...attrs });
}
export function select(name, options, value) {
  const node = h(
    "select",
    { name },
    options.map((o) =>
      h(
        "option",
        { value: typeof o === "string" ? o : o[0] },
        typeof o === "string" ? o : o[1],
      ),
    ),
  );
  if (value != null) node.value = value;
  return node;
}
export function toast(message, action) {
  let container = document.getElementById("toasts");
  if (!container) {
    container = h("div", { id: "toasts", "aria-live": "polite" });
    document.body.append(container);
  }
  const node = h("div", { class: "toast" }, h("span", {}, message));
  if (action)
    node.append(
      button(
        action.label,
        async () => {
          try {
            await action.run();
            node.remove();
          } catch (e) {
            toast(e.message);
          }
        },
        "secondary",
      ),
    );
  node.append(button("×", () => node.remove(), "quiet"));
  container.append(node);
  setTimeout(() => node.remove(), action ? 60000 : 8000);
}
export function errorBox(error, retry) {
  return h(
    "div",
    { class: "error", role: "alert" },
    h("span", {}, error.message || String(error)),
    retry && button("Retry", retry, "secondary"),
  );
}
export function modal(title, content) {
  const dialog = h(
    "dialog",
    {},
    h(
      "div",
      { class: "section-head" },
      h("h2", {}, title),
      button("×", () => dialog.close(), "quiet"),
    ),
    content,
  );
  dialog.addEventListener("close", () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
  return dialog;
}
export async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast("Copied to clipboard");
  } catch {
    modal(
      "Copy this message",
      h("textarea", { rows: 10, readonly: true }, text),
    );
  }
}
export function empty(title, description, action) {
  return h(
    "div",
    { class: "empty" },
    h("span", { class: "empty-icon" }, "▧"),
    h("h3", {}, title),
    h("p", {}, description),
    action,
  );
}
export function skeleton() {
  return h(
    "div",
    { class: "skeleton", "aria-label": "Loading" },
    h("div"),
    h("div"),
    h("div"),
  );
}
export function brand(name) {
  return h(
    "a",
    { class: "brand", href: new URL("../index.html", import.meta.url).href },
    h("img", { src: CONFIG.LOGO, alt: "", width: 36, height: 36 }),
    h(
      "span",
      {},
      name ||
        (CONFIG.BRAND_NAME === "{{BUSINESS_NAME}}"
          ? "Fresh Fold"
          : CONFIG.BRAND_NAME),
    ),
  );
}
export async function authGate(root, role, onLogin) {
  if (!configured) {
    replace(
      root,
      h(
        "section",
        { class: "setup-card" },
        brand(),
        h("h1", {}, "Connect your workspace"),
        h(
          "p",
          {},
          "Your pages are ready. Connect Supabase to enable secure staff login and live orders.",
        ),
        h(
          "ol",
          {},
          h("li", {}, "Follow docs/SETUP.md to create your Supabase project."),
          h(
            "li",
            {},
            "Add the public project URL and anon key in shared/config.js.",
          ),
          h("li", {}, "Run the migration and create your owner account."),
        ),
        h(
          "a",
          {
            href: `${CONFIG.REPOSITORY_URL}/blob/main/docs/SETUP.md`,
            target: "_blank",
            rel: "noopener noreferrer",
          },
          "Read setup instructions",
        ),
      ),
    );
    return;
  }
  let cleanup;
  const check = async () => {
    try {
      const { session } = await query(db.auth.getSession());
      if (!session) {
        login();
        return;
      }
      const profile = await query(
        db
          .from("profiles")
          .select("id,role,full_name,active")
          .eq("id", session.user.id)
          .single(),
      );
      if (!profile.active || ![role, "owner"].includes(profile.role))
        throw new Error("Your account does not have access to this page.");
      cleanup = await onLogin(profile);
    } catch (e) {
      replace(
        root,
        errorBox(e, check),
        button(
          "Back to sign in",
          async () => {
            await db.auth.signOut();
            login();
          },
          "secondary",
        ),
      );
    }
  };
  function login() {
    cleanup?.();
    const email = input("email", "", {
        type: "email",
        required: true,
        autocomplete: "username",
      }),
      password = input("password", "", {
        type: "password",
        required: true,
        autocomplete: "current-password",
      }),
      error = h("div", { "aria-live": "polite" }),
      submit = h("button", { type: "submit", class: "button" }, "Sign in");
    const form = h(
      "form",
      { class: "auth-card" },
      brand(),
      h("div", { class: "eyebrow" }, `${role} workspace`),
      h("h1", {}, "Welcome back"),
      h("p", {}, "Sign in to keep the day moving."),
      field("Email", email),
      field("Password", password),
      error,
      submit,
    );
    form.onsubmit = async (event) => {
      event.preventDefault();
      submit.disabled = true;
      replace(error);
      try {
        await query(
          db.auth.signInWithPassword({
            email: email.value,
            password: password.value,
          }),
        );
        await check();
      } catch (e) {
        replace(error, errorBox(e));
      } finally {
        submit.disabled = false;
      }
    };
    replace(root, form);
  }
  db.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT") login();
  });
  await check();
}
export function registerPWA() {
  if ("serviceWorker" in navigator)
    navigator.serviceWorker
      .register(new URL("../sw.js", import.meta.url), {
        scope: new URL("../", import.meta.url).pathname,
      })
      .catch(() => {});
}
