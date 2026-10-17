export const STATUSES = [
  "pending_approval",
  "placed",
  "picked_up",
  "weighed",
  "at_shop",
  "ready",
  "delivered",
  "cancelled",
];
export const LABELS = {
  pending_approval: "◷ Pending approval",
  placed: "○ Placed",
  picked_up: "↗ Picked up",
  weighed: "⚖ Weighed",
  at_shop: "▧ At shop",
  ready: "✓ Ready",
  delivered: "✓ Delivered",
  cancelled: "× Cancelled",
};
export const WINDOWS = ["Morning", "Afternoon", "Evening"];
export const money = (value, symbol = "₱") =>
  `${symbol}${Number(value || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export function today(timezone = "Asia/Manila", date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
export function addDays(date, n) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Number(n));
  return d.toISOString().slice(0, 10);
}
export function phone(value) {
  const p = String(value).replace(/[\s()-]/g, "");
  if (/^09\d{9}$/.test(p)) return "+63" + p.slice(1);
  if (/^639\d{9}$/.test(p)) return "+" + p;
  if (/^\+639\d{9}$/.test(p)) return p;
  throw new Error("Enter a Philippine mobile number, such as 0917 123 4567.");
}
export function mapLink(address, lat, lng) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(lat != null && lng != null ? `${lat},${lng}` : address)}`;
}
export function safeUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}
export const activeOrder = (o) =>
  !["delivered", "cancelled"].includes(o.status);
export function csv(rows) {
  return (
    "\ufeff" +
    rows
      .map((row) =>
        row
          .map((value) => {
            let s = String(value ?? "");
            if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
            return '"' + s.replaceAll('"', '""') + '"';
          })
          .join(","),
      )
      .join("\r\n")
  );
}
export function download(name, text, type = "text/csv") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function dispatchText(o, c, s) {
  return `${c.bag_code} · ${c.full_name}\n${c.phone}\n${o.status === "ready" && o.deliver_to_other ? o.delivery_address : c.address}, ${o.status === "ready" && o.deliver_to_other ? o.delivery_area : c.area}\n${o.status === "ready" && o.deliver_to_other ? "" : c.landmark || ""}\n${o.loads} loads · ${o.bags} bags · ${o.pickup_window}\n${o.status === "ready" ? "Collect from" : "Take to"}: ${s?.name || "Shop not assigned"} · ${s?.phone || ""} · ${s?.address || ""}\n${mapLink(o.status === "ready" && o.deliver_to_other ? o.delivery_address : c.address, o.deliver_to_other && o.status === "ready" ? null : c.lat, o.deliver_to_other && o.status === "ready" ? null : c.lng)}`;
}

// randomUUID is HTTPS-only in browsers; getRandomValues also supports a LAN trial.
export function uuid() {
  if (globalThis.crypto.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
