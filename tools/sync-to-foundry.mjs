#!/usr/bin/env node
// Copy the module into the local Foundry data directory.
// Usage: node tools/sync-to-foundry.mjs [--data <FoundryVTT data dir>]

import { cp, mkdir, rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_ID = "weighty-containers";
const CONTENT = ["lang", "scripts", "styles", "templates", "module.json", "LICENSE", "README.md", "API.md"];

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function resolveDataDir() {
  const flagIndex = process.argv.indexOf("--data");
  if (flagIndex !== -1 && process.argv[flagIndex + 1]) return process.argv[flagIndex + 1];
  if (process.env.FOUNDRY_DATA) return process.env.FOUNDRY_DATA;
  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData) return join(localAppData, "FoundryVTT");
  throw new Error("Could not locate the Foundry data directory. Pass --data <path> or set FOUNDRY_DATA.");
}

const target = join(resolveDataDir(), "Data", "modules", MODULE_ID);

try {
  await stat(dirname(target));
} catch {
  throw new Error(`No modules directory at ${dirname(target)} - is that the right Foundry data path?`);
}

await mkdir(target, { recursive: true });

for (const entry of CONTENT) {
  const from = join(root, entry);
  try {
    await stat(from);
  } catch {
    continue;
  }
  await rm(join(target, entry), { recursive: true, force: true });
  await cp(from, join(target, entry), { recursive: true });
}

console.log(`Synced ${MODULE_ID} -> ${target}`);
console.log("Reload Foundry (F5) to pick up the changes.");
