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
  lbsToDisplay
} from "../integrations/dnd5e.js";

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

function makeRestrictionMessage({ containerName, itemName, restrictions }) {
  const details = [];
  if (restrictions.allowedTypes.length) {
    details.push(game.i18n.format(`${MODULE_ID}.restrictionMessage.types`, {
      types: restrictions.allowedTypes.join(", ")
    }));
  }
  if (restrictions.allowedSubtypes.length) {
    details.push(game.i18n.format(`${MODULE_ID}.restrictionMessage.subtypes`, {
      subtypes: restrictions.allowedSubtypes.join(", ")
    }));
  }
  if (restrictions.requiredProperties.length) {
    details.push(game.i18n.format(`${MODULE_ID}.restrictionMessage.properties`, {
      properties: restrictions.requiredProperties.join(", ")
    }));
  }
  if (restrictions.forbiddenProperties.length) {
    details.push(game.i18n.format(
      `${MODULE_ID}.restrictionMessage.forbiddenProperties`,
      { properties: restrictions.forbiddenProperties.join(", ") }
    ));
  }
  return game.i18n.format(`${MODULE_ID}.restrictionMessage.default`, {
    containerName: containerName ?? "Container",
    itemName: itemName ?? "Item",
    rules: details.join("; ")
  });
}

function makeCapacityMessage(violation) {
  const custom = (game.settings.get(MODULE_ID, "exceedMessageText") ?? "").trim();
  if (custom) return custom;
  const containerName = violation.containerName ?? "Container";

  if (violation.kind === "count") {
    return game.i18n.format(`${MODULE_ID}.exceedMessage.count`, {
      containerName,
      before: Math.round(violation.before),
      delta: Math.round(violation.delta),
      capacity: Math.round(violation.capacity)
    });
  }

  const metric = getSystemWeightUnit() === "kg";
  const key = metric
    ? `${MODULE_ID}.exceedMessage.default_kg`
    : `${MODULE_ID}.exceedMessage.default`;
  return game.i18n.format(key, {
    containerName,
    before: lbsToDisplay(violation.before).toFixed(2),
    delta: lbsToDisplay(violation.delta).toFixed(2),
    capacity: lbsToDisplay(violation.capacity).toFixed(2)
  });
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

/** Escape hatch for other modules and macros: `{ [MODULE_ID]: { bypass: true } }`. */
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

    const candidate = makeItemCandidate(item, changes);
    const projectedActor = createProjectedActor(actor, candidate);
    const destinationId = candidate.system?.container ?? null;
    const previousId = isCreate ? null : (item.system?.container ?? null);

    // Only validate content rules when the item is actually entering a
    // container. Re-checking on every edit freezes anything already inside a
    // container whose rules were tightened afterwards - it could not even be
    // equipped or renamed.
    if (destinationId && destinationId !== previousId) {
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
