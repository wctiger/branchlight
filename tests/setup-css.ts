import { mock } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Bun's test runner does not compile CSS Modules. Give DOM tests scoped class
// exports; Vite's actual CSS compilation and cascade are verified in the browser.
const sourceRoot = fileURLToPath(new URL("../src/", import.meta.url));
for (const path of new Bun.Glob("**/*.module.css").scanSync({
  cwd: sourceRoot,
  absolute: true,
})) {
  const source = readFileSync(path, "utf8");
  const prefix = path.slice(sourceRoot.length).replace(/\W/g, "_");
  const classes = Object.fromEntries(
    [...source.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((match) => [
      match[1],
      `${prefix}_${match[1]}`,
    ]),
  );
  mock.module(path, () => ({ default: classes }));
}
