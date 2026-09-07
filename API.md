# Weighty Containers — Public API

For modules that need container weight, capacity or content rules.

`apiVersion: 2` since **3.5.0**. See [Migrating from apiVersion 1](#migrating-from-apiversion-1)
before upgrading - the numbers changed.

## Getting the API

```js
const api = game.modules.get("weighty-containers")?.api;
if (api?.apiVersion >= 2) {
  // ...
}
```

`globalThis.weightyCont` is the console handle. It carries the same API plus the
`dumpContainer` / `dumpActor` debug helpers, whose shape may change without
notice — don't build on those.

Both are available from the `ready` hook onwards. To be woken up as soon as it
exists:

```js
Hooks.once("weighty-containers.ready", api => { /* ... */ });
```

## Hooks

| Hook | Arguments | Fired when |
| --- | --- | --- |
| `weighty-containers.ready` | `(api)` | The API is installed |
| `weighty-containers.updateContainerRules` | `(containerItem, config)` | A container's rules are saved from the dialog |

## Surface

### `getContainerLoad(actor, containerId)`

The one call most consumers want. Returns everything needed to render a
container's fill state, or `null` if the container is unknown.

```js
{
  loadLbs: 13.23,     // adjusted load, pounds (module-internal unit)
  capacityLbs: 33.07, // capacity, pounds; null when the container declares none
  load: 6,            // same load, in the unit dnd5e is set to display
  capacity: 15,       // same capacity, display unit; null when absent
  unit: "kg",         // "kg" | "lb"
  reductionPct: 50,   // 0..100
  pct: 40,            // load/capacity, clamped 0..100; null without a capacity
  isOver: false,
  hasCapacity: true
}
```

"Adjusted" means the container's weight reduction is applied and nested
containers are walked. Do not recompute this from raw item weights — the two
numbers will drift.

`loadLbs` is always equal to what dnd5e itself puts in
`container.system.contentsWeight` for a container whose `weight.units` is `lb`.
If those two ever disagree, that is a bug in this module.

### Rules

- `getReductionPct(container)` → `0..100`
- `getContainerRestrictions(container)` → `{ allowedTypes, allowedSubtypes, requiredProperties, forbiddenProperties, propertyMatchMode }`, all normalized to lowercase token arrays. Flags are stored as either arrays or delimited strings; this normalizes both.
- `validateContainerRestrictions(container, itemData)` → `{ ok, reason?, restrictions }`. `reason` is one of `"type" | "subtype" | "property" | "forbiddenProperty"`.

Call the validator rather than reimplementing it: it matches against item type,
subtype, base item, identifier, weapon-type aliases and properties.

### Weight

- `getCapacityLbs(container)` → number | `null` — weight capacity
- `getCapacityCount(container)` → number | `null` — item-count capacity, which
  dnd5e prefers over weight when both are set
- `computeAdjustedLoad(actor, containerId)` → `{ load, trace }` in pounds
- `computeActorCarriedLbs(actor)` → number
- `lbsToDisplay(lbs)` → number in the client's display unit
- `getSystemWeightUnit()` → `"kg" | "lb"`

Conversion uses `CONFIG.DND5E.weightUnits`, so a kilogram is **2.5 lb** — dnd5e's
round conversion, not the physical 2.20462. Use `lbsToDisplay` rather than your
own factor or your numbers will not match the sheet.

### Classification and UI

- `isContainer(item)` → boolean
- `isWeightlessContainer(item)` → boolean — carries dnd5e's `weightlessContents`
  property, so nothing inside it counts
- `openRulesDialog(container, { readOnly } = {})` → opens the rules window,
  returns the app. Defaults to read-only for non-GMs.
- `openReductionDialog` — alias kept for callers written before 3.4.0

### Rule presets

The dialog's preset row is an open registry:

```js
api.registerRulePreset({
  id: "my-module.spell-satchel",
  label: "MYMODULE.SpellSatchel",   // localization key or literal
  icon: "fas fa-scroll",
  config: { allowedTypes: ["consumable"], allowedSubtypes: ["scroll"] }
});
```

A preset config is a *partial* rule config: only the keys it names are applied,
so a contents preset leaves the GM's weight reduction alone. Valid keys are
`reductionPct`, `allowedTypes`, `allowedSubtypes`, `requiredProperties`,
`forbiddenProperties` and `propertyMatchMode`.

- `listRulePresets()` → `RulePreset[]`
- `registerRulePreset(preset)` → boolean
- `unregisterRulePreset(id)` → boolean

## Encumbrance

The module does **not** touch `Actor#prepareDerivedData`. It patches exactly one
thing — dnd5e's `ContainerData#contentsWeight` getter — and scales it by the
container's reduction. Everything dnd5e builds on that getter (`totalWeight`,
`totalWeightIn()`, `computeCapacity()`, and the actor's whole encumbrance block)
picks the reduction up on its own, so there is no second implementation to drift.

Read the actor's encumbrance block rather than summing item weights yourself, or
you will silently discard every reduction.

## Skipping enforcement

To move an item without the capacity and content checks — a GM tool, a loot
distributor, a migration — pass the module's own option:

```js
await item.update({ "system.container": bagId }, {
  "weighty-containers": { bypass: true }
});
```

## Migrating from apiVersion 1

Numbers returned by 1.x were wrong in ways that are now fixed, so expect them to
change:

- **Kilograms.** 1.x used 2.20462 lb per kg; dnd5e uses 2.5. Every metric world
  was off by about 13%.
- **Nesting.** A container's reduction now also applies to the contents of its
  sub-containers, and reductions compound. Previously only direct contents were
  reduced.
- **`weightlessContents`.** dnd5e's own weightless flag is now honoured.
- **Currency.** Coins carried in a container now count toward its load.
- **Capacity violations** gained `kind` (`"weight"` or `"count"`) and unit-neutral
  `capacity` / `before` / `after` / `delta` fields. The `*Lbs` fields are still
  there for weight violations and are `null` for count violations.

## Compatibility

Degrade gracefully — the module may be absent or older:

```js
const api = game.modules.get("weighty-containers")?.api;
const load = typeof api?.getContainerLoad === "function"
  ? api.getContainerLoad(actor, containerId)
  : null;
```

Feature-detect each function you use. `apiVersion` is bumped only on a breaking
change; new functions arrive without a bump.
