/**
 * Copy the module into the local Foundry Data/modules/<id> folder.
 * Target root: --data <path>, the FOUNDRY_DATA env var, or %LOCALAPPDATA%/FoundryVTT/Data.
 * Reload Foundry (F5) afterwards; a new stylesheet or language in module.json needs a server restart.
 */
import { existsSync } from "node:fs";
import { cp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { presentEntries, readJson, root } from "./package-files.mjs";

const { id } = await readJson("module.json");

function resolveDataRoot() {
  const flagIndex = process.argv.indexOf("--data");
  if (flagIndex !== -1 && process.argv[flagIndex + 1]) return process.argv[flagIndex + 1];
  if (process.env.FOUNDRY_DATA) return process.env.FOUNDRY_DATA;
  return process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "FoundryVTT", "Data") : null;
}

const dataRoot = resolveDataRoot();
if (!dataRoot || !existsSync(join(dataRoot, "modules"))) {
  console.error(`Foundry Data folder not found (${dataRoot}). Pass --data <path> or set FOUNDRY_DATA.`);
  process.exit(1);
}

const target = join(dataRoot, "modules", id);
if (existsSync(target)) {
  const manifest = join(target, "module.json");
  const existing = existsSync(manifest) ? JSON.parse(await readFile(manifest, "utf8")).id : null;
  if (existing !== id) {
    console.error(`Refusing to overwrite ${target}: it is not a ${id} install.`);
    process.exit(1);
  }
  await rm(target, { recursive: true });
}

for (const entry of presentEntries()) {
  await cp(join(root, entry), join(target, entry), { recursive: true });
}
console.log(`Deployed ${id} → ${target}`);
