// ─────────────────────────────────────────────────────────
// Weighty Containers - Public API
// ─────────────────────────────────────────────────────────

import { MODULE_ID } from "../constants.js";
import {
  getContainerRestrictions,
  getReductionPct,
  listRulePresets,
  registerRulePreset,
  unregisterRulePreset
} from "../core/rules.js";
import {
  getCapacityCount,
  isContainer,
  isWeightlessContainer
} from "../core/weight.js";
import {
  getSystemWeightUnit,
  lbsToDisplay
} from "../integrations/dnd5e.js";
import {
  computeActorCarriedLbs,
  computeAdjustedLoad,
  getCapacityLbs,
  getCarriedShare,
  getContainerLoad,
  validateContainerRestrictions
} from "./containers.js";
import { buildDebugApi } from "./debug.js";

/**
 * Version of the documented API surface. Bumped only on a breaking change;
 * additive changes keep the number.
 */
export const API_VERSION = 2;

/** Hook fired once the API is installed. Receives the api object. */
export const HOOK_READY = `${MODULE_ID}.ready`;

/** Hook fired after a container's rules are persisted. Receives (item, config). */
export const HOOK_UPDATE_RULES = `${MODULE_ID}.updateContainerRules`;

async function defaultOpenRulesDialog(containerItem, options) {
  const { openReductionDialog } = await import("../ui/container-rules-app.js");
  return openReductionDialog(containerItem, options);
}

/**
 * Build the public API object backed directly by the host container module.
 * Optional `openRulesDialog` allows tests to intercept UI launches without
 * loading Foundry ApplicationV2 classes.
 *
 * @returns {Object}
 */
export function buildPublicApi({ openRulesDialog = defaultOpenRulesDialog } = {}) {
  return {
    apiVersion: API_VERSION,
    stability: "stable",

    // Classification
    isContainer,
    isWeightlessContainer,

    // Rules
    getReductionPct,
    getContainerRestrictions,
    validateContainerRestrictions,

    // Weight
    getCapacityLbs,
    getCapacityCount,
    getContainerLoad,
    computeAdjustedLoad,
    computeActorCarriedLbs,
    getCarriedShare,
    lbsToDisplay,
    getSystemWeightUnit,

    // UI and extension points
    openRulesDialog,
    listRulePresets,
    registerRulePreset,
    unregisterRulePreset,
    /** @deprecated kept for callers written against the pre-API module */
    openReductionDialog: openRulesDialog
  };
}

/**
 * Install the API on the module entry and announce it.
 *
 * `game.modules.get("weighty-containers").api` is the supported entry point.
 * `globalThis.weightyCont` stays as the console handle and additionally carries
 * the debug helpers.
 */
export function installPublicApi({ debugApi = buildDebugApi(), ...options } = {}) {
  const api = buildPublicApi(options);

  const module = globalThis.game?.modules?.get?.(MODULE_ID);
  if (module) module.api = api;

  Object.defineProperty(globalThis, "weightyCont", {
    value: Object.freeze({ ...api, ...debugApi }),
    configurable: true,
    writable: false
  });

  globalThis.Hooks?.callAll?.(HOOK_READY, api);
  return api;
}

/**
 * Announce that a container's rules changed, so consumers can refresh.
 */
export function notifyContainerRulesUpdated(containerItem, config) {
  globalThis.Hooks?.callAll?.(HOOK_UPDATE_RULES, containerItem, config);
}
