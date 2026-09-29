# Weighty Containers architecture

A map of the code for anyone extending it. Supported platform: Foundry VTT 14.367, dnd5e 5.3.3; socketlib optional.
The public API is documented in [`API.md`](../API.md), the window design system in [`DESIGN.md`](../DESIGN.md).

## Layers

```text
scripts/
  main.js            composition root: settings, the ContainerData patch, socket, hooks, public API
  constants.js       MODULE_ID, I18N (localisation root "WC"), log levels
  core/              pure logic — no game/ui/Hooks access, unit tested in plain Node
    weight.js          own weight, capacity and unit conversion
    containers.js      adjusted load of a container and an actor's carried weight (cycles detected)
    restrictions.js    content rules: types, subtypes, required and forbidden properties
    units.js
  integrations/
    dnd5e.js         weight units, weapon types, currency weight, encumbrance item filter
  foundry/           everything that touches the Foundry runtime
    runtime.js         settings, dnd5e unit table, the ContainerData patch
    enforcement.js     preCreateItem / preUpdateItem rules and notifications
    socket.js          socketlib facade with a native-socket fallback
    api.js             the public API object and its hooks
    logger.js, debug.js
  ui/                the container rules window (ApplicationV2) and its state, tabs, presets, multiselect
```

The dependency direction is one-way: `ui` → `foundry` / `integrations` → `core`. Core functions receive what they
need from the runtime as arguments (`computeAdjustedLoadCore(actor, id, { defaultUnit, currencyLbs, onCycle })`).

## How the reduction reaches dnd5e

`foundry/runtime.js` patches dnd5e's `ContainerData#contentsWeight` getter at `setup` and scales it by the
container's reduction. dnd5e builds `totalWeight` and the actor's encumbrance on that getter, so the capacity bar,
inventory rows and the encumbrance track all show the reduction from one patch, with no second implementation. If the
patch cannot be installed at `setup` it is retried at `ready`, followed by one re-preparation of the actors.

Weights use dnd5e's own unit table (`CONFIG.DND5E.weightUnits`, where a kilogram is 2.5 lb). Actor Inventory Manager
relies on the same table; any other factor makes the two modules disagree.

## Enforcement

`preCreateItem` and `preUpdateItem` project the change and check capacity and content rules. Updates that touch no
weight- or rule-relevant path skip the projection. The `enforceMode` world setting decides between blocking and
warning. Other modules and macros can bypass a check with the operation option `{ "weighty-containers": { bypass: true } }`.

Rejections are shown to the users chosen by the `notifyScope` setting through the socket. The socket facade has no
"run as GM" method: no client can ask a GM to write documents on its behalf.

## Public API

`game.modules.get("weighty-containers").api` (API version 2) is the supported handle; `globalThis.weightyCont` remains
as a console handle. Hooks: `weighty-containers.ready` (api) and `weighty-containers.updateContainerRules`
(item, config). Container rules are stored as item flags `flags.weighty-containers.*`.

## Localisation

`lang/en.json` and `lang/ru.json`, nested under `WC`. Code builds keys from the `I18N` constant; hook names and flags
keep the module id.

## Checks

`npm run check` runs ESLint and the `node --test` suite. `tools/preview-ui.mjs` renders the real templates in both
themes for visual review (needs Foundry, Playwright and Edge); `tests/manual/foundry-v14-smoke.md` is the in-world
scenario.
