import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Store } from "../server/store.js";

test("old SQLite customer records survive the optional-email migration and a second startup", () => {
  const dir = mkdtempSync(join(tmpdir(), "laundry-migration-"));
  let store;
  try {
    const old = new DatabaseSync(join(dir, "platform.sqlite"));
    old.exec(
      readFileSync(
        new URL("../server/schema.sql", import.meta.url),
        "utf8",
      ).replace("email TEXT NOT NULL DEFAULT '',", ""),
    );
    old
      .prepare(
        "INSERT INTO customers(id,bag_code,full_name,phone,area,address,booking_token,created_at) VALUES(?,?,?,?,?,?,?,?)",
      )
      .run(
        "existing",
        "CU-0042",
        "Existing Customer",
        "+639171234567",
        "Makati",
        "Existing address",
        "a".repeat(48),
        new Date().toISOString(),
      );
    old.close();
    store = new Store(dir);
    assert.equal(
      store.one("customers", "existing").address,
      "Existing address",
    );
    assert.equal(store.one("customers", "existing").email, "");
    store.db
      .prepare("UPDATE customers SET email=? WHERE id=?")
      .run("saved@example.com", "existing");
    store.db.close();
    store = new Store(dir);
    assert.equal(store.one("customers", "existing").email, "saved@example.com");
    assert.equal(store.one("customers", "existing").bag_code, "CU-0042");
  } finally {
    store?.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
