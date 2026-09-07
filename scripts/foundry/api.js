// ─────────────────────────────────────────────────────────
// Weighty Containers - Public API
// ─────────────────────────────────────────────────────────

import { MODULE_ID } from "../constants.js";
import { getContainerRestrictions } from "../core/restrictions.js";
import {
  getCapacityCount,
  getReductionPct,
  isContainer,
  isWeightlessContainer
} from "../core/weight.js";
import {
  listRulePresets,
  registerRulePreset,
  unregisterRulePreset
} from "../ui/rule-presets.js";

/**
 * Version of the documented API surface. Bumped only on a breaking change;
 * additive changes keep the number.
 *
 * 2 — weights use dnd5e's own unit table (its kilogram is 2.5 lb, not
 *     2.20462), a container's reduction compounds through its sub-containers,
 *     and `weightlessContents` plus carried currency are honoured. Every
 *     number this API returns can therefore differ from 1.x. Capacity
 *     violations gained a `kind` of `"weight"` or `"count"`.
 */
export const API_VERSION = 2;

/** Hook fired once the API is installed. Receives the api object. */
export const HOOK_READY = `${MODULE_ID}.ready`;

/** Hook fired after a container's rules are persisted. Receives (item, config). */
export const HOOK_UPDATE_RULES = `${MODULE_ID}.updateContainerRules`;

/**
 * Build the public API object.
 * Kept free of global access so it can be unit tested.
 *
 * @param {Object} deps
 * @param {(actor: Object) => number} deps.computeActorCarriedLbs
 * @param {(actor: Object, containerId: string) => {load: number, trace: Array}} deps.computeAdjustedLoad
 * @param {(container: Object) => number|null} deps.getCapacityLbs
 * @param {(lbs: number) => number} deps.lbsToDisplay
 * @param {() => string} deps.getSystemWeightUnit
 * @param {(container: Object, itemData: Object) => {ok: boolean, reason?: string, restrictions: Object}} deps.validateContainerRestrictions
 * @param {(container: Object) => Promise<Object|void>} deps.openRulesDialog
 * @returns {Object}
 */
export function buildPublicApi({
  computeActorCarriedLbs,
  computeAdjustedLoad,
  getCapacityLbs,
  lbsToDisplay,
  getSystemWeightUnit,
  validateContainerRestrictions,
  openRulesDialog
}) {
  /**
   * Everything a consumer needs to render a container's load, in one call.
   *
   * Weights are returned both raw (pounds, the module's internal unit) and in
   * the unit the dnd5e client is configured to display, so callers never have
   * to convert.
   *
   * @param {Object} actor
   * @param {string} containerId
   * @returns {{
   *   loadLbs: number, capacityLbs: number|null,
   *   load: number, capacity: number|null,
   *   unit: string, reductionPct: number,
   *   pct: number|null, isOver: boolean, hasCapacity: boolean
   * }|null}
   */
  function getContainerLoad(actor, containerId) {
    if (!actor || !containerId) return null;
    const container = actor.items?.get?.(containerId) ?? null;
    if (!container) return null;

    const { load } = computeAdjustedLoad(actor, containerId);
    const capacityLbs = getCapacityLbs(container);
    const hasCapacity = typeof capacityLbs === "number" && capacityLbs > 0;
    const round = value => Number(Number(value).toFixed(2));

    return {
      loadLbs: round(load),
      capacityLbs: hasCapacity ? round(capacityLbs) : null,
      load: round(lbsToDisplay(load)),
      capacity: hasCapacity ? round(lbsToDisplay(capacityLbs)) : null,
      unit: getSystemWeightUnit(),
      reductionPct: getReductionPct(container),
      pct: hasCapacity ? Math.min(100, Math.max(0, Math.round((load / capacityLbs) * 100))) : null,
      isOver: hasCapacity ? load > capacityLbs : false,
      hasCapacity
    };
  }

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
 *
 * @param {Object} deps  Same shape as {@link buildPublicApi}, plus `debugApi`.
 * @returns {Object} the installed api
 */
export function installPublicApi({ debugApi = {}, ...deps } = {}) {
  const api = buildPublicApi(deps);

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
 * @param {Object} containerItem
 * @param {Object} config
 */
export function notifyContainerRulesUpdated(containerItem, config) {
  globalThis.Hooks?.callAll?.(HOOK_UPDATE_RULES, containerItem, config);
}
