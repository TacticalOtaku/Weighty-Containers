import assert from "node:assert/strict";
import test from "node:test";

import {
  containerConfigMatches,
  getReductionPct,
  getRulePreset,
  makeContainerConfigUpdate,
  parseTokenList,
  registerRulePreset,
  unregisterRulePreset,
  validateContainerRestrictions
} from "../scripts/core/rules.js";

const moduleFlags = rules => ({
  flags: { "weighty-containers": rules }
});

test("getReductionPct clamps invalid flag values", () => {
  assert.equal(getReductionPct(moduleFlags({ reductionPct: 150 })), 100);
  assert.equal(getReductionPct(moduleFlags({ reductionPct: -10 })), 0);
  assert.equal(getReductionPct(moduleFlags({ reductionPct: "bad" })), 0);
});

test("parseTokenList normalizes arrays and delimited strings", () => {
  assert.deepEqual(parseTokenList([" Weapon ", "", "MAGIC"]), ["weapon", "magic"]);
  assert.deepEqual(parseTokenList("weapon; potion,\nloot"), ["weapon", "potion", "loot"]);
});

test("validateContainerRestrictions accepts matching type and required properties", () => {
  const container = moduleFlags({
    allowedTypes: ["weapon"],
    requiredProperties: ["mgc", "thr"]
  });
  const result = validateContainerRestrictions(container, {
    type: "weapon",
    system: { properties: ["mgc", "thr"] }
  });
  assert.equal(result.ok, true);
});

test("validateContainerRestrictions supports any mode and forbidden properties", () => {
  const container = moduleFlags({
    requiredProperties: ["mgc", "thr"],
    propertyMatchMode: "any",
    forbiddenProperties: ["hvy"]
  });
  assert.equal(validateContainerRestrictions(container, {
    type: "weapon",
    system: { properties: ["thr"] }
  }).ok, true);
  assert.equal(validateContainerRestrictions(container, {
    type: "weapon",
    system: { properties: ["thr", "hvy"] }
  }).reason, "forbiddenProperty");
});

test("validateContainerRestrictions matches subtype aliases", () => {
  const container = moduleFlags({ allowedSubtypes: ["martial"] });
  const item = {
    type: "weapon",
    system: { type: { value: "martialM" } }
  };
  assert.equal(validateContainerRestrictions(container, item, {
    weaponTypeMap: { martialM: "martial" }
  }).ok, true);
});

test("makeContainerConfigUpdate and containerConfigMatches share flag schema", () => {
  const config = {
    reductionPct: 120,
    allowedTypes: ["Weapon", "consumable"],
    allowedSubtypes: ["potion"],
    requiredProperties: ["mgc"],
    forbiddenProperties: ["hvy"],
    propertyMatchMode: "any"
  };
  const update = makeContainerConfigUpdate(config);
  assert.equal(update["flags.weighty-containers.reductionPct"], 100);
  assert.deepEqual(update["flags.weighty-containers.allowedTypes"], ["weapon", "consumable"]);

  const persisted = moduleFlags({
    reductionPct: 100,
    allowedTypes: ["consumable", "weapon"],
    allowedSubtypes: "potion",
    requiredProperties: ["mgc"],
    forbiddenProperties: ["hvy"],
    propertyMatchMode: "any"
  });
  assert.equal(containerConfigMatches(persisted, config), true);
  assert.equal(containerConfigMatches(persisted, { ...config, reductionPct: 50 }), false);
});

test("registerRulePreset keeps only rule keys and rejects presets without any", t => {
  t.after(() => unregisterRulePreset("test.satchel"));

  assert.equal(registerRulePreset({
    id: "test.satchel",
    label: "Satchel",
    config: { allowedTypes: ["consumable"], bogus: 1 }
  }), true);
  assert.deepEqual(getRulePreset("test.satchel").config, { allowedTypes: ["consumable"] });
  assert.equal(getRulePreset("test.satchel").icon, "fa-solid fa-wand-magic-sparkles");

  assert.equal(registerRulePreset({ id: "test.empty", config: { bogus: 1 } }), false);
  assert.equal(registerRulePreset({ config: { reductionPct: 10 } }), false, "an id is required");
  assert.equal(getRulePreset("test.empty"), null);
});

test("registering an existing id replaces the preset", t => {
  t.after(() => unregisterRulePreset("test.pouch"));
  registerRulePreset({ id: "test.pouch", config: { reductionPct: 10 } });
  registerRulePreset({ id: "test.pouch", config: { reductionPct: 75 } });
  assert.deepEqual(getRulePreset("test.pouch").config, { reductionPct: 75 });
  assert.equal(unregisterRulePreset("test.pouch"), true);
  assert.equal(getRulePreset("test.pouch"), null);
});
