import { MODULE_ID } from "../constants.js";

/**
 * Thin facade over socketlib with a native-socket fallback.
 *
 * Deliberately has no "run this as the GM" method: nothing here should be able
 * to ask a GM client to write documents on someone else's behalf.
 */
export class WCSocket {
  constructor(logger) {
    this.logger = logger;
    this.socket = null;
    this.handlers = new Map();
    this.ready = false;
  }

  init() {
    if (typeof socketlib === "undefined") {
      this.logger.info("socketlib not found - native Foundry socket fallback");
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
      if (Array.isArray(payload?.users) && !payload.users.includes(game.user.id)) return;
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
    this.handlers.get(name)(...args);
    game.socket.emit(`module.${MODULE_ID}`, { name, args, users: null });
  }

  /**
   * Run a handler on the listed users only. The local user is handled inline so
   * the notification appears even when no socket transport is available.
   *
   * @param {string} name
   * @param {string[]} userIds
   * @param {...*} args
   */
  async executeForUsers(name, userIds, ...args) {
    if (!this.ready || !this.handlers.has(name)) return;
    const targets = Array.from(new Set((userIds ?? []).filter(Boolean)));
    if (!targets.length) return;

    const localIndex = targets.indexOf(game.user?.id);
    if (localIndex !== -1) {
      targets.splice(localIndex, 1);
      this.handlers.get(name)(...args);
    }
    if (!targets.length) return;

    if (this.socket) return this.socket.executeForUsers(name, targets, ...args);
    game.socket.emit(`module.${MODULE_ID}`, { name, args, users: targets });
  }
}
