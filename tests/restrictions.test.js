import test from "node:test";
import assert from "node:assert/strict";

import {
  parseTokenList,
  validateContainerRestrictions
} from "../scripts/core/restrictions.js";

const moduleFlags = rules => ({
  flags: { "weighty-containers": rules }
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
