import { MODULE_ID } from "../constants.js";
import {
  collectContainerAncestorIds,
  createProjectedActor,
  findCapacityViolations,
  getItem
} from "../core/containers.js";
import { validateContainerRestrictions } from "../core/restrictions.js";
import { isContainer } from "../core/weight.js";

const LBS_PER_KG = 2.20462;

function getSystemWeightUnit() {
  try {
    return game.settings.get("dnd5e", "metricWeightUnits") ? "kg" : "lb";
  } catch {
    return "lb";
  }
}

function lbsToDisplay(value) {
  return getSystemWeightUnit() === "kg" ? value / LBS_PER_KG : value;
}

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

function makeCapacityMessage({
  containerName,
  capacityLbs,
  beforeLbs,
  deltaLbs
}) {
  const custom = (game.settings.get(MODULE_ID, "exceedMessageText") ?? "").trim();
  if (custom) return custom;
  const metric = getSystemWeightUnit() === "kg";
  const key = metric
    ? `${MODULE_ID}.exceedMessage.default_kg`
    : `${MODULE_ID}.exceedMessage.default`;
  return game.i18n.format(key, {
    containerName: containerName ?? "Container",
    before: lbsToDisplay(beforeLbs).toFixed(2),
    delta: lbsToDisplay(deltaLbs).toFixed(2),
    capacity: lbsToDisplay(capacityLbs).toFixed(2)
  });
}

export function registerEnforcementHooks({ logger, socket }) {
  const notifyRestriction = ({ actorName, containerName, itemName, restrictions }) => {
    const msg = makeRestrictionMessage({
      containerName,
      itemName,
      restrictions
    });
    socket.executeForEveryone("notifyExceedRemote", {
      msg,
      actorName,
      containerName,
      itemName,
      restrictions
    });
    logger.info("container restriction failed", {
      actorName,
      containerName,
      itemName,
      restrictions
    });
  };

  const enforceRestrictions = (actor, container, itemData) => {
    const result = validateContainerRestrictions(container, itemData, {
      weaponTypeMap: CONFIG.DND5E?.weaponTypeMap ?? {}
    });
    if (result.ok) return true;
    notifyRestriction({
      actorName: actor?.name,
      containerName: container?.name,
      itemName: itemData?.name,
      restrictions: result.restrictions
    });
    return game.settings.get(MODULE_ID, "enforceMode") !== "block";
  };

  const notifyCapacity = violation => {
    const data = {
      containerName: violation.container?.name,
      capacityLbs: violation.capacityLbs,
      beforeLbs: violation.beforeLbs,
      deltaLbs: violation.deltaLbs
    };
    const msg = makeCapacityMessage(data);
    socket.executeForEveryone("notifyExceedRemote", { msg, ...data });
    logger.info("capacity exceeded", data);
  };

  const enforceProjectedItemChange = (item, changes) => {
    const actor = item?.parent;
    if (!actor) return;

    const candidate = makeItemCandidate(item, changes);
    const projectedActor = createProjectedActor(actor, candidate);
    const destinationId = candidate.system?.container ?? null;
    const destination = destinationId
      ? getItem(projectedActor, destinationId)
      : null;

    if (destination && !enforceRestrictions(actor, destination, candidate)) {
      return false;
    }

    const violations = findCapacityViolations(actor, projectedActor, {
      includeNested: game.settings.get(MODULE_ID, "includeNested"),
      defaultUnit: getSystemWeightUnit(),
      onCycle: containerId => logger.warn("Cycle detected", { containerId })
    });
    if (!violations.length) return;

    const preferredOrder = destinationId
      ? collectContainerAncestorIds(projectedActor, destinationId)
      : [];
    if (isContainer(candidate)) preferredOrder.push(candidate.id);
    const violation = preferredOrder
      .map(containerId => (
        violations.find(entry => entry.container.id === containerId)
      ))
      .find(Boolean) ?? violations[0];

    notifyCapacity(violation);
    if (game.settings.get(MODULE_ID, "enforceMode") === "block") return false;
  };

  Hooks.on("preCreateItem", (item, data) => (
    enforceProjectedItemChange(item, data)
  ));
  Hooks.on("preUpdateItem", (item, changes) => (
    enforceProjectedItemChange(item, changes)
  ));
}
