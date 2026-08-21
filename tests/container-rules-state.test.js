import test from "node:test";
import assert from "node:assert/strict";

import { ContainerRulesState } from "../scripts/ui/container-rules-state.js";

const makeState = () => new ContainerRulesState({
  draft: {
    reductionPct: 25,
    allowedTypes: ["weapon"],
    allowedSubtypes: ["melee", "potion"],
    requiredProperties: ["mgc", "hvy"],
    forbiddenProperties: ["hvy"],
    propertyMatchMode: "all"
  },
  catalogs: {
    allowedTypes: [{ options: [{ value: "weapon", label: "Weapon" }] }],
    allowedSubtypes: [
      { types: ["weapon"], options: [{ value: "melee", label: "Melee" }] },
      { types: ["consumable"], options: [{ value: "potion", label: "Potion" }] }
    ],
    requiredProperties: [{ options: [
      { value: "mgc", label: "Magical" },
      { value: "hvy", label: "Heavy" }
    ] }],
    forbiddenProperties: [{ options: [{ value: "hvy", label: "Heavy" }] }]
  }
});

test("container rules state owns selections, conflicts, and unavailable subtypes", () => {
  const state = makeState();

  assert.deepEqual(state.unavailableSubtypeValues(), ["potion"]);
  assert.deepEqual(state.propertyConflicts(), ["hvy"]);
  assert.deepEqual(state.selectionLabels("requiredProperties"), [
    { value: "mgc", label: "Magical" },
    { value: "hvy", label: "Heavy" }
  ]);

  state.removeUnavailableSubtypes();
  const changed = state.resolvePropertyConflicts("requiredProperties");
  assert.equal(changed, "forbiddenProperties");
  assert.deepEqual(state.allowedSubtypes, ["melee"]);
  assert.deepEqual(state.forbiddenProperties, []);
});

test("container rules state produces stable snapshots and persistence payloads", () => {
  const state = makeState();
  const initial = state.snapshot();

  state.setSelection("allowedTypes", ["weapon", "weapon", "loot"]);
  state.setReductionPct(140);
  state.setPropertyMatchMode("any");

  assert.notEqual(state.snapshot(), initial);
  assert.deepEqual(state.toConfig(), {
    reductionPct: 100,
    allowedTypes: ["weapon", "loot"],
    allowedSubtypes: ["melee", "potion"],
    requiredProperties: ["mgc", "hvy"],
    forbiddenProperties: ["hvy"],
    propertyMatchMode: "any"
  });
});
