import assert from "node:assert/strict";
import test from "node:test";
import {
  getRulePreset,
  registerRulePreset,
  unregisterRulePreset
} from "../scripts/ui/rule-presets.js";

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
