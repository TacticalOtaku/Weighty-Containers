import { MODULE_ID } from "../constants.js";

export class WCSocket {
  constructor(logger) {
    this.logger = logger;
    this.socket = null;
    this.handlers = new Map();
    this.ready = false;
  }

  init() {
    if (typeof socketlib === "undefined") {
      this.logger.info("socketlib not found — native Foundry socket fallback");
      this._initNativeFallback();
      return;
    }
    try {
      this.socket = socketlib.registerModule(MODULE_ID);
      for (const [name, handler] of this.handlers) {
        this.socket.register(name, handler);
      }
      this.ready = true;
      this.logger.info("socketlib registered");
    } catch (error) {
      this.logger.error("socketlib registration failed", error);
      this._initNativeFallback();
    }
  }

  _initNativeFallback() {
    game.socket.on(`module.${MODULE_ID}`, payload => {
      const handler = this.handlers.get(payload?.name);
      if (handler) handler(...(payload.args ?? []));
    });
    this.ready = true;
  }

  register(name, handler) {
    this.handlers.set(name, handler);
    if (this.socket) this.socket.register(name, handler);
  }

  async executeForEveryone(name, ...args) {
    if (!this.ready || !this.handlers.has(name)) return;
    if (this.socket) return this.socket.executeForEveryone(name, ...args);
    const handler = this.handlers.get(name);
    handler(...args);
    game.socket.emit(`module.${MODULE_ID}`, { name, args });
  }
}
