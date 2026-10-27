import { MODULE_ID } from "../constants.js";
import { convertWeightToLbs } from "./units.js";

export { convertWeightToLbs };

export function num(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function getItemUnitWeight(item) {
  return num(item?.system?.weight?.value, 0);
}

export function getItemWeightUnits(item) {
  return item?.system?.weight?.units || null;
}

export function getItemQuantity(item) {
  return num(item?.system?.quantity, 1);
}

export function ownWeightLbs(item, defaultUnit = "lb") {
  return convertWeightToLbs(
    getItemUnitWeight(item),
    getItemWeightUnits(item),
    defaultUnit
  ) * getItemQuantity(item);
}

/**
 * A container's own weight, without contents. dnd5e's ContainerData.totalWeight
 * does not multiply a container by its quantity, so neither do we.
 */
export function containerOwnWeightLbs(item, defaultUnit = "lb") {
  return convertWeightToLbs(
    getItemUnitWeight(item),
    getItemWeightUnits(item),
    defaultUnit
  );
}

export function getItemProperties(item) {
  const properties = item?.system?.properties;
  if (properties instanceof Set) return properties;
  if (Array.isArray(properties)) return new Set(properties);
  return new Set();
}

/**
 * dnd5e's own "contents weigh nothing" flag. A container carrying it reports
 * only its own weight, so the module must not count what is inside either.
 */
export function isWeightlessContainer(item) {
  return isContainer(item) && getItemProperties(item).has("weightlessContents");
}

export function getReductionPct(containerItem) {
  const value = Number(containerItem?.flags?.[MODULE_ID]?.reductionPct ?? 0);
  if (!Number.isFinite(value)) return 0;
  return clamp(Math.round(value), 0, 100);
}

/**
 * A container's weight capacity in pounds, or null when it declares none.
 * @param {Object} containerItem
 * @param {string} defaultUnit
 * @returns {number|null}
 */
export function getCapacityLbs(containerItem, defaultUnit = "lb") {
  const weight = containerItem?.system?.capacity?.weight;
  const value = num(weight?.value, 0);
  return value > 0 ? convertWeightToLbs(value, weight.units, defaultUnit) : null;
}

/**
 * A container's item-count capacity, or null when it declares none.
 * dnd5e prefers `capacity.count` over `capacity.weight` when both are set.
 * @param {Object} containerItem
 * @returns {number|null}
 */
export function getCapacityCount(containerItem) {
  const count = num(containerItem?.system?.capacity?.count, 0);
  return count > 0 ? count : null;
}

export function isContainer(item) {
  return item?.type === "container";
}
