import test from "node:test";
import assert from "node:assert/strict";

import { LOG } from "../scripts/foundry/logger.js";
import {
  MODULE_SETTING_DEFAULTS,
  directContentsWeight,
  getModuleSetting,
  patchContainerDataGetters
} from "../scripts/foundry/runtime.js";

function withSilentLog(t) {
  const prevLevel = LOG.level;
  LOG.buffer.length = 0;
  LOG.setLevel("off");
  t.after(() => {
    LOG.setLevel(prevLevel);
    LOG.buffer.length = 0;
  });
}

function makeContainerDataClass(rawContentsWeight, { computeCapacity = null } = {}) {
  class ContainerData {
    constructor(parent) {
      this.parent = parent;
      this.weight = parent.system.weight;
      this.capacity = parent.system.capacity;
      this.contents = parent.system.contents;
      this.currencyWeight = parent.system.currencyWeight ?? 0;
    }

    get contentsWeight() { return rawContentsWeight; }

    get totalWeight() { return this.parent.system.weight.value + this.contentsWeight; }
  }
  if (computeCapacity) ContainerData.prototype.computeCapacity = computeCapacity;
  return ContainerData;
}

function withContainerClass(ContainerData, fn) {
  const previous = globalThis.CONFIG;
  globalThis.CONFIG = { Item: { dataModels: { container: ContainerData } } };
  try {
    return fn();
  } finally {
    globalThis.CONFIG = previous;
  }
}

const container = (reductionPct, extraSystem = {}) => ({
  id: "bag",
  name: "Bag",
  type: "container",
  system: { weight: { value: 5, units: "lb" }, ...extraSystem },
  flags: { "weighty-containers": { reductionPct } }
});

test("the container patch scales dnd5e's own contents weight and nothing else", t => {
  withSilentLog(t);
  const ContainerData = makeContainerDataClass(12);
  withContainerClass(ContainerData, () => {
    assert.equal(patchContainerDataGetters(), true);
  });

  const plain = new ContainerData(container(0));
  assert.equal(plain.contentsWeight, 12, "no reduction leaves the system value untouched");
  assert.equal(plain.totalWeight, 17);

  const reduced = new ContainerData(container(50));
  assert.equal(reduced.contentsWeight, 6);
  assert.equal(
    reduced.totalWeight,
    11,
    "totalWeight follows for free because dnd5e builds it on contentsWeight"
  );
});

test("the container patch survives an async contents weight", async t => {
  withSilentLog(t);
  const ContainerData = makeContainerDataClass(Promise.resolve(10));
  withContainerClass(ContainerData, () => {
    patchContainerDataGetters();
  });

  const reduced = new ContainerData(container(25));
  const value = reduced.contentsWeight;
  assert.ok(value instanceof Promise, "compendium containers stay asynchronous");
  assert.equal(await value, 7.5);
});

test("patching is idempotent and logs missing data models to LOG", t => {
  withSilentLog(t);
  const ContainerData = makeContainerDataClass(8);
  withContainerClass(ContainerData, () => {
    patchContainerDataGetters();
    patchContainerDataGetters();
  });
  assert.equal(new ContainerData(container(50)).contentsWeight, 4);

  const previous = globalThis.CONFIG;
  globalThis.CONFIG = { Item: { dataModels: {} } };
  assert.equal(patchContainerDataGetters(), false);
  assert.equal(LOG.buffer.some(entry => entry.level === "error"), true);
  globalThis.CONFIG = previous;
});

test("patchComputeCapacity and directContentsWeight share core weight rules when nested contents are excluded", async t => {
  withSilentLog(t);
  const sub = {
    id: "pouch",
    type: "container",
    system: { weight: { value: 2, units: "lb" }, quantity: 1 }
  };
  const potion = {
    id: "potion",
    type: "consumable",
    system: { weight: { value: 1, units: "lb" }, quantity: 4 }
  };
  const ContainerData = makeContainerDataClass(20, {
    computeCapacity: async () => ({ value: 10, max: 10, pct: 100 })
  });
  withContainerClass(ContainerData, () => {
    patchContainerDataGetters({ includeNested: () => false });
  });

  const bag = container(50, {
    weight: { value: 1, units: "kg" },
    capacity: { weight: { value: 10, units: "kg" } },
    currencyWeight: 2,
    contents: [sub, potion]
  });
  const data = new ContainerData(bag);

  // sub (2 lb = 0.8 kg) + potion (4 lb = 1.6 kg) + currency (2 kg) = 4.4 kg; * 0.5 = 2.2 kg
  assert.equal(directContentsWeight(data), 2.2);

  const capacityContext = await data.computeCapacity();
  assert.equal(capacityContext.value, 2.2);
  assert.ok(Math.abs(capacityContext.pct - 22) < 1e-9);

  // Async compendium contents resolve via the same path.
  const asyncData = new ContainerData(container(50, {
    weight: { value: 1, units: "lb" },
    contents: Promise.resolve([sub, potion])
  }));
  assert.equal(await directContentsWeight(asyncData), 3);
});

test("getModuleSetting falls back to canonical defaults when settings are absent or throw", t => {
  const prevGame = globalThis.game;
  t.after(() => { globalThis.game = prevGame; });

  delete globalThis.game;
  assert.equal(getModuleSetting("enforceMode"), MODULE_SETTING_DEFAULTS.enforceMode);
  assert.equal(getModuleSetting("includeNested"), true);

  globalThis.game = {
    settings: {
      get: (_mod, key) => {
        if (key === "includeNested") return false;
        if (key === "notifyScope") throw new Error("not registered");
        return undefined;
      }
    }
  };
  assert.equal(getModuleSetting("includeNested"), false);
  assert.equal(getModuleSetting("notifyScope"), "selfAndGm");
});
