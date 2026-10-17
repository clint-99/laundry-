import { h, replace } from "../shared/h.js";
import { brand, field, input, errorBox } from "../shared/ui.js";
import { request } from "../shared/api.js";
const root = document.getElementById("app");
async function start() {
  try {
    const status = await request("/api/setup/status");
    if (!status.needs_setup) {
      replace(
        root,
        h(
          "section",
          { class: "setup-card" },
          brand(),
          h("h1", {}, "Your workspace is set up"),
          h("a", { class: "button", href: "../owner/" }, "Owner sign in"),
        ),
      );
      return;
    }
    const error = h("div", { "aria-live": "polite" }),
      submit = h(
        "button",
        { type: "submit", class: "button" },
        "Create owner account",
      );
    const form = h(
      "form",
      { class: "auth-card" },
      brand(),
      h("h1", {}, "Make it your workspace"),
      h(
        "p",
        {},
        "Create your owner login. Your data stays in the SQLite database on this computer.",
      ),
      field(
        "One-time setup code",
        input("code", "", {
          required: true,
          autocomplete: "off",
          maxlength: 48,
        }),
        "Read data/setup-code.txt on the computer running the server. Never post this code publicly.",
      ),
      field(
        "Your name",
        input("full_name", "", {
          required: true,
          maxlength: 120,
          autocomplete: "name",
        }),
      ),
      field(
        "Email",
        input("email", "", {
          type: "email",
          required: true,
          autocomplete: "username",
        }),
      ),
      field(
        "Password (at least 12 characters)",
        input("password", "", {
          type: "password",
          required: true,
          minlength: 12,
          maxlength: 128,
          autocomplete: "new-password",
        }),
      ),
      error,
      submit,
    );
    form.onsubmit = async (e) => {
      e.preventDefault();
      submit.disabled = true;
      replace(error);
      try {
        await request("/api/setup", Object.fromEntries(new FormData(form)));
        location.assign("../owner/");
      } catch (err) {
        replace(error, errorBox(err));
      } finally {
        submit.disabled = false;
      }
    };
    replace(root, form);
  } catch (err) {
    replace(root, errorBox(err, start));
  }
}
start();
