export class RequestError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
export function text(data, key, min = 1, max = 500) {
  const value = data[key];
  if (
    typeof value !== "string" ||
    value.trim().length < min ||
    value.length > max
  )
    throw new RequestError(`Please check ${key.replaceAll("_", " ")}.`);
  return value.trim();
}
export function normalizePhone(value) {
  const p = String(value).replace(/[\s()-]/g, "");
  const n = /^09\d{9}$/.test(p)
    ? "+63" + p.slice(1)
    : /^639\d{9}$/.test(p)
      ? "+" + p
      : p;
  if (!/^\+639\d{9}$/.test(n))
    throw new RequestError("Enter a valid Philippine mobile number.");
  return n;
}
export function token(data) {
  const t = data.token;
  if (typeof t !== "string" || !/^[a-f0-9]{48}$/.test(t))
    throw new RequestError("Link not valid");
  return t;
}
/** @returns {Record<string, string | number | boolean>} */
export function validateBooking(data, returning) {
  const service = text(data, "service_id", 36, 36);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      service,
    )
  )
    throw new RequestError("Choose a service.");
  if (!Number.isInteger(data.loads) || data.loads < 1 || data.loads > 20)
    throw new RequestError("Choose 1 to 20 loads.");
  const date = text(data, "pickup_date", 10, 10);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(Date.parse(date)) ||
    new Date(date).toISOString().slice(0, 10) !== date
  )
    throw new RequestError("Choose a valid pickup date.");
  const window = text(data, "pickup_window", 1, 20);
  if (!["Morning", "Afternoon", "Evening"].includes(window))
    throw new RequestError("Choose a pickup window.");
  const result = {
    service_id: service,
    loads: data.loads,
    pickup_date: date,
    pickup_window: window,
  };
  if (data.request_id != null) {
    if (
      typeof data.request_id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        data.request_id,
      )
    )
      throw new RequestError("Reload the page and try again.");
    result.request_id = data.request_id;
  }
  if (returning) return { ...result, token: token(data) };
  if (data.consent !== true)
    throw new RequestError("Please agree to the privacy notice to continue.");
  Object.assign(result, {
    name: text(data, "name", 1, 120),
    phone: normalizePhone(text(data, "phone", 10, 24)),
    area: text(data, "area", 1, 120),
    address: text(data, "address", 1, 500),
    landmark: data.landmark ? text(data, "landmark", 0, 300) : "",
    notes: data.notes ? text(data, "notes", 0, 1000) : "",
    consent: true,
    deliver_to_other: data.deliver_to_other === true,
  });
  if (result.deliver_to_other) {
    result.delivery_address = text(data, "delivery_address", 1, 500);
    result.delivery_area = text(data, "delivery_area", 1, 120);
  }
  for (const [key, min, max] of [
    ["lat", -90, 90],
    ["lng", -180, 180],
  ])
    if (data[key] != null) {
      if (
        typeof data[key] !== "number" ||
        !Number.isFinite(data[key]) ||
        data[key] < min ||
        data[key] > max
      )
        throw new RequestError("Check your location.");
      result[key] = data[key];
    }
  if ((result.lat == null) !== (result.lng == null))
    throw new RequestError("Check your location.");
  return result;
}
