import test from "node:test";
import assert from "node:assert/strict";

import {
  convertWeightToLbs,
  getCapacityLbs,
  ownWeightLbs
} from "../scripts/core/weight.js";

test("convertWeightToLbs converts supported units and preserves unknown units", () => {
  assert.equal(convertWeightToLbs(2, "lb"), 2);
  assert.equal(convertWeightToLbs(1, "kg"), 2.5);
  assert.equal(convertWeightToLbs(16, "oz"), 1);
  assert.equal(convertWeightToLbs(3, "stones"), 3);
});

test("ownWeightLbs multiplies the unit weight by the quantity", () => {
  assert.equal(ownWeightLbs({
    system: { weight: { value: 2, units: "lb" }, quantity: 3 }
  }), 6);
});

test("getCapacityLbs reads dnd5e's weight capacity", () => {
  assert.equal(getCapacityLbs({
    system: { capacity: { weight: { value: 5, units: "kg" } } }
  }), 12.5);
  assert.equal(getCapacityLbs({ system: { capacity: { count: 20, weight: { value: 0 } } } }), null);
  assert.equal(getCapacityLbs({ system: {} }), null);
});
