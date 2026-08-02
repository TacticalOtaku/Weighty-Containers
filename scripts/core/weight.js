import { LBS_PER_KG, MODULE_ID } from "../constants.js";

export function num(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function convertWeightToLbs(value, units, defaultUnit = "lb") {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  const normalizedUnit = String(units || defaultUnit).toLowerCase().trim();
  switch (normalizedUnit) {
    case "lb":
    case "lbs":
      return parsed;
    case "kg":
    case "kgs":
    case "kilogram":
    case "kilograms":
      return parsed * LBS_PER_KG;
    case "oz":
    case "ounce":
    case "ounces":
      return parsed / 16;
    default:
      return parsed;
  }
}

export function getItemUnitWeight(item) {
  const weight = item?.system?.weight;
  if (weight == null) return 0;
  return typeof weight === "object" ? num(weight.value, 0) : num(weight, 0);
}

export function getItemWeightUnits(item) {
  const weight = item?.system?.weight;
  return weight && typeof weight === "object" ? weight.units || null : null;
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

export function getReductionPct(containerItem) {
  const value = Number(containerItem?.flags?.[MODULE_ID]?.reductionPct ?? 0);
  if (!Number.isFinite(value)) return 0;
  return clamp(Math.round(value), 0, 100);
}

export function getCapacityLbs(containerItem, defaultUnit = "lb") {
  const capacity = containerItem?.system?.capacity;
  if (!capacity) return null;

  if (capacity.weight?.value != null) {
    const value = num(capacity.weight.value, 0);
    if (value > 0) {
      return convertWeightToLbs(
        value,
        capacity.weight.units,
        defaultUnit
      );
    }
  }

  if (capacity.value != null && Number.isFinite(Number(capacity.value))) {
    const valueLbs = convertWeightToLbs(
      capacity.value,
      capacity.units,
      defaultUnit
    );
    if (valueLbs > 0) return valueLbs;
  }

  if (typeof capacity === "number" && capacity > 0) return capacity;
  return null;
}

export function isContainer(item) {
  return item?.type === "container";
}
