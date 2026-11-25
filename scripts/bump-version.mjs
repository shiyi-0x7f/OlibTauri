#!/usr/bin/env node
import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+/.test(version)) {
  console.error("Usage: node scripts/bump-version.mjs <version>");
  console.error("Example: node scripts/bump-version.mjs 3.2.1");
  process.exit(1);
}

const files = [
  {
    path: resolve(root, "package.json"),
    replace: (s) => s.replace(/"version":\s*"[^"]+"/, `"version": "${version}"`),
  },
  {
    path: resolve(root, "src-tauri/tauri.conf.json"),
    replace: (s) => s.replace(/"version":\s*"[^"]+"/, `"version": "${version}"`),
  },
  {
    path: resolve(root, "src-tauri/Cargo.toml"),
    replace: (s) => s.replace(/^version\s*=\s*"[^"]+"/m, `version = "${version}"`),
  },
];

for (const f of files) {
  const content = readFileSync(f.path, "utf-8");
  const updated = f.replace(content);
  if (content === updated) {
    console.warn(`  skip  ${f.path} (no change)`);
  } else {
    writeFileSync(f.path, updated, "utf-8");
    console.log(`  done  ${f.path}`);
  }
}

console.log(`\nVersion bumped to ${version}`);
