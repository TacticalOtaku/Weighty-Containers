import { convertWeightToLbs, lbsToUnit, setUnitConversionTable } from "../core/units.js";

export const CONTAINER_DATA_MODEL_PATH = "CONFIG.Item.dataModels.container";

// Order matters: dnd5e builds `equipmentTypes` as misc equipment *plus* the
// armor types, so armor is listed first and claims its own options; the
// equipment group then only keeps what is left.
const SUBTYPE_CATALOGS = [
  { key: "weaponTypes", labelKey: "weaponTypes", types: ["weapon"] },
  { key: "consumableTypes", labelKey: "consumableTypes", types: ["consumable"] },
  { key: "armorTypes", labelKey: "armorTypes", types: ["equipment"] },
  { key: "equipmentTypes", labelKey: "equipmentTypes", types: ["equipment"] },
  { key: "toolTypes", labelKey: "toolTypes", types: ["tool"] },
  { key: "lootTypes", labelKey: "lootTypes", types: ["loot"] }
];

// dnd5e 3.0 folded the per-type property tables into one `itemProperties`
// table plus `validProperties`; the old tables no longer exist.
const PROPERTY_CATALOGS = [
  { key: "itemProperties", labelKey: "itemProperties" }
];

/**
 * Item types that can physically sit inside a container. Everything else
 * dnd5e registers (class, spell, feat, facility, ...) is noise in the rules
 * dialog.
 */
const PHYSICAL_ITEM_TYPES = new Set([
  "weapon", "equipment", "consumable", "tool", "loot", "container"
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

/** Whether dnd5e is counting coin weight at all. */
export function isCurrencyWeightEnabled() {
  return getSetting("dnd5e", "currencyWeight") === true;
}

/**
 * Weight of a currency block, reproducing dnd5e's own arithmetic.
 *
 * The result is in the *display* unit (kg when dnd5e shows metric weights),
 * because dnd5e divides the coin count by that unit's coins-per-weight. The
 * Item Piles D&D 5e bridge keeps coins in the same `system.currency` fields,
 * so coins it moves weigh the same.
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

/**
 * Weight of the coins inside a container, in pounds. Prefers the system's own
 * getter. dnd5e adds that number to the contents without converting, so it
 * counts in the container's own weight units, and is read in them here.
 */
export function containerCurrencyLbs(containerItem) {
  const own = containerItem?.system?.currencyWeight;
  const weight = typeof own === "number" && Number.isFinite(own)
    ? own
    : currencyWeightOf(containerItem?.system?.currency);
  return convertWeightToLbs(weight, containerItem?.system?.weight?.units, getSystemWeightUnit());
}

/** Weight of the coins an actor carries directly, in pounds. */
export function actorCurrencyLbs(actor) {
  return convertWeightToLbs(currencyWeightOf(actor?.system?.currency), getSystemWeightUnit());
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

/** Short label for a weight unit, e.g. "lb" or "kg", localized when possible. */
export function getWeightUnitLabel(unit) {
  const key = unit || getSystemWeightUnit();
  const abbreviation = getDnd5eConfig().weightUnits?.[key]?.abbreviation;
  if (!abbreviation) return key;
  try {
    return globalThis.game?.i18n?.localize?.(abbreviation) ?? abbreviation;
  } catch {
    return abbreviation;
  }
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
