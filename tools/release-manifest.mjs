/**
 * Release rules for module.json, shared by the packaging script and its tests. They follow the other TacticalOtaku
 * modules: Foundry reads the manifest from the main branch; the download URL points at this version's release asset.
 */
export function releaseUrls(repository, id, version) {
  const base = repository.replace(/\/+$/, "");
  const raw = base.replace(/^https:\/\/github\.com\//, "https://raw.githubusercontent.com/");
  return {
    url: base,
    manifest: `${raw}/main/module.json`,
    download: `${base}/releases/download/v${version}/${archiveName(id, version)}`,
  };
}

export function archiveName(id, version) {
  return `${id}-v${version}.zip`;
}

/**
 * Problems that would make the package uninstallable or inconsistent. `exists(path)` checks files inside the build.
 * @returns {string[]}
 */
export function validateManifest(manifest, { version, repository, exists }) {
  const problems = [];
  const expect = (condition, message) => condition || problems.push(message);
  expect(/^[a-z0-9-]+$/.test(manifest.id ?? ""), "id must be a lowercase package id");
  expect(manifest.version === version, `version ${manifest.version} differs from package.json ${version}`);
  expect(/^\d+\.\d+\.\d+$/.test(manifest.version ?? ""), "version must be semantic (x.y.z)");
  expect(Boolean(manifest.title), "title is required");
  expect(Boolean(manifest.compatibility?.minimum), "compatibility.minimum is required");
  expect(Boolean(manifest.compatibility?.verified), "compatibility.verified is required");
  expect(Boolean(manifest.compatibility?.maximum), "compatibility.maximum is required until the next core version is tested");

  const urls = releaseUrls(repository, manifest.id ?? "", version);
  for (const key of ["url", "manifest", "download"]) {
    expect(manifest[key] === urls[key], `${key} must be ${urls[key]}`);
  }

  const files = [
    ...(manifest.esmodules ?? []),
    ...(manifest.scripts ?? []),
    ...(manifest.styles ?? []),
    ...(manifest.languages ?? []).map((language) => language.path),
  ];
  expect((manifest.esmodules ?? []).length > 0, "esmodules must list the module entry");
  for (const file of files) expect(exists(file), `listed file is missing from the build: ${file}`);
  return problems;
}
