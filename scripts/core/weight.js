// ─────────────────────────────────────────────────────────
// Weight arithmetic and unit conversion.
//
// dnd5e owns the conversion table (CONFIG.DND5E.weightUnits). Notably its
// kilogram is 2.5 lb, not the physical 2.20462 - the system uses the DMG's
// round metric conversion. DEFAULT_UNIT_CONVERSION mirrors dnd5e 5.3.3 for
// offline tests and early startup; runtime callers pass the normalized table
// read from CONFIG.DND5E.weightUnits with no hidden mutable state here.
// ─────────────────────────────────────────────────────────

import { getItemPropertyTokens } from "./rules.js";

/** Pounds per unit, keyed by lowercase unit token. Mirrors dnd5e 5.3.3. */
export const DEFAULT_UNIT_CONVERSION = Object.freeze({
  lb: 1,
  lbs: 1,
  pound: 1,
  pounds: 1,
  tn: 2000,
  ton: 2000,
  tons: 2000,
  kg: 2.5,
  kgs: 2.5,
  kilogram: 2.5,
  kilograms: 2.5,
  mg: 2500,
  oz: 1 / 16,
  ounce: 1 / 16,
  ounces: 1 / 16
});

/**
 * Normalize a `CONFIG.DND5E.weightUnits`-shaped table into a stateless lookup
 * merged over {@link DEFAULT_UNIT_CONVERSION}.
 * @param {Object} table  `{ [unit]: number | { conversion: number } }`
 * @returns {Object}
 */
export function normalizeUnitConversionTable(table) {
  const next = { ...DEFAULT_UNIT_CONVERSION };
  for (const [unit, entry] of Object.entries(table ?? {})) {
    const factor = typeof entry === "number" ? entry : Number(entry?.conversion);
    if (!Number.isFinite(factor) || factor <= 0) continue;
    next[String(unit).toLowerCase()] = factor;
  }
  return Object.freeze(next);
}

/**
 * Pounds in one of `unit`, or null when the unit is unknown.
 * @param {string} unit
 * @param {Object} [unitTable]
 * @returns {number|null}
 */
export function lbsPerUnit(unit, unitTable = DEFAULT_UNIT_CONVERSION) {
  const key = String(unit ?? "").toLowerCase().trim();
  return unitTable[key] ?? null;
}

/**
 * Convert a weight to pounds. Unknown units pass through unchanged, matching
 * dnd5e's non-strict `convertWeight`.
 */
export function convertWeightToLbs(
  value,
  units,
  defaultUnit = "lb",
  unitTable = DEFAULT_UNIT_CONVERSION
) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return parsed * (lbsPerUnit(units || defaultUnit, unitTable) ?? 1);
}

/**
 * Convert pounds into `unit`. Unknown units pass through unchanged.
 */
export function lbsToUnit(lbs, unit, unitTable = DEFAULT_UNIT_CONVERSION) {
  const parsed = Number(lbs);
  if (!Number.isFinite(parsed)) return 0;
  return parsed / (lbsPerUnit(unit, unitTable) ?? 1);
}

function num(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function isContainer(item) {
  return item?.type === "container";
}

/**
 * dnd5e's own "contents weigh nothing" flag. A container carrying it reports
 * only its own weight, so the module must not count what is inside either.
 */
export function isWeightlessContainer(item) {
  return isContainer(item) && getItemPropertyTokens(item).has("weightlesscontents");
}

export function ownWeightLbs(item, defaultUnit = "lb", unitTable = DEFAULT_UNIT_CONVERSION) {
  return convertWeightToLbs(
    num(item?.system?.weight?.value, 0),
    item?.system?.weight?.units || null,
    defaultUnit,
    unitTable
  ) * num(item?.system?.quantity, 1);
}

/**
 * A container's own weight, without contents. dnd5e's ContainerData.totalWeight
 * does not multiply a container by its quantity, so neither do we.
 */
export function containerOwnWeightLbs(
  item,
  defaultUnit = "lb",
  unitTable = DEFAULT_UNIT_CONVERSION
) {
  return convertWeightToLbs(
    num(item?.system?.weight?.value, 0),
    item?.system?.weight?.units || null,
    defaultUnit,
    unitTable
  );
}

/**
 * A container's weight capacity in pounds, or null when it declares none.
 * @returns {number|null}
 */
export function getCapacityLbs(
  containerItem,
  defaultUnit = "lb",
  unitTable = DEFAULT_UNIT_CONVERSION
) {
  const weight = containerItem?.system?.capacity?.weight;
  const value = num(weight?.value, 0);
  return value > 0
    ? convertWeightToLbs(value, weight.units, defaultUnit, unitTable)
    : null;
}

/**
 * A container's item-count capacity, or null when it declares none.
 * dnd5e prefers `capacity.count` over `capacity.weight` when both are set.
 * @returns {number|null}
 */
export function getCapacityCount(containerItem) {
  const count = num(containerItem?.system?.capacity?.count, 0);
  return count > 0 ? count : null;
}
