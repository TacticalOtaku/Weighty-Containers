// ─────────────────────────────────────────────────────────
// Weighty Containers - Foundry VTT v14.367 / dnd5e 5.3.3
// ─────────────────────────────────────────────────────────

import { LBS_PER_KG, MODULE_ID } from "./constants.js";
import {
  computeActorCarriedLbs as computeActorCarriedLbsCore,
  computeAdjustedLoad as computeAdjustedLoadCore
} from "./core/containers.js";
import {
  validateContainerRestrictions as validateContainerRestrictionsCore
} from "./core/restrictions.js";
import { getCapacityLbs as resolveCapacityLbs } from "./core/weight.js";
import { installDebugApi } from "./foundry/debug.js";
import { registerEnforcementHooks } from "./foundry/enforcement.js";
import { LOG } from "./foundry/logger.js";
import {
  patchContainerDataGetters,
  registerEncumbrancePatch,
  registerModuleSettings
} from "./foundry/runtime.js";
import { WCSocket } from "./foundry/socket.js";
import { registerSheetUiHooks } from "./ui/sheet-hooks.js";

const wcSocket = new WCSocket(LOG);

function getSystemWeightUnit() {
  try {
    return game.settings.get("dnd5e", "metricWeightUnits") ? "kg" : "lb";
  } catch {
    return "lb";
  }
}

function lbsToDisplay(lbs) {
  return getSystemWeightUnit() === "kg" ? lbs / LBS_PER_KG : lbs;
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
    includeNested: game.settings.get(MODULE_ID, "includeNested"),
    defaultUnit: getSystemWeightUnit(),
    index: idx,
    memo,
    visited,
    onCycle: cycleId => LOG.warn("Cycle detected", { containerId: cycleId })
  });
}

function computeActorCarriedLbs(actor) {
  return computeActorCarriedLbsCore(actor, {
    includeNested: game.settings.get(MODULE_ID, "includeNested"),
    defaultUnit: getSystemWeightUnit(),
    onCycle: containerId => LOG.warn("Cycle detected", { containerId })
  });
}

function validateContainerRestrictions(containerItem, itemData) {
  return validateContainerRestrictionsCore(containerItem, itemData, {
    weaponTypeMap: CONFIG.DND5E?.weaponTypeMap ?? {}
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

Hooks.once("ready", () => {
  wcSocket.register("notifyExceedRemote", notifyExceedRemote);
  wcSocket.init();

  patchContainerDataGetters({
    logger: LOG,
    computeAdjustedLoad,
    getCapacityLbs,
    lbsToDisplay
  });
  registerEncumbrancePatch({
    logger: LOG,
    computeActorCarriedLbs,
    lbsToDisplay
  });
  registerEnforcementHooks({ logger: LOG, socket: wcSocket });
  registerSheetUiHooks();
  installDebugApi({
    computeActorCarriedLbs,
    computeAdjustedLoad,
    getCapacityLbs,
    lbsToDisplay,
    validateContainerRestrictions
  });

  LOG.info("ready", {
    system: game.system?.id,
    systemVersion: game.system?.version,
    foundryVersion: game.version
  });
});
