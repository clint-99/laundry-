// Development static server only. Production hosting is GitHub Pages.
import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
const root = resolve("."),
  types = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".css": "text/css",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".webmanifest": "application/manifest+json",
    ".md": "text/plain",
  };
const allowed = new Set([
  "index.html",
  "book",
  "rider",
  "owner",
  "shared",
  "icons",
  "docs",
  "sw.js",
]);
http
  .createServer(async (req, res) => {
    try {
      const u = new URL(req.url, "http://localhost");
      let path = decodeURIComponent(u.pathname);
      const top = path.split("/").filter(Boolean)[0] || "index.html";
      if (!allowed.has(top)) throw Error();
      let file = resolve(root, "." + path);
      if (!file.startsWith(root + sep) && file !== root) throw Error();
      if ((await stat(file)).isDirectory()) {
        if (!path.endsWith("/")) {
          res.writeHead(301, { Location: path + "/" });
          return res.end();
        }
        file = resolve(file, "index.html");
      }
      const data = await readFile(file);
      res.writeHead(200, {
        "Content-Type": types[extname(file)] || "application/octet-stream",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
      });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
  })
  .listen(Number(process.env.PORT || 3000), "127.0.0.1", () =>
    console.log(
      "Static development server listening on port " +
        (process.env.PORT || 3000),
    ),
  );
