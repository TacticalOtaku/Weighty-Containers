import { I18N, MODULE_ID } from "../constants.js";
import { isRelevantExpandedChange } from "../core/containers.js";
import { RULE_SELECTION_NAMES } from "../core/rules.js";
import {
  getRuleTokenLabels,
  getSystemWeightUnit,
  getWeightUnitLabel,
  lbsToDisplay
} from "../integrations/dnd5e.js";
import {
  ITEM_PILES_DND5E_ID,
  isModuleActive,
  registerItemPilesGuards
} from "../integrations/item-piles.js";
import { evaluateContainerChange } from "./containers.js";
import { LOG } from "./logger.js";
import { getModuleSetting } from "./runtime.js";

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

export function isRelevantItemChange(changes) {
  const expanded = foundry.utils.expandObject(changes ?? {});
  return isRelevantExpandedChange(expanded);
}

function localizeFallback(key, fallback) {
  const value = game.i18n?.localize?.(key);
  return value && value !== key ? value : fallback;
}

function makeRestrictionMessage({ containerName, itemName, restrictions }) {
  const details = [];
  const labelCache = new Map();
  const list = name => getRuleTokenLabels(name, restrictions[name], labelCache).join(", ");
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

  const custom = String(getModuleSetting("exceedMessageText") ?? "").trim();
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

export function registerEnforcementHooks({ socket }) {
  // Facts only; each recipient builds the text itself (see renderRejection).
  const notify = (payload, actor, self) => {
    const targets = resolveNotificationTargets(getModuleSetting("notifyScope"), { actor, self });
    socket.executeForUsers("notifyExceedRemote", targets, payload);
  };

  const notifyRestriction = ({ actor, actorName, containerName, itemName, restrictions }, self) => {
    notify({ type: "restriction", containerName, itemName, restrictions }, actor, self);
    LOG.info("container restriction failed", {
      actorName, containerName, itemName, restrictions
    });
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
    LOG.info("capacity exceeded", data);
  };

  /**
   * Check items on one actor as they would be after a change, notify about the
   * rule(s) broken, and say whether the change may go ahead.
   */
  const enforceCandidates = (actor, candidates, self) => {
    const block = getModuleSetting("enforceMode") === "block";
    const outcome = evaluateContainerChange(actor, candidates, { stopOnRestriction: block });
    if (outcome.ok) return true;

    for (const failure of outcome.restrictionFailures) {
      notifyRestriction({
        actor,
        actorName: actor?.name,
        containerName: failure.container?.name,
        itemName: failure.itemData?.name,
        restrictions: failure.restrictions
      }, self);
      if (block) return false;
    }

    if (outcome.capacityViolation) {
      notifyCapacity(outcome.capacityViolation, actor, self);
      if (block) return false;
    }
    return true;
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
    LOG.info("Item Piles transfers are checked before they run", {
      dnd5eBridge: isModuleActive(ITEM_PILES_DND5E_ID)
    });
  }
}
