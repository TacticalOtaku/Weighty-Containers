// Regressions for the ways the module used to disagree with dnd5e's own
// numbers. Each case here shipped wrong in 3.4.0.

import test from "node:test";
import assert from "node:assert/strict";

import {
  ItemCollectionView,
  computeActorCarriedLbs,
  computeAdjustedLoad,
  computeContentsCount,
  createProjectedActor,
  findCapacityViolations
} from "../scripts/core/containers.js";
import { getCapacityCount, isWeightlessContainer } from "../scripts/core/weight.js";
import {
  DEFAULT_UNIT_CONVERSION,
  convertWeightToLbs,
  lbsPerUnit,
  resetUnitConversionTable,
  setUnitConversionTable
} from "../scripts/core/units.js";

const item = ({
  id,
  type = "loot",
  container = null,
  weight = 0,
  units = "lb",
  quantity = 1,
  capacity = null,
  count = null,
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
    properties: new Set(properties),
    ...(capacity == null && count == null
      ? {}
      : {
        capacity: {
          count,
          weight: { value: capacity, units: "lb" }
        }
      })
  },
  flags: { "weighty-containers": { reductionPct: reduction } }
});

const actor = items => ({ items: new ItemCollectionView(items) });

test("kilograms use dnd5e's 2.5 lb conversion, not the physical one", () => {
  assert.equal(lbsPerUnit("kg"), 2.5);
  assert.equal(DEFAULT_UNIT_CONVERSION.kg, 2.5);
});

test("the conversion table can be replaced from CONFIG.DND5E.weightUnits", t => {
  t.after(() => resetUnitConversionTable());
  setUnitConversionTable({ kg: { conversion: 3 }, st: { conversion: 14 }, bad: { conversion: 0 } });
  assert.equal(lbsPerUnit("kg"), 3);
  assert.equal(lbsPerUnit("st"), 14);
  assert.equal(lbsPerUnit("bad"), null, "a zero factor is rejected, leaving the unit unknown");
  assert.equal(convertWeightToLbs(3, "bad"), 3, "unknown units pass through unchanged");
  resetUnitConversionTable();
  assert.equal(lbsPerUnit("kg"), 2.5);
});

test("a container's reduction reaches items in its sub-containers", () => {
  const bag = item({ id: "bag", type: "container", weight: 5, reduction: 50 });
  const pouch = item({ id: "pouch", type: "container", container: "bag", weight: 1 });
  const rations = item({ id: "rations", container: "pouch", weight: 2, quantity: 2 });
  const subject = actor([bag, pouch, rations]);

  // (pouch 1 + rations 4) * 0.5
  assert.equal(computeAdjustedLoad(subject, "bag").load, 2.5);
  assert.equal(computeActorCarriedLbs(subject), 7.5);
});

test("dnd5e's weightlessContents property empties a container's load", () => {
  const bag = item({
    id: "bag",
    type: "container",
    weight: 5,
    properties: ["weightlessContents"]
  });
  const anvil = item({ id: "anvil", container: "bag", weight: 200 });
  const subject = actor([bag, anvil]);

  assert.equal(isWeightlessContainer(bag), true);
  assert.equal(computeAdjustedLoad(subject, "bag").load, 0);
  assert.equal(computeActorCarriedLbs(subject), 5);
});

test("carried currency counts toward a container's load and is reduced with it", () => {
  const bag = item({ id: "bag", type: "container", weight: 0, reduction: 50 });
  const brick = item({ id: "brick", container: "bag", weight: 10 });
  const subject = actor([bag, brick]);

  const currencyLbs = container => (container?.id === "bag" ? 4 : 0);
  assert.equal(computeAdjustedLoad(subject, "bag", { currencyLbs }).load, 7);
  assert.equal(
    computeActorCarriedLbs(subject, { currencyLbs, actorCurrencyLbs: 3 }),
    10
  );
});

test("a container's quantity does not multiply its own weight, matching dnd5e", () => {
  const crate = item({ id: "crate", type: "container", weight: 10, quantity: 4 });
  assert.equal(computeActorCarriedLbs(actor([crate])), 10);
});

test("vehicles can exclude mountable items the way dnd5e does", () => {
  const cannon = item({ id: "cannon", weight: 800 });
  cannon.system.isMountable = true;
  const rope = item({ id: "rope", weight: 10 });
  const subject = actor([cannon, rope]);

  assert.equal(computeActorCarriedLbs(subject), 810);
  assert.equal(
    computeActorCarriedLbs(subject, { validateItem: entry => !entry.system.isMountable }),
    10
  );
});

test("item-count capacity is enforced, including sub-container contents", () => {
  const pouch = item({ id: "pouch", type: "container", count: 2 });
  const first = item({ id: "first", container: "pouch", quantity: 2 });
  const current = actor([pouch, first]);
  assert.equal(getCapacityCount(pouch), 2);
  assert.equal(computeContentsCount(current, "pouch"), 2);

  const projected = createProjectedActor(current, item({ id: "second", container: "pouch" }));
  const violations = findCapacityViolations(current, projected);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].kind, "count");
  assert.equal(violations[0].capacity, 2);
  assert.equal(violations[0].after, 3);
});

test("a cycle does not poison the memo for a container reached legitimately", () => {
  const bag = item({ id: "bag", type: "container" });
  const loop = item({ id: "loop", type: "container", container: "bag", weight: 1 });
  const inner = item({ id: "inner", type: "container", container: "loop", weight: 1 });
  inner.system.container = "loop";
  const payload = item({ id: "payload", container: "loop", weight: 4 });
  const subject = actor([bag, loop, inner, payload]);

  const first = computeAdjustedLoad(subject, "loop").load;
  const viaBag = computeAdjustedLoad(subject, "bag").load;
  assert.equal(first, 5);
  assert.equal(viaBag, 6);
});
