// ─────────────────────────────────────────────────────────
// Weighty Containers - Foundry VTT v14.367 / dnd5e 5.3.3
// ─────────────────────────────────────────────────────────

import { installPublicApi } from "./foundry/api.js";
import { registerEnforcementHooks, renderRejection } from "./foundry/enforcement.js";
import { LOG } from "./foundry/logger.js";
import { registerContainerPatch, registerModuleSettings } from "./foundry/runtime.js";
import { WCSocket } from "./foundry/socket.js";
import { registerSheetUiHooks } from "./ui/sheet-hooks.js";

const wcSocket = new WCSocket();

function notifyExceedRemote(data) {
  const message = renderRejection(data);
  if (!message) {
    LOG.warn("Rejected invalid notification socket payload");
    return;
  }
  ui.notifications?.warn(message);
}

registerModuleSettings();
// The reduction rides on dnd5e's own contentsWeight, so the capacity bar,
// the inventory rows and the encumbrance track all pick it up from one patch.
registerContainerPatch();

Hooks.once("ready", () => {
  wcSocket.register("notifyExceedRemote", notifyExceedRemote);
  wcSocket.init();

  registerEnforcementHooks({ socket: wcSocket });
  registerSheetUiHooks();
  installPublicApi();

  LOG.info("ready", {
    system: game.system?.id,
    systemVersion: game.system?.version,
    foundryVersion: game.version
  });
});
