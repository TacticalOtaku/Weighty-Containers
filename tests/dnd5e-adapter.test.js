import test from "node:test";
import assert from "node:assert/strict";

import {
  CONTAINER_DATA_MODEL_PATH,
  actorCurrencyLbs,
  containerCurrencyLbs,
  getContainerDataModelClass,
  getRuleCatalogs,
  getRuleTokenLabels,
  getSystemWeightUnit,
  getUnitConversionTable,
  getWeaponTypeMap,
  lbsToDisplay
} from "../scripts/integrations/dnd5e.js";

test("D&D5e adapter owns weight units, conversion table, and data model paths", () => {
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
      weightUnits: { kg: { conversion: 2.5 }, st: { conversion: 14 } },
      weaponTypeMap: { martialM: "martial" }
    },
    Item: { dataModels: { container: ContainerData } }
  };

  assert.equal(getSystemWeightUnit(), "kg");
  assert.equal(Number(lbsToDisplay(2.5).toFixed(5)), 1);
  assert.equal(getUnitConversionTable().st, 14);
  assert.deepEqual(getWeaponTypeMap(), { martialM: "martial" });
  assert.equal(getContainerDataModelClass(), ContainerData);
  assert.equal(CONTAINER_DATA_MODEL_PATH, "CONFIG.Item.dataModels.container");
});

test("D&D5e adapter builds deduplicated rule catalogs and resolves token labels", () => {
  globalThis.game = {
    i18n: { lang: "en", localize: key => ({ "TYPES.Item.weapon": "Weapon", "DND5E.Armor": "Armor" }[key] ?? key) },
    system: { documentTypes: { Item: ["weapon", "spell", "equipment"] } }
  };
  globalThis.CONFIG = {
    Item: { typeLabels: { feat: "Feat", equipment: "Equipment" } },
    DND5E: {
      weaponTypes: { simpleM: "Simple Melee" },
      consumableTypes: {
        ammo: { label: "Ammunition", subtypes: { arrow: "Arrow" } }
      },
      armorTypes: { light: "Light Armor" },
      equipmentTypes: { light: "Light Armor", clothing: "Clothing" },
      itemProperties: { mgc: { label: "Magical" } },
      validProperties: { weapon: ["mgc", "thr"] }
    }
  };

  const catalogs = getRuleCatalogs();
  const itemValues = catalogs.allowedTypes[0].options.map(option => option.value);
  assert.equal(itemValues.includes("spell"), false, "non-physical types are filtered out");
  assert.equal(itemValues.includes("feat"), false);
  assert.equal(itemValues.includes("weapon"), true);

  const armorGroup = catalogs.allowedSubtypes.find(group => group.key === "armorTypes");
  const equipGroup = catalogs.allowedSubtypes.find(group => group.key === "equipmentTypes");
  const ammoNested = catalogs.allowedSubtypes.find(group => group.key === "consumableTypes-ammo");
  assert.deepEqual(armorGroup.options.map(o => o.value), ["light"]);
  assert.deepEqual(equipGroup.options.map(o => o.value), ["clothing"], "armor claims overlapping options first");
  assert.deepEqual(ammoNested.options.map(o => o.value), ["arrow"]);

  assert.deepEqual(getRuleTokenLabels("requiredProperties", ["mgc", "custom"]), ["Magical", "custom"]);
});

test("D&D5e adapter falls back safely before Foundry globals are ready", () => {
  delete globalThis.game;
  delete globalThis.CONFIG;

  assert.equal(getSystemWeightUnit(), "lb");
  assert.equal(lbsToDisplay(3), 3);
  assert.deepEqual(getWeaponTypeMap(), {});
  assert.equal(getContainerDataModelClass(), null);
  assert.equal(getRuleCatalogs().allowedTypes[0].options.length, 6);
});

test("coin weight converts accurately for live containers and plain-object projections", () => {
  globalThis.game = {
    settings: { get: (moduleId, key) => moduleId === "dnd5e" && ["metricWeightUnits", "currencyWeight"].includes(key) }
  };
  globalThis.CONFIG = { DND5E: { encumbrance: { currencyPerWeight: { imperial: 50, metric: 110 } } } };

  // 1100 coins weigh 10 kg in a metric world, both on the actor and in a kg bag.
  assert.equal(actorCurrencyLbs({ system: { currency: { gp: 1100 } } }), 25);
  assert.equal(containerCurrencyLbs({ system: { currencyWeight: 10, weight: { units: "kg" } } }), 25);
  // dnd5e adds a bag's live currencyWeight in the bag's own units.
  assert.equal(containerCurrencyLbs({ system: { currencyWeight: 10, weight: { units: "lb" } } }), 10);
  // Plain-object projections (without currencyWeight getter) compute currencyWeightOf in
  // display units (kg), so converting from display unit gives 25 lb even on a lb bag.
  assert.equal(containerCurrencyLbs({ system: { currency: { gp: 1100 }, weight: { units: "lb" } } }), 25);
});
