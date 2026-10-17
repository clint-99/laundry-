// Same-origin API. Staff sessions use HttpOnly cookies, never browser-stored tokens.
export async function request(path, body) {
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    headers:
      body === undefined
        ? {}
        : { "Content-Type": "application/json", "X-Laundry-Request": "1" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
    cache: "no-store",
  });
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(
      "The server is unavailable. Start it with npm start and retry.",
    );
  }
  if (!response.ok)
    throw Object.assign(
      new Error(data.error || "Request failed. Please retry."),
      { status: response.status },
    );
  return data;
}
const wrap = async (promise) => {
  try {
    return { data: await promise, error: null };
  } catch (e) {
    return { data: null, error: { message: e.message, status: e.status } };
  }
};
const listeners = new Set();
class TableQuery {
  constructor(table) {
    this.spec = { table, op: "select", filters: {} };
  }
  select() {
    return this;
  }
  eq(name, value) {
    this.spec.filters[name] = value;
    return this;
  }
  single() {
    this.spec.single = true;
    return this;
  }
  order(name) {
    this.spec.order = name;
    return this;
  }
  range(start, end) {
    Object.assign(this.spec, { start, end });
    return this;
  }
  insert(values) {
    Object.assign(this.spec, { op: "insert", values });
    return this;
  }
  update(values) {
    Object.assign(this.spec, { op: "update", values });
    return this;
  }
  then(resolve, reject) {
    return wrap(request("/api/table", this.spec)).then(resolve, reject);
  }
}
export const db = {
  from: (table) => new TableQuery(table),
  rpc: (name, args = {}) => wrap(request("/api/rpc", { name, args })),
  auth: {
    getSession: () => wrap(request("/api/session")),
    signInWithPassword: (data) => wrap(request("/api/login", data)),
    signOut: async () => {
      const result = await wrap(request("/api/logout", {}));
      if (!result.error)
        for (const listener of listeners) listener("SIGNED_OUT");
      if (result.error)
        for (const listener of listeners)
          listener("SIGN_OUT_ERROR", result.error);
      return result;
    },
    onAuthStateChange: (listener) => {
      listeners.add(listener);
      return { unsubscribe: () => listeners.delete(listener) };
    },
  },
  channel() {
    const callbacks = new Map();
    return {
      on(_kind, filter, fn) {
        callbacks.set(filter.table, fn);
        return this;
      },
      subscribe() {
        this.source = new EventSource("/api/events");
        this.source.onmessage = (event) => {
          const value = JSON.parse(event.data);
          callbacks.get(value.table)?.();
        };
        return this;
      },
    };
  },
  removeChannel(channel) {
    channel.source?.close();
  },
};
export async function query(operation) {
  const { data, error } = await operation;
  if (error)
    throw Object.assign(Error(error.message), { status: error.status });
  return data;
}
export const edge = (name, body = {}) => request("/api/public/" + name, body);
export const staffEdge = (body) => request("/api/staff-admin", body);
