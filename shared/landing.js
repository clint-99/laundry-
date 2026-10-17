import { h, replace } from "./h.js";
import { brand } from "./ui.js";
replace(
  document.getElementById("app"),
  h(
    "div",
    { class: "landing" },
    h(
      "header",
      {},
      brand(),
      h(
        "a",
        { href: "./book/", class: "button secondary" },
        "Book a pickup ↗",
      ),
    ),
    h(
      "main",
      {},
      h(
        "section",
        { class: "hero" },
        h(
          "div",
          {},
          h("div", { class: "eyebrow" }, "A FRESHER EVERYDAY"),
          h("h1", {}, "Fresh laundry.\nWithout the legwork."),
          h(
            "p",
            {},
            "From your doorstep to your favorite drawer. We collect, our partner shops clean, and we bring it all back.",
          ),
          h("a", { class: "button", href: "./book/" }, "Schedule a pickup →"),
          h(
            "p",
            { class: "help" },
            "Free pickup & delivery · Simple per-load pricing",
          ),
        ),
        h(
          "div",
          { class: "hero-graphic", "aria-hidden": "true" },
          h("img", {
            src: "./icons/basket.svg",
            alt: "",
            width: 260,
            height: 260,
          }),
          h("span", { class: "hero-tag" }, "✓ A load off your mind"),
        ),
      ),
      h(
        "section",
        { class: "steps" },
        [
          [
            "01",
            "You book.",
            "Pick a day and tell us where to collect your bags.",
          ],
          [
            "02",
            "We take care of it.",
            "Our riders bring your laundry to a partner shop.",
          ],
          [
            "03",
            "Freshness, delivered.",
            "Clean, folded laundry comes right back to your door.",
          ],
        ].map(([n, t, d]) =>
          h(
            "article",
            { class: "card" },
            h("span", { class: "number" }, n),
            h("h3", {}, t),
            h("p", {}, d),
          ),
        ),
      ),
    ),
    h(
      "footer",
      {},
      h("span", {}, "Your neighborhood laundry, a little simpler."),
      h(
        "div",
        { class: "inline" },
        h("a", { href: "./owner/" }, "Owner login"),
        h("a", { href: "./rider/" }, "Rider login"),
      ),
    ),
  ),
);
