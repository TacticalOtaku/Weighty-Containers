import test from "node:test";
import assert from "node:assert/strict";

import {
  CONTAINER_DATA_MODEL_PATH,
  actorCurrencyLbs,
  containerCurrencyLbs,
  getContainerDataModelClass,
  getPropertyCatalogs,
  getSubtypeCatalogs,
  getSystemWeightUnit,
  getValidPropertiesByItemType,
  getWeaponTypeMap,
  lbsToDisplay
} from "../scripts/integrations/dnd5e.js";

test("D&D5e adapter owns weight units and version-specific API paths", () => {
  class ContainerData {}
  globalThis.game = {
    settings: {
      get(moduleId, key) {
        return moduleId === "dnd5e" && key === "metricWeightUnits";
      }
    }
  };
  globalThis.CONFIG = {
    DND5E: {
      weaponTypeMap: { martialM: "martial" },
      weaponTypes: { martialM: "Martial Melee" },
      itemProperties: { mgc: "Magical" },
      validProperties: { weapon: ["mgc"] }
    },
    Item: { dataModels: { container: ContainerData } }
  };

  assert.equal(getSystemWeightUnit(), "kg");
  assert.equal(Number(lbsToDisplay(2.5).toFixed(5)), 1);
  assert.deepEqual(getWeaponTypeMap(), { martialM: "martial" });
  assert.equal(getContainerDataModelClass(), ContainerData);
  assert.deepEqual(getSubtypeCatalogs()[0].values, { martialM: "Martial Melee" });
  assert.deepEqual(getPropertyCatalogs()[0].values, { mgc: "Magical" });
  assert.deepEqual(getValidPropertiesByItemType(), { weapon: ["mgc"] });
  assert.equal(CONTAINER_DATA_MODEL_PATH, "CONFIG.Item.dataModels.container");
});

test("D&D5e adapter falls back safely before Foundry globals are ready", () => {
  delete globalThis.game;
  delete globalThis.CONFIG;

  assert.equal(getSystemWeightUnit(), "lb");
  assert.equal(lbsToDisplay(3), 3);
  assert.deepEqual(getWeaponTypeMap(), {});
  assert.equal(getContainerDataModelClass(), null);
  assert.deepEqual(getValidPropertiesByItemType(), {});
});

test("coin weight is converted to pounds from the unit dnd5e counts it in", () => {
  globalThis.game = {
    settings: { get: (moduleId, key) => moduleId === "dnd5e" && ["metricWeightUnits", "currencyWeight"].includes(key) }
  };
  globalThis.CONFIG = { DND5E: { encumbrance: { currencyPerWeight: { imperial: 50, metric: 110 } } } };

  // 1100 coins weigh 10 kg in a metric world, both on the actor and in a kg bag.
  assert.equal(actorCurrencyLbs({ system: { currency: { gp: 1100 } } }), 25);
  assert.equal(containerCurrencyLbs({ system: { currencyWeight: 10, weight: { units: "kg" } } }), 25);
  // dnd5e adds a bag's coin weight in the bag's own units, whatever the display unit.
  assert.equal(containerCurrencyLbs({ system: { currencyWeight: 10, weight: { units: "lb" } } }), 10);
});
