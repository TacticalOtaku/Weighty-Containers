export class SocketlibSocket {
  constructor(moduleId) {
    this.moduleId = moduleId;
    this.socket = null;
    this.functions = new Map();
  }

  static registerModule(moduleId) {
    const socket = new SocketlibSocket(moduleId);
    Hooks.once('socketlib.ready', () => {
      try {
        const libSocket = window.socketlib;
        if (!libSocket) {
          console.warn(`Socketlib not found for module ${moduleId}`);
          return;
        }
        socket.socket = libSocket.RegisterModule(socket.moduleId);
        for (const [name, func] of socket.functions) {
          socket.socket.register(name, func);
        }
        console.info(`Socketlib registered for module ${moduleId}`);
      } catch (e) {
        console.error(`Failed to register socketlib for ${moduleId}`, e);
      }
    });
    return socket;
  }

  register(name, func) {
    this.functions.set(name, func);
    if (this.socket) {
      this.socket.register(name, func);
    }
  }

  async executeForEveryone(name, ...args) {
    if (!this.socket) return;
    return this.socket.executeForEveryone(name, ...args);
  }

  async executeAsGM(name, ...args) {
    if (!this.socket) return;
    return this.socket.executeAsGM(name, ...args);
  }
 }