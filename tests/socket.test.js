import test from "node:test";
import assert from "node:assert/strict";

import { WCSocket } from "../scripts/foundry/socket.js";

test("socket facade has no remote GM write method", () => {
  const logger = {
    info() {},
    error() {}
  };
  const socket = new WCSocket(logger);
  assert.equal(socket.executeAsGM, undefined);
});

test("socket ignores calls to unregistered handlers", async () => {
  const logger = {
    info() {},
    error() {}
  };
  const socket = new WCSocket(logger);
  socket.ready = true;
  assert.equal(await socket.executeForEveryone("updateContainerConfig", {}), undefined);
});
