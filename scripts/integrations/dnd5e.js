import { I18N } from "../constants.js";
import { normalizeToken, parseTokenList } from "../core/rules.js";
import {
  DEFAULT_UNIT_CONVERSION,
  convertWeightToLbs,
  lbsToUnit,
  normalizeUnitConversionTable
} from "../core/weight.js";

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
const PHYSICAL_ITEM_TYPES = [
  "weapon", "consumable", "equipment", "tool", "loot", "container"
];
const PHYSICAL_ITEM_TYPE_SET = new Set(PHYSICAL_ITEM_TYPES);

let cachedRawUnitTable = null;
let cachedNormalizedUnitTable = DEFAULT_UNIT_CONVERSION;

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

function localizeLabel(label, fallback = "") {
  if (!label) return fallback;
  try {
    return globalThis.game?.i18n?.localize?.(String(label)) ?? String(label);
  } catch {
    return String(label);
  }
}

function currentLang() {
  return globalThis.game?.i18n?.lang;
}

/**
 * dnd5e's weight conversion table (`CONFIG.DND5E.weightUnits`, where a
 * kilogram is 2.5 lb), falling back to {@link DEFAULT_UNIT_CONVERSION}.
 */
export function getUnitConversionTable() {
  const table = getDnd5eConfig().weightUnits;
  if (!table || typeof table !== "object") return DEFAULT_UNIT_CONVERSION;
  if (table !== cachedRawUnitTable) {
    cachedRawUnitTable = table;
    cachedNormalizedUnitTable = normalizeUnitConversionTable(table);
  }
  return cachedNormalizedUnitTable;
}

/** The unit dnd5e is configured to display weights in. */
export function getSystemWeightUnit() {
  return getSetting("dnd5e", "metricWeightUnits") ? "kg" : "lb";
}

export function lbsToDisplay(lbs) {
  return lbsToUnit(lbs, getSystemWeightUnit(), getUnitConversionTable());
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
 * Weight of the coins inside a container, in pounds. Prefers dnd5e's own
 * `currencyWeight` getter (which is in the container's `weight.units`); when
 * absent on plain-object projections, falls back to `currencyWeightOf` (which
 * is in the display unit) and converts from that unit.
 */
export function containerCurrencyLbs(containerItem) {
  const unitTable = getUnitConversionTable();
  const displayUnit = getSystemWeightUnit();
  const own = containerItem?.system?.currencyWeight;
  if (typeof own === "number" && Number.isFinite(own)) {
    return convertWeightToLbs(
      own,
      containerItem?.system?.weight?.units,
      displayUnit,
      unitTable
    );
  }
  return convertWeightToLbs(
    currencyWeightOf(containerItem?.system?.currency),
    displayUnit,
    displayUnit,
    unitTable
  );
}

/** Weight of the coins an actor carries directly, in pounds. */
export function actorCurrencyLbs(actor) {
  const displayUnit = getSystemWeightUnit();
  return convertWeightToLbs(
    currencyWeightOf(actor?.system?.currency),
    displayUnit,
    displayUnit,
    getUnitConversionTable()
  );
}

/** Short label for a weight unit, e.g. "lb" or "kg", localized when possible. */
export function getWeightUnitLabel(unit) {
  const key = unit || getSystemWeightUnit();
  const abbreviation = getDnd5eConfig().weightUnits?.[key]?.abbreviation;
  if (!abbreviation) return key;
  return localizeLabel(abbreviation, key);
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

function addOption(map, value, label = null) {
  const key = normalizeToken(value);
  if (!key || map.has(key)) return;
  map.set(key, localizeLabel(label, String(value)));
}

function optionsFromConfig(config) {
  const options = new Map();
  if (!config) return [];

  if (config instanceof Map) {
    for (const [value, label] of config.entries()) addOption(options, value, label);
  } else if (Array.isArray(config) || config instanceof Set) {
    for (const value of config) addOption(options, value);
  } else if (typeof config === "object") {
    for (const [value, label] of Object.entries(config)) {
      if (label && typeof label === "object" && !Array.isArray(label)) {
        addOption(options, value, label.label ?? label.name ?? value);
      } else {
        addOption(options, value, label);
      }
    }
  }

  const lang = currentLang();
  return Array.from(options, ([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label, lang));
}

function valuesFromConfig(config) {
  if (!config) return [];
  if (config instanceof Map) return Array.from(config.keys());
  if (Array.isArray(config) || config instanceof Set) return Array.from(config);
  if (typeof config !== "object") return [config];

  const values = [];
  for (const [key, value] of Object.entries(config)) {
    if (value === false || value == null) continue;
    if (value === true || typeof value !== "object") {
      values.push(key);
      continue;
    }

    const nested = valuesFromConfig(value);
    if (nested.length) values.push(...nested);
    else values.push(key);
  }
  return values;
}

/**
 * Options of a catalog that are not already offered by an earlier group.
 * dnd5e's catalogs overlap (equipment types contain every armor type), and
 * the same checkbox twice in one list only reads as a bug.
 */
function takeUnseen(options, seen) {
  return options.filter(option => {
    if (seen.has(option.value)) return false;
    seen.add(option.value);
    return true;
  });
}

function buildItemTypeGroups() {
  const itemTypes = new Map();
  const docTypes = globalThis.game?.system?.documentTypes?.Item ?? [];
  const typeLabels = getConfig().Item?.typeLabels ?? {};

  for (const type of valuesFromConfig(docTypes)) {
    if (PHYSICAL_ITEM_TYPE_SET.has(normalizeToken(type))) {
      addOption(itemTypes, type, `TYPES.Item.${type}`);
    }
  }
  for (const [type, label] of Object.entries(typeLabels)) {
    if (PHYSICAL_ITEM_TYPE_SET.has(normalizeToken(type))) {
      addOption(itemTypes, type, label);
    }
  }
  for (const type of PHYSICAL_ITEM_TYPES) {
    addOption(itemTypes, type, `TYPES.Item.${type}`);
  }

  const lang = currentLang();
  const options = Array.from(itemTypes, ([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label, lang));

  return [{ label: localizeLabel(`${I18N}.configDialog.groups.itemTypes`), options }];
}

function nestedSubtypeGroups(catalog, seen) {
  const groups = [];
  if (!catalog.values || typeof catalog.values !== "object") return groups;
  for (const [parent, entry] of Object.entries(catalog.values)) {
    const subtypes = entry && typeof entry === "object" ? entry.subtypes : null;
    const options = takeUnseen(optionsFromConfig(subtypes), seen);
    if (!options.length) continue;
    groups.push({
      key: `${catalog.key}-${parent}`,
      label: localizeLabel(entry.label, parent),
      options,
      types: catalog.types ?? []
    });
  }
  return groups;
}

function buildSubtypeGroups(dnd5eConfig) {
  const seen = new Set(["melee", "ranged"]);
  const groups = [{
    key: "weaponRange",
    label: localizeLabel(`${I18N}.configDialog.groups.weaponRange`),
    types: ["weapon"],
    options: [
      { value: "melee", label: localizeLabel(`${I18N}.configDialog.option.melee`) },
      { value: "ranged", label: localizeLabel(`${I18N}.configDialog.option.ranged`) }
    ]
  }];

  const catalogs = SUBTYPE_CATALOGS.map(catalog => ({
    ...catalog,
    values: dnd5eConfig[catalog.key]
  }));
  for (const catalog of catalogs) {
    const options = takeUnseen(optionsFromConfig(catalog.values), seen);
    if (options.length) {
      groups.push({
        key: catalog.key,
        label: localizeLabel(`${I18N}.configDialog.groups.${catalog.labelKey}`),
        options,
        types: catalog.types ?? []
      });
    }
  }
  for (const catalog of catalogs) {
    groups.push(...nestedSubtypeGroups(catalog, seen));
  }

  return groups;
}

function buildPropertyGroups(dnd5eConfig) {
  const groups = [];
  const seen = new Set();

  for (const catalog of PROPERTY_CATALOGS) {
    const options = takeUnseen(optionsFromConfig(dnd5eConfig[catalog.key]), seen);
    if (options.length) {
      groups.push({
        key: catalog.key,
        label: localizeLabel(`${I18N}.configDialog.groups.${catalog.labelKey}`),
        options
      });
    }
  }

  const validProperties = dnd5eConfig.validProperties;
  if (validProperties && typeof validProperties === "object") {
    for (const [itemType, properties] of Object.entries(validProperties)) {
      const options = takeUnseen(optionsFromConfig(properties), seen);
      if (options.length) {
        groups.push({
          key: `validProperties-${itemType}`,
          label: localizeLabel(`TYPES.Item.${itemType}`, itemType),
          options
        });
      }
    }
  }

  return groups;
}

/**
 * Rule selection catalogs derived from dnd5e configuration tables.
 */
export function getRuleCatalogs() {
  const dnd5eConfig = getDnd5eConfig();
  const propertyGroups = buildPropertyGroups(dnd5eConfig);
  return {
    allowedTypes: buildItemTypeGroups(),
    allowedSubtypes: buildSubtypeGroups(dnd5eConfig),
    requiredProperties: propertyGroups,
    forbiddenProperties: propertyGroups
  };
}

/**
 * Human labels for stored rule tokens, e.g. `mgc` -> "Magical".
 * Unknown tokens, or a Foundry that is not ready yet, fall back to the token.
 */
export function getRuleTokenLabels(name, tokens, cache = new Map()) {
  if (!cache.has(name)) {
    const labels = new Map();
    try {
      const catalogs = cache.get("__catalogs") ?? getRuleCatalogs();
      cache.set("__catalogs", catalogs);
      for (const group of catalogs[name] ?? []) {
        for (const option of group.options) {
          const key = normalizeToken(option.value);
          if (!labels.has(key)) labels.set(key, option.label);
        }
      }
    } catch {
      labels.clear();
    }
    cache.set(name, labels);
  }
  const labels = cache.get(name);
  return parseTokenList(tokens).map(value => labels.get(value) || value);
}
