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

  // Derived from the manifest rather than hardcoded, so a version bump is one edit.
  const { version } = manifest;
  assert.match(version, /^\d+\.\d+\.\d+$/);
  assert.equal(pkg.version, version);
  assert.match(
    manifest.download,
    new RegExp(`/v${version.replace(/\./g, "\\.")}/weighty-containers-v${version.replace(/\./g, "\\.")}\\.zip$`)
  );
});

test("manifest is verified for Foundry 14.367", async () => {
  const manifest = await readJson("module.json");
  assert.equal(manifest.compatibility.verified, "14.367");
});
