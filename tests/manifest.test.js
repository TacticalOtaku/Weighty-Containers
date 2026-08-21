import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const readJson = async relativePath => JSON.parse(
  await readFile(new URL(`../${relativePath}`, import.meta.url), "utf8")
);

test("package metadata uses one module version", async () => {
  const [manifest, pkg] = await Promise.all([
    readJson("module.json"),
    readJson("package.json")
  ]);

  assert.equal(manifest.version, "3.3.5");
  assert.equal(pkg.version, manifest.version);
  assert.match(manifest.download, /\/v3\.3\.5\/weighty-containers-v3\.3\.5\.zip$/);
});

test("manifest is verified for Foundry 14.367", async () => {
  const manifest = await readJson("module.json");
  assert.equal(manifest.compatibility.verified, "14.367");
});
