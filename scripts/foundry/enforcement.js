import { I18N, MODULE_ID } from "../constants.js";
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
import {
  ITEM_PILES_DND5E_ID,
  isModuleActive,
  registerItemPilesGuards
} from "../integrations/item-piles.js";
import { RULE_SELECTION_NAMES } from "../ui/container-rules-state.js";
import { ruleTokenLabels } from "../ui/rule-presentation.js";

const MAX_SOCKET_TEXT = 1000;

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

function localizeFallback(key, fallback) {
  const value = game.i18n?.localize?.(key);
  return value && value !== key ? value : fallback;
}

function makeRestrictionMessage({ containerName, itemName, restrictions }) {
  const details = [];
  const labelCache = new Map();
  const list = name => ruleTokenLabels(name, restrictions[name], labelCache).join(", ");
  if (restrictions.allowedTypes.length) {
    details.push(game.i18n.format(`${I18N}.restrictionMessage.types`, {
      types: list("allowedTypes")
    }));
  }
  if (restrictions.allowedSubtypes.length) {
    details.push(game.i18n.format(`${I18N}.restrictionMessage.subtypes`, {
      subtypes: list("allowedSubtypes")
    }));
  }
  if (restrictions.requiredProperties.length) {
    details.push(game.i18n.format(`${I18N}.restrictionMessage.properties`, {
      properties: list("requiredProperties")
    }));
  }
  if (restrictions.forbiddenProperties.length) {
    details.push(game.i18n.format(
      `${I18N}.restrictionMessage.forbiddenProperties`,
      { properties: list("forbiddenProperties") }
    ));
  }
  return game.i18n.format(`${I18N}.restrictionMessage.default`, {
    containerName: containerName
      ?? localizeFallback(`${I18N}.fallback.container`, "Container"),
    itemName: itemName ?? localizeFallback(`${I18N}.fallback.item`, "Item"),
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
    ?? localizeFallback(`${I18N}.fallback.container`, "Container");

  let key;
  let values;
  if (violation.kind === "count") {
    key = `${I18N}.exceedMessage.count`;
    values = {
      containerName,
      before: Math.round(violation.before),
      delta: Math.round(violation.delta),
      capacity: Math.round(violation.capacity),
      unit: localizeFallback(`${I18N}.fallback.items`, "items")
    };
  } else {
    key = `${I18N}.exceedMessage.default`;
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
 * Turn a rejection received over the socket into the text to show.
 *
 * Any connected client can write to the module's socket channel, so nothing in
 * the payload is shown as sent: the message is rebuilt here from checked
 * fields, with this world's own wording.
 * @returns {string|null} null when the payload is malformed
 */
export function renderRejection(data) {
  if (!data || typeof data !== "object") return null;
  const isText = value => value == null || (typeof value === "string" && value.length <= MAX_SOCKET_TEXT);
  if (!isText(data.containerName) || !isText(data.itemName)) return null;
  const { containerName, itemName } = data;

  if (data.type === "capacity") {
    const { kind, capacity, before, delta } = data;
    if (!["weight", "count"].includes(kind)) return null;
    if (![capacity, before, delta].every(Number.isFinite)) return null;
    return makeCapacityMessage({ containerName, kind, capacity, before, delta });
  }

  if (data.type === "restriction") {
    if (!data.restrictions || typeof data.restrictions !== "object") return null;
    const restrictions = {};
    for (const name of RULE_SELECTION_NAMES) {
      const tokens = data.restrictions[name] ?? [];
      if (!Array.isArray(tokens) || tokens.length > 100 || !tokens.every(isText)) return null;
      restrictions[name] = tokens.filter(Boolean);
    }
    return makeRestrictionMessage({ containerName, itemName, restrictions });
  }
  return null;
}

/**
 * Who should see a rejection.
 *
 * A player overfilling their own backpack is nobody else's business, so the
 * default is the acting user plus whichever GMs are online to notice a rule
 * they may want to relax.
 * @returns {string[]} user ids
 */
export function resolveNotificationTargets(scope, {
  actor = null,
  self = game.user?.id ? [game.user.id] : []
} = {}) {
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
  // Facts only; each recipient builds the text itself (see renderRejection).
  const notify = (payload, actor, self) => {
    const targets = resolveNotificationTargets(getNotifyScope(), { actor, self });
    socket.executeForUsers("notifyExceedRemote", targets, payload);
  };

  const notifyRestriction = ({ actor, actorName, containerName, itemName, restrictions }, self) => {
    notify({ type: "restriction", containerName, itemName, restrictions }, actor, self);
    logger.info("container restriction failed", {
      actorName, containerName, itemName, restrictions
    });
  };

  const enforceRestrictions = (actor, container, itemData, self) => {
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
    }, self);
    return game.settings.get(MODULE_ID, "enforceMode") !== "block";
  };

  const notifyCapacity = (violation, actor, self) => {
    const data = {
      type: "capacity",
      containerName: violation.container?.name,
      kind: violation.kind,
      capacity: violation.capacity,
      before: violation.before,
      delta: violation.delta
    };
    notify(data, actor, self);
    logger.info("capacity exceeded", data);
  };

  /**
   * Check items on one actor as they would be after a change, notify about the
   * first rule broken, and say whether the change may go ahead.
   * @param {Object} actor
   * @param {Object[]} candidates  Changed or created items, as plain data.
   * @param {string[]} [self]      Users who made the change; this client's user when omitted.
   * @returns {boolean}
   */
  const enforceCandidates = (actor, candidates, self) => {
    const projectedActor = createProjectedActor(actor, candidates);

    // Only validate content rules when an item is actually entering a
    // container. Re-checking on every edit freezes anything already inside a
    // container whose rules were tightened afterwards - it could not even be
    // equipped or renamed. Contents created together with their container find
    // no destination on the actor yet, so they pass.
    for (const candidate of candidates) {
      const destinationId = candidate.system?.container ?? null;
      const previousId = getItem(actor, candidate.id)?.system?.container ?? null;
      if (!destinationId || destinationId === previousId || !getItem(actor, destinationId)) continue;
      const destination = getItem(projectedActor, destinationId);
      if (!enforceRestrictions(actor, destination, candidate, self)) return false;
    }

    const violations = findCapacityViolations(actor, projectedActor, {
      includeNested: game.settings.get(MODULE_ID, "includeNested"),
      defaultUnit: getSystemWeightUnit(),
      currencyLbs: containerCurrencyLbs,
      onCycle: containerId => logger.warn("Cycle detected", { containerId })
    });
    if (!violations.length) return true;

    const preferredOrder = candidates.flatMap(candidate => [
      ...(candidate.system?.container
        ? collectContainerAncestorIds(projectedActor, candidate.system.container)
        : []),
      ...(isContainer(candidate) && candidate.id ? [candidate.id] : [])
    ]);
    const violation = preferredOrder
      .map(containerId => violations.find(entry => entry.container.id === containerId))
      .find(Boolean) ?? violations[0];

    notifyCapacity(violation, actor, self);
    return game.settings.get(MODULE_ID, "enforceMode") !== "block";
  };

  const enforceProjectedItemChange = (item, changes, options, { isCreate }) => {
    if (isBypassed(options)) return;
    const actor = item?.parent;
    if (!actor?.items) return;
    if (!isCreate && !isRelevantItemChange(changes)) return;

    // ponytail: each document is projected alone. Foundry strips `data` from the
    // options preCreateItem receives, so a container dropped together with its
    // contents is weighed empty and its contents arrive unchecked. Seeing the
    // whole batch needs a `_preCreateOperation` override; do that if users hit it.
    // Item Piles batches are checked whole in its own pre-hooks (below).
    return enforceCandidates(actor, [makeItemCandidate(item, changes)]) ? undefined : false;
  };

  Hooks.on("preCreateItem", (item, data, options) => (
    enforceProjectedItemChange(item, data, options, { isCreate: true })
  ));
  Hooks.on("preUpdateItem", (item, changes, options) => (
    enforceProjectedItemChange(item, changes, options, { isCreate: false })
  ));

  // Item Piles operations run on a GM client, so the acting player is found
  // among the receiving actor's owners. In warn mode the guard warns and lets
  // the operation run: the document hooks above see each item alone and miss
  // a container that arrives with its contents.
  // shortcut: a change that lands on the same actor between this check and
  // Item Piles' commit is not seen; lock the actor if that ever matters.
  const itemPilesGuarded = registerItemPilesGuards(({ actor, itemsToCreate = [], itemsToUpdate = [] }) => {
    if (!actor?.items) return true;
    const candidates = [
      ...itemsToCreate.map(data => makeItemCandidate(null, data)),
      ...itemsToUpdate.map(data => makeItemCandidate(actor.items.get(data._id), data))
    ];
    if (!candidates.length) return true;
    const owners = game.users
      .filter(user => user.active && actor.testUserPermission?.(user, "OWNER"))
      .map(user => user.id);
    return enforceCandidates(actor, candidates, [...new Set([game.user?.id, ...owners])].filter(Boolean));
  });
  if (itemPilesGuarded) {
    logger.info("Item Piles transfers are checked before they run", {
      dnd5eBridge: isModuleActive(ITEM_PILES_DND5E_ID)
    });
  }
}
