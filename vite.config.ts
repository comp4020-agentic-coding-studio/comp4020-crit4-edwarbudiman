import { readdirSync } from "node:fs";
import { join } from "node:path";
import { defineConfig } from "vitest/config";

// Every .html file in the repo is a page and a build entry, so a multi-page
// hand-written site needs no build config: add pages, link them, ship.
// (Vite's default would build only the root index.html and silently drop the
// rest from dist/ — fine locally, 404s deployed.)
// `reference` is here because .gitignore does not stop Vite: any .html under a
// cloned reference repo would become a build entry, get its imports resolved,
// and end up deployed inside our own dist/. Ignoring a directory for git and
// ignoring it for the build are two separate jobs.
const SKIP = new Set([
  "node_modules",
  "dist",
  "spec",
  "scripts",
  "reflections",
  "reference",
]);

function htmlEntries(dir = "."): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith(".") || SKIP.has(entry.name)) return [];
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return htmlEntries(path);
    return entry.name.endsWith(".html") ? [path] : [];
  });
}

// `base: "./"` makes built asset URLs relative, so the site works under any
// GitHub Pages path (username.github.io/your-repo/) without further config.
export default defineConfig({
  base: "./",
  build: {
    rollupOptions: {
      input: htmlEntries(),
    },
  },
  test: {
    // Same reason as SKIP above, for the same directory: a cloned reference
    // repo brings its own *.test.ts, and those test its code, not ours.
    exclude: ["**/node_modules/**", "**/dist/**", "reference/**"],
  },
});
