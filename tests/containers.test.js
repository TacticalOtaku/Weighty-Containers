import test from "node:test";
import assert from "node:assert/strict";

import {
  ItemCollectionView,
  collectContainerAncestorIds,
  computeActorCarriedLbs,
  computeAdjustedLoad,
  createProjectedActor,
  findCapacityViolations
} from "../scripts/core/containers.js";

const item = ({
  id,
  type = "loot",
  container = null,
  weight = 0,
  units = "lb",
  quantity = 1,
  capacity = null,
  reduction = 0
}) => ({
  id,
  name: id,
  type,
  system: {
    container,
    weight: { value: weight, units },
    quantity,
    ...(capacity == null
      ? {}
      : { capacity: { weight: { value: capacity, units: "lb" } } })
  },
  flags: { "weighty-containers": { reductionPct: reduction } }
});

const actor = items => ({ items: new ItemCollectionView(items) });

test("computeAdjustedLoad applies each container's reduction to direct contents", () => {
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

  assert.equal(computeAdjustedLoad(subject, "top").load, 8);
  assert.equal(computeActorCarriedLbs(subject), 9);
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
  assert.equal(violations[0].afterLbs, 2.20462);
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
