import test from "node:test";
import assert from "node:assert/strict";

import {
  API_VERSION,
  HOOK_READY,
  HOOK_UPDATE_RULES,
  buildPublicApi,
  installPublicApi,
  notifyContainerRulesUpdated
} from "../scripts/foundry/api.js";
import { getContainerRawPreviewWeight } from "../scripts/foundry/containers.js";
import { ItemCollectionView } from "../scripts/core/containers.js";
import { buildDebugApi } from "../scripts/foundry/debug.js";

function withRuntime({ metric = false, includeNested = true } = {}, fn) {
  const prevGame = globalThis.game;
  const prevConfig = globalThis.CONFIG;
  globalThis.CONFIG = {
    DND5E: {
      weaponTypeMap: { martialM: "martial" }
    }
  };
  globalThis.game = {
    settings: {
      get(moduleId, key) {
        if (moduleId === "dnd5e" && key === "metricWeightUnits") return metric;
        if (moduleId === "weighty-containers" && key === "includeNested") return includeNested;
        return undefined;
      }
    }
  };
  try {
    return fn();
  } finally {
    globalThis.game = prevGame;
    globalThis.CONFIG = prevConfig;
  }
}

const makeItem = ({
  id,
  name = id,
  type = "loot",
  container = null,
  weight = 0,
  units = "lb",
  quantity = 1,
  capacity = null,
  count = null,
  reduction = 0,
  properties = []
}) => ({
  id,
  name,
  type,
  system: {
    container,
    weight: { value: weight, units },
    quantity,
    properties: new Set(properties),
    ...(capacity == null && count == null
      ? {}
      : { capacity: { count, weight: { value: capacity, units } } })
  },
  flags: { "weighty-containers": { reductionPct: reduction } }
});

const makeActor = items => ({ items: new ItemCollectionView(items) });

test("public api exposes the documented surface", () => {
  const api = buildPublicApi();

  assert.equal(api.apiVersion, API_VERSION);
  assert.equal(api.stability, "stable");

  for (const name of [
    "isContainer",
    "isWeightlessContainer",
    "getReductionPct",
    "getContainerRestrictions",
    "validateContainerRestrictions",
    "getCapacityLbs",
    "getCapacityCount",
    "getContainerLoad",
    "computeAdjustedLoad",
    "computeActorCarriedLbs",
    "getCarriedShare",
    "lbsToDisplay",
    "getSystemWeightUnit",
    "openRulesDialog",
    "listRulePresets",
    "registerRulePreset",
    "unregisterRulePreset"
  ]) {
    assert.equal(typeof api[name], "function", `${name} must be callable`);
  }
});

test("getCarriedShare computes real compounded and weightless shares through the public interface", () => {
  withRuntime({}, () => {
    const api = buildPublicApi();
    const half = makeItem({ id: "half", type: "container", weight: 1, reduction: 50 });
    const inner = makeItem({ id: "inner", type: "container", container: "half", weight: 1, reduction: 50 });
    const holding = makeItem({ id: "holding", type: "container", properties: ["weightlessContents"] });
    const gem = makeItem({ id: "gem", container: "inner", weight: 2 });
    const hidden = makeItem({ id: "hidden", container: "holding", weight: 2 });
    const actor = makeActor([half, inner, holding, gem, hidden]);

    assert.equal(api.getCarriedShare(actor, gem), 0.25);
    assert.equal(api.getCarriedShare(actor, hidden), 0);
  });
});

test("openReductionDialog stays available for pre-API callers", async () => {
  const api = buildPublicApi({ openRulesDialog: async () => "opened" });
  assert.equal(api.openReductionDialog, api.openRulesDialog);
  assert.equal(await api.openReductionDialog({}), "opened");
});

test("getContainerLoad reports real adjusted load and capacity in metric and imperial units", () => {
  withRuntime({ metric: true }, () => {
    const api = buildPublicApi();
    const bag = makeItem({
      id: "bag",
      type: "container",
      units: "kg",
      capacity: 20,
      reduction: 50
    });
    const brick = makeItem({ id: "brick", container: "bag", weight: 20, units: "kg" });
    const load = api.getContainerLoad(makeActor([bag, brick]), "bag");

    // 20 kg * 2.5 lb/kg * (1 - 0.5) = 25 lb = 10 kg; capacity 20 kg = 50 lb
    assert.equal(load.loadLbs, 25);
    assert.equal(load.capacityLbs, 50);
    assert.equal(load.load, 10);
    assert.equal(load.capacity, 20);
    assert.equal(load.unit, "kg");
    assert.equal(load.reductionPct, 50);
    assert.equal(load.pct, 50);
    assert.equal(load.isOver, false);
    assert.equal(load.hasCapacity, true);
  });
});

test("getContainerLoad flags an overfilled container", () => {
  withRuntime({}, () => {
    const api = buildPublicApi();
    const bag = makeItem({ id: "bag", type: "container", capacity: 30 });
    const anvil = makeItem({ id: "anvil", container: "bag", weight: 60 });
    const load = api.getContainerLoad(makeActor([bag, anvil]), "bag");

    assert.equal(load.isOver, true);
    assert.equal(load.pct, 100, "the meter percentage is clamped");
  });
});

test("getContainerLoad follows an item-count capacity, as dnd5e does", () => {
  withRuntime({}, () => {
    const api = buildPublicApi();
    const quiver = makeItem({
      id: "quiver",
      type: "container",
      capacity: 50,
      count: 20
    });
    const arrows = makeItem({
      id: "arrows",
      type: "consumable",
      container: "quiver",
      weight: 0.05,
      quantity: 25
    });

    const load = api.getContainerLoad(makeActor([quiver, arrows]), "quiver");
    assert.equal(load.kind, "count");
    assert.equal(load.count, 25);
    assert.equal(load.capacityCount, 20);
    assert.equal(load.isOver, true);
    assert.equal(load.pct, 100);
    assert.equal(load.capacityLbs, 50, "the declared weight capacity is still reported");
  });
});

test("getContainerLoad copes with a container that declares no capacity", () => {
  withRuntime({}, () => {
    const api = buildPublicApi();
    const bag = makeItem({ id: "bag", type: "container" });
    const book = makeItem({ id: "book", container: "bag", weight: 7 });

    const load = api.getContainerLoad(makeActor([bag, book]), "bag");
    assert.equal(load.hasCapacity, false);
    assert.equal(load.capacity, null);
    assert.equal(load.pct, null);
    assert.equal(load.isOver, false);
    assert.equal(load.load, 7);
  });
});

test("getContainerLoad returns null for unknown input", () => {
  const api = buildPublicApi();
  assert.equal(api.getContainerLoad(null, "bag"), null);
  assert.equal(api.getContainerLoad(makeActor([makeItem({ id: "bag" })]), null), null);
  assert.equal(api.getContainerLoad(makeActor([makeItem({ id: "bag" })]), "missing"), null);
});

test("getContainerRawPreviewWeight computes pre-reduction weight for actor, world, and compendium containers", () => {
  withRuntime({ metric: true }, () => {
    const bag = makeItem({ id: "bag", type: "container", units: "kg", reduction: 50 });
    const sword = makeItem({ id: "sword", container: "bag", weight: 5, units: "lb" });
    const actor = makeActor([bag, sword]);
    bag.parent = actor;

    // 5 lb = 2 kg raw in bag's kg units before bag's 50% reduction
    assert.deepEqual(getContainerRawPreviewWeight(bag), { raw: 2, unit: "kg" });

    // Unowned world container reads synchronous system.contents
    const worldBag = makeItem({ id: "worldBag", type: "container", units: "lb", reduction: 50 });
    worldBag.system.contents = [makeItem({ id: "gem", weight: 6, units: "lb" })];
    assert.deepEqual(getContainerRawPreviewWeight(worldBag), { raw: 6, unit: "lb" });

    // Compendium container with async contents returns null so UI falls back to sample weight
    const compendiumBag = makeItem({ id: "compBag", type: "container", units: "lb" });
    compendiumBag.system.contents = Promise.resolve([]);
    assert.equal(getContainerRawPreviewWeight(compendiumBag), null);
  });
});

test("debug api summarizes an actor's containers without exposing internal cache parameters", () => {
  withRuntime({}, () => {
    const debug = buildDebugApi();
    const bag = makeItem({ id: "bag", name: "Pack", type: "container", capacity: 10, reduction: 50 });
    const gem = makeItem({ id: "gem", container: "bag", weight: 8 });
    const actor = makeActor([bag, gem]);

    const origTable = console.table;
    console.table = () => {};
    try {
      const result = debug.dumpActor(actor);
      assert.equal(result.Pack.loadLbs, 4);
      assert.equal(result.Pack.capacityLbs, 10);
      assert.equal(result.Pack.reductionPct, 50);
    } finally {
      console.table = origTable;
    }
  });
});

test("installPublicApi publishes on the module entry and announces itself", () => {
  const module = {};
  const fired = [];
  const previousGame = globalThis.game;
  const previousHooks = globalThis.Hooks;
  const previousGlobal = globalThis.weightyCont;

  globalThis.game = { modules: { get: id => (id === "weighty-containers" ? module : null) } };
  globalThis.Hooks = { callAll: (name, ...args) => fired.push([name, ...args]) };

  try {
    const api = installPublicApi({
      debugApi: { dumpContainer() { return "dump"; } }
    });

    assert.equal(module.api, api, "the module entry is the supported handle");
    assert.equal(typeof globalThis.weightyCont.getContainerLoad, "function");
    assert.equal(globalThis.weightyCont.dumpContainer(), "dump", "console helpers are merged in");
    assert.equal(Object.isFrozen(globalThis.weightyCont), true);
    assert.deepEqual(fired, [[HOOK_READY, api]]);
  } finally {
    globalThis.game = previousGame;
    globalThis.Hooks = previousHooks;
    if (previousGlobal === undefined) delete globalThis.weightyCont;
    else Object.defineProperty(globalThis, "weightyCont", { value: previousGlobal, configurable: true });
  }
});

test("notifyContainerRulesUpdated announces saved rules", () => {
  const fired = [];
  const previousHooks = globalThis.Hooks;
  globalThis.Hooks = { callAll: (name, ...args) => fired.push([name, ...args]) };

  try {
    const item = { id: "bag" };
    const config = { reductionPct: 25 };
    notifyContainerRulesUpdated(item, config);
    assert.deepEqual(fired, [[HOOK_UPDATE_RULES, item, config]]);
  } finally {
    globalThis.Hooks = previousHooks;
  }
});

test("api helpers survive a runtime without Hooks", () => {
  const previousHooks = globalThis.Hooks;
  const previousGame = globalThis.game;
  delete globalThis.Hooks;
  delete globalThis.game;

  try {
    assert.doesNotThrow(() => notifyContainerRulesUpdated({}, {}));
    assert.doesNotThrow(() => installPublicApi());
  } finally {
    globalThis.Hooks = previousHooks;
    globalThis.game = previousGame;
  }
});
