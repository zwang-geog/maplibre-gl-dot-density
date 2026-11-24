import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** tsc leaves `.ts` in import specifiers; npm types need `.js`. */
async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(path);
      continue;
    }
    if (!entry.name.endsWith(".d.ts")) continue;
    const before = await readFile(path, "utf8");
    const after = before.replaceAll(/from ("|\')(\.[^"']+)\.ts\1/g, "from $1$2.js$1");
    if (after !== before) await writeFile(path, after);
  }
}

await walk("dist");
