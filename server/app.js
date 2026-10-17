import http from "node:http";
import { readFile, stat, mkdtemp, rm } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { tmpdir } from "node:os";
import { backup } from "node:sqlite";
import { resolve, join, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Store, AppError } from "./store.js";
const ROOT = resolve(fileURLToPath(new URL("../", import.meta.url)));
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
  ".md": "text/plain; charset=utf-8",
};
export function createApp({
  directory = process.env.DATA_DIR || join(ROOT, "data"),
  publicOrigin = process.env.PUBLIC_ORIGIN || "",
} = {}) {
  if (publicOrigin) {
    const url = new URL(publicOrigin);
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.origin !== publicOrigin
    )
      throw new Error(
        "PUBLIC_ORIGIN must be an origin without a path or trailing slash.",
      );
  }
  const store = new Store(directory),
    streams = new Set();
  store.onChange = (table) => {
    for (const stream of streams)
      if (store.session(stream.cookie)?.role === "owner")
        stream.res.write("data: " + JSON.stringify({ table }) + "\n\n");
  };
  const json = (res, status, data) => {
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(JSON.stringify(data));
  };
  const cookie = (req) => {
    const match = (req.headers.cookie || "").match(
      /(?:^|;\s*)laundry_session=([a-f0-9]{64})(?:;|$)/,
    );
    return match?.[1] || "";
  };
  const sessionCookie = (value, remove = false) =>
    `laundry_session=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${remove ? 0 : 8 * 3600}${publicOrigin.startsWith("https:") ? "; Secure" : ""}`;
  async function body(req) {
    if (!/^application\/json(?:;|$)/i.test(req.headers["content-type"] || ""))
      throw new AppError("Send JSON data.", 415);
    if (req.headers["x-laundry-request"] !== "1")
      throw new AppError("Invalid request.", 403);
    const expected = publicOrigin || "http://" + req.headers.host;
    if (req.headers.origin && req.headers.origin !== expected)
      throw new AppError("Origin not allowed.", 403);
    if (Number(req.headers["content-length"] || 0) > 32768)
      throw new AppError("Request too large.", 413);
    const chunks = [];
    let bytes = 0;
    for await (const chunk of req) {
      bytes += chunk.length;
      if (bytes > 32768) throw new AppError("Request too large.", 413);
      chunks.push(chunk);
    }
    try {
      const result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (!result || typeof result !== "object" || Array.isArray(result))
        throw Error();
      return result;
    } catch {
      throw new AppError("Invalid JSON data.");
    }
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    const ip = req.socket.remoteAddress || "unknown"; // Do not trust caller-controlled forwarded headers.
    try {
      const url = new URL(req.url, "http://localhost"),
        path = url.pathname;
      if (path === "/api/health" && req.method === "GET")
        return json(res, 200, { ok: true, storage: "sqlite" });
      if (path === "/api/setup/status" && req.method === "GET")
        return json(res, 200, {
          needs_setup: store.all("profiles").length === 0,
        });
      if (path === "/api/session" && req.method === "GET") {
        const user = store.session(cookie(req));
        return json(res, 200, { session: user ? { user } : null });
      }
      if (path === "/api/backup" && req.method === "GET") {
        store.require(store.session(cookie(req)));
        const temp = await mkdtemp(join(tmpdir(), "laundry-backup-"));
        try {
          const file = join(temp, "backup.sqlite");
          await backup(store.db, file);
          res.writeHead(200, {
            "Content-Type": "application/octet-stream",
            "Content-Disposition":
              'attachment; filename="laundry-backup.sqlite"',
            "Cache-Control": "no-store",
          });
          await pipeline(createReadStream(file), res);
        } finally {
          await rm(temp, { recursive: true, force: true });
        }
        return;
      }
      if (path === "/api/events" && req.method === "GET") {
        const token = cookie(req),
          user = store.session(token);
        store.require(user);
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-store",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        });
        res.write(": connected\n\n");
        const stream = { res, cookie: token };
        streams.add(stream);
        const heartbeat = setInterval(() => {
          if (store.session(token)?.role !== "owner") {
            res.end();
            return;
          }
          res.write(": keepalive\n\n");
        }, 10000);
        req.on("close", () => {
          clearInterval(heartbeat);
          streams.delete(stream);
        });
        return;
      }
      if (path.startsWith("/api/")) {
        if (req.method !== "POST") throw new AppError("Use POST.", 405);
        const data = await body(req);
        const user = store.session(cookie(req));
        if (path === "/api/setup") {
          const owner = store.setup(data, ip);
          return json(res, 201, { ok: true, owner });
        }
        if (path === "/api/login") {
          const logged = store.login(data, ip);
          res.setHeader("Set-Cookie", sessionCookie(logged.token));
          return json(res, 200, { session: { user: logged.user } });
        }
        if (path === "/api/logout") {
          store.logout(cookie(req));
          res.setHeader("Set-Cookie", sessionCookie("", true));
          return json(res, 200, { ok: true });
        }
        if (path === "/api/table")
          return json(res, 200, store.table(user, data));
        if (path === "/api/rpc")
          return json(res, 200, store.rpc(user, data.name, data.args));
        if (path === "/api/staff-admin") {
          store.rate("staff:" + ip, 40, 3600);
          return json(res, 200, store.staff(user, data));
        }
        if (path.startsWith("/api/public/"))
          return json(
            res,
            200,
            store.public(path.slice("/api/public/".length), data, ip),
          );
        throw new AppError("Not found.", 404);
      }
      if (req.method !== "GET" && req.method !== "HEAD")
        throw new AppError("Method not allowed.", 405);
      const decoded = decodeURIComponent(path);
      const first = decoded.split("/").filter(Boolean)[0] || "index.html";
      if (
        ![
          "index.html",
          "book",
          "owner",
          "rider",
          "setup",
          "shared",
          "icons",
          "docs",
          "sw.js",
        ].includes(first)
      )
        throw new AppError("Not found.", 404);
      let file = resolve(ROOT, "." + decoded);
      if (file !== ROOT && !file.startsWith(ROOT + sep))
        throw new AppError("Not found.", 404);
      let info;
      try {
        info = await stat(file);
      } catch {
        throw new AppError("Not found.", 404);
      }
      if (info.isDirectory()) {
        if (!decoded.endsWith("/")) {
          res.writeHead(301, { Location: decoded + "/" });
          return res.end();
        }
        file = join(file, "index.html");
      }
      const contents = await readFile(file);
      res.writeHead(200, {
        "Content-Type": TYPES[extname(file)] || "application/octet-stream",
        "Cache-Control": "no-cache",
      });
      res.end(req.method === "HEAD" ? undefined : contents);
    } catch (error) {
      if (res.headersSent) {
        res.end();
        return;
      }
      if (error instanceof AppError)
        return json(res, error.status, { error: error.message });
      if (
        error.code?.startsWith("ERR_SQLITE") ||
        error.message?.includes("UNIQUE constraint")
      )
        return json(res, 409, {
          error:
            "This record conflicts with saved data. Check the phone or email and try again.",
        });
      console.error("Request failed:", error.name);
      json(res, 500, { error: "Something went wrong. Please try again." });
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  return {
    server,
    store,
    close: async () => {
      for (const s of streams) s.res.end();
      await new Promise((resolve) => server.close(resolve));
      store.close();
    },
  };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = createApp();
  const port = Number(process.env.PORT || 3000);
  app.server.listen(port, process.env.HOST || "127.0.0.1", () => {
    console.log(
      `Laundry platform running on port ${port}. SQLite data: ${app.store.directory}`,
    );
    if (!app.store.all("profiles").length)
      console.log(
        `First run: open /setup/ and use the one-time code in ${app.store.setupPath}.`,
      );
  });
  for (const sig of ["SIGINT", "SIGTERM"])
    process.once(sig, () => app.close().then(() => process.exit(0)));
}
