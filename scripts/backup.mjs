import { DatabaseSync, backup } from "node:sqlite";
import { resolve, join } from "node:path";
import { mkdirSync, chmodSync, existsSync } from "node:fs";
const source = resolve(process.env.DATA_DIR || "data", "platform.sqlite");
if (!existsSync(source))
  throw Error("Start the app first to create its database.");
const destination = resolve(process.argv[2] || "../laundry-backups");
mkdirSync(destination, { recursive: true, mode: 0o700 });
const path = join(
  destination,
  "laundry-" + new Date().toISOString().replace(/[:.]/g, "-") + ".sqlite",
);
const db = new DatabaseSync(source, { readOnly: true });
try {
  await backup(db, path);
  chmodSync(path, 0o600);
  console.log("Complete SQLite backup saved to " + path);
} finally {
  db.close();
}
