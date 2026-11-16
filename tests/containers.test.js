import test from "node:test";
import assert from "node:assert/strict";

import {
  ItemCollectionView,
  collectContainerAncestorIds,
  computeActorCarriedLbs,
  computeAdjustedLoad,
  computeContainerLoadFromContents,
  createProjectedActor,
  evaluateContainerChanges,
  findCapacityViolations,
  getCarriedShare,
  isRelevantExpandedChange
} from "../scripts/core/containers.js";

const item = ({
  id,
  type = "loot",
  container = null,
  weight = 0,
  units = "lb",
  quantity = 1,
  capacity = null,
  reduction = 0,
  properties = []
}) => ({
  id,
  name: id,
  type,
  system: {
    container,
    weight: { value: weight, units },
    quantity,
    properties,
    ...(capacity == null
      ? {}
      : { capacity: { weight: { value: capacity, units: "lb" } } })
  },
  flags: { "weighty-containers": { reductionPct: reduction } }
});

const actor = items => ({ items: new ItemCollectionView(items) });

test("reductions compound through nested containers", () => {
  const top = item({ id: "top", type: "container", weight: 1, reduction: 50 });
  const nested = item({
    id: "nested",
    type: "container",
    container: "top",
    weight: 2,
    reduction: 25
  });
  const direct = item({ id: "direct", container: "top", weight: 4, quantity: 2 });
  const inner = item({ id: "inner", container: "nested", weight: 4 });
  const subject = actor([top, nested, direct, inner]);

  // nested contents 4 * 0.75 = 3; top contents (2 + 3 + 8) * 0.5 = 6.5
  assert.equal(computeAdjustedLoad(subject, "top").load, 6.5);
  assert.equal(computeActorCarriedLbs(subject), 7.5);
});

test("computeContainerLoadFromContents shares load math for standalone containers", () => {
  const bag = item({ id: "bag", type: "container", weight: 1, reduction: 50 });
  const sub = item({ id: "sub", type: "container", weight: 2, reduction: 25 });
  const inner = item({ id: "inner", weight: 4 });
  sub.system.contents = [inner];
  const direct = item({ id: "direct", weight: 4, quantity: 2 });

  const nestedResult = computeContainerLoadFromContents(bag, [sub, direct], { includeNested: true });
  assert.equal(nestedResult.rawLbs, 13);
  assert.equal(nestedResult.load, 6.5);

  const directResult = computeContainerLoadFromContents(bag, [sub, direct], { includeNested: false });
  assert.equal(directResult.rawLbs, 10);
  assert.equal(directResult.load, 5);
});

test("collectContainerAncestorIds returns nearest-to-root order", () => {
  const top = item({ id: "top", type: "container" });
  const nested = item({ id: "nested", type: "container", container: "top" });
  assert.deepEqual(
    collectContainerAncestorIds(actor([top, nested]), "nested"),
    ["nested", "top"]
  );
});

test("adding to a nested container detects an overflowing outer ancestor", () => {
  const outer = item({ id: "outer", type: "container", capacity: 5 });
  const inner = item({
    id: "inner",
    type: "container",
    container: "outer",
    capacity: 20
  });
  const current = actor([outer, inner]);
  const projected = createProjectedActor(
    current,
    item({ id: "payload", container: "inner", weight: 8 })
  );

  const violations = findCapacityViolations(current, projected);
  assert.deepEqual(violations.map(entry => entry.container.id), ["outer"]);
});

test("changing only weight units is reflected in projected capacity checks", () => {
  const bag = item({ id: "bag", type: "container", capacity: 2 });
  const payload = item({ id: "payload", container: "bag", weight: 1, units: "lb" });
  const current = actor([bag, payload]);
  const projected = createProjectedActor(
    current,
    item({ id: "payload", container: "bag", weight: 1, units: "kg" })
  );

  const violations = findCapacityViolations(current, projected);
  assert.equal(violations[0].container.id, "bag");
  assert.equal(violations[0].afterLbs, 2.5);
});

test("moving between sibling containers does not double-count common ancestors", () => {
  const outer = item({ id: "outer", type: "container", capacity: 7 });
  const left = item({ id: "left", type: "container", container: "outer", capacity: 20 });
  const right = item({ id: "right", type: "container", container: "outer", capacity: 20 });
  const payload = item({ id: "payload", container: "left", weight: 8 });
  const current = actor([outer, left, right, payload]);
  const projected = createProjectedActor(
    current,
    item({ id: "payload", container: "right", weight: 8 })
  );

  assert.deepEqual(findCapacityViolations(current, projected), []);
});

test("reducing capacity below an unchanged load creates a violation", () => {
  const bag = item({ id: "bag", type: "container", capacity: 10 });
  const payload = item({ id: "payload", container: "bag", weight: 8 });
  const current = actor([bag, payload]);
  const projected = createProjectedActor(
    current,
    item({ id: "bag", type: "container", capacity: 5 })
  );

  const violations = findCapacityViolations(current, projected);
  assert.equal(violations[0].container.id, "bag");
  assert.equal(violations[0].deltaLbs, 0);
});

test("cycles are broken deterministically", () => {
  const first = item({ id: "first", type: "container", container: "second" });
  const second = item({ id: "second", type: "container", container: "first" });
  const cycles = [];
  const result = computeAdjustedLoad(actor([first, second]), "first", {
    onCycle: id => cycles.push(id)
  });
  assert.equal(Number.isFinite(result.load), true);
  assert.deepEqual(cycles, ["first"]);
});

test("setting a first capacity below the current load is judged like lowering one", () => {
  const bag = item({ id: "bag", type: "container" });
  const payload = item({ id: "payload", container: "bag", weight: 8 });
  const current = actor([bag, payload]);
  const projected = createProjectedActor(
    current,
    item({ id: "bag", type: "container", capacity: 5 })
  );

  assert.deepEqual(findCapacityViolations(current, projected).map(entry => entry.container.id), ["bag"]);
});

test("an unchanged over-full container does not block unrelated edits", () => {
  const bag = item({ id: "bag", type: "container", capacity: 5 });
  const payload = item({ id: "payload", container: "bag", weight: 8 });
  const current = actor([bag, payload]);
  const projected = createProjectedActor(current, item({ id: "payload", container: "bag", weight: 8 }));

  assert.deepEqual(findCapacityViolations(current, projected), []);
});

test("evaluateContainerChanges ranks nearest-to-root violations and checks entry transitions", () => {
  const outer = item({ id: "outer", type: "container", capacity: 10 });
  const inner = item({ id: "inner", type: "container", container: "outer", capacity: 5 });
  inner.flags["weighty-containers"].allowedTypes = ["consumable"];
  const sword = item({ id: "sword", type: "weapon", weight: 12 });
  const current = actor([outer, inner, sword]);

  const blocked = evaluateContainerChanges(
    current,
    [item({ id: "sword", type: "weapon", container: "inner", weight: 12 })],
    { stopOnRestriction: true }
  );
  assert.equal(blocked.ok, false);
  assert.equal(blocked.restrictionFailures.length, 1);
  assert.equal(blocked.capacityViolation, null);

  const warned = evaluateContainerChanges(
    current,
    [item({ id: "sword", type: "weapon", container: "inner", weight: 12 })]
  );
  assert.equal(warned.ok, false);
  assert.equal(warned.restrictionFailures.length, 1);
  assert.equal(warned.capacityViolation.container.id, "inner");
});

test("isRelevantExpandedChange ignores unrelated edits and recognizes Foundry deletions", () => {
  assert.equal(isRelevantExpandedChange({ name: "Bag", system: { equipped: true } }), false);
  assert.equal(isRelevantExpandedChange({ system: { weight: { value: 2 } } }), true);
  assert.equal(isRelevantExpandedChange({ system: { "-=container": null } }), true);
  assert.equal(isRelevantExpandedChange({ flags: { "-=weighty-containers": null } }), true);
});

// Each case: the share times the item's weight must be exactly what the item
// adds to computeActorCarriedLbs.
function assertCarriedShare(items, itemId, expected, options = {}) {
  const subject = actor(items);
  const target = subject.items.get(itemId);
  const share = getCarriedShare(subject, target, options);
  assert.equal(share, expected);
  const without = actor(items.filter(entry => entry.id !== itemId));
  const added = computeActorCarriedLbs(subject, options) - computeActorCarriedLbs(without, options);
  const ownLbs = target.system.weight.value * target.system.quantity;
  assert.ok(Math.abs(share * ownLbs - added) < 1e-5, `${itemId}: ${share} * ${ownLbs} vs ${added}`);
}

test("getCarriedShare matches the actor's load", () => {
  const coin = { container: null, weight: 4, quantity: 2 };
  const bag = item({ id: "bag", type: "container", weight: 1 });
  const half = item({ id: "half", type: "container", weight: 1, reduction: 50 });
  const inner = item({ id: "inner", type: "container", container: "half", weight: 1, reduction: 50 });
  const holding = item({ id: "holding", type: "container", weight: 1, properties: ["weightlessContents"] });
  const pouch = item({ id: "pouch", type: "container", container: "holding", weight: 1 });
  const containers = [bag, half, inner, holding, pouch];
  const withItem = (id, container) => [...containers, item({ id, ...coin, container })];

  assertCarriedShare(withItem("loose", null), "loose", 1);
  assertCarriedShare(withItem("inBag", "bag"), "inBag", 1);
  assertCarriedShare(withItem("inHalf", "half"), "inHalf", 0.5);
  assertCarriedShare(withItem("inInner", "inner"), "inInner", 0.25);
  assertCarriedShare(withItem("inHolding", "holding"), "inHolding", 0);
  assertCarriedShare(withItem("inPouch", "pouch"), "inPouch", 0);
  assertCarriedShare(containers, "inner", 0.5);
  assertCarriedShare(withItem("missing", "nowhere"), "missing", 0);
});

test("getCarriedShare drops sub-container contents with includeNested off", () => {
  const half = item({ id: "half", type: "container", weight: 1, reduction: 50 });
  const inner = item({ id: "inner", type: "container", container: "half", weight: 1 });
  const direct = item({ id: "direct", container: "half", weight: 2 });
  const deep = item({ id: "deep", container: "inner", weight: 2 });
  const items = [half, inner, direct, deep];

  assertCarriedShare(items, "direct", 0.5, { includeNested: false });
  assertCarriedShare(items, "deep", 0, { includeNested: false });
  assertCarriedShare(items, "deep", 0.5);
});

test("getCarriedShare survives cycles and bad input", () => {
  const a = item({ id: "a", type: "container", container: "b", weight: 1 });
  const b = item({ id: "b", type: "container", container: "a", weight: 1 });
  const stuck = item({ id: "stuck", container: "a", weight: 3 });
  const self = item({ id: "self", type: "container", container: "self", weight: 1 });

  assertCarriedShare([a, b, stuck], "stuck", 0);
  assertCarriedShare([self], "self", 0);
  assert.equal(getCarriedShare(actor([]), null), 0);
  assert.equal(getCarriedShare(null, item({ id: "x", container: "bag" })), 0);
});

test("getCarriedShare honours the encumbrance filter on the outermost item", () => {
  const mount = item({ id: "mount", type: "container", weight: 1 });
  mount.system.isMountable = true;
  const cargo = item({ id: "cargo", container: "mount", weight: 5 });
  const validateItem = entry => !entry.system.isMountable;
  assertCarriedShare([mount, cargo], "cargo", 0, { validateItem });
  assertCarriedShare([mount, cargo], "cargo", 1);
});
