# Changelog

## 3.8.0

### Fixed
- `api.computeActorCarriedLbs` ignored nested contents when "Include nested containers" was off, so it could report
  less than the sheet's encumbrance. The setting is documented to leave carried weight alone; now it does.
- Giving a container its first capacity below what it already holds is judged like lowering an existing capacity.
  Before, lowering 10 → 5 was blocked while setting none → 5 went through.
- Rejection notices no longer show text taken from the socket. Each client rebuilds the message from checked fields
  with the world's own wording, so a forged socket message cannot impersonate the module. Clients on 3.7.0 and 3.8.0
  do not understand each other's notices; update every client together.

### Changed
- Removed the attempt to weigh a container together with the contents dropped with it: Foundry never passes the rest
  of the batch to `preCreateItem`, so it never ran. The limit is documented in `docs/architecture.md`.
- `weightyCont.dumpLog()` prints the in-memory log buffer, which the log settings fill but nothing could read.
- Rule label catalogs are built once per rejection message instead of once per rule.

### Development
- Tests for the rule preset registry, the option-list controller and socket payload validation.
- `tools/check-multiselect.mjs` explains its arguments instead of crashing; both browser tools are described in
  `docs/architecture.md`.
- Dead code removed: `displayToLbs`, `WCSocket#executeForEveryone`, `ItemCollectionView#find`, `WCLogger#keepBuffer`.

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
