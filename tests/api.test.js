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

const LBS_PER_KG = 2.20462;

function makeDeps(overrides = {}) {
  return {
    computeActorCarriedLbs: () => 0,
    computeAdjustedLoad: () => ({ load: 0, trace: [] }),
    getCapacityLbs: () => null,
    lbsToDisplay: lbs => lbs,
    getSystemWeightUnit: () => "lb",
    validateContainerRestrictions: () => ({ ok: true, restrictions: {} }),
    openRulesDialog: async () => "opened",
    ...overrides
  };
}

function makeActor(container) {
  return { items: new Map([[container.id, container]]) };
}

test("public api exposes the documented surface", () => {
  const api = buildPublicApi(makeDeps());

  assert.equal(api.apiVersion, API_VERSION);
  assert.equal(api.stability, "stable");

  for (const name of [
    "isContainer",
    "getReductionPct",
    "getContainerRestrictions",
    "validateContainerRestrictions",
    "getCapacityLbs",
    "getContainerLoad",
    "computeAdjustedLoad",
    "computeActorCarriedLbs",
    "lbsToDisplay",
    "getSystemWeightUnit",
    "openRulesDialog"
  ]) {
    assert.equal(typeof api[name], "function", `${name} must be callable`);
  }
});

test("openReductionDialog stays available for pre-API callers", async () => {
  const api = buildPublicApi(makeDeps());
  assert.equal(api.openReductionDialog, api.openRulesDialog);
  assert.equal(await api.openReductionDialog({}), "opened");
});

test("getContainerLoad reports load and capacity in both units", () => {
  const container = { id: "bag", type: "container", flags: { "weighty-containers": { reductionPct: 50 } } };
  const api = buildPublicApi(makeDeps({
    computeAdjustedLoad: () => ({ load: 22.0462, trace: [] }),
    getCapacityLbs: () => 44.0924,
    lbsToDisplay: lbs => lbs / LBS_PER_KG,
    getSystemWeightUnit: () => "kg"
  }));

  const load = api.getContainerLoad(makeActor(container), "bag");

  assert.equal(load.loadLbs, 22.05);
  assert.equal(load.capacityLbs, 44.09);
  assert.equal(load.load, 10);
  assert.equal(load.capacity, 20);
  assert.equal(load.unit, "kg");
  assert.equal(load.reductionPct, 50);
  assert.equal(load.pct, 50);
  assert.equal(load.isOver, false);
  assert.equal(load.hasCapacity, true);
});

test("getContainerLoad flags an overfilled container", () => {
  const container = { id: "bag", type: "container", flags: {} };
  const api = buildPublicApi(makeDeps({
    computeAdjustedLoad: () => ({ load: 60, trace: [] }),
    getCapacityLbs: () => 30
  }));

  const load = api.getContainerLoad(makeActor(container), "bag");
  assert.equal(load.isOver, true);
  assert.equal(load.pct, 100, "the meter percentage is clamped");
});

test("getContainerLoad copes with a container that declares no capacity", () => {
  const container = { id: "bag", type: "container", flags: {} };
  const api = buildPublicApi(makeDeps({
    computeAdjustedLoad: () => ({ load: 7, trace: [] }),
    getCapacityLbs: () => null
  }));

  const load = api.getContainerLoad(makeActor(container), "bag");
  assert.equal(load.hasCapacity, false);
  assert.equal(load.capacity, null);
  assert.equal(load.pct, null);
  assert.equal(load.isOver, false);
  assert.equal(load.load, 7);
});

test("getContainerLoad returns null for unknown input", () => {
  const api = buildPublicApi(makeDeps());
  assert.equal(api.getContainerLoad(null, "bag"), null);
  assert.equal(api.getContainerLoad(makeActor({ id: "bag" }), null), null);
  assert.equal(api.getContainerLoad(makeActor({ id: "bag" }), "missing"), null);
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
      ...makeDeps(),
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
    assert.doesNotThrow(() => installPublicApi(makeDeps()));
  } finally {
    globalThis.Hooks = previousHooks;
    globalThis.game = previousGame;
  }
});
