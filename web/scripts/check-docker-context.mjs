#!/usr/bin/env node
/**
 * The production image's build context omits what .dockerignore lists (e2e/,
 * scripts/, …), and `next build` type-checks every .ts under the context. A
 * file that ships in the image must therefore never import from a directory
 * that does not — or the image fails to build while every local check passes
 * (which is how scripts/docs-screenshots.spec.ts importing ../e2e/helpers
 * broke the Docker workflow for a day). Run from web/: exits 1 on a violation.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const ignored = readFileSync(path.join(root, ".dockerignore"), "utf8")
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith("#") && l.endsWith("/"))
  .map((l) => l.replace(/\/$/, ""));

const shipped = [];
function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const rel = path.relative(root, full);
    if (ignored.some((d) => rel === d || rel.startsWith(`${d}/`))) continue;
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    if (statSync(full).isDirectory()) walk(full);
    else if (/\.(ts|tsx|mts|js|mjs)$/.test(entry)) shipped.push(full);
  }
}
walk(root);

const problems = [];
for (const file of shipped) {
  const text = readFileSync(file, "utf8");
  for (const m of text.matchAll(/from\s+["']([^"']+)["']|import\(["']([^"']+)["']\)/g)) {
    const spec = m[1] ?? m[2];
    if (!spec.startsWith(".")) continue;
    const target = path.relative(root, path.resolve(path.dirname(file), spec));
    if (ignored.some((d) => target === d || target.startsWith(`${d}/`))) {
      problems.push(`${path.relative(root, file)} imports ${spec} (outside the image: ${target})`);
    }
  }
}
if (problems.length) {
  console.error("Files that ship in the image import files .dockerignore leaves out:\n  " + problems.join("\n  "));
  process.exit(1);
}
console.log(`docker context check: ${shipped.length} shipped source files, no imports into ignored paths`);
