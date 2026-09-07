import test from "node:test";
import assert from "node:assert/strict";

import { patchContainerDataGetters } from "../scripts/foundry/runtime.js";

const silentLogger = { info() {}, warn() {}, debug() {}, error() {} };

function makeContainerDataClass(rawContentsWeight) {
  class ContainerData {
    constructor(parent) { this.parent = parent; }

    get contentsWeight() { return rawContentsWeight; }

    get totalWeight() { return this.parent.system.weight.value + this.contentsWeight; }
  }
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

const container = reductionPct => ({
  name: "Bag",
  system: { weight: { value: 5, units: "lb" } },
  flags: { "weighty-containers": { reductionPct } }
});

test("the container patch scales dnd5e's own contents weight and nothing else", () => {
  const ContainerData = makeContainerDataClass(12);
  withContainerClass(ContainerData, () => {
    assert.equal(patchContainerDataGetters({ logger: silentLogger }), true);
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

test("the container patch survives an async contents weight", async () => {
  const ContainerData = makeContainerDataClass(Promise.resolve(10));
  withContainerClass(ContainerData, () => {
    patchContainerDataGetters({ logger: silentLogger });
  });

  const reduced = new ContainerData(container(25));
  const value = reduced.contentsWeight;
  assert.ok(value instanceof Promise, "compendium containers stay asynchronous");
  assert.equal(await value, 7.5);
});

test("patching is idempotent and reports a missing data model", () => {
  const ContainerData = makeContainerDataClass(8);
  withContainerClass(ContainerData, () => {
    patchContainerDataGetters({ logger: silentLogger });
    patchContainerDataGetters({ logger: silentLogger });
  });
  assert.equal(new ContainerData(container(50)).contentsWeight, 4);

  const previous = globalThis.CONFIG;
  globalThis.CONFIG = { Item: { dataModels: {} } };
  const errors = [];
  assert.equal(
    patchContainerDataGetters({ logger: { ...silentLogger, error: m => errors.push(m) } }),
    false
  );
  assert.equal(errors.length, 1);
  globalThis.CONFIG = previous;
});
