import { LOG_LEVELS, MODULE_ID } from "../constants.js";

export class WCLogger {
  constructor() {
    this.level = "warn";
    this.keepBuffer = true;
    this.bufferLimit = 500;
    this.withStacks = false;
    this.buffer = [];
  }

  setLevel(level) {
    if (LOG_LEVELS.includes(level)) this.level = level;
  }

  _shouldLog(level) {
    if (this.level === "off") return false;
    return LOG_LEVELS.indexOf(level) <= LOG_LEVELS.indexOf(this.level);
  }

  _push(level, message, data) {
    const entry = {
      ts: new Date().toISOString(),
      level,
      msg: message,
      data: data ?? null,
      stack: this.withStacks ? new Error().stack : null
    };
    if (this.keepBuffer) {
      this.buffer.push(entry);
      while (this.buffer.length > Math.max(0, this.bufferLimit)) {
        this.buffer.shift();
      }
    }
    if (!this._shouldLog(level)) return;

    const label = `${MODULE_ID} | ${level.toUpperCase()} | ${message}`;
    const output = console[level] ?? console.log;
    if (level === "trace" || level === "debug") {
      console.groupCollapsed(label);
      if (data !== undefined) console.log("data:", data);
      if (entry.stack) console.log("stack:", entry.stack);
      console.groupEnd();
    } else {
      output.call(console, label, data ?? "");
    }
  }

  error(message, data) { this._push("error", message, data); }
  warn(message, data) { this._push("warn", message, data); }
  info(message, data) { this._push("info", message, data); }
  debug(message, data) { this._push("debug", message, data); }
  trace(message, data) { this._push("trace", message, data); }
}

export const LOG = new WCLogger();
