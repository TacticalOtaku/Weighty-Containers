// ─────────────────────────────────────────────────────────
// Weighty Containers — Foundry VTT v13.351 / dnd5e 5.2.5
// ─────────────────────────────────────────────────────────

const MODULE_ID = "weighty-containers";
const LBS_PER_KG = 2.20462;

// ══════════════════════ Logging ══════════════════════
const LOG_LEVELS = ["off", "error", "warn", "info", "debug", "trace"];

class WCLogger {
  constructor() {
    this.level = "warn";
    this.keepBuffer = true;
    this.bufferLimit = 500;
    this.withStacks = false;
    this.buffer = [];
  }

  setLevel(l) {
    if (LOG_LEVELS.includes(l)) this.level = l;
  }

  _shouldLog(l) {
    if (this.level === "off") return false;
    return LOG_LEVELS.indexOf(l) <= LOG_LEVELS.indexOf(this.level);
  }

  _push(l, msg, data) {
    const entry = {
      ts: new Date().toISOString(),
      level: l,
      msg,
      data: data ?? null,
      stack: this.withStacks ? new Error().stack : null
    };
    if (this.keepBuffer) {
      this.buffer.push(entry);
      if (this.buffer.length > this.bufferLimit) this.buffer.shift();
    }
    if (!this._shouldLog(l)) return;
    const label = `${MODULE_ID} | ${l.toUpperCase()} | ${msg}`;
    const fn = console[l] ?? console.log;
    if (l === "trace" || l === "debug") {
      console.groupCollapsed(label);
      if (data !== undefined) console.log("data:", data);
      if (entry.stack) console.log("stack:", entry.stack);
      console.groupEnd();
    } else {
      fn.call(console, label, data ?? "");
    }
  }

  error(m, d) { this._push("error", m, d); }
  warn(m, d) { this._push("warn", m, d); }
  info(m, d) { this._push("info", m, d); }
  debug(m, d) { this._push("debug", m, d); }
  trace(m, d) { this._push("trace", m, d); }
}

const LOG = new WCLogger();

// ══════════════════════ Socket Wrapper ══════════════════════

class WCSocket {
  constructor() {
    this._socket = null;
    this._pending = new Map();
    this._ready = false;
  }

  init() {
    if (typeof socketlib === "undefined") {
      LOG.info("socketlib not found — native Foundry socket fallback");
      this._initNativeFallback();
      return;
    }
    try {
      this._socket = socketlib.registerModule(MODULE_ID);
      for (const [name, func] of this._pending) {
        this._socket.register(name, func);
      }
      this._ready = true;
      LOG.info("socketlib registered");
    } catch (e) {
      LOG.error("socketlib registration failed", e);
      this._initNativeFallback();
    }
  }

  _initNativeFallback() {
    game.socket.on(`module.${MODULE_ID}`, (payload) => {
      const fn = this._pending.get(payload?.name);
      if (fn) fn(...(payload.args ?? []));
    });
    this._ready = true;
  }

  register(name, func) {
    this._pending.set(name, func);
    if (this._socket) this._socket.register(name, func);
  }

  async executeForEveryone(name, ...args) {
    if (!this._ready) return;
    if (this._socket) return this._socket.executeForEveryone(name, ...args);
    const fn = this._pending.get(name);
    if (fn) fn(...args);
    game.socket.emit(`module.${MODULE_ID}`, { name, args });
  }

  async executeAsGM(name, ...args) {
    if (!this._ready) return;
    if (this._socket) return this._socket.executeAsGM(name, ...args);
    if (game.user.isGM) {
      const fn = this._pending.get(name);
      if (fn) return fn(...args);
    }
    game.socket.emit(`module.${MODULE_ID}`, { name, args });
  }
}

const wcSocket = new WCSocket();

// ══════════════════════ Unit Conversion ══════════════════════

function getSystemWeightUnit() {
  try {
    return game.settings.get("dnd5e", "metricWeightUnits") ? "kg" : "lb";
  } catch {
    return "lb";
  }
}

function isMetricUnit() {
  return getSystemWeightUnit() === "kg";
}

function convertToLbs(value, units) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const u = String(units || getSystemWeightUnit()).toLowerCase().trim();
  switch (u) {
    case "lb": case "lbs": return n;
    case "kg": case "kgs": case "kilogram": case "kilograms": return n * LBS_PER_KG;
    case "oz": case "ounce": case "ounces": return n / 16;
    default: return n;
  }
}

function lbsToDisplay(lbs) {
  return isMetricUnit() ? lbs / LBS_PER_KG : lbs;
}

function displayUnit() {
  return isMetricUnit() ? "kg" : "lb";
}

// ══════════════════════ Numeric Helpers ══════════════════════

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function fmt2(n) {
  return Number(n).toFixed(2);
}

// ══════════════════════ Item Helpers (dnd5e 5.2.x) ══════════════════════

function getItemUnitWeight(item) {
  if (!item?.system) return 0;
  const w = item.system.weight;
  if (w == null) return 0;
  if (typeof w === "object" && w !== null) {
    return num(w.value, 0);
  }
  return num(w, 0);
}

function getItemWeightUnits(item) {
  if (!item?.system) return null;
  const w = item.system.weight;
  if (typeof w === "object" && w !== null) {
    return w.units || null;
  }
  return null;
}

function getItemQuantity(item) {
  return num(item?.system?.quantity, 1);
}

function ownWeightLbs(item) {
  return convertToLbs(getItemUnitWeight(item), getItemWeightUnits(item)) * getItemQuantity(item);
}

function isContainer(item) {
  return item?.type === "container";
}

function getItem(actor, id) {
  return actor?.items?.get(id) ?? null;
}

// ══════════════════════ Container-specific Helpers ══════════════════════

function getReductionPct(containerItem) {
  const v = Number(containerItem?.flags?.[MODULE_ID]?.reductionPct ?? 0);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}

/**
 * dnd5e 5.2.x: system.capacity = { count, volume: {...}, weight: { value, units } }
 */
function getCapacityLbs(containerItem) {
  const cap = containerItem?.system?.capacity;
  if (!cap) return null;

  // dnd5e 5.2.x: capacity.weight.value + capacity.weight.units
  if (cap.weight?.value != null) {
    const v = num(cap.weight.value, 0);
    if (v > 0) {
      const units = cap.weight.units || getSystemWeightUnit();
      return convertToLbs(v, units);
    }
  }

  // Fallback: capacity.value (older dnd5e)
  if (cap.value != null && Number.isFinite(Number(cap.value))) {
    const valLbs = convertToLbs(cap.value, cap.units);
    if (valLbs > 0) return valLbs;
  }

  // Plain number
  if (typeof cap === "number" && cap > 0) return cap;

  LOG.debug("capacity not resolved", { item: containerItem?.name, cap });
  return null;
}

// ══════════════════════ Index & Load Calculation ══════════════════════

function buildContainerIndex(actor) {
  const idx = new Map();
  if (!actor?.items) return idx;
  for (const it of actor.items) {
    const cid = it.system?.container ?? null;
    if (!cid) continue;
    if (!idx.has(cid)) idx.set(cid, []);
    idx.get(cid).push(it);
  }
  return idx;
}

function computeAdjustedLoad(actor, containerId, idx = null, memo = null, visited = null) {
  const includeNested = game.settings.get(MODULE_ID, "includeNested");
  const trace = [];
  if (!actor || !containerId) return { load: 0, trace };

  const by = idx ?? buildContainerIndex(actor);
  const memoMap = memo ?? new Map();
  const vis = visited ?? new Set();

  const container = getItem(actor, containerId);
  const reduction = getReductionPct(container) / 100;
  const memoKey = `${containerId}|${includeNested}|${reduction}`;

  if (memoMap.has(memoKey)) return { load: memoMap.get(memoKey), trace };

  if (vis.has(containerId)) {
    LOG.warn("Cycle detected", { containerId });
    memoMap.set(memoKey, 0);
    return { load: 0, trace: [{ type: "cycle-break", id: containerId }] };
  }
  vis.add(containerId);

  let load = 0;
  const children = by.get(containerId) ?? [];

  for (const child of children) {
    const wLbs = ownWeightLbs(child);
    const reduced = wLbs * (1 - reduction);

    if (isContainer(child)) {
      load += reduced;
      trace.push({ child: child.name, id: child.id, type: "container-self", wLbs, reduction, added: reduced });
      if (includeNested) {
        const sub = computeAdjustedLoad(actor, child.id, by, memoMap, vis);
        load += sub.load;
        trace.push({ child: child.name, id: child.id, type: "container-contents", nestedLoad: sub.load });
      }
    } else {
      load += reduced;
      trace.push({ child: child.name, id: child.id, type: "item", wLbs, reduction, added: reduced });
    }
  }

  vis.delete(containerId);
  load = Math.max(0, Number(load.toFixed(5)));
  memoMap.set(memoKey, load);
  return { load, trace };
}

function computeActorCarriedLbs(actor) {
  if (!actor?.items) return 0;
  let total = 0;
  const idx = buildContainerIndex(actor);
  const memo = new Map();

  for (const item of actor.items) {
    if (item.system?.container) continue;
    total += ownWeightLbs(item);
    if (isContainer(item)) {
      const { load } = computeAdjustedLoad(actor, item.id, idx, memo);
      total += load;
    }
  }
  return Math.max(0, Number(total.toFixed(5)));
}

// ══════════════════════ Settings ══════════════════════

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "enforceMode", {
    name: `${MODULE_ID}.enforceMode.name`,
    hint: `${MODULE_ID}.enforceMode.hint`,
    scope: "world", config: true, restricted: true,
    type: String,
    choices: {
      block: game.i18n.localize(`${MODULE_ID}.enforceMode.block`),
      warn: game.i18n.localize(`${MODULE_ID}.enforceMode.warn`)
    },
    default: "block"
  });

  game.settings.register(MODULE_ID, "includeNested", {
    name: `${MODULE_ID}.includeNested.name`,
    hint: `${MODULE_ID}.includeNested.hint`,
    scope: "world", config: true, restricted: true,
    type: Boolean, default: true
  });

  game.settings.register(MODULE_ID, "logLevel", {
    name: `${MODULE_ID}.logLevel.name`,
    hint: `${MODULE_ID}.logLevel.hint`,
    scope: "client", config: true, restricted: false,
    type: String,
    choices: Object.fromEntries(LOG_LEVELS.map(l => [l, game.i18n.localize(`${MODULE_ID}.logLevel.${l}`)])),
    default: "warn",
    onChange: v => LOG.setLevel(v)
  });

  game.settings.register(MODULE_ID, "logStacks", {
    name: `${MODULE_ID}.logStacks.name`,
    hint: `${MODULE_ID}.logStacks.hint`,
    scope: "client", config: true, restricted: false,
    type: Boolean, default: false,
    onChange: v => { LOG.withStacks = v; }
  });

  game.settings.register(MODULE_ID, "logBufferLimit", {
    name: `${MODULE_ID}.logBufferLimit.name`,
    hint: `${MODULE_ID}.logBufferLimit.hint`,
    scope: "client", config: true, restricted: false,
    type: Number, default: 500,
    onChange: v => { LOG.bufferLimit = num(v, 500); }
  });

  game.settings.register(MODULE_ID, "exceedMessageText", {
    name: `${MODULE_ID}.exceedMessageText.name`,
    hint: `${MODULE_ID}.exceedMessageText.hint`,
    scope: "client", config: true, restricted: false,
    type: String, default: ""
  });

  // CSS
  const styleId = `${MODULE_ID}-css`;
  if (!document.getElementById(styleId)) {
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
      .wc-inline-gear {
        display: inline-flex; align-items: center; justify-content: center;
        width: 22px; height: 22px; border-radius: 4px;
        border: 1px solid rgba(0,0,0,.15); background: rgba(0,0,0,.06);
        cursor: pointer; margin-left: 0.25rem;
      }
      .wc-inline-gear:hover { background: rgba(0,0,0,.12); }
    `;
    document.head.appendChild(style);
  }

  try {
    LOG.setLevel(game.settings.get(MODULE_ID, "logLevel"));
    LOG.withStacks = game.settings.get(MODULE_ID, "logStacks");
    LOG.bufferLimit = game.settings.get(MODULE_ID, "logBufferLimit");
  } catch {}

  LOG.info("init complete");
});

// ══════════════════════ Ready ══════════════════════

Hooks.once("ready", () => {
  wcSocket.register("updateReductionPct", _socketUpdateReduction);
  wcSocket.register("notifyExceedRemote", _socketNotifyExceed);
  wcSocket.init();

  _patchContainerDataGetters();
  _registerEncumbrancePatch();
  _registerEnforcementHooks();
  _registerUIHooks();

  LOG.info("ready", {
    system: game.system?.id,
    systemVersion: game.system?.version,
    foundryVersion: game.version
  });
});

// ══════════════════════ Socket Handlers ══════════════════════

async function _socketUpdateReduction(containerId, pct) {
  if (!game.user.isGM) return;
  const [actorId, itemId] = containerId.split(".");
  const actor = game.actors.get(actorId);
  if (!actor) return;
  const container = getItem(actor, itemId);
  if (!container) return;
  await container.update({ [`flags.${MODULE_ID}.reductionPct`]: pct });
  LOG.info("Socket: reduction updated", { container: container.name, pct });
}

async function _socketNotifyExceed(data) {
  ui.notifications?.warn(data.msg);
}

// ══════════════════════════════════════════════════════════════════
// PRIMARY PATCH: Override ContainerData computed getters
// ══════════════════════════════════════════════════════════════════
// In dnd5e 5.2.x, ContainerData has computed getters:
//   - contentsWeight  (weight of all items inside, in display units)
//   - totalWeight     (contentsWeight + own weight + currency weight)
//
// The ContainerSheet reads these getters to render the capacity bar.
// We override them on the ContainerData PROTOTYPE so that when
// a container has a reduction percentage, the getter returns the
// adjusted value instead of the raw sum.
//
// This approach works because:
//   1. Getters are called fresh every time the sheet renders
//   2. We preserve the original getter for containers without reduction
//   3. No DOM manipulation needed — the template gets correct data
// ══════════════════════════════════════════════════════════════════

function _patchContainerDataGetters() {
  // Find the ContainerData class from the system's data models
  const containerDataClass = CONFIG.Item.dataModels?.container;

  if (!containerDataClass) {
    LOG.error("Could not find ContainerData class at CONFIG.Item.dataModels.container");
    LOG.warn("Falling back to DOM-based patching");
    _registerDOMFallback();
    return;
  }

  const proto = containerDataClass.prototype;

  // ── Patch contentsWeight ──
  const originalContentsWeightDesc = Object.getOwnPropertyDescriptor(proto, "contentsWeight");

  if (originalContentsWeightDesc?.get) {
    const originalContentsWeightGet = originalContentsWeightDesc.get;

    Object.defineProperty(proto, "contentsWeight", {
      get() {
        const rawValue = originalContentsWeightGet.call(this);

        // 'this' is the ContainerData instance
        // this.parent is the Item document
        const item = this.parent;
        if (!item) return rawValue;

        const reduction = getReductionPct(item);
        if (reduction === 0) return rawValue;

        const actor = item.parent;
        if (!actor) return rawValue;

        // Compute our adjusted load in display units
        const { load: adjustedLbs } = computeAdjustedLoad(actor, item.id);
        const adjustedDisplay = Number(lbsToDisplay(adjustedLbs).toFixed(2));

        LOG.trace("contentsWeight getter override", {
          container: item.name,
          raw: rawValue,
          adjusted: adjustedDisplay,
          reduction
        });

        return adjustedDisplay;
      },
      configurable: true,
      enumerable: originalContentsWeightDesc.enumerable ?? true
    });

    LOG.info("Patched ContainerData.contentsWeight getter");
  } else {
    LOG.warn("contentsWeight getter not found on ContainerData prototype", {
      descriptor: originalContentsWeightDesc,
      protoKeys: Object.getOwnPropertyNames(proto)
    });
  }

  // ── Patch totalWeight ──
  // totalWeight = contentsWeight + ownWeight + currencyWeight
  // Since contentsWeight is already patched, totalWeight should
  // automatically use the patched value IF it calls this.contentsWeight.
  // But some implementations cache or inline the calculation, so we
  // patch totalWeight too for safety.
  const originalTotalWeightDesc = Object.getOwnPropertyDescriptor(proto, "totalWeight");

  if (originalTotalWeightDesc?.get) {
    const originalTotalWeightGet = originalTotalWeightDesc.get;

    Object.defineProperty(proto, "totalWeight", {
      get() {
        const item = this.parent;
        if (!item) return originalTotalWeightGet.call(this);

        const reduction = getReductionPct(item);
        if (reduction === 0) return originalTotalWeightGet.call(this);

        // Recompute: own weight + adjusted contents + currency weight
        const ownW = num(this.weight?.value, 0) * num(this.quantity, 1);
        const contentsW = this.contentsWeight; // Already patched
        const currencyW = num(this.currencyWeight, 0);

        const total = Number((ownW + contentsW + currencyW).toFixed(2));

        LOG.trace("totalWeight getter override", {
          container: item.name,
          own: ownW,
          contents: contentsW,
          currency: currencyW,
          total
        });

        return total;
      },
      configurable: true,
      enumerable: originalTotalWeightDesc.enumerable ?? true
    });

    LOG.info("Patched ContainerData.totalWeight getter");
  } else {
    LOG.debug("totalWeight getter not found — may not be needed");
  }
}

// ══════════════════════ DOM Fallback (if getter patch fails) ══════════════════════

function _registerDOMFallback() {
  const onRender = (app, element) => {
    const el = element instanceof HTMLElement ? element : element?.[0] ?? element;
    if (!(el instanceof HTMLElement)) return;

    const item = app?.document ?? app?.item ?? app?.object;
    if (!(item instanceof Item) || item.type !== "container") return;
    if (!item.parent) return;

    const reduction = getReductionPct(item);
    if (reduction === 0) return;

    const capacityLbs = getCapacityLbs(item);
    if (!capacityLbs) return;

    const { load: loadLbs } = computeAdjustedLoad(item.parent, item.id);
    const loadDisplay = lbsToDisplay(loadLbs);
    const capDisplay = lbsToDisplay(capacityLbs);
    const pct = capDisplay > 0 ? Math.clamp(Math.round((loadDisplay / capDisplay) * 100), 0, 100) : 0;

    // Update [role="meter"]
    const meter = el.querySelector('[role="meter"]');
    if (meter) {
      meter.setAttribute("aria-valuenow", String(loadDisplay.toFixed(2)));
      meter.setAttribute("aria-valuemax", String(capDisplay.toFixed(2)));
      const fill = meter.querySelector(".fill, .bar, [style]");
      if (fill) fill.style.width = `${pct}%`;
    }

    // Update encumbrance text via walker
    const rx = /([0-9]+(?:[.,][0-9]+)?)\s*\/\s*([0-9]+(?:[.,][0-9]+)?)/;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    let node;
    while ((node = walker.nextNode())) {
      if (rx.test(node.textContent)) {
        const m = node.textContent.match(rx);
        const matchMax = Number(m[2].replace(",", "."));
        if (Math.abs(matchMax - capDisplay) < 0.1) {
          node.textContent = node.textContent.replace(rx, `${fmt2(loadDisplay)} / ${fmt2(capDisplay)}`);
          break;
        }
      }
    }
  };

  Hooks.on("renderItemSheet", onRender);
  Hooks.on("renderContainerSheet", onRender);
}

// ══════════════════════ Actor Encumbrance Patch ══════════════════════

function _registerEncumbrancePatch() {
  if (typeof libWrapper === "undefined") {
    LOG.error("lib-wrapper not found!");
    return;
  }

  try {
    libWrapper.register(
      MODULE_ID,
      "CONFIG.Actor.documentClass.prototype.prepareDerivedData",
      function wcPrepareDerivedData(wrapped, ...args) {
        wrapped(...args);
        try {
          const enc = this.system?.attributes?.encumbrance;
          if (!enc) return;
          const adjustedLbs = computeActorCarriedLbs(this);
          const displayWeight = lbsToDisplay(adjustedLbs);
          enc.value = Number(displayWeight.toFixed(2));
          if (enc.max > 0) {
            enc.pct = Math.clamp(Math.round((enc.value / enc.max) * 100), 0, 100);
          } else {
            enc.pct = 0;
          }
        } catch (e) {
          LOG.error("Encumbrance patch failed", { actor: this?.name, error: e });
        }
      },
      "WRAPPER"
    );
    LOG.info("libWrapper: Actor.prepareDerivedData patched");
  } catch (e) {
    LOG.error("Failed to register libWrapper for Actor.prepareDerivedData", e);
  }
}

// ══════════════════════ Enforcement ══════════════════════

function _registerEnforcementHooks() {
  Hooks.on("preCreateItem", (item, data) => _enforceOnCreate(item, data));
  Hooks.on("preUpdateItem", (item, changes) => _enforceOnUpdate(item, changes));
}

function _enforceOnCreate(item, data) {
  const actor = item?.parent;
  const containerId = data?.system?.container ?? null;
  if (!actor || !containerId) return;

  const container = getItem(actor, containerId);
  if (!container) return;
  const capacityLbs = getCapacityLbs(container);
  if (!capacityLbs) return;

  const { load: currentLbs } = computeAdjustedLoad(actor, containerId);
  const reduction = getReductionPct(container) / 100;

  const rawWeight = data?.system?.weight;
  let unitWeight = 0;
  let units = null;
  if (typeof rawWeight === "object" && rawWeight !== null) {
    unitWeight = num(rawWeight.value, 0);
    units = rawWeight.units || null;
  } else {
    unitWeight = num(rawWeight, 0);
  }
  const qty = num(data?.system?.quantity, 1);
  const deltaLbs = convertToLbs(unitWeight * qty, units) * (1 - reduction);

  if (currentLbs + deltaLbs > capacityLbs) {
    _notifyExceed({ actorName: actor?.name, containerName: container?.name, capacityLbs, beforeLbs: currentLbs, deltaLbs });
    if (game.settings.get(MODULE_ID, "enforceMode") === "block") return false;
  }
}

function _enforceOnUpdate(item, changes) {
  const actor = item?.parent;
  if (!actor) return;

  const currentCid = item.system?.container ?? null;
  const newCid = changes?.system?.container ?? currentCid;

  // Quantity increase
  if (changes?.system?.quantity != null && newCid && newCid === currentCid) {
    const newQty = num(changes.system.quantity, getItemQuantity(item));
    const oldQty = getItemQuantity(item);
    if (newQty > oldQty) {
      const container = getItem(actor, newCid);
      const capacityLbs = getCapacityLbs(container);
      if (capacityLbs) {
        const { load: currentLbs } = computeAdjustedLoad(actor, newCid);
        const reduction = getReductionPct(container) / 100;
        const deltaLbs = (newQty - oldQty) * convertToLbs(getItemUnitWeight(item), getItemWeightUnits(item)) * (1 - reduction);
        if (currentLbs + deltaLbs > capacityLbs) {
          _notifyExceed({ actorName: actor?.name, containerName: container?.name, capacityLbs, beforeLbs: currentLbs, deltaLbs });
          if (game.settings.get(MODULE_ID, "enforceMode") === "block") return false;
        }
      }
    }
  }

  // Move to different container
  if (newCid && newCid !== currentCid) {
    const dest = getItem(actor, newCid);
    if (!dest) return;
    const capacityLbs = getCapacityLbs(dest);
    if (capacityLbs) {
      const idx = buildContainerIndex(actor);
      const memo = new Map();
      const { load: currentLbs } = computeAdjustedLoad(actor, newCid, idx, memo);
      const destRed = getReductionPct(dest) / 100;
      let deltaLbs = ownWeightLbs(item) * (1 - destRed);
      if (isContainer(item) && game.settings.get(MODULE_ID, "includeNested")) {
        const { load } = computeAdjustedLoad(actor, item.id, idx, memo);
        deltaLbs += load;
      }
      if (currentLbs + deltaLbs > capacityLbs) {
        _notifyExceed({ actorName: actor?.name, containerName: dest?.name, capacityLbs, beforeLbs: currentLbs, deltaLbs });
        if (game.settings.get(MODULE_ID, "enforceMode") === "block") return false;
      }
    }
  }

  // Weight increase
  const weightChange = changes?.system?.weight;
  if (weightChange != null && currentCid) {
    const container = getItem(actor, currentCid);
    const capacityLbs = getCapacityLbs(container);
    if (capacityLbs) {
      const { load: currentLbs } = computeAdjustedLoad(actor, currentCid);
      const reduction = getReductionPct(container) / 100;
      const oldTotalLbs = ownWeightLbs(item) * (1 - reduction);
      let newUnitW = getItemUnitWeight(item);
      let newUnits = getItemWeightUnits(item);
      if (typeof weightChange === "object" && weightChange !== null) {
        if (weightChange.value != null) newUnitW = num(weightChange.value, newUnitW);
        if (weightChange.units != null) newUnits = weightChange.units;
      } else {
        newUnitW = num(weightChange, newUnitW);
      }
      const newTotalLbs = convertToLbs(newUnitW * getItemQuantity(item), newUnits) * (1 - reduction);
      const deltaLbs = Math.max(0, newTotalLbs - oldTotalLbs);
      if (deltaLbs > 0 && currentLbs + deltaLbs > capacityLbs) {
        _notifyExceed({ actorName: actor?.name, containerName: container?.name, capacityLbs, beforeLbs: currentLbs, deltaLbs });
        if (game.settings.get(MODULE_ID, "enforceMode") === "block") return false;
      }
    }
  }
}

// ══════════════════════ Notifications ══════════════════════

function _makeExceedMessage({ containerName, capacityLbs, beforeLbs, deltaLbs }) {
  const custom = (game.settings.get(MODULE_ID, "exceedMessageText") ?? "").trim();
  if (custom) return custom;
  const metric = isMetricUnit();
  const convert = v => lbsToDisplay(v);
  const key = metric ? `${MODULE_ID}.exceedMessage.default_kg` : `${MODULE_ID}.exceedMessage.default`;
  return game.i18n.format(key, {
    containerName: containerName ?? "Container",
    before: fmt2(convert(beforeLbs)),
    delta: fmt2(convert(deltaLbs)),
    capacity: fmt2(convert(capacityLbs))
  });
}

function _notifyExceed({ actorName, containerName, capacityLbs, beforeLbs, deltaLbs }) {
  const msg = _makeExceedMessage({ containerName, capacityLbs, beforeLbs, deltaLbs });
  wcSocket.executeForEveryone("notifyExceedRemote", { msg, actorName, containerName, capacityLbs, beforeLbs, deltaLbs });
  LOG.info("capacity exceeded", { actorName, containerName, capacityLbs, beforeLbs, deltaLbs });
}

// ══════════════════════ UI Hooks ══════════════════════

function _registerUIHooks() {
  const debounceTimers = new Map();
  const debouncedRender = (key, fn, delay = 100) => {
    clearTimeout(debounceTimers.get(key));
    debounceTimers.set(key, setTimeout(fn, delay));
  };

  Hooks.on("getItemSheetHeaderButtons", (app, buttons) => {
    _injectHeaderButton(app, buttons);
  });

  // Inline gear only — no DOM capacity patching needed
  const onRender = (app, element) => {
    const el = element instanceof HTMLElement ? element : element?.[0] ?? element;
    if (el instanceof HTMLElement) {
      try { _ensureInlineGear(app, el); } catch (e) { LOG.error("Inline gear failed", e); }
    }
  };

  Hooks.on("renderItemSheet", onRender);
  Hooks.on("renderContainerSheet", onRender);
  Hooks.on("renderItemSheet5e", onRender);
  Hooks.on("renderContainerSheet5e", onRender);

  // Rerender on changes
  Hooks.on("updateItem", (item) => {
    const actor = item.parent;
    if (!actor) return;
    if (isContainer(item) || item.system?.container) {
      debouncedRender(`actor:${actor.id}`, () => {
        if (actor.sheet?.rendered) actor.sheet.render(false);
      });
    }
    if (isContainer(item)) {
      debouncedRender(`item:${item.id}`, () => {
        if (item.sheet?.rendered) item.sheet.render(false);
      });
    }
    const cid = item.system?.container;
    if (cid) {
      const c = getItem(actor, cid);
      if (c?.sheet?.rendered) {
        debouncedRender(`item:${cid}`, () => c.sheet.render(false));
      }
    }
  });

  const onItemChange = (item) => {
    const actor = item.parent;
    if (!actor) return;
    const cid = item.system?.container;
    if (cid) {
      const c = getItem(actor, cid);
      debouncedRender(`item:${cid}`, () => { if (c?.sheet?.rendered) c.sheet.render(false); });
    }
    debouncedRender(`actor:${actor.id}`, () => { if (actor.sheet?.rendered) actor.sheet.render(false); });
  };

  Hooks.on("createItem", onItemChange);
  Hooks.on("deleteItem", onItemChange);
}

function _injectHeaderButton(app, buttons) {
  try {
    const doc = app?.document ?? app?.item ?? app?.object;
    if (!(doc instanceof Item) || doc.type !== "container") return;
    if (!game.user.isGM) return;
    if (buttons.some(b => b?.class === "wc-reduction-btn")) return;
    buttons.unshift({
      label: game.i18n.localize(`${MODULE_ID}.reductionBtn.label`),
      class: "wc-reduction-btn",
      icon: "fas fa-cog",
      onclick: () => openReductionDialog(doc)
    });
  } catch (e) {
    LOG.error("Header button injection failed", e);
  }
}

function _ensureInlineGear(app, element) {
  const doc = app?.document ?? app?.item ?? app?.object;
  if (!(doc instanceof Item) || doc.type !== "container") return;
  if (!game.user.isGM) return;

  const header = element.querySelector(".sheet-header, header.sheet-header, .item-header, .window-header");
  if (!header) return;
  if (header.querySelector(".wc-inline-gear")) return;

  const btn = document.createElement("span");
  btn.className = "wc-inline-gear";
  btn.title = game.i18n.localize(`${MODULE_ID}.inlineGear.title`);
  btn.innerHTML = '<i class="fas fa-cog"></i>';
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    openReductionDialog(doc);
  });

  const controls = header.querySelector(".header-controls, .controls, .toggles, .item-controls, .window-title");
  if (controls) controls.after(btn);
  else header.appendChild(btn);
}

// ══════════════════════ GM Dialog ══════════════════════

async function openReductionDialog(containerItem) {
  if (!containerItem) {
    ui.notifications?.error(game.i18n.localize(`${MODULE_ID}.reductionDialog.errorNoItem`));
    return;
  }

  const cur = getReductionPct(containerItem);
  const content = `
    <form>
      <div class="form-group">
        <label>${game.i18n.localize(`${MODULE_ID}.reductionDialog.label`)}</label>
        <input type="number" name="pct" value="${cur}" min="0" max="100" step="1" autofocus/>
        <p class="notes">${game.i18n.localize(`${MODULE_ID}.reductionDialog.notes`)}</p>
      </div>
    </form>`;

  let pct = null;

  if (foundry.applications?.api?.DialogV2) {
    pct = await foundry.applications.api.DialogV2.prompt({
      window: { title: game.i18n.localize(`${MODULE_ID}.reductionDialog.title`) },
      content,
      ok: {
        label: game.i18n.localize(`${MODULE_ID}.reductionDialog.save`),
        callback: (event, button, dialog) => {
          const root = dialog?.element ?? dialog;
          const el = root instanceof HTMLElement ? root : document.body;
          const input = el.querySelector('input[name="pct"]');
          const val = Number(input?.value);
          return Math.clamp(Math.round(Number.isFinite(val) ? val : 0), 0, 100);
        }
      },
      rejectClose: false
    });
  } else {
    pct = await Dialog.prompt({
      title: game.i18n.localize(`${MODULE_ID}.reductionDialog.title`),
      content,
      label: game.i18n.localize(`${MODULE_ID}.reductionDialog.save`),
      callback: (html) => {
        const el = html instanceof HTMLElement ? html : html[0] ?? html;
        const input = el.querySelector('input[name="pct"]');
        const val = Number(input?.value);
        return Math.clamp(Math.round(Number.isFinite(val) ? val : 0), 0, 100);
      },
      rejectClose: false
    });
  }

  if (pct == null) return;

  if (containerItem.parent && wcSocket._ready) {
    await wcSocket.executeAsGM("updateReductionPct", `${containerItem.parent.id}.${containerItem.id}`, pct);
  } else {
    await containerItem.update({ [`flags.${MODULE_ID}.reductionPct`]: pct });
  }

  ui.notifications?.info(
    game.i18n.format(`${MODULE_ID}.reductionSet.notification`, { pct, containerName: containerItem.name })
  );
}

// ══════════════════════ Debug API ══════════════════════

Hooks.once("ready", () => {
  globalThis.weightyCont = {
    get log() { return LOG; },
    get socket() { return wcSocket; },
    computeActorCarriedLbs,
    computeAdjustedLoad,
    buildContainerIndex,
    getCapacityLbs,
    getReductionPct,

    _findOpenApps() {
      const apps = [];
      if (foundry.applications?.instances instanceof Map) {
        for (const app of foundry.applications.instances.values()) apps.push(app);
      }
      if (ui.windows) {
        const iter = ui.windows instanceof Map ? ui.windows.values() : Object.values(ui.windows);
        for (const app of iter) apps.push(app);
      }
      return apps;
    },

    _findOpenContainer() {
      for (const app of this._findOpenApps()) {
        const doc = app?.document ?? app?.object ?? app?.item;
        if (doc instanceof Item && doc.type === "container") return doc;
      }
      return null;
    },

    dumpContainer(itemOrName) {
      let item = null;
      if (itemOrName instanceof Item) {
        item = itemOrName;
      } else if (typeof itemOrName === "string") {
        const actor = canvas.tokens?.controlled?.[0]?.actor;
        if (actor) item = actor.items.find(i => i.type === "container" && i.name === itemOrName);
      } else {
        item = this._findOpenContainer();
        if (!item) {
          const actor = canvas.tokens?.controlled?.[0]?.actor;
          if (actor) item = actor.items.find(i => i.type === "container");
        }
      }

      if (!item) {
        console.warn("No container found. Select a token or open a container sheet.");
        console.warn("Open apps:", this._findOpenApps().map(a => ({
          class: a?.constructor?.name,
          doc: (a?.document ?? a?.object)?.name,
          type: (a?.document ?? a?.object)?.type
        })));
        return;
      }

      const sys = item.system;
      console.group(`%cContainer: ${item.name} (${item.id})`, "color: #4CAF50; font-weight: bold");
      console.log("Reduction:", getReductionPct(item) + "%");
      console.log("system.capacity:", foundry.utils.deepClone(sys.capacity));
      console.log("system.weight:", foundry.utils.deepClone(sys.weight));

      // Test computed getters
      try { console.log("contentsWeight (getter):", sys.contentsWeight); } catch (e) { console.log("contentsWeight error:", e); }
      try { console.log("totalWeight (getter):", sys.totalWeight); } catch (e) { console.log("totalWeight error:", e); }
      try { console.log("contentsCount (getter):", sys.contentsCount); } catch (e) { console.log("contentsCount error:", e); }
      try { console.log("currencyWeight (getter):", sys.currencyWeight); } catch (e) { console.log("currencyWeight error:", e); }

      if (item.parent) {
        const { load, trace } = computeAdjustedLoad(item.parent, item.id);
        console.log("WC adjusted load (lbs):", load);
        console.log("WC adjusted load (display):", lbsToDisplay(load));
        console.log("Capacity (lbs):", getCapacityLbs(item));
        console.log("Trace:", trace);
      }

      console.log("CONFIG.Item.dataModels.container:", CONFIG.Item.dataModels?.container);
      console.groupEnd();
      return sys;
    },

    dumpActor(actor) {
      if (!actor) actor = canvas.tokens?.controlled?.[0]?.actor;
      if (!actor) { console.warn("No actor — select a token"); return; }
      const idx = buildContainerIndex(actor);
      const result = {};
      for (const item of actor.items) {
        if (!isContainer(item)) continue;
        const cap = getCapacityLbs(item);
        const { load, trace } = computeAdjustedLoad(actor, item.id, idx);
        result[item.name] = {
          id: item.id,
          capacityLbs: cap,
          loadLbs: load,
          loadDisplay: Number(lbsToDisplay(load).toFixed(2)),
          reductionPct: getReductionPct(item),
          contentsWeight: item.system.contentsWeight,
          totalWeight: item.system.totalWeight,
          trace
        };
      }
      console.table(result);
      return result;
    }
  };
});
