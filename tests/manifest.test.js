import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const readJson = async (path) => JSON.parse(await readFile(new URL(path, root), "utf8"));

/** The keys Foundry's PackageRelationships schema keeps; anything else is dropped without a warning. */
const RELATIONSHIP_KEYS = ["systems", "requires", "recommends", "conflicts", "flags"];

test("package.json and module.json carry one version", async () => {
  const [manifest, pkg] = await Promise.all([readJson("module.json"), readJson("package.json")]);
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.equal(pkg.version, manifest.version);
});

test("compatibility is bounded to the verified core generation", async () => {
  const { compatibility } = await readJson("module.json");
  assert.ok(compatibility.minimum, "compatibility.minimum");
  assert.ok(compatibility.verified, "compatibility.verified");
  assert.equal(compatibility.maximum, String(compatibility.verified).split(".")[0]);
});

test("relationships use only keys Foundry understands", async () => {
  const { relationships = {} } = await readJson("module.json");
  for (const key of Object.keys(relationships)) assert.ok(RELATIONSHIP_KEYS.includes(key), `relationships.${key}`);
});

test("every listed file exists and both languages ship", async () => {
  const manifest = await readJson("module.json");
  const files = [...manifest.esmodules, ...(manifest.styles ?? []), ...manifest.languages.map((language) => language.path)];
  for (const file of files) assert.ok(existsSync(new URL(file, root)), file);
  assert.deepEqual(manifest.languages.map((language) => language.lang).sort(), ["en", "ru"]);
  assert.ok(manifest.languages.every((language) => language.path.startsWith("lang/")), "languages live in lang/");
});

test("the download URL points at this version's release archive", async () => {
  const { version, download } = await readJson("module.json");
  const escaped = version.replace(/\./g, "\\.");
  assert.match(download, new RegExp(`/v${escaped}/weighty-containers-v${escaped}\\.zip$`));
});

test("manifest is verified for Foundry 14.367", async () => {
  const manifest = await readJson("module.json");
  assert.equal(manifest.compatibility.verified, "14.367");
});
