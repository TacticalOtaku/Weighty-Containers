/**
 * What a Foundry package of this module contains, shared by deploy and package. Entries that do not exist are
 * skipped, so the list is the same for every TacticalOtaku module without a build step.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const PACKAGE_ENTRIES = [
  "module.json",
  "LICENSE",
  "README.md",
  "CHANGELOG.md",
  "API.md",
  "lang",
  "scripts",
  "styles",
  "templates",
  "assets",
];

export function presentEntries() {
  return PACKAGE_ENTRIES.filter((entry) => existsSync(join(root, entry)));
}

export async function readJson(file) {
  return JSON.parse(await readFile(join(root, file), "utf8"));
}
