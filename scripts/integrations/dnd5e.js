import { lbsPerUnit, lbsToUnit, setUnitConversionTable } from "../core/units.js";

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

/**
 * Item types that can physically sit inside a container. Everything else
 * dnd5e registers (class, spell, feat, ...) is noise in the rules dialog.
 */
const PHYSICAL_ITEM_TYPES = new Set([
  "weapon", "equipment", "consumable", "tool", "loot", "container", "backpack", "facility"
]);

function getConfig() {
  return globalThis.CONFIG ?? {};
}

function getDnd5eConfig() {
  return getConfig().DND5E ?? {};
}

function getSetting(namespace, key, fallback = undefined) {
  try {
    return globalThis.game?.settings?.get(namespace, key);
  } catch {
    return fallback;
  }
}

/**
 * Adopt dnd5e's weight conversion table. The system's kilogram is 2.5 lb, so
 * anything the module computes with a physical factor drifts from the sheet.
 * Safe to call before CONFIG.DND5E exists; the offline fallback stays in place.
 * @returns {boolean} whether the system table was found
 */
export function installUnitConversion() {
  const table = getDnd5eConfig().weightUnits;
  if (!table || typeof table !== "object") return false;
  setUnitConversionTable(table);
  return true;
}

/** The unit dnd5e is configured to display weights in. */
export function getSystemWeightUnit() {
  return getSetting("dnd5e", "metricWeightUnits") ? "kg" : "lb";
}

export function lbsToDisplay(lbs) {
  return lbsToUnit(lbs, getSystemWeightUnit());
}

/** Convert a value expressed in the display unit back into pounds. */
export function displayToLbs(value) {
  return (Number(value) || 0) * (lbsPerUnit(getSystemWeightUnit()) ?? 1);
}

/** Whether dnd5e is counting coin weight at all. */
export function isCurrencyWeightEnabled() {
  return getSetting("dnd5e", "currencyWeight") === true;
}

/**
 * Weight of a currency block, reproducing dnd5e's own arithmetic.
 *
 * Note the unit: dnd5e divides the coin count by a per-unit constant chosen
 * from the *display* unit and then adds the result straight into a pound-
 * denominated sum, without converting. That is a quirk of the system, but the
 * module's job is to agree with the sheet standing next to it, so we reproduce
 * it rather than "fix" it here.
 *
 * @param {Object} currency  `{ pp, gp, ep, sp, cp }`
 * @returns {number}
 */
export function currencyWeightOf(currency) {
  if (!currency || !isCurrencyWeightEnabled()) return 0;
  const count = Object.values(currency)
    .reduce((total, value) => total + Math.max(Number(value) || 0, 0), 0);
  if (!count) return 0;
  const perWeight = getDnd5eConfig().encumbrance?.currencyPerWeight ?? {
    imperial: 50,
    metric: 110
  };
  const metric = getSystemWeightUnit() === "kg";
  const divisor = Number(metric ? perWeight.metric : perWeight.imperial) || 50;
  return count / divisor;
}

/** Weight of the coins inside a container. Prefers the system's own getter. */
export function containerCurrencyLbs(containerItem) {
  const own = containerItem?.system?.currencyWeight;
  if (typeof own === "number" && Number.isFinite(own)) return own;
  return currencyWeightOf(containerItem?.system?.currency);
}

/** Weight of the coins an actor carries directly. */
export function actorCurrencyLbs(actor) {
  return currencyWeightOf(actor?.system?.currency);
}

/**
 * Contents weight of a container *before* this module's reduction, in the
 * container's own weight units - dnd5e's formula, minus the patched getter.
 *
 * Used by the rules dialog so the preview can show what the container really
 * holds instead of an abstract sample weight. Returns null when the contents
 * cannot be read synchronously (compendium items).
 *
 * @param {Object} containerItem
 * @returns {number|null}
 */
export function getRawContentsWeight(containerItem) {
  const contents = containerItem?.system?.contents;
  if (!contents || typeof contents[Symbol.iterator] !== "function") return null;
  const units = containerItem.system?.weight?.units;
  let total = Number(containerItem.system?.currencyWeight) || 0;
  for (const child of contents) {
    const childWeight = child?.system?.totalWeightIn?.(units);
    if (typeof childWeight !== "number") return null;
    total += childWeight;
  }
  return total;
}

/** Short label for a weight unit, e.g. "lb" or "kg". */
export function getWeightUnitLabel(unit) {
  const key = unit || getSystemWeightUnit();
  return getDnd5eConfig().weightUnits?.[key]?.abbreviation ?? key;
}

/**
 * dnd5e excludes mountable items from a vehicle's encumbrance. Mirror that so
 * the module's own actor total agrees with the sheet.
 */
export function makeEncumbranceItemFilter(actor) {
  if (actor?.type !== "vehicle") return null;
  return item => !item?.system?.isMountable;
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

export function isPhysicalItemType(type) {
  return PHYSICAL_ITEM_TYPES.has(String(type ?? "").toLowerCase());
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
