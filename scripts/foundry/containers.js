import {
  buildContainerIndex,
  computeActorCarriedLbs as computeActorCarriedLbsCore,
  computeAdjustedLoad as computeAdjustedLoadCore,
  computeContainerLoadFromContents,
  computeContentsCount,
  evaluateContainerChanges,
  getCarriedShare as getCarriedShareCore
} from "../core/containers.js";
import {
  getReductionPct,
  validateContainerRestrictions as validateContainerRestrictionsCore
} from "../core/rules.js";
import {
  getCapacityCount,
  getCapacityLbs as resolveCapacityLbs,
  isContainer,
  lbsToUnit
} from "../core/weight.js";
import {
  actorCurrencyLbs,
  containerCurrencyLbs,
  getSystemWeightUnit,
  getUnitConversionTable,
  getWeaponTypeMap,
  getWeightUnitLabel,
  lbsToDisplay,
  makeEncumbranceItemFilter
} from "../integrations/dnd5e.js";
import { LOG } from "./logger.js";
import { getModuleSetting } from "./runtime.js";

const onCycle = containerId => LOG.warn("Cycle detected", { containerId });

function hostWeightOptions() {
  return {
    defaultUnit: getSystemWeightUnit(),
    unitTable: getUnitConversionTable(),
    currencyLbs: containerCurrencyLbs,
    onCycle
  };
}

export function getCapacityLbs(containerItem) {
  const capacityLbs = resolveCapacityLbs(
    containerItem,
    getSystemWeightUnit(),
    getUnitConversionTable()
  );
  if (capacityLbs == null) {
    LOG.debug("capacity not resolved", {
      item: containerItem?.name,
      capacity: containerItem?.system?.capacity
    });
  }
  return capacityLbs;
}

export function computeAdjustedLoad(actor, containerId) {
  const { load, trace } = computeAdjustedLoadCore(actor, containerId, {
    includeNested: getModuleSetting("includeNested") !== false,
    ...hostWeightOptions()
  });
  return { load, trace };
}

// Carried weight always counts nested contents, matching the patched sheet.
export function computeActorCarriedLbs(actor) {
  return computeActorCarriedLbsCore(actor, {
    ...hostWeightOptions(),
    validateItem: makeEncumbranceItemFilter(actor),
    actorCurrencyLbs: actorCurrencyLbs(actor)
  });
}

// Matches computeActorCarriedLbs above, so no includeNested here either.
export function getCarriedShare(actor, item) {
  return getCarriedShareCore(actor, item, {
    validateItem: makeEncumbranceItemFilter(actor)
  });
}

export function validateContainerRestrictions(containerItem, itemData) {
  return validateContainerRestrictionsCore(containerItem, itemData, {
    weaponTypeMap: getWeaponTypeMap()
  });
}

export function getContainerLoad(actor, containerId) {
  if (!actor || !containerId) return null;
  const container = actor.items?.get?.(containerId) ?? null;
  if (!container) return null;

  const { load } = computeAdjustedLoad(actor, containerId);
  const capacityLbs = getCapacityLbs(container);
  const hasWeightCapacity = typeof capacityLbs === "number" && capacityLbs > 0;
  const capacityCount = getCapacityCount(container);
  const count = computeContentsCount(actor, containerId);
  const kind = capacityCount ? "count" : (hasWeightCapacity ? "weight" : null);
  const [value, max] = kind === "count" ? [count, capacityCount] : [load, capacityLbs];
  const round = num => Number(Number(num).toFixed(2));

  return {
    loadLbs: round(load),
    capacityLbs: hasWeightCapacity ? round(capacityLbs) : null,
    load: round(lbsToDisplay(load)),
    capacity: hasWeightCapacity ? round(lbsToDisplay(capacityLbs)) : null,
    count,
    capacityCount,
    kind,
    unit: getSystemWeightUnit(),
    reductionPct: getReductionPct(container),
    pct: kind ? Math.min(100, Math.max(0, Math.round((value / max) * 100))) : null,
    isOver: kind ? value > max : false,
    hasCapacity: Boolean(kind)
  };
}

/**
 * Pre-reduction contents weight of a container in its own weight units, used
 * to seed the rules dialog slider preview. Returns null when contents cannot
 * be read synchronously (such as compendium items).
 */
function resolveContainerRawLbs(containerItem, defaultUnit, unitTable) {
  if (containerItem.parent?.items) {
    return computeAdjustedLoadCore(containerItem.parent, containerItem.id, {
      includeNested: true,
      defaultUnit,
      unitTable,
      currencyLbs: containerCurrencyLbs,
      onCycle
    }).rawLbs;
  }
  const contents = containerItem.system?.contents;
  if (!contents || typeof contents[Symbol.iterator] !== "function") return null;
  return computeContainerLoadFromContents(containerItem, contents, {
    includeNested: true,
    defaultUnit,
    unitTable,
    currencyLbs: containerCurrencyLbs,
    onCycle
  })?.rawLbs ?? null;
}

export function getContainerRawPreviewWeight(containerItem) {
  if (!containerItem) return null;
  const defaultUnit = getSystemWeightUnit();
  const unitTable = getUnitConversionTable();
  const targetUnit = containerItem.system?.weight?.units || defaultUnit;
  const rawLbs = resolveContainerRawLbs(containerItem, defaultUnit, unitTable);
  if (typeof rawLbs !== "number") return null;
  return {
    raw: Number(lbsToUnit(rawLbs, targetUnit, unitTable).toFixed(4)),
    unit: getWeightUnitLabel(targetUnit)
  };
}

export function evaluateContainerChange(actor, candidates, { stopOnRestriction = false } = {}) {
  return evaluateContainerChanges(actor, candidates, {
    includeNested: getModuleSetting("includeNested") !== false,
    ...hostWeightOptions(),
    weaponTypeMap: getWeaponTypeMap(),
    stopOnRestriction
  });
}

export function summarizeActorContainers(actor) {
  const index = buildContainerIndex(actor);
  const memo = new Map();
  const options = {
    includeNested: getModuleSetting("includeNested") !== false,
    ...hostWeightOptions(),
    index,
    memo
  };
  const summary = {};
  for (const item of actor.items) {
    if (!isContainer(item)) continue;
    const { load, trace } = computeAdjustedLoadCore(actor, item.id, options);
    summary[item.name] = {
      id: item.id,
      capacityLbs: getCapacityLbs(item),
      loadLbs: load,
      loadDisplay: Number(lbsToDisplay(load).toFixed(2)),
      reductionPct: getReductionPct(item),
      contentsWeight: item.system.contentsWeight,
      totalWeight: item.system.totalWeight,
      trace
    };
  }
  return summary;
}
