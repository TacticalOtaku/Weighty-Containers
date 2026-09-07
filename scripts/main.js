// ─────────────────────────────────────────────────────────
// Weighty Containers - Foundry VTT v14.367 / dnd5e 5.3.3
// ─────────────────────────────────────────────────────────

import { MODULE_ID } from "./constants.js";
import {
  computeActorCarriedLbs as computeActorCarriedLbsCore,
  computeAdjustedLoad as computeAdjustedLoadCore
} from "./core/containers.js";
import {
  validateContainerRestrictions as validateContainerRestrictionsCore
} from "./core/restrictions.js";
import { getCapacityLbs as resolveCapacityLbs } from "./core/weight.js";
import { installPublicApi } from "./foundry/api.js";
import { buildDebugApi } from "./foundry/debug.js";
import { registerEnforcementHooks } from "./foundry/enforcement.js";
import { LOG } from "./foundry/logger.js";
import {
  patchContainerDataGetters,
  refreshPreparedActors,
  registerModuleSettings,
  registerUnitConversion
} from "./foundry/runtime.js";
import { WCSocket } from "./foundry/socket.js";
import {
  actorCurrencyLbs,
  containerCurrencyLbs,
  getSystemWeightUnit,
  getWeaponTypeMap,
  lbsToDisplay,
  makeEncumbranceItemFilter
} from "./integrations/dnd5e.js";
import { openReductionDialog } from "./ui/container-rules-app.js";
import { registerSheetUiHooks } from "./ui/sheet-hooks.js";

const wcSocket = new WCSocket(LOG);

function includeNested() {
  try {
    return game.settings.get(MODULE_ID, "includeNested");
  } catch {
    return true;
  }
}

function getCapacityLbs(containerItem) {
  const capacityLbs = resolveCapacityLbs(containerItem, getSystemWeightUnit());
  if (capacityLbs == null) {
    LOG.debug("capacity not resolved", {
      item: containerItem?.name,
      capacity: containerItem?.system?.capacity
    });
  }
  return capacityLbs;
}

function computeAdjustedLoad(actor, containerId, idx = null, memo = null, visited = null) {
  return computeAdjustedLoadCore(actor, containerId, {
    includeNested: includeNested(),
    defaultUnit: getSystemWeightUnit(),
    index: idx,
    memo,
    visited,
    currencyLbs: containerCurrencyLbs,
    onCycle: cycleId => LOG.warn("Cycle detected", { containerId: cycleId })
  });
}

function computeActorCarriedLbs(actor) {
  return computeActorCarriedLbsCore(actor, {
    includeNested: includeNested(),
    defaultUnit: getSystemWeightUnit(),
    validateItem: makeEncumbranceItemFilter(actor),
    currencyLbs: containerCurrencyLbs,
    actorCurrencyLbs: actorCurrencyLbs(actor),
    onCycle: containerId => LOG.warn("Cycle detected", { containerId })
  });
}

function validateContainerRestrictions(containerItem, itemData) {
  return validateContainerRestrictionsCore(containerItem, itemData, {
    weaponTypeMap: getWeaponTypeMap()
  });
}

function notifyExceedRemote(data) {
  if (typeof data?.msg !== "string" || data.msg.length > 1000) {
    LOG.warn("Rejected invalid notification socket payload");
    return;
  }
  ui.notifications?.warn(data.msg);
}

registerModuleSettings(LOG);
registerUnitConversion(LOG);

Hooks.once("ready", () => {
  wcSocket.register("notifyExceedRemote", notifyExceedRemote);
  wcSocket.init();

  // The reduction rides on dnd5e's own contentsWeight, so the capacity bar,
  // the inventory rows and the encumbrance track all pick it up from one patch.
  const patched = patchContainerDataGetters({ logger: LOG });
  if (patched) refreshPreparedActors(LOG);

  registerEnforcementHooks({ logger: LOG, socket: wcSocket });
  registerSheetUiHooks();
  installPublicApi({
    computeActorCarriedLbs,
    computeAdjustedLoad,
    getCapacityLbs,
    getSystemWeightUnit,
    lbsToDisplay,
    validateContainerRestrictions,
    openRulesDialog: openReductionDialog,
    debugApi: buildDebugApi({ computeAdjustedLoad, getCapacityLbs, lbsToDisplay })
  });

  LOG.info("ready", {
    system: game.system?.id,
    systemVersion: game.system?.version,
    foundryVersion: game.version
  });
});
