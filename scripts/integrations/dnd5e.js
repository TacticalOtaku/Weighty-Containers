import { LBS_PER_KG } from "../constants.js";

export const ACTOR_PREPARE_DERIVED_DATA_PATH =
  "CONFIG.Actor.documentClass.prototype.prepareDerivedData";
export const CONTAINER_DATA_MODEL_PATH = "CONFIG.Item.dataModels.container";

const SUBTYPE_CATALOGS = [
  { key: "weaponTypes", labelKey: "weaponTypes", types: ["weapon"] },
  { key: "consumableTypes", labelKey: "consumableTypes", types: ["consumable"] },
  { key: "equipmentTypes", labelKey: "equipmentTypes", types: ["equipment"] },
  { key: "armorTypes", labelKey: "armorTypes", types: ["equipment"] },
  { key: "toolTypes", labelKey: "toolTypes", types: ["tool"] },
  { key: "lootTypes", labelKey: "lootTypes", types: ["loot"] }
];

const PROPERTY_CATALOGS = [
  { key: "itemProperties", labelKey: "itemProperties" },
  { key: "weaponProperties", labelKey: "weaponProperties" },
  { key: "equipmentProperties", labelKey: "equipmentProperties" },
  { key: "consumableProperties", labelKey: "consumableProperties" }
];

function getConfig() {
  return globalThis.CONFIG ?? {};
}

function getDnd5eConfig() {
  return getConfig().DND5E ?? {};
}

export function getSystemWeightUnit() {
  try {
    return globalThis.game?.settings?.get("dnd5e", "metricWeightUnits")
      ? "kg"
      : "lb";
  } catch {
    return "lb";
  }
}

export function lbsToDisplay(lbs) {
  return getSystemWeightUnit() === "kg" ? lbs / LBS_PER_KG : lbs;
}

export function getWeaponTypeMap() {
  return getDnd5eConfig().weaponTypeMap ?? {};
}

export function getContainerDataModelClass() {
  return getConfig().Item?.dataModels?.container ?? null;
}

export function getItemDocumentTypes() {
  return globalThis.game?.system?.documentTypes?.Item ?? [];
}

export function getItemTypeLabels() {
  return getConfig().Item?.typeLabels ?? {};
}

export function getSubtypeCatalogs() {
  const config = getDnd5eConfig();
  return SUBTYPE_CATALOGS.map(catalog => ({
    ...catalog,
    values: config[catalog.key]
  }));
}

export function getPropertyCatalogs() {
  const config = getDnd5eConfig();
  return PROPERTY_CATALOGS.map(catalog => ({
    ...catalog,
    values: config[catalog.key]
  }));
}

export function getValidPropertiesByItemType() {
  const validProperties = getDnd5eConfig().validProperties;
  return validProperties && typeof validProperties === "object"
    ? validProperties
    : {};
}
