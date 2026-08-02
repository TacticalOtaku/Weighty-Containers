import {
  getCapacityLbs,
  getReductionPct,
  isContainer,
  ownWeightLbs
} from "./weight.js";

const LOAD_EPSILON = 0.00001;

export class ItemCollectionView {
  constructor(items = []) {
    this.items = new Map(Array.from(items, item => [item.id, item]));
  }

  get(id) {
    return this.items.get(id);
  }

  find(predicate) {
    return Array.from(this.items.values()).find(predicate);
  }

  [Symbol.iterator]() {
    return this.items.values();
  }
}

export function getItem(actor, id) {
  return actor?.items?.get(id) ?? null;
}

export function buildContainerIndex(actor) {
  const index = new Map();
  if (!actor?.items) return index;
  for (const item of actor.items) {
    const containerId = item.system?.container ?? null;
    if (!containerId) continue;
    if (!index.has(containerId)) index.set(containerId, []);
    index.get(containerId).push(item);
  }
  return index;
}

export function collectContainerAncestorIds(actor, containerId) {
  const ancestors = [];
  const visited = new Set();
  let currentId = containerId;
  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const container = getItem(actor, currentId);
    if (!container || !isContainer(container)) break;
    ancestors.push(currentId);
    currentId = container.system?.container ?? null;
  }
  return ancestors;
}

export function computeAdjustedLoad(
  actor,
  containerId,
  {
    includeNested = true,
    defaultUnit = "lb",
    index = null,
    memo = null,
    visited = null,
    onCycle = null
  } = {}
) {
  const trace = [];
  if (!actor || !containerId) return { load: 0, trace };

  const containerIndex = index ?? buildContainerIndex(actor);
  const memoMap = memo ?? new Map();
  const visitedIds = visited ?? new Set();
  const container = getItem(actor, containerId);
  const reduction = getReductionPct(container) / 100;
  const memoKey = `${containerId}|${includeNested}|${defaultUnit}|${reduction}`;

  if (memoMap.has(memoKey)) {
    return { load: memoMap.get(memoKey), trace };
  }
  if (visitedIds.has(containerId)) {
    onCycle?.(containerId);
    memoMap.set(memoKey, 0);
    return { load: 0, trace: [{ type: "cycle-break", id: containerId }] };
  }

  visitedIds.add(containerId);
  let load = 0;
  for (const child of containerIndex.get(containerId) ?? []) {
    const weightLbs = ownWeightLbs(child, defaultUnit);
    const reducedWeight = weightLbs * (1 - reduction);
    if (isContainer(child)) {
      load += reducedWeight;
      trace.push({
        child: child.name,
        id: child.id,
        type: "container-self",
        wLbs: weightLbs,
        reduction,
        added: reducedWeight
      });
      if (includeNested) {
        const nested = computeAdjustedLoad(actor, child.id, {
          includeNested,
          defaultUnit,
          index: containerIndex,
          memo: memoMap,
          visited: visitedIds,
          onCycle
        });
        load += nested.load;
        trace.push({
          child: child.name,
          id: child.id,
          type: "container-contents",
          nestedLoad: nested.load
        });
      }
    } else {
      load += reducedWeight;
      trace.push({
        child: child.name,
        id: child.id,
        type: "item",
        wLbs: weightLbs,
        reduction,
        added: reducedWeight
      });
    }
  }

  visitedIds.delete(containerId);
  load = Math.max(0, Number(load.toFixed(5)));
  memoMap.set(memoKey, load);
  return { load, trace };
}

export function computeActorCarriedLbs(
  actor,
  { includeNested = true, defaultUnit = "lb", onCycle = null } = {}
) {
  if (!actor?.items) return 0;
  let total = 0;
  const index = buildContainerIndex(actor);
  const memo = new Map();
  for (const item of actor.items) {
    if (item.system?.container) continue;
    total += ownWeightLbs(item, defaultUnit);
    if (isContainer(item)) {
      total += computeAdjustedLoad(actor, item.id, {
        includeNested,
        defaultUnit,
        index,
        memo,
        onCycle
      }).load;
    }
  }
  return Math.max(0, Number(total.toFixed(5)));
}

export function createProjectedActor(actor, candidateItem) {
  const items = [];
  let replaced = false;
  for (const item of actor?.items ?? []) {
    if (item.id === candidateItem.id) {
      items.push(candidateItem);
      replaced = true;
    } else {
      items.push(item);
    }
  }
  if (!replaced) items.push(candidateItem);
  return { items: new ItemCollectionView(items) };
}

export function findCapacityViolations(
  currentActor,
  projectedActor,
  { includeNested = true, defaultUnit = "lb", onCycle = null } = {}
) {
  const violations = [];
  const currentIndex = buildContainerIndex(currentActor);
  const projectedIndex = buildContainerIndex(projectedActor);
  const currentMemo = new Map();
  const projectedMemo = new Map();

  for (const projectedContainer of projectedActor?.items ?? []) {
    if (!isContainer(projectedContainer)) continue;
    const capacityLbs = getCapacityLbs(projectedContainer, defaultUnit);
    if (!capacityLbs) continue;

    const currentContainer = getItem(currentActor, projectedContainer.id);
    const beforeLbs = currentContainer
      ? computeAdjustedLoad(currentActor, currentContainer.id, {
        includeNested,
        defaultUnit,
        index: currentIndex,
        memo: currentMemo,
        onCycle
      }).load
      : 0;
    const afterLbs = computeAdjustedLoad(projectedActor, projectedContainer.id, {
      includeNested,
      defaultUnit,
      index: projectedIndex,
      memo: projectedMemo,
      onCycle
    }).load;
    const previousCapacityLbs = currentContainer
      ? getCapacityLbs(currentContainer, defaultUnit)
      : null;
    const loadIncreased = afterLbs > beforeLbs + LOAD_EPSILON;
    const capacityDecreased = previousCapacityLbs != null
      && capacityLbs < previousCapacityLbs - LOAD_EPSILON;

    if (afterLbs > capacityLbs + LOAD_EPSILON
        && (loadIncreased || capacityDecreased || !currentContainer)) {
      violations.push({
        container: projectedContainer,
        capacityLbs,
        beforeLbs,
        afterLbs,
        deltaLbs: Math.max(0, afterLbs - beforeLbs)
      });
    }
  }
  return violations;
}
