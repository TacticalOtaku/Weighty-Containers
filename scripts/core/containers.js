import {
  containerOwnWeightLbs,
  getCapacityCount,
  getCapacityLbs,
  getItemQuantity,
  getReductionPct,
  isContainer,
  isWeightlessContainer,
  ownWeightLbs
} from "./weight.js";

const LOAD_EPSILON = 0.00001;

/** Currency is priced by the host; core stays free of game settings. */
const NO_CURRENCY = () => 0;

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

/**
 * Number of items inside a container, including sub-container contents.
 * Mirrors dnd5e's `contentsCount`, which sums quantities.
 */
export function computeContentsCount(actor, containerId, {
  index = null,
  visited = null
} = {}) {
  if (!actor || !containerId) return 0;
  const containerIndex = index ?? buildContainerIndex(actor);
  const visitedIds = visited ?? new Set();
  if (visitedIds.has(containerId)) return 0;
  visitedIds.add(containerId);

  let count = 0;
  for (const child of containerIndex.get(containerId) ?? []) {
    count += getItemQuantity(child);
    if (isContainer(child)) {
      count += computeContentsCount(actor, child.id, {
        index: containerIndex,
        visited: visitedIds
      });
    }
  }
  visitedIds.delete(containerId);
  return count;
}

/**
 * Weight of everything inside a container, in pounds, with weight reductions
 * applied.
 *
 * The shape mirrors dnd5e's ContainerData#contentsWeight so the two never
 * disagree: children contribute their full total weight (a sub-container
 * contributes its own weight plus its own already-reduced contents), the
 * container's carried currency is included, and the container's reduction then
 * scales the whole sum. Reductions therefore compound through nesting - a 50%
 * bag holding a 50% pouch quarters what is in the pouch.
 *
 * @param {Object} actor
 * @param {string} containerId
 * @param {Object} [options]
 * @param {boolean} [options.includeNested]  Walk into sub-containers.
 * @param {string} [options.defaultUnit]     Unit assumed when an item declares none.
 * @param {Function} [options.currencyLbs]   `(container) => number`
 * @param {Function} [options.onCycle]       Called with the id that closed a cycle.
 * @returns {{load: number, trace: Array}}
 */
export function computeAdjustedLoad(
  actor,
  containerId,
  {
    includeNested = true,
    defaultUnit = "lb",
    index = null,
    memo = null,
    visited = null,
    currencyLbs = NO_CURRENCY,
    onCycle = null
  } = {}
) {
  const trace = [];
  if (!actor || !containerId) return { load: 0, trace };

  const containerIndex = index ?? buildContainerIndex(actor);
  const memoMap = memo ?? new Map();
  const visitedIds = visited ?? new Set();
  const container = getItem(actor, containerId);

  if (isWeightlessContainer(container)) {
    return { load: 0, trace: [{ type: "weightless", id: containerId }] };
  }

  const reduction = getReductionPct(container) / 100;
  const memoKey = `${containerId}|${includeNested}|${defaultUnit}`;

  if (memoMap.has(memoKey)) {
    return { load: memoMap.get(memoKey), trace };
  }
  if (visitedIds.has(containerId)) {
    // Deliberately not memoized: reaching this container through a cycle says
    // nothing about its load on a well-formed path.
    onCycle?.(containerId);
    return { load: 0, trace: [{ type: "cycle-break", id: containerId }] };
  }

  visitedIds.add(containerId);
  let raw = 0;
  for (const child of containerIndex.get(containerId) ?? []) {
    if (isContainer(child)) {
      const ownLbs = containerOwnWeightLbs(child, defaultUnit);
      raw += ownLbs;
      trace.push({
        child: child.name,
        id: child.id,
        type: "container-self",
        wLbs: ownLbs
      });
      if (includeNested) {
        const nested = computeAdjustedLoad(actor, child.id, {
          includeNested,
          defaultUnit,
          index: containerIndex,
          memo: memoMap,
          visited: visitedIds,
          currencyLbs,
          onCycle
        });
        raw += nested.load;
        trace.push({
          child: child.name,
          id: child.id,
          type: "container-contents",
          nestedLoad: nested.load
        });
      }
    } else {
      const weightLbs = ownWeightLbs(child, defaultUnit);
      raw += weightLbs;
      trace.push({
        child: child.name,
        id: child.id,
        type: "item",
        wLbs: weightLbs
      });
    }
  }

  const currency = Number(currencyLbs(container)) || 0;
  if (currency) {
    raw += currency;
    trace.push({ type: "currency", wLbs: currency });
  }

  visitedIds.delete(containerId);
  const load = Math.max(0, Number((raw * (1 - reduction)).toFixed(5)));
  trace.push({ type: "reduction", reduction, rawLbs: raw, load });
  memoMap.set(memoKey, load);
  return { load, trace };
}

/**
 * Total weight an actor carries, in pounds, with reductions applied.
 *
 * @param {Object} actor
 * @param {Object} [options]
 * @param {Function} [options.validateItem]   `(item) => boolean`, mirrors dnd5e's filter.
 * @param {Function} [options.currencyLbs]    `(document) => number`, for containers.
 * @param {number} [options.actorCurrencyLbs] Weight of the actor's own coins.
 */
export function computeActorCarriedLbs(
  actor,
  {
    includeNested = true,
    defaultUnit = "lb",
    validateItem = null,
    currencyLbs = NO_CURRENCY,
    actorCurrencyLbs = 0,
    onCycle = null
  } = {}
) {
  if (!actor?.items) return 0;
  let total = Number(actorCurrencyLbs) || 0;
  const index = buildContainerIndex(actor);
  const memo = new Map();
  for (const item of actor.items) {
    if (item.system?.container) continue;
    if (validateItem && !validateItem(item)) continue;
    if (isContainer(item)) {
      total += containerOwnWeightLbs(item, defaultUnit);
      total += computeAdjustedLoad(actor, item.id, {
        includeNested,
        defaultUnit,
        index,
        memo,
        currencyLbs,
        onCycle
      }).load;
    } else {
      total += ownWeightLbs(item, defaultUnit);
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

/**
 * Containers that the projected change would push past their capacity.
 *
 * Both weight and item-count capacities are checked. A container that is
 * already over capacity is only reported when the change makes it worse, so
 * unrelated edits to items already inside are never blocked.
 */
export function findCapacityViolations(
  currentActor,
  projectedActor,
  {
    includeNested = true,
    defaultUnit = "lb",
    currencyLbs = NO_CURRENCY,
    onCycle = null
  } = {}
) {
  const violations = [];
  const currentIndex = buildContainerIndex(currentActor);
  const projectedIndex = buildContainerIndex(projectedActor);
  const currentMemo = new Map();
  const projectedMemo = new Map();

  for (const projectedContainer of projectedActor?.items ?? []) {
    if (!isContainer(projectedContainer)) continue;
    if (isWeightlessContainer(projectedContainer)) continue;

    const currentContainer = getItem(currentActor, projectedContainer.id);
    const countCapacity = getCapacityCount(projectedContainer);
    const capacityLbs = countCapacity ? null : getCapacityLbs(projectedContainer, defaultUnit);
    if (!countCapacity && !capacityLbs) continue;

    const measure = countCapacity
      ? (actorLike, index) => computeContentsCount(actorLike, projectedContainer.id, { index })
      : (actorLike, index, memo) => computeAdjustedLoad(actorLike, projectedContainer.id, {
        includeNested,
        defaultUnit,
        index,
        memo,
        currencyLbs,
        onCycle
      }).load;

    const before = currentContainer ? measure(currentActor, currentIndex, currentMemo) : 0;
    const after = measure(projectedActor, projectedIndex, projectedMemo);
    const capacity = countCapacity ?? capacityLbs;
    const previousCapacity = currentContainer
      ? (countCapacity
        ? getCapacityCount(currentContainer)
        : getCapacityLbs(currentContainer, defaultUnit))
      : null;

    const loadIncreased = after > before + LOAD_EPSILON;
    const capacityDecreased = previousCapacity != null
      && capacity < previousCapacity - LOAD_EPSILON;

    if (after > capacity + LOAD_EPSILON
        && (loadIncreased || capacityDecreased || !currentContainer)) {
      violations.push({
        container: projectedContainer,
        kind: countCapacity ? "count" : "weight",
        capacity,
        before,
        after,
        delta: Math.max(0, after - before),
        // Weight-shaped aliases kept for API consumers written against 3.4.0.
        capacityLbs: countCapacity ? null : capacity,
        capacityCount: countCapacity ?? null,
        beforeLbs: countCapacity ? null : before,
        afterLbs: countCapacity ? null : after,
        deltaLbs: countCapacity ? null : Math.max(0, after - before)
      });
    }
  }
  return violations;
}
