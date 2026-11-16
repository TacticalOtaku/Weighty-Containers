import test from "node:test";
import assert from "node:assert/strict";

import { LOG } from "../scripts/foundry/logger.js";
import { WCSocket } from "../scripts/foundry/socket.js";

test("socket facade has no remote GM write method", () => {
  const socket = new WCSocket();
  assert.equal(socket.executeAsGM, undefined);
});

test("socket ignores calls to unregistered handlers", async () => {
  const socket = new WCSocket();
  socket.ready = true;
  assert.equal(await socket.executeForUsers("updateContainerConfig", ["u1"], {}), undefined);
});

test("socket native fallback runs local handlers inline and emits only to remote targets", async t => {
  const prevSocketlib = globalThis.socketlib;
  const prevGame = globalThis.game;
  const prevLevel = LOG.level;
  LOG.setLevel("off");
  t.after(() => {
    globalThis.socketlib = prevSocketlib;
    globalThis.game = prevGame;
    LOG.setLevel(prevLevel);
  });

  delete globalThis.socketlib;
  const emitted = [];
  const listeners = new Map();
  globalThis.game = {
    user: { id: "u1" },
    socket: {
      on: (event, fn) => listeners.set(event, fn),
      emit: (event, payload) => emitted.push([event, payload])
    }
  };

  const received = [];
  const socket = new WCSocket();
  socket.register("notify", msg => received.push(msg));
  socket.init();

  await socket.executeForUsers("notify", ["u1", "gm"], "over");
  assert.deepEqual(received, ["over"]);
  assert.deepEqual(emitted, [[
    "module.weighty-containers",
    { name: "notify", args: ["over"], users: ["gm"] }
  ]]);

  listeners.get("module.weighty-containers")({ name: "notify", args: ["for-u2"], users: ["u2"] });
  assert.deepEqual(received, ["over"], "messages addressed to other users are ignored");
});
