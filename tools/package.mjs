/**
 * Build a Foundry release: validates module.json, then writes dist/<id>-v<version>.zip with module.json at the
 * archive root, as Foundry expects. Foundry reads the manifest from the repository's main branch, so only the
 * archive is attached to the GitHub release v<version>. Run through `npm run release`, which checks first.
 */
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { presentEntries, readJson, root } from "./package-files.mjs";
import { archiveName, validateManifest } from "./release-manifest.mjs";
import { createZip } from "./zip.mjs";

const pkg = await readJson("package.json");
const manifest = await readJson("module.json");
const problems = validateManifest(manifest, {
  version: pkg.version,
  repository: manifest.url ?? "",
  exists: (file) => existsSync(join(root, file)),
});
if (problems.length) {
  console.error(`module.json is not releasable:\n  - ${problems.join("\n  - ")}`);
  process.exit(1);
}

async function listFiles(path) {
  const entries = await readdir(path, { withFileTypes: true }).catch(() => null);
  if (!entries) return [path];
  const nested = await Promise.all(entries.map((entry) => listFiles(join(path, entry.name))));
  return nested.flat();
}

const files = (await Promise.all(presentEntries().map((entry) => listFiles(join(root, entry)))))
  .flat()
  .map((file) => relative(root, file).split(sep).join("/"))
  .sort();
const zip = createZip(await Promise.all(files.map(async (name) => ({ name, data: await readFile(join(root, name)) }))));

const out = join(root, "dist");
await mkdir(out, { recursive: true });
const target = join(out, archiveName(manifest.id, manifest.version));
// A released archive is a record of what users downloaded: never replace it by accident.
if (existsSync(target) && !process.argv.includes("--force")) {
  console.error(`${target} already exists. Bump the version, or pass --force to replace an unreleased archive.`);
  process.exit(1);
}
await writeFile(target, zip);

console.log(`Packaged ${manifest.id} ${manifest.version}: ${files.length} files, ${(zip.length / 1024).toFixed(1)} KiB`);
console.log(`  ${target}`);
console.log(`Push module.json to main and attach the archive to the GitHub release v${manifest.version}.`);
