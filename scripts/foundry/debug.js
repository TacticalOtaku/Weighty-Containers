import { buildContainerIndex } from "../core/containers.js";
import { getContainerRestrictions } from "../core/restrictions.js";
import { getReductionPct, isContainer } from "../core/weight.js";

export function installDebugApi({
  computeActorCarriedLbs,
  computeAdjustedLoad,
  getCapacityLbs,
  lbsToDisplay,
  validateContainerRestrictions
}) {
  const findOpenApps = () => {
    if (!(foundry.applications?.instances instanceof Map)) return [];
    return Array.from(foundry.applications.instances.values());
  };

  const findOpenContainer = () => {
    for (const app of findOpenApps()) {
      const document = app?.document ?? app?.object ?? app?.item;
      if (document instanceof Item && document.type === "container") {
        return document;
      }
    }
    return null;
  };

  const api = {
    apiVersion: 1,
    stability: "unstable",
    computeActorCarriedLbs,
    computeAdjustedLoad,
    getCapacityLbs,
    getReductionPct,
    getContainerRestrictions,
    validateContainerRestrictions,

    dumpContainer(itemOrName) {
      let item = null;
      if (itemOrName instanceof Item) {
        item = itemOrName;
      } else if (typeof itemOrName === "string") {
        const actor = canvas.tokens?.controlled?.[0]?.actor;
        item = actor?.items.find(entry => (
          entry.type === "container" && entry.name === itemOrName
        ));
      } else {
        item = findOpenContainer();
        if (!item) {
          const actor = canvas.tokens?.controlled?.[0]?.actor;
          item = actor?.items.find(entry => entry.type === "container");
        }
      }

      if (!item) {
        console.warn("No container found. Select a token or open a container sheet.");
        return;
      }

      const system = item.system;
      console.group(
        `%cContainer: ${item.name} (${item.id})`,
        "color: #4CAF50; font-weight: bold"
      );
      console.log("Reduction:", `${getReductionPct(item)}%`);
      console.log("Restrictions:", getContainerRestrictions(item));
      console.log("system.capacity:", foundry.utils.deepClone(system.capacity));
      console.log("system.weight:", foundry.utils.deepClone(system.weight));
      console.log("contentsWeight:", system.contentsWeight);
      console.log("totalWeight:", system.totalWeight);
      if (item.parent) {
        const { load, trace } = computeAdjustedLoad(item.parent, item.id);
        console.log("Adjusted load (lbs):", load);
        console.log("Adjusted load (display):", lbsToDisplay(load));
        console.log("Capacity (lbs):", getCapacityLbs(item));
        console.log("Trace:", trace);
      }
      console.groupEnd();
      return system;
    },

    dumpActor(actor = canvas.tokens?.controlled?.[0]?.actor) {
      if (!actor) {
        console.warn("No actor — select a token");
        return;
      }
      const index = buildContainerIndex(actor);
      const result = {};
      for (const item of actor.items) {
        if (!isContainer(item)) continue;
        const { load, trace } = computeAdjustedLoad(actor, item.id, index);
        result[item.name] = {
          id: item.id,
          capacityLbs: getCapacityLbs(item),
          loadLbs: load,
          loadDisplay: Number(lbsToDisplay(load).toFixed(2)),
          reductionPct: getReductionPct(item),
          contentsWeight: item.system.contentsWeight,
          totalWeight: item.system.totalWeight,
          trace
        };
      }
      console.table(result);
      return result;
    }
  };

  Object.defineProperty(globalThis, "weightyCont", {
    value: Object.freeze(api),
    configurable: true,
    writable: false
  });
}
