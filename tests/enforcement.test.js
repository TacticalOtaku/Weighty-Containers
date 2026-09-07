import test from "node:test";
import assert from "node:assert/strict";

import { ItemCollectionView } from "../scripts/core/containers.js";
import { registerEnforcementHooks } from "../scripts/foundry/enforcement.js";

const item = ({
  id,
  type = "loot",
  container = null,
  weight = 0,
  units = "lb",
  capacity = null,
  quantity = 1
}) => ({
  id,
  name: id,
  type,
  system: {
    container,
    weight: { value: weight, units },
    quantity,
    properties: new Set(),
    ...(capacity == null
      ? {}
      : { capacity: { weight: { value: capacity, units: "lb" } } })
  },
  flags: {},
  toObject() {
    return structuredClone({
      id: this.id,
      name: this.name,
      type: this.type,
      system: this.system,
      flags: this.flags
    });
  }
});

const expandObject = source => {
  const expanded = {};
  for (const [path, value] of Object.entries(source)) {
    const keys = path.split(".");
    let target = expanded;
    while (keys.length > 1) {
      const key = keys.shift();
      target[key] ??= {};
      target = target[key];
    }
    target[keys[0]] = value;
  }
  return expanded;
};

const merge = (left, right) => {
  const result = structuredClone(left);
  const apply = (target, source) => {
    for (const [key, value] of Object.entries(source)) {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        target[key] ??= {};
        apply(target[key], value);
      } else {
        target[key] = value;
      }
    }
  };
  apply(result, right);
  return result;
};

const setup = items => {
  const hooks = {};
  const socketCalls = [];
  globalThis.Hooks = {
    on(name, handler) { hooks[name] = handler; }
  };
  globalThis.CONFIG = { DND5E: {} };
  globalThis.game = {
    settings: {
      get(module, key) {
        if (module === "dnd5e" && key === "metricWeightUnits") return false;
        if (key === "includeNested") return true;
        if (key === "enforceMode") return "block";
        if (key === "exceedMessageText") return "";
        return undefined;
      }
    },
    i18n: {
      format(key) { return key; }
    },
    user: { id: "u1", isGM: false },
    users: [
      { id: "u1", active: true, isGM: false },
      { id: "gm", active: true, isGM: true }
    ]
  };
  globalThis.foundry = {
    utils: {
      deepClone: structuredClone,
      expandObject,
      mergeObject: merge
    }
  };
  const actor = {
    name: "Actor",
    items: new ItemCollectionView(items)
  };
  for (const entry of actor.items) entry.parent = actor;

  registerEnforcementHooks({
    logger: {
      info() {},
      warn() {}
    },
    socket: {
      executeForUsers(name, users, ...args) { socketCalls.push([name, ...args, users]); }
    }
  });
  return { actor, hooks, socketCalls };
};

test("preUpdateItem blocks a flattened weight-unit change that exceeds capacity", () => {
  const bag = item({ id: "bag", type: "container", capacity: 2 });
  const payload = item({
    id: "payload",
    container: "bag",
    weight: 1,
    units: "lb"
  });
  const { hooks, socketCalls } = setup([bag, payload]);

  assert.equal(
    hooks.preUpdateItem(payload, { "system.weight.units": "kg" }, {}),
    false
  );
  assert.equal(socketCalls.length, 1);
  assert.equal(socketCalls[0][1].containerName, "bag");
});

test("preCreateItem blocks an overflowing ancestor container", () => {
  const outer = item({ id: "outer", type: "container", capacity: 5 });
  const inner = item({
    id: "inner",
    type: "container",
    container: "outer",
    capacity: 20
  });
  const { actor, hooks, socketCalls } = setup([outer, inner]);
  const payload = item({
    id: "payload",
    container: "inner",
    weight: 8
  });
  payload.parent = actor;

  assert.equal(hooks.preCreateItem(payload, {}, {}), false);
  assert.equal(socketCalls.length, 1);
  assert.equal(socketCalls[0][1].containerName, "outer");
});

test("edits to an item already inside a rule-breaking container are not blocked", () => {
  const bag = item({ id: "bag", type: "container", capacity: 100 });
  bag.flags = { "weighty-containers": { allowedTypes: ["consumable"] } };
  const sword = item({ id: "sword", type: "weapon", container: "bag", weight: 6 });
  const { hooks, socketCalls } = setup([bag, sword]);

  // The sword does not satisfy the bag's rules, but it is already inside:
  // equipping or renaming it must still go through, silently.
  assert.equal(hooks.preUpdateItem(sword, { "system.equipped": true }, {}), undefined);
  assert.equal(hooks.preUpdateItem(sword, { name: "Renamed" }, {}), undefined);
  assert.equal(socketCalls.length, 0);
});

test("moving an item into a container it does not satisfy is still blocked", () => {
  const bag = item({ id: "bag", type: "container", capacity: 100 });
  bag.flags = { "weighty-containers": { allowedTypes: ["consumable"] } };
  const sword = item({ id: "sword", type: "weapon", weight: 6 });
  const { hooks, socketCalls } = setup([bag, sword]);

  assert.equal(hooks.preUpdateItem(sword, { "system.container": "bag" }, {}), false);
  assert.equal(socketCalls.length, 1);
});

test("callers can opt out of enforcement for a single operation", () => {
  const bag = item({ id: "bag", type: "container", capacity: 1 });
  const brick = item({ id: "brick", weight: 50 });
  const { hooks, socketCalls } = setup([bag, brick]);

  const bypass = { "weighty-containers": { bypass: true } };
  assert.equal(hooks.preUpdateItem(brick, { "system.container": "bag" }, bypass), undefined);
  assert.equal(socketCalls.length, 0);
});

test("rejections go to the acting user, owners and GMs - not the whole table", () => {
  const bag = item({ id: "bag", type: "container", capacity: 1 });
  const brick = item({ id: "brick", weight: 50 });
  const { hooks, socketCalls } = setup([bag, brick]);

  assert.equal(hooks.preUpdateItem(brick, { "system.container": "bag" }, {}), false);
  const recipients = socketCalls[0].at(-1);
  assert.deepEqual(recipients.sort(), ["gm", "u1"]);
});
