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
`dumpContainer` / `dumpActor` / `dumpLog` debug helpers, whose shape may change without
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
  count: 12,          // items inside, sub-container contents included (dnd5e's contentsCount)
  capacityCount: null,// item-count capacity; null when the container declares none
  kind: "weight",     // the limit dnd5e applies: "count" | "weight" | null
  pct: 40,            // load/capacity, clamped 0..100; null without a capacity
  isOver: false,
  hasCapacity: true
}
```

`pct`, `isOver` and `hasCapacity` follow `kind`. dnd5e measures a container by
its item count when it declares one and ignores its weight capacity, so a quiver
for 20 arrows holding 25 is over even though `load` is far below `capacity`.
Before 3.9.0 these three fields always followed weight.

"Adjusted" means the container's weight reduction is applied and nested
containers are walked. Do not recompute this from raw item weights — the two
numbers will drift.

For a container with dnd5e's `weightlessContents` (a Bag of Holding) the load
is still what is inside it - that is what its capacity is measured against, and
what dnd5e's own capacity bar shows. The property only stops the contents from
counting toward whatever holds the container.

`loadLbs` is always equal to what dnd5e itself puts in
`container.system.contentsWeight` for a container whose `weight.units` is `lb`.
If those two ever disagree, that is a bug in this module.

### Rules

- `getReductionPct(container)` → `0..100`
- `getContainerRestrictions(container)` → `{ allowedTypes, allowedSubtypes, requiredProperties, forbiddenProperties, propertyMatchMode }`, all normalized to lowercase token arrays. Flags are stored as either arrays or delimited strings; this normalizes both.
- `validateContainerRestrictions(container, itemData)` → `{ ok, reason?, restrictions }`. `reason` is one of `"type" | "subtype" | "property" | "forbiddenProperty"`.

Call the validator rather than reimplementing it: it matches subtype rules
against item type, subtype (including consumable subtypes such as `arrow`),
base item, identifier and weapon-type aliases. Properties are matched only by
the required/forbidden property rules; since 3.6.0 they no longer satisfy a
subtype rule.

### Weight

- `getCapacityLbs(container)` → number | `null` — weight capacity
- `getCapacityCount(container)` → number | `null` — item-count capacity, which
  dnd5e prefers over weight when both are set
- `computeAdjustedLoad(actor, containerId)` → `{ load, trace }` in pounds. With
  the `includeNested` setting off, sub-containers count by their own weight only,
  as in the capacity check.
- `computeActorCarriedLbs(actor)` → number — the actor's carried weight. It
  always counts nested contents, matching the sheet's encumbrance; since 3.8.0
  the `includeNested` setting no longer lowers it.
- `getCarriedShare(actor, item)` → number from 0 to 1 — how much of the item's
  own total weight its actor carries, counted as `computeActorCarriedLbs`
  counts it. Multiply the item's weight by it. 1 outside any container; each
  container's reduction compounds up the chain (a 50% pouch in a 50% bag gives
  0.25); 0 inside a `weightlessContents` container anywhere up the chain, on a
  vehicle mount that does not count toward encumbrance, and when the chain is
  broken (a missing container or a cycle). Like `computeActorCarriedLbs`, it
  ignores the `includeNested` setting. Absent in 3.9.0 and earlier, so feature-detect
  it.
- `lbsToDisplay(lbs)` → number in the client's display unit
- `getSystemWeightUnit()` → `"kg" | "lb"`

Conversion uses `CONFIG.DND5E.weightUnits`, so a kilogram is **2.5 lb** — dnd5e's
round conversion, not the physical 2.20462. Use `lbsToDisplay` rather than your
own factor or your numbers will not match the sheet.

Coins count as dnd5e counts them: an actor's coins in the display unit, a
container's coins in the container's own `weight.units`. Before 3.9.0 both were
taken as pounds, so metric worlds weighed coins at 1/2.5 of their weight.

### Classification and UI

- `isContainer(item)` → boolean
- `isWeightlessContainer(item)` → boolean — carries dnd5e's `weightlessContents`
  property, so nothing inside it counts toward whatever holds it (its own
  capacity still does)
- `openRulesDialog(container, { readOnly } = {})` → opens the rules window,
  returns the app. Defaults to read-only for non-GMs.
- `openReductionDialog` — alias kept for callers written before 3.4.0

### Rule presets

The dialog's preset row is an open registry:

```js
api.registerRulePreset({
  id: "my-module.spell-satchel",
  label: "MYMODULE.SpellSatchel",   // localization key or literal
  icon: "fa-solid fa-scroll",
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

The rules dialog saves this way itself: a GM lowering a full bag's reduction is
changing a rule, not stuffing an item in, and is never blocked by it.

### Item Piles

When [Item Piles](https://foundryvtt.com/packages/item-piles) is active (with or
without its D&D 5e bridge), its transfers, trades, "take all" and added items
are checked in its own pre-hooks (`item-piles-preTransferItems`,
`-preTransferAllItems`, `-preTransferEverything`, `-preTradeItems`,
`-preAddItems`). Item Piles removes items from the source before it creates
them on the target, so a refusal there cancels the whole operation before
anything moves, instead of losing the items half-way. A container taken with
its contents is weighed full. In warn mode the operation runs and the warning
is shown. Item Piles runs these operations on a GM
client, so the receiving actor's active owners are notified as the acting user.
Item Piles operations carry no bypass option; to skip the check, move the items
yourself with the option above.

Updates that cannot move weight or break a content rule - charges, equipped
state, names, descriptions - are not checked at all. Only changes to `type`,
`system.container`, `quantity`, `weight`, `capacity`, `currency`,
`properties`, `system.type` or the module's flags are.

## Behaviour changes in 3.9.0

Fixes, so `apiVersion` stays at 2:

- **Coins in metric worlds** weigh what dnd5e says (see [Weight](#weight)), so
  loads and `computeActorCarriedLbs` rise where coins are carried.
- **`getContainerLoad`** gained `count`, `capacityCount` and `kind`; `pct`,
  `isOver` and `hasCapacity` follow an item-count capacity when one is set.
- **`getCapacityLbs`** reads only dnd5e's `capacity.weight`. The pre-3.0
  `capacity.value` and bare-number shapes, and object-shaped item properties,
  are no longer read; dnd5e 5.3.3 migrates them away on load.

## Behaviour changes in 3.6.0

These are fixes, so `apiVersion` stays at 2, but numbers and outcomes can change:

- **Bag of Holding.** `computeAdjustedLoad` / `getContainerLoad` for a
  `weightlessContents` container return what is inside it instead of `0`, and
  its capacity is enforced.
- **Subtype rules** no longer accept a property key as a subtype.
- **Containers created with their contents** (dnd5e's `createWithContents`)
  are weighed full, so an over-full container can no longer be dropped into a
  bag that has no room for it.

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
