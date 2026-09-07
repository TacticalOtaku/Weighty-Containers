// ─────────────────────────────────────────────────────────
// Weight units.
//
// dnd5e owns the conversion table (CONFIG.DND5E.weightUnits). Notably its
// kilogram is 2.5 lb, not the physical 2.20462 - the system uses the DMG's
// round metric conversion. Inventing our own factor here makes every number
// the module renders disagree with the sheet next to it, so the adapter
// installs the system's table at init and this file only holds the offline
// fallback used by unit tests.
// ─────────────────────────────────────────────────────────

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

let conversion = { ...DEFAULT_UNIT_CONVERSION };

/**
 * Replace the conversion table, normally from CONFIG.DND5E.weightUnits.
 * @param {Object} table  `{ [unit]: number | { conversion: number } }`
 * @returns {Object} the installed table
 */
export function setUnitConversionTable(table) {
  const next = { ...DEFAULT_UNIT_CONVERSION };
  for (const [unit, entry] of Object.entries(table ?? {})) {
    const factor = typeof entry === "number" ? entry : Number(entry?.conversion);
    if (!Number.isFinite(factor) || factor <= 0) continue;
    next[String(unit).toLowerCase()] = factor;
  }
  conversion = next;
  return conversion;
}

/** Restore the offline fallback table. Used by tests. */
export function resetUnitConversionTable() {
  conversion = { ...DEFAULT_UNIT_CONVERSION };
  return conversion;
}

/**
 * Pounds in one of `unit`, or null when the unit is unknown.
 * @param {string} unit
 * @returns {number|null}
 */
export function lbsPerUnit(unit) {
  const key = String(unit ?? "").toLowerCase().trim();
  return conversion[key] ?? null;
}

/**
 * Convert a weight to pounds. Unknown units pass through unchanged, matching
 * dnd5e's non-strict `convertWeight`.
 * @param {number} value
 * @param {string} units       Unit of `value`; falls back to `defaultUnit`.
 * @param {string} defaultUnit
 * @returns {number}
 */
export function convertWeightToLbs(value, units, defaultUnit = "lb") {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return parsed * (lbsPerUnit(units || defaultUnit) ?? 1);
}

/**
 * Convert pounds into `unit`. Unknown units pass through unchanged.
 * @param {number} lbs
 * @param {string} unit
 * @returns {number}
 */
export function lbsToUnit(lbs, unit) {
  const parsed = Number(lbs);
  if (!Number.isFinite(parsed)) return 0;
  return parsed / (lbsPerUnit(unit) ?? 1);
}
