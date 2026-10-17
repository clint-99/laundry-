import { build } from "esbuild";
import {
  writeFileSync,
  copyFileSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
const output = "shared/vendor/supabase-js-2.118.0.js";
const result = await build({
  stdin: {
    contents: "export {createClient} from '@supabase/supabase-js';",
    resolveDir: process.cwd(),
  },
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
  outfile: output,
  legalComments: "eof",
  metafile: true,
});
copyFileSync(
  "node_modules/@supabase/supabase-js/LICENSE",
  "shared/vendor/SUPABASE-LICENSE",
);
const packages = new Set(
  Object.keys(result.metafile.inputs)
    .filter((p) => p.startsWith("node_modules/"))
    .map((p) => {
      const parts = p.split("/");
      return parts.slice(0, parts[1].startsWith("@") ? 3 : 2).join("/");
    }),
);
let notices = "Third-party packages included in the vendored browser bundle.\n";
for (const folder of [...packages].sort()) {
  const pkg = JSON.parse(readFileSync(join(folder, "package.json"), "utf8"));
  notices += `\n${"=".repeat(72)}\n${pkg.name} ${pkg.version} — ${pkg.license || "See license below"}\n`;
  const files = readdirSync(folder).filter((f) =>
    /^licen[sc]e(?:\.|$)/i.test(f),
  );
  if (!files.length) throw Error(`License file missing: ${pkg.name}`);
  for (const file of files)
    notices += "\n" + readFileSync(join(folder, file), "utf8") + "\n";
}
writeFileSync("shared/vendor/THIRD_PARTY_LICENSES.txt", notices);
const hash = createHash("sha256").update(readFileSync(output)).digest("hex");
writeFileSync(
  "shared/vendor/README.md",
  `Supabase JS 2.118.0 and locked transitive dependencies, bundled locally with esbuild 0.25.12.\n\nReproduce with npm ci && npm run vendor. package-lock.json records registry integrity hashes and exact dependencies. No CDN scripts are imported at runtime. See THIRD_PARTY_LICENSES.txt for included packages and licenses.\n\nBundle SHA-256: ${hash}\n`,
);
