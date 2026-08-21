import test from "node:test";
import assert from "node:assert/strict";

import {
  ACTOR_PREPARE_DERIVED_DATA_PATH,
  CONTAINER_DATA_MODEL_PATH,
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
  assert.equal(Number(lbsToDisplay(2.20462).toFixed(5)), 1);
  assert.deepEqual(getWeaponTypeMap(), { martialM: "martial" });
  assert.equal(getContainerDataModelClass(), ContainerData);
  assert.deepEqual(getSubtypeCatalogs()[0].values, { martialM: "Martial Melee" });
  assert.deepEqual(getPropertyCatalogs()[0].values, { mgc: "Magical" });
  assert.deepEqual(getValidPropertiesByItemType(), { weapon: ["mgc"] });
  assert.equal(
    ACTOR_PREPARE_DERIVED_DATA_PATH,
    "CONFIG.Actor.documentClass.prototype.prepareDerivedData"
  );
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
