import { MODULE_ID } from "../constants.js";
import {
  collectContainerAncestorIds,
  createProjectedActor,
  findCapacityViolations,
  getItem
} from "../core/containers.js";
import { validateContainerRestrictions } from "../core/restrictions.js";
import { isContainer } from "../core/weight.js";
import {
  containerCurrencyLbs,
  getSystemWeightUnit,
  getWeaponTypeMap,
  getWeightUnitLabel,
  lbsToDisplay
} from "../integrations/dnd5e.js";
import { ruleTokenLabels } from "../ui/rule-presentation.js";

function makeItemCandidate(item, changes = {}) {
  const source = item?.toObject?.() ?? {
    id: item?.id,
    name: item?.name,
    type: item?.type,
    flags: foundry.utils.deepClone(item?.flags ?? {}),
    system: foundry.utils.deepClone(item?.system ?? {})
  };
  const expanded = foundry.utils.expandObject(changes ?? {});
  const candidate = foundry.utils.mergeObject(source, expanded, {
    inplace: false,
    applyOperators: true
  });
  candidate.id ??= item?.id ?? candidate._id;
  return candidate;
}

/**
 * Change paths that can move weight or break a content rule. An update that
 * touches none of them (charges, equipped, description...) cannot create a
 * violation, so it skips the whole projection.
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

export function isRelevantItemChange(changes) {
  const expanded = foundry.utils.expandObject(changes ?? {});
  return RELEVANT_CHANGE_PATHS.some(path => touchesPath(expanded, path));
}

/**
 * Items created alongside this one in the same operation - dnd5e drops a
 * container together with its contents in one `createDocuments(..., {keepId})`
 * call. Without them the projection would weigh the container empty, and its
 * contents would point at a container that does not exist yet.
 */
function creationSiblings(options, candidate) {
  if (!options?.keepId || !Array.isArray(options.data)) return [];
  return options.data
    .filter(data => data && typeof data === "object" && data._id && data._id !== candidate.id)
    .map(data => ({ ...foundry.utils.deepClone(data), id: data._id }));
}

function localizeFallback(key, fallback) {
  const value = game.i18n?.localize?.(key);
  return value && value !== key ? value : fallback;
}

function makeRestrictionMessage({ containerName, itemName, restrictions }) {
  const details = [];
  const list = name => ruleTokenLabels(name, restrictions[name]).join(", ");
  if (restrictions.allowedTypes.length) {
    details.push(game.i18n.format(`${MODULE_ID}.restrictionMessage.types`, {
      types: list("allowedTypes")
    }));
  }
  if (restrictions.allowedSubtypes.length) {
    details.push(game.i18n.format(`${MODULE_ID}.restrictionMessage.subtypes`, {
      subtypes: list("allowedSubtypes")
    }));
  }
  if (restrictions.requiredProperties.length) {
    details.push(game.i18n.format(`${MODULE_ID}.restrictionMessage.properties`, {
      properties: list("requiredProperties")
    }));
  }
  if (restrictions.forbiddenProperties.length) {
    details.push(game.i18n.format(
      `${MODULE_ID}.restrictionMessage.forbiddenProperties`,
      { properties: list("forbiddenProperties") }
    ));
  }
  return game.i18n.format(`${MODULE_ID}.restrictionMessage.default`, {
    containerName: containerName
      ?? localizeFallback(`${MODULE_ID}.fallback.container`, "Container"),
    itemName: itemName ?? localizeFallback(`${MODULE_ID}.fallback.item`, "Item"),
    rules: details.join("; ")
  });
}

function getCustomExceedText() {
  try {
    return String(game.settings.get(MODULE_ID, "exceedMessageText") ?? "").trim();
  } catch {
    return "";
  }
}

/** `{name}` placeholders in the GM's custom text, left alone when unknown. */
function fillPlaceholders(template, values) {
  return template.replace(/\{(\w+)\}/g, (match, key) => (
    Object.hasOwn(values, key) ? String(values[key]) : match
  ));
}

export function makeCapacityMessage(violation) {
  const containerName = violation.containerName
    ?? localizeFallback(`${MODULE_ID}.fallback.container`, "Container");

  let key;
  let values;
  if (violation.kind === "count") {
    key = `${MODULE_ID}.exceedMessage.count`;
    values = {
      containerName,
      before: Math.round(violation.before),
      delta: Math.round(violation.delta),
      capacity: Math.round(violation.capacity),
      unit: localizeFallback(`${MODULE_ID}.fallback.items`, "items")
    };
  } else {
    key = `${MODULE_ID}.exceedMessage.default`;
    const format = value => Number(lbsToDisplay(value).toFixed(2));
    values = {
      containerName,
      before: format(violation.before),
      delta: format(violation.delta),
      capacity: format(violation.capacity),
      unit: getWeightUnitLabel(getSystemWeightUnit())
    };
  }

  const custom = getCustomExceedText();
  if (custom) return fillPlaceholders(custom, values);
  return game.i18n.format(key, values);
}

/**
 * Who should see a rejection.
 *
 * A player overfilling their own backpack is nobody else's business, so the
 * default is the acting user plus whichever GMs are online to notice a rule
 * they may want to relax.
 * @returns {string[]} user ids
 */
export function resolveNotificationTargets(scope, { actor = null } = {}) {
  const self = game.user?.id ? [game.user.id] : [];
  if (scope === "everyone") return game.users.filter(user => user.active).map(user => user.id);
  if (scope === "self") return self;
  const gms = game.users.filter(user => user.active && user.isGM).map(user => user.id);
  const owners = actor
    ? game.users.filter(user => user.active && actor.testUserPermission?.(user, "OWNER"))
      .map(user => user.id)
    : [];
  return Array.from(new Set([...self, ...gms, ...owners]));
}

function getNotifyScope() {
  try {
    return game.settings.get(MODULE_ID, "notifyScope") ?? "selfAndGm";
  } catch {
    return "selfAndGm";
  }
}

/**
 * Escape hatch for other modules and macros: `{ [MODULE_ID]: { bypass: true } }`.
 * A fresh object each call, since Foundry passes operation options around.
 */
export function bypassOption() {
  return { [MODULE_ID]: { bypass: true } };
}

function isBypassed(options) {
  return options?.[MODULE_ID]?.bypass === true;
}

export function registerEnforcementHooks({ logger, socket }) {
  const notify = (msg, payload, actor) => {
    const targets = resolveNotificationTargets(getNotifyScope(), { actor });
    socket.executeForUsers("notifyExceedRemote", targets, { msg, ...payload });
  };

  const notifyRestriction = ({ actor, actorName, containerName, itemName, restrictions }) => {
    const msg = makeRestrictionMessage({ containerName, itemName, restrictions });
    notify(msg, { actorName, containerName, itemName, restrictions }, actor);
    logger.info("container restriction failed", {
      actorName, containerName, itemName, restrictions
    });
  };

  const enforceRestrictions = (actor, container, itemData) => {
    const result = validateContainerRestrictions(container, itemData, {
      weaponTypeMap: getWeaponTypeMap()
    });
    if (result.ok) return true;
    notifyRestriction({
      actor,
      actorName: actor?.name,
      containerName: container?.name,
      itemName: itemData?.name,
      restrictions: result.restrictions
    });
    return game.settings.get(MODULE_ID, "enforceMode") !== "block";
  };

  const notifyCapacity = (violation, actor) => {
    const data = {
      containerName: violation.container?.name,
      kind: violation.kind,
      capacity: violation.capacity,
      before: violation.before,
      delta: violation.delta,
      // 3.4.0-shaped aliases
      capacityLbs: violation.capacityLbs,
      beforeLbs: violation.beforeLbs,
      deltaLbs: violation.deltaLbs
    };
    notify(makeCapacityMessage(data), data, actor);
    logger.info("capacity exceeded", data);
  };

  const enforceProjectedItemChange = (item, changes, options, { isCreate }) => {
    if (isBypassed(options)) return;
    const actor = item?.parent;
    if (!actor?.items) return;
    if (!isCreate && !isRelevantItemChange(changes)) return;

    const candidate = makeItemCandidate(item, changes);
    const siblings = isCreate ? creationSiblings(options, candidate) : [];
    const projectedActor = createProjectedActor(actor, candidate, siblings);
    const destinationId = candidate.system?.container ?? null;
    const previousId = isCreate ? null : (item.system?.container ?? null);

    // Only validate content rules when the item is actually entering a
    // container. Re-checking on every edit freezes anything already inside a
    // container whose rules were tightened afterwards - it could not even be
    // equipped or renamed. Contents created together with their container
    // were already inside it, so they are not re-judged either.
    const arrivesWithContainer = siblings.some(entry => entry.id === destinationId);
    if (destinationId && destinationId !== previousId && !arrivesWithContainer) {
      const destination = getItem(projectedActor, destinationId);
      if (destination && !enforceRestrictions(actor, destination, candidate)) return false;
    }

    const violations = findCapacityViolations(actor, projectedActor, {
      includeNested: game.settings.get(MODULE_ID, "includeNested"),
      defaultUnit: getSystemWeightUnit(),
      currencyLbs: containerCurrencyLbs,
      onCycle: containerId => logger.warn("Cycle detected", { containerId })
    });
    if (!violations.length) return;

    const preferredOrder = destinationId
      ? collectContainerAncestorIds(projectedActor, destinationId)
      : [];
    if (isContainer(candidate) && candidate.id) preferredOrder.push(candidate.id);
    const violation = preferredOrder
      .map(containerId => violations.find(entry => entry.container.id === containerId))
      .find(Boolean) ?? violations[0];

    notifyCapacity(violation, actor);
    if (game.settings.get(MODULE_ID, "enforceMode") === "block") return false;
  };

  Hooks.on("preCreateItem", (item, data, options) => (
    enforceProjectedItemChange(item, data, options, { isCreate: true })
  ));
  Hooks.on("preUpdateItem", (item, changes, options) => (
    enforceProjectedItemChange(item, changes, options, { isCreate: false })
  ));
}
