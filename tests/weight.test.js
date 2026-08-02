import test from "node:test";
import assert from "node:assert/strict";

import {
  convertWeightToLbs,
  getCapacityLbs,
  getReductionPct,
  ownWeightLbs
} from "../scripts/core/weight.js";

test("convertWeightToLbs converts supported units and preserves unknown units", () => {
  assert.equal(convertWeightToLbs(2, "lb"), 2);
  assert.equal(convertWeightToLbs(1, "kg"), 2.20462);
  assert.equal(convertWeightToLbs(16, "oz"), 1);
  assert.equal(convertWeightToLbs(3, "stones"), 3);
});

test("ownWeightLbs supports object and legacy numeric weight shapes", () => {
  assert.equal(ownWeightLbs({
    system: { weight: { value: 2, units: "lb" }, quantity: 3 }
  }), 6);
  assert.equal(ownWeightLbs({
    system: { weight: 2, quantity: 3 }
  }), 6);
});

test("getReductionPct clamps invalid flag values", () => {
  assert.equal(getReductionPct({ flags: { "weighty-containers": { reductionPct: 150 } } }), 100);
  assert.equal(getReductionPct({ flags: { "weighty-containers": { reductionPct: -10 } } }), 0);
  assert.equal(getReductionPct({ flags: { "weighty-containers": { reductionPct: "bad" } } }), 0);
});

test("getCapacityLbs reads dnd5e and legacy capacity shapes", () => {
  assert.equal(getCapacityLbs({
    system: { capacity: { weight: { value: 5, units: "kg" } } }
  }), 11.0231);
  assert.equal(getCapacityLbs({
    system: { capacity: { value: 12, units: "lb" } }
  }), 12);
  assert.equal(getCapacityLbs({ system: { capacity: 7 } }), 7);
});
