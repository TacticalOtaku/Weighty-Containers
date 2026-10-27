# Changelog

## 3.9.0 (unreleased)

### Added
- Item Piles integration (with or without the Item Piles: D&D 5e bridge). Transfers, trades, "take all" and added
  items are checked in Item Piles' own pre-hooks and cancelled whole, before Item Piles removes anything from the
  source. A refusal half-way through would have lost the items. A container taken with its contents is weighed full;
  in warn mode it is warned about and goes through.
- `api.getContainerLoad` returns `count`, `capacityCount` and `kind`.

### Fixed
- In metric worlds coins weighed 2.5 times too little: dnd5e's coin weight is in kilograms there, and the module
  added it as pounds. A container's coins now count in its own weight units, an actor's in the display unit, as on
  the sheet. Capacity checks and `api.computeActorCarriedLbs` were affected.
- `api.getContainerLoad` judged a container with an item-count capacity by weight. `pct`, `isOver` and
  `hasCapacity` now follow the count, as dnd5e does.

### Changed
- Toggling "Include nested containers" no longer re-prepares every actor and token: encumbrance does not depend on
  it. Open container sheets are still redrawn.
- Pre-dnd5e 3.0 data shapes (`capacity.value`, a bare-number capacity or weight, object-shaped properties) are no
  longer read; dnd5e 5.3.3 migrates them on load.

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
