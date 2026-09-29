# Changelog

## 3.7.0

### Changed
- The manifest caps compatibility at Foundry 14 until the next core generation is tested.
- socketlib is listed under `relationships.recommends`, so Foundry shows it as a recommended module. The previous
  `optional` key is not part of Foundry's manifest schema and was dropped silently.
- Localisation keys are nested under `WC` in `lang/*.json` (they were flat `weighty-containers.*` keys). Translations
  maintained outside this repository need the same move.

### Development
- ESLint and Prettier; `npm run check`, `deploy`, `package` and `release` as in the other TacticalOtaku modules.
  `npm run deploy` replaces `npm run sync`; `FOUNDRY_DATA` now names the Foundry `Data` folder.
- `npm run release` validates `module.json` and writes `dist/weighty-containers-v<version>.zip`; it never replaces an
  existing archive.
- Font Awesome classes use the current `fa-solid` names.
- Architecture notes in `docs/architecture.md`, project rules in `CLAUDE.md`.

## 3.6.0 and earlier

This file starts after 3.6.0. Earlier versions are listed on the
[GitHub releases page](https://github.com/TacticalOtaku/Weighty-Containers/releases).
