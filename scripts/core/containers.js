import { MODULE_ID } from "../constants.js";
import { getReductionPct, validateContainerRestrictions } from "./rules.js";
import {
  DEFAULT_UNIT_CONVERSION,
  containerOwnWeightLbs,
  getCapacityCount,
  getCapacityLbs,
  isContainer,
  isWeightlessContainer,
  ownWeightLbs
} from "./weight.js";

const LOAD_EPSILON = 0.00001;

/** Currency is priced by the host; core stays free of game settings. */
const NO_CURRENCY = () => 0;

/**
 * Item change paths that can move weight or break a content rule. Updates
 * touching none of them (charges, equipped, name...) skip projection.
 */
const RELEVANT_CHANGE_PATHS = [
  ["type"],
  ["system", "container"],
  ["system", "quantity"],
  ["system", "weight"],
  ["system", "capacity"],
  ["system", "currency"],
  ["system", "properties"],
  ["system", "type"],
  ["flags", MODULE_ID]
];

function touchesPath(changes, path) {
  let node = changes;
  for (const key of path) {
    if (!node || typeof node !== "object") return false;
    // Foundry's deletion syntax (`-=key`) removes the value outright.
    if (Object.hasOwn(node, `-=${key}`)) return true;
    if (!Object.hasOwn(node, key)) return false;
    node = node[key];
  }
  return true;
}

export function isRelevantExpandedChange(expanded) {
  return RELEVANT_CHANGE_PATHS.some(path => touchesPath(expanded, path));
}

export class ItemCollectionView {
  constructor(items = []) {
    this.items = new Map(Array.from(items, item => [item.id, item]));
  }

  get(id) {
    return this.items.get(id);
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
    const qty = Number(child?.system?.quantity);
    count += Number.isFinite(qty) ? qty : 1;
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

function accumulateContainerLoad(
  container,
  containerKey,
  getChildren,
  {
    includeNested,
    defaultUnit,
    unitTable,
    memo,
    visited,
    currencyLbs,
    onCycle
  }
) {
  const trace = [];
  const memoKey = containerKey == null ? null : `${containerKey}|${includeNested}|${defaultUnit}`;
  if (memoKey && memo?.has(memoKey)) {
    return { ...memo.get(memoKey), trace };
  }
  if (visited.has(containerKey)) {
    // Deliberately not memoized: reaching this container through a cycle says
    // nothing about its load on a well-formed path.
    onCycle?.(containerKey);
    return { load: 0, rawLbs: 0, trace: [{ type: "cycle-break", id: containerKey }] };
  }

  const children = getChildren(container, containerKey);
  if (children == null) return null;

  visited.add(containerKey);
  let raw = 0;
  for (const child of children) {
    if (isContainer(child)) {
      const ownLbs = containerOwnWeightLbs(child, defaultUnit, unitTable);
      raw += ownLbs;
      trace.push({
        child: child.name,
        id: child.id,
        type: "container-self",
        wLbs: ownLbs
      });
      // dnd5e's `weightlessContents` hides a sub-container's contents from
      // whatever holds it (ContainerData#totalWeight), not from the
      // sub-container's own capacity - so it is honoured here, one level up.
      if (isWeightlessContainer(child)) {
        trace.push({ child: child.name, id: child.id, type: "weightless" });
      } else if (includeNested) {
        const nestedKey = child.id ?? child;
        const nested = accumulateContainerLoad(child, nestedKey, getChildren, {
          includeNested,
          defaultUnit,
          unitTable,
          memo,
          visited,
          currencyLbs,
          onCycle
        });
        if (!nested) {
          visited.delete(containerKey);
          return null;
        }
        raw += nested.load;
        trace.push({
          child: child.name,
          id: child.id,
          type: "container-contents",
          nestedLoad: nested.load
        });
      }
    } else {
      const weightLbs = ownWeightLbs(child, defaultUnit, unitTable);
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

  visited.delete(containerKey);
  const reduction = getReductionPct(container) / 100;
  const rawLbs = Math.max(0, Number(raw.toFixed(5)));
  const load = Math.max(0, Number((raw * (1 - reduction)).toFixed(5)));
  trace.push({ type: "reduction", reduction, rawLbs: raw, load });
  if (memoKey && memo) memo.set(memoKey, { load, rawLbs });
  return { load, rawLbs, trace };
}

/**
 * Weight of everything inside a container, in pounds, with weight reductions
 * applied. This is the number dnd5e's capacity bar shows - including for a
 * container with `weightlessContents`, whose contents only stop counting for
 * whatever holds it.
 */
export function computeAdjustedLoad(
  actor,
  containerId,
  {
    includeNested = true,
    defaultUnit = "lb",
    unitTable = DEFAULT_UNIT_CONVERSION,
    index = null,
    memo = null,
    visited = null,
    currencyLbs = NO_CURRENCY,
    onCycle = null
  } = {}
) {
  if (!actor || !containerId) return { load: 0, rawLbs: 0, trace: [] };
  const containerIndex = index ?? buildContainerIndex(actor);
  const memoMap = memo ?? new Map();
  const visitedIds = visited ?? new Set();
  const container = getItem(actor, containerId);

  return accumulateContainerLoad(
    container,
    containerId,
    (_entry, id) => containerIndex.get(id) ?? [],
    {
      includeNested,
      defaultUnit,
      unitTable,
      memo: memoMap,
      visited: visitedIds,
      currencyLbs,
      onCycle
    }
  );
}

/**
 * Compute adjusted and raw load in pounds directly from a container item and
 * its resolved children collection (used for standalone ContainerData and
 * unowned world containers). Returns null when contents are unavailable or
 * async during nested traversal.
 */
export function computeContainerLoadFromContents(
  containerItem,
  directContents,
  {
    includeNested = true,
    defaultUnit = "lb",
    unitTable = DEFAULT_UNIT_CONVERSION,
    currencyLbs = NO_CURRENCY,
    onCycle = null
  } = {}
) {
  if (!directContents || typeof directContents[Symbol.iterator] !== "function") {
    return null;
  }
  const rootKey = containerItem?.id ?? containerItem ?? Symbol("container");
  return accumulateContainerLoad(
    containerItem,
    rootKey,
    entry => {
      if (entry === containerItem) return directContents;
      const nested = entry?.system?.contents;
      if (!nested || typeof nested[Symbol.iterator] !== "function") return null;
      return nested;
    },
    {
      includeNested,
      defaultUnit,
      unitTable,
      memo: null,
      visited: new Set(),
      currencyLbs,
      onCycle
    }
  );
}

/**
 * Total weight an actor carries, in pounds, with reductions applied.
 */
export function computeActorCarriedLbs(
  actor,
  {
    includeNested = true,
    defaultUnit = "lb",
    unitTable = DEFAULT_UNIT_CONVERSION,
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
      total += containerOwnWeightLbs(item, defaultUnit, unitTable);
      if (isWeightlessContainer(item)) continue;
      total += computeAdjustedLoad(actor, item.id, {
        includeNested,
        defaultUnit,
        unitTable,
        index,
        memo,
        currencyLbs,
        onCycle
      }).load;
    } else {
      total += ownWeightLbs(item, defaultUnit, unitTable);
    }
  }
  return Math.max(0, Number(total.toFixed(5)));
}

/**
 * Share (0 to 1) of an item's own total weight that its actor carries, as
 * {@link computeActorCarriedLbs} counts it.
 */
export function getCarriedShare(actor, item, { includeNested = true, validateItem = null } = {}) {
  if (!item) return 0;
  let share = 1;
  let current = item;
  const visited = new Set();
  for (let depth = 0; current.system?.container; depth++) {
    if ((depth && !includeNested) || visited.has(current.id)) return 0;
    visited.add(current.id);
    const container = getItem(actor, current.system.container);
    if (!isContainer(container) || isWeightlessContainer(container)) return 0;
    share *= 1 - getReductionPct(container) / 100;
    current = container;
  }
  if (validateItem && !validateItem(current)) return 0;
  return share;
}

/**
 * The actor as it would look after a change to one or more items.
 */
export function createProjectedActor(actor, candidateItems) {
  const candidates = [].concat(candidateItems);
  const byId = new Map(candidates.filter(item => item?.id).map(item => [item.id, item]));
  const items = Array.from(actor?.items ?? [], item => byId.get(item.id) ?? item);
  for (const candidate of candidates) {
    if (!candidate?.id || !getItem(actor, candidate.id)) items.push(candidate);
  }
  return { items: new ItemCollectionView(items) };
}

/**
 * Containers that the projected change would push past their capacity.
 */
export function findCapacityViolations(
  currentActor,
  projectedActor,
  {
    includeNested = true,
    defaultUnit = "lb",
    unitTable = DEFAULT_UNIT_CONVERSION,
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

    const currentContainer = getItem(currentActor, projectedContainer.id);
    const countCapacity = getCapacityCount(projectedContainer);
    const capacityLbs = countCapacity
      ? null
      : getCapacityLbs(projectedContainer, defaultUnit, unitTable);
    if (!countCapacity && !capacityLbs) continue;

    const measure = countCapacity
      ? (actorLike, index) => computeContentsCount(actorLike, projectedContainer.id, { index })
      : (actorLike, index, memo) => computeAdjustedLoad(actorLike, projectedContainer.id, {
        includeNested,
        defaultUnit,
        unitTable,
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
        : getCapacityLbs(currentContainer, defaultUnit, unitTable))
      : null;

    const loadIncreased = after > before + LOAD_EPSILON;
    // A limit where there was none (or a new container) tightens the rule just
    // as lowering an existing limit does.
    const capacityDecreased = previousCapacity == null
      || capacity < previousCapacity - LOAD_EPSILON;

    if (after > capacity + LOAD_EPSILON && (loadIncreased || capacityDecreased)) {
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

/**
 * Evaluate candidate item creations/updates on an actor against container
 * entry restrictions and capacity rules, selecting the nearest-to-root
 * overflowing container first.
 */
export function evaluateContainerChanges(
  currentActor,
  candidates,
  {
    includeNested = true,
    defaultUnit = "lb",
    unitTable = DEFAULT_UNIT_CONVERSION,
    currencyLbs = NO_CURRENCY,
    weaponTypeMap = {},
    onCycle = null,
    stopOnRestriction = false
  } = {}
) {
  const projectedActor = createProjectedActor(currentActor, candidates);

  // Only validate content rules when an item is actually entering a
  // container. Re-checking on every edit freezes anything already inside a
  // container whose rules were tightened afterwards - it could not even be
  // equipped or renamed. Contents created together with their container find
  // no destination on the actor yet, so they pass.
  const restrictionFailures = [];
  for (const candidate of candidates) {
    const destinationId = candidate.system?.container ?? null;
    const previousId = getItem(currentActor, candidate.id)?.system?.container ?? null;
    if (!destinationId || destinationId === previousId || !getItem(currentActor, destinationId)) {
      continue;
    }
    const destination = getItem(projectedActor, destinationId);
    const result = validateContainerRestrictions(destination, candidate, { weaponTypeMap });
    if (!result.ok) {
      restrictionFailures.push({
        container: destination,
        itemData: candidate,
        restrictions: result.restrictions,
        reason: result.reason
      });
      if (stopOnRestriction) {
        return { ok: false, restrictionFailures, capacityViolation: null };
      }
    }
  }

  const violations = findCapacityViolations(currentActor, projectedActor, {
    includeNested,
    defaultUnit,
    unitTable,
    currencyLbs,
    onCycle
  });
  let capacityViolation = null;
  if (violations.length) {
    const preferredOrder = candidates.flatMap(candidate => [
      ...(candidate.system?.container
        ? collectContainerAncestorIds(projectedActor, candidate.system.container)
        : []),
      ...(isContainer(candidate) && candidate.id ? [candidate.id] : [])
    ]);
    capacityViolation = preferredOrder
      .map(containerId => violations.find(entry => entry.container.id === containerId))
      .find(Boolean) ?? violations[0];
  }

  return {
    ok: restrictionFailures.length === 0 && !capacityViolation,
    restrictionFailures,
    capacityViolation
  };
}
