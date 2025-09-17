// weighty-containers — v0.2.9
// Author: TacticalOtaku
// Patched to correctly override actor encumbrance
// Added socketlib support for multiplayer synchronization
// Updated to use libWrapper for compatibility with midi-qol
// Adjusted for dnd5e 5.1.8 compatibility (removed _computeContentsWeight patch)
// Fixed null parent error in openReductionDialog

import { SocketlibSocket } from "./socketlib-socket.js";

const MODULE_ID = "weighty-containers";

/* ============== Logging ============== */
const LOG_LEVELS = ["off", "error", "warn", "info", "debug", "trace"];
class WCLogger {
  constructor() {
    this.level = "trace";
    this.keepBuffer = true;
    this.bufferLimit = 500;
    this.withStacks = true;
    this.buffer = [];
  }
  setLevel(l) { if (LOG_LEVELS.includes(l)) this.level = l; }
  should(l) {
    const w = LOG_LEVELS.indexOf(this.level);
    const h = LOG_LEVELS.indexOf(l);
    return h >= 0 && h <= w && this.level !== "off";
  }
  push(l, m, d) {
    const e = {
      ts: new Date().toISOString(),
      level: l,
      msg: m,
      data: d ?? null,
      stack: this.withStacks ? new Error().stack : null
    };
    if (this.keepBuffer) {
      this.buffer.push(e);
      if (this.buffer.length > this.bufferLimit) this.buffer.shift();
    }
    if (this.should(l)) {
      const label = `${MODULE_ID} | ${e.ts} | ${l.toUpperCase()} | ${m}`;
      try {
        if (l === "trace" || l === "debug") {
          console.groupCollapsed(label);
          if (d !== undefined) console.log("data:", d);
          if (e.stack) console.log("stack:", e.stack);
          console.groupEnd();
        } else {
          (console[l] ?? console.log)(label, d ?? "");
        }
      } catch {
        console.log(label, d ?? "");
      }
    }
  }
  error(m, d) { this.push("error", m, d); }
  warn(m, d) { this.push("warn", m, d); }
  info(m, d) { this.push("info", m, d); }
  debug(m, d) { this.push("debug", m, d); }
  trace(m, d) { this.push("trace", m, d); }
}
const LOG = new WCLogger();

/* ============== Small utils ============== */
const jq = (el) => (el instanceof jQuery ? el : $(el ?? [])); // wrap safe

/* ============== Settings ============== */
Hooks.once("init", () => {
  // WORLD (GM)
  game.settings.register(MODULE_ID, "enforceMode", {
    name: game.i18n.localize("weighty-containers.enforceMode.name") || "Behavior on exceed",
    hint: game.i18n.localize("weighty-containers.enforceMode.hint") || "Block (cancel) or only warn when a container would exceed capacity.",
    scope: "world",
    config: true,
    restricted: true,
    type: String,
    choices: {
      block: game.i18n.localize("weighty-containers.enforceMode.block") || "Block",
      warn: game.i18n.localize("weighty-containers.enforceMode.warn") || "Warn only"
    },
    default: "block"
  });
  game.settings.register(MODULE_ID, "includeNested", {
    name: game.i18n.localize("weighty-containers.includeNested.name") || "Include nested containers",
    hint: game.i18n.localize("weighty-containers.includeNested.hint") || "Include nested containers' weights in parent load.",
    scope: "world",
    config: true,
    restricted: true,
    type: Boolean,
    default: true
  });

  // Diagnostics (UI only for GMs)
  game.settings.register(MODULE_ID, "logLevel", {
    name: game.i18n.localize("weighty-containers.logLevel.name") || "Log level",
    hint: game.i18n.localize("weighty-containers.logLevel.hint") || "Set the logging level for diagnostics.",
    scope: "client",
    config: true,
    restricted: true,
    type: String,
    choices: {
      off: game.i18n.localize("weighty-containers.logLevel.off") || "Off",
      error: game.i18n.localize("weighty-containers.logLevel.error") || "Error",
      warn: game.i18n.localize("weighty-containers.logLevel.warn") || "Warn",
      info: game.i18n.localize("weighty-containers.logLevel.info") || "Info",
      debug: game.i18n.localize("weighty-containers.logLevel.debug") || "Debug",
      trace: game.i18n.localize("weighty-containers.logLevel.trace") || "Trace"
    },
    default: "trace",
    onChange: v => LOG.setLevel(v)
  });
  game.settings.register(MODULE_ID, "logStacks", {
    name: game.i18n.localize("weighty-containers.logStacks.name") || "Include stack traces",
    hint: game.i18n.localize("weighty-containers.logStacks.hint") || "Include stack traces in logs.",
    scope: "client",
    config: true,
    restricted: true,
    type: Boolean,
    default: true,
    onChange: v => LOG.withStacks = v
  });
  game.settings.register(MODULE_ID, "logBufferLimit", {
    name: game.i18n.localize("weighty-containers.logBufferLimit.name") || "Log buffer size",
    hint: game.i18n.localize("weighty-containers.logBufferLimit.hint") || "Maximum number of log entries to keep in buffer.",
    scope: "client",
    config: true,
    restricted: true,
    type: Number,
    default: 500,
    onChange: v => LOG.bufferLimit = Number(v) || 500
  });

  // CLIENT (per-user)
  game.settings.register(MODULE_ID, "exceedMessageText", {
    name: game.i18n.localize("weighty-containers.exceedMessageText.name") || "Exceed notification text (per-user)",
    hint: game.i18n.localize("weighty-containers.exceedMessageText.hint") || "Exact text to show when capacity would be exceeded. Leave empty for default detailed message.",
    scope: "client",
    config: true,
    restricted: false,
    type: String,
    default: ""
  });

  // Tiny CSS for inline gear
  const id = `${MODULE_ID}-css`;
  if (!document.getElementById(id)) {
    const s = document.createElement("style");
    s.id = id;
    s.textContent = `
      .wc-inline-gear { display:inline-flex; align-items:center; justify-content:center; width:22px; height:22px; border-radius:4px; border:1px solid rgba(0,0,0,.15); background:rgba(0,0,0,.06); cursor:pointer; margin-left:.25rem; }
      .wc-inline-gear:hover { background:rgba(0,0,0,.12); }
    `;
    document.head.appendChild(s);
  }

  LOG.setLevel(game.settings.get(MODULE_ID, "logLevel"));
  LOG.withStacks = game.settings.get(MODULE_ID, "logStacks");
  LOG.bufferLimit = game.settings.get(MODULE_ID, "logBufferLimit");
  LOG.info("init done", { level: LOG.level, withStacks: LOG.withStacks, bufferLimit: LOG.bufferLimit });
});

Hooks.once("ready", () => {
  // Initialize socketlib
  const socket = SocketlibSocket.registerModule(MODULE_ID);
  window.wcSocket = socket;

  // Register remote functions
  socket.register("updateReductionPct", updateReductionPct);
  socket.register("notifyExceedRemote", notifyExceedRemote);

  registerEnforcementHooks();

  // Use libWrapper to patch Actor's prepareDerivedData
  try {
    libWrapper.register(MODULE_ID, "CONFIG.Actor.documentClass.prototype.prepareDerivedData", function (wrapped, ...args) {
      // Run the original system method first
      wrapped(...args);
      try {
        // Check if this actor has an encumbrance attribute
        if (!this.system?.attributes?.encumbrance) return;

        // Use the module's function to calculate the adjusted weight
        const adjustedWeight = computeActorAdjustedCarried(this);
        const enc = this.system.attributes.encumbrance;

        // Overwrite the system's value with our calculated value
        enc.value = adjustedWeight;

        // Also recalculate the percentage for the encumbrance bar
        enc.pct = enc.max > 0 ? Math.round((adjustedWeight / enc.max) * 100) : 0;
      } catch (e) {
        LOG.error("Failed to patch actor encumbrance", { actor: this.name, e });
      }
    }, "WRAPPER");
    LOG.info("libWrapper registered for prepareDerivedData");
  } catch (e) {
    LOG.error("Failed to register libWrapper for prepareDerivedData", { e });
  }

  // Header buttons (if V2 emits them)
  Hooks.on("getApplicationHeaderButtons", (app, buttons) => {
    try {
      const doc = app?.document ?? app?.item ?? app?.object;
      if (!(doc instanceof Item)) return;
      if (doc.type !== "container") return;
      if (!game.user.isGM) return;
      if (buttons.some(b => b?.class === "wc-reduction-btn")) return;
      buttons.unshift({
        label: game.i18n.localize("weighty-containers.reductionBtn.label") || "Reduction",
        class: "wc-reduction-btn",
        icon: "fas fa-cog",
        onclick: () => openReductionDialog(doc)
      });
      LOG.debug("header button via getApplicationHeaderButtons", { appId: app?.appId ?? app?.id, item: doc.name });
    } catch (e) {
      LOG.error("getApplicationHeaderButtons failed", { e });
    }
  });

  // Render hooks: repaint bars + inline gear fallback
  const injectAll = (app, htmlEl) => {
    try { ensureInlineReductionControl(app, htmlEl); } catch (e) { LOG.error("inline gear inject failed", { e }); }
    try { repaintContainerBars(app, htmlEl); } catch (e) { LOG.error("repaintContainerBars failed", { e }); }
  };
  Hooks.on("renderItemSheet", injectAll);
  Hooks.on("renderContainerSheet", injectAll);

  // Re-render relevant sheets after updates to ensure UI sync
  Hooks.on("updateItem", (item) => {
    if (!isContainer(item)) return;
    const actor = item.parent;
    if (!actor) return;
    // Re-render actor sheet if open
    const actorSheet = actor.sheet;
    if (actorSheet?.rendered) actorSheet.render();
    // Re-render item sheet if open
    const itemSheet = item.sheet;
    if (itemSheet?.rendered) itemSheet.render();
  });

  LOG.info("ready", { system: game.system?.id, version: game.system?.version });
});

/* ============== Socket Remote Functions ============== */
async function updateReductionPct(containerId, pct) {
  if (!game.user.isGM) return;
  const [actorId, itemId] = containerId.split('.');
  const actor = game.actors.get(actorId);
  if (!actor) {
    LOG.warn("Actor not found for socket update", { actorId });
    return;
  }
  const container = getItem(actor, itemId);
  if (!container) {
    LOG.warn("Container not found for socket update", { itemId });
    return;
  }
  await container.update({ [`flags.${MODULE_ID}.reductionPct`]: pct });
  LOG.info("Reduction updated via socket", { container: container.name, pct });
}

async function notifyExceedRemote(data) {
  ui.notifications?.warn(data.msg);
  LOG.info("Exceed notification via socket", data);
}

/* ============== Generic utils ============== */
function num(v, d = 0) { const n = Number(v); return Number.isFinite(n) ? n : d; }
function qty(doc) { return num(doc?.system?.quantity, 1); }
function unitW(doc) { const w = (doc?.system?.weight?.value ?? doc?.system?.weight); return num(w, 0); }
function ownWeight(doc) { return unitW(doc) * qty(doc); }
function getItem(actor, id) { return actor?.items?.get?.(id) ?? null; }
function isContainer(i) { return i?.type === "container"; }

function indexByContainer(actor) {
  const map = new Map();
  for (const it of actor?.items ?? []) {
    const cid = it?.system?.container ?? null;
    if (!cid) continue;
    if (!map.has(cid)) map.set(cid, []);
    map.get(cid).push(it);
  }
  return map;
}

function getReductionPct(containerItem) {
  const v = Number(containerItem?.flags?.[MODULE_ID]?.reductionPct ?? 0);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}

function getCapacity(containerItem) {
  const cap = containerItem?.system?.capacity;
  if (cap == null) {
    LOG.warn("capacity missing", { item: containerItem?.name, id: containerItem?.id });
    return null;
  }
  const toLb = (v, u) => {
    const units = String(u ?? "lb").toLowerCase();
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    switch (units) {
      case "lb":
      case "lbs":
        return n;
      case "kg":
      case "kgs":
      case "kilogram":
      case "kilograms":
        return n * 2.20462262;
      case "oz":
      case "ounce":
      case "ounces":
        return n / 16;
      default:
        return n;
    }
  };
  if (typeof cap === "number") return cap > 0 ? cap : null;
  if (Number.isFinite(Number(cap.value))) {
    const val = toLb(cap.value, cap.units);
    if (val != null && val > 0) return val;
  }
  if (cap?.weight && Number.isFinite(Number(cap.weight.value))) {
    const val = toLb(cap.weight.value, cap.weight.units);
    if (val != null && val > 0) return val;
  }
  const flagged = Number(containerItem?.flags?.dnd5e?.capacity);
  if (Number.isFinite(flagged) && flagged > 0) return flagged;
  LOG.warn("capacity not found or non-positive", { item: containerItem?.name, id: containerItem?.id, capShape: cap });
  return null;
}

/* ============== Loads math ============== */
function computeAdjustedLoadWithTrace(actor, containerId) {
  const includeNested = game.settings.get(MODULE_ID, "includeNested");
  const trace = [];
  if (!actor || !containerId) return { load: 0, trace };
  const by = indexByContainer(actor);
  const parent = getItem(actor, containerId);
  const parentRed = getReductionPct(parent) / 100;
  let load = 0;
  const children = by.get(containerId) ?? [];
  for (const ch of children) {
    const w = ownWeight(ch);
    if (isContainer(ch)) {
      const addItem = w * (1 - parentRed);
      load += addItem;
      trace.push({ child: ch.name, id: ch.id, type: "container(item)", wOwn: w, reducedBy: parentRed, added: addItem });
      if (includeNested) {
        const sub = computeAdjustedLoadWithTrace(actor, ch.id);
        load += sub.load;
        trace.push({ child: ch.name, id: ch.id, type: "container(contents)", nestedAdded: sub.load });
      }
    } else {
      const add = w * (1 - parentRed);
      load += add;
      trace.push({ child: ch.name, id: ch.id, type: "item", wOwn: w, reducedBy: parentRed, added: add });
    }
  }
  return { load: Math.max(0, +load.toFixed(3)), trace };
}
function computeAdjustedLoad(actor, cid) { return computeAdjustedLoadWithTrace(actor, cid).load; }

function computeActorAdjustedCarried(actor) {
  if (!actor) return 0;
  let total = 0;
  for (const it of actor.items ?? []) {
    if (it?.system?.container) continue; // top-level only
    if (isContainer(it)) {
      total += ownWeight(it);
      total += computeAdjustedLoad(actor, it.id);
    } else {
      total += ownWeight(it);
    }
  }
  return Math.max(0, +total.toFixed(3));
}

/* ============== Messaging (non-critical) ============== */
const fmt2 = n => Number(n).toFixed(2);
function makeMessage({ actorName, containerName, capacity, before, delta }) {
  const custom = (game.settings.get(MODULE_ID, "exceedMessageText") ?? "").toString().trim();
  if (custom) return custom;
  return game.i18n.format("weighty-containers.exceedMessage.default", {
    containerName: containerName ?? "Container",
    before: fmt2(before),
    delta: fmt2(delta),
    capacity: fmt2(capacity)
  }) || `[${containerName ?? "Container"}] Capacity exceeded: ${fmt2(before)} + ${fmt2(delta)} > ${fmt2(capacity)} lb`;
}
function notifyExceed({ actorName, containerName, capacity, before, delta, extra }) {
  const msg = makeMessage({ actorName, containerName, capacity, before, delta });
  // Use socket to notify all clients if available
  if (window.wcSocket) {
    window.wcSocket.executeForEveryone("notifyExceedRemote", { msg, actorName, containerName, capacity, before, delta, ...extra });
  } else {
    ui.notifications?.warn(msg);
  }
  LOG.info("exceed", { actorName, containerName, capacity, before, delta, after: before + delta, ...extra });
  return msg;
}

/* ============== Enforcement ============== */
function enforceCapacityOnCreate(item, data) {
  const actor = item?.parent;
  const containerId = data?.system?.container ?? null;
  if (!actor || !containerId) return;
  const container = getItem(actor, containerId);
  if (!container) return;
  const capacity = getCapacity(container);
  if (!capacity) return;

  const { load: current, trace } = computeAdjustedLoadWithTrace(actor, containerId);
  const parentRed = getReductionPct(container) / 100;
  const unit = num(data?.system?.weight?.value ?? data?.system?.weight, 0);
  const q = num(data?.system?.quantity, 1);
  const delta = unit * q * (1 - parentRed);

  LOG.debug("preCreate check (adjusted)", { actor: actor?.name, container: container?.name, capacity, current, unit, qty: q, parentRed, delta, trace });
  if (current + delta > capacity) {
    notifyExceed({ actorName: actor?.name, containerName: container?.name, capacity, before: current, delta, extra: { trace } });
    if (game.settings.get(MODULE_ID, "enforceMode") === "block") return false;
  }
}
function enforceCapacityOnUpdate(item, changes) {
  const actor = item?.parent;
  if (!actor) return;
  const was = item?.system?.container ?? null;
  const will = (changes?.system?.container ?? was);

  // qty++
  if (changes?.system?.quantity != null && will && will === was) {
    const newQty = num(changes.system.quantity, qty(item)), oldQty = qty(item);
    if (newQty > oldQty) {
      const container = getItem(actor, will);
      const capacity = getCapacity(container);
      if (capacity) {
        const { load: current, trace } = computeAdjustedLoadWithTrace(actor, will);
        const parentRed = getReductionPct(container) / 100;
        const delta = (newQty - oldQty) * unitW(item) * (1 - parentRed);
        LOG.debug("preUpdate qty++ check (adjusted)", { container: container?.name, capacity, current, parentRed, delta, trace });
        if (current + delta > capacity) {
          notifyExceed({ actorName: actor?.name, containerName: container?.name, capacity, before: current, delta, extra: { trace } });
          if (game.settings.get(MODULE_ID, "enforceMode") === "block") return false;
        }
      }
    }
  }

  // move
  if (will && will !== was) {
    const dest = getItem(actor, will);
    if (dest) {
      const capacity = getCapacity(dest);
      if (capacity) {
        const { load: current, trace } = computeAdjustedLoadWithTrace(actor, will);
        const destRed = getReductionPct(dest) / 100;
        let delta = ownWeight(item) * (1 - destRed);
        if (game.settings.get(MODULE_ID, "includeNested")) {
          const sub = computeAdjustedLoadWithTrace(actor, item.id);
          delta += sub.load;
          trace.push({ movingContainerContents: item.name, id: item.id, added: sub.load });
        }
        LOG.debug("preUpdate move check (adjusted)", { dest: dest?.name, capacity, current, delta, destRed, trace });
        if (current + delta > capacity) {
          notifyExceed({ actorName: actor?.name, containerName: dest?.name, capacity, before: current, delta, extra: { trace } });
          if (game.settings.get(MODULE_ID, "enforceMode") === "block") return false;
        }
      }
    } else {
      LOG.warn("preUpdate: dest container not found on actor", { willContainerId: will });
    }
  }

  // weight++
  const wChange = (changes?.system?.weight?.value ?? changes?.system?.weight);
  if (wChange != null && was) {
    const container = getItem(actor, was);
    const capacity = getCapacity(container);
    if (capacity) {
      const { load: current, trace } = computeAdjustedLoadWithTrace(actor, was);
      const parentRed = getReductionPct(container) / 100;
      const oldTotal = ownWeight(item) * (1 - parentRed);
      const newTotal = num(wChange, unitW(item)) * qty(item) * (1 - parentRed);
      const delta = Math.max(0, newTotal - oldTotal);
      LOG.debug("preUpdate weight++ check (adjusted)", { container: container?.name, capacity, current, oldTotal, newTotal, delta, parentRed, trace });
      if (delta > 0 && current + delta > capacity) {
        notifyExceed({ actorName: actor?.name, containerName: container?.name, capacity, before: current, delta, extra: { trace } });
        if (game.settings.get(MODULE_ID, "enforceMode") === "block") return false;
      }
    }
  }
}

function registerEnforcementHooks() {
  Hooks.on("preCreateItem", (item, data) => {
    const r = enforceCapacityOnCreate(item, data);
    if (r === false) return false;
  });
  Hooks.on("preUpdateItem", (item, changes) => {
    const r = enforceCapacityOnUpdate(item, changes);
    if (r === false) return false;
  });
}

/* ============== UI: repaint native bars ============== */
function repaintContainerBars(app, htmlEl) {
  const item = app?.document ?? app?.item ?? app?.object;
  if (!(item instanceof Item) || item.type !== "container") return;

  const capacity = getCapacity(item);
  if (!capacity) {
    LOG.debug("container has no capacity UI to repaint");
    return;
  }
  const { load } = computeAdjustedLoadWithTrace(item.parent, item.id);
  const pct = Math.max(0, Math.min(100, Math.round((load / capacity) * 100)));

  const $html = jq(htmlEl);

  // 1) obvious capacity blocks with bars
  const blocks = $html.find(`
    .capacity, .item-capacity, .resource.capacity, .dnd5e-capacity,
    [data-resource="capacity"], [data-section*="capacity"], section.capacity,
    .progress, .meter
  `);

  let host = null, bar = null, label = null;
  blocks.each((i, el) => {
    if (host) return;
    const $el = jq(el);
    const text = ($el.text() || "").toLowerCase();
    const looks = /capacity|вместим|ёмк|weight|вес|lb|lbs|kg/.test(text);
    const b = $el.find('.bar, .progress-bar, .meter-bar, .fill, .value, .pct, [role="progressbar"]').first();
    if (looks && b.length) {
      host = $el;
      bar = b;
      label = $el.find('.label, .progress-label, .meter-label, .value, .capacity-value, .caption').first();
    }
  });

  // 2) fallback — search any element whose TEXT contains "X / Y" with Y≈capacity (closest/shortest)
  if (!host) {
    const rx = /([0-9]+(?:[.,][0-9]+)?)\s*\/\s*([0-9]+(?:[.,][0-9]+)?)/;
    let bestEl = null, bestLen = 1e9, bestMatch = null;

    $html.find("*").each((i, el) => {
      const $el = jq(el);
      if (!$el.is(":visible")) return;
      const txtRaw = ($el.text() || "");
      const m = txtRaw.match(rx);
      if (!m) return;
      const max = Number(m[2].replace(',', '.'));
      if (!Number.isFinite(max)) return;
      if (Math.abs(max - capacity) < 0.01) {
        const len = txtRaw.length;
        if (len < bestLen) {
          bestLen = len;
          bestEl = $el;
          bestMatch = m;
        }
      }
    });

    if (bestEl) {
      host = bestEl;
      const maybeBar = host.closest(":scope").find('.bar, .progress-bar, .meter-bar, .fill, [role="progressbar"]').first();
      if (maybeBar.length) bar = maybeBar;
      label = host;
    }
  }

  if (!host) {
    LOG.debug("container repaint: native bar not found; skip", { item: item.name, pct, load, capacity });
    return;
  }

  // Update bar width if we found one
  if (bar?.length) {
    if (bar.is('[role="progressbar"]')) bar.attr('aria-valuenow', String(pct)).css('width', `${pct}%`);
    else bar.css('width', `${pct}%`);
  }

  // Update visible "X / Y" text inside label/host (non-destructively)
  const newText = `${fmt2(load)} / ${fmt2(capacity)} lb`;
  const updateTextInEl = ($el) => {
    const html = $el.html();
    const rx = /([0-9]+(?:[.,][0-9]+)?)\s*\/\s*([0-9]+(?:[.,][0-9]+)?)/;
    if (html && rx.test(html)) {
      $el.html(html.replace(rx, `${fmt2(load)} / ${fmt2(capacity)}`));
    } else {
      $el.text(newText);
    }
  };

  if (label?.length) updateTextInEl(label);
  else updateTextInEl(host);

  LOG.debug("container repaint done", { item: item.name, pct, load, capacity });
}

/* ============== UI: inline gear in .sheet-header ============== */
function ensureInlineReductionControl(app, htmlEl) {
  const doc = app?.document ?? app?.item ?? app?.object;
  if (!(doc instanceof Item)) return;
  if (doc.type !== "container") return;
  if (!game.user.isGM) return;

  const $html = jq(htmlEl);
  const header = $html.find(".sheet-header, header.sheet-header, .item-header").first();
  if (!header.length) {
    LOG.trace("no .sheet-header in html; skip inline gear");
    return;
  }

  if (header.find(".wc-inline-gear").length) return; // already inserted

  const btn = $(`<span class="wc-inline-gear" title="${game.i18n.localize("weighty-containers.inlineGear.title") || "Container Weight Reduction"}"><i class="fas fa-cog"></i></span>`);
  btn.on("click", () => openReductionDialog(doc));

  const right = header.find(".header-controls, .controls, .toggles, .item-controls").first();
  if (right.length) right.append(btn);
  else header.append(btn);

  LOG.debug("inline gear inserted into sheet header", { appId: app?.appId ?? app?.id, item: doc.name });
}

/* ============== GM dialog ============== */
async function openReductionDialog(containerItem) {
  if (!containerItem) {
    LOG.error("No container item provided to reduction dialog");
    ui.notifications?.error(game.i18n.localize("weighty-containers.reductionDialog.errorNoItem") || "No container item found for reduction dialog");
    return;
  }
  const cur = getReductionPct(containerItem);
  const dlg = new Dialog({
    title: game.i18n.localize("weighty-containers.reductionDialog.title") || "Container Weight Reduction",
    content: `
      <form>
        <div class="form-group">
          <label>${game.i18n.localize("weighty-containers.reductionDialog.label") || "Reduction (%)"}</label>
          <input type="number" name="pct" value="${cur}" min="0" max="100" step="1"/>
          <p class="notes">${game.i18n.localize("weighty-containers.reductionDialog.notes") || "Applies to items directly inside this container. Nested containers apply their own reduction."}</p>
        </div>
      </form>`,
    buttons: {
      ok: {
        label: game.i18n.localize("weighty-containers.reductionDialog.save") || "Save",
        callback: async html => {
          const val = Number(jq(html).find('input[name="pct"]').val());
          const pct = Math.max(0, Math.min(100, Math.round(Number.isFinite(val) ? val : 0)));
          if (!containerItem.parent) {
            LOG.warn("Container item has no parent actor; falling back to direct update", { itemId: containerItem.id, itemName: containerItem.name });
            await containerItem.update({ [`flags.${MODULE_ID}.reductionPct`]: pct });
          } else if (window.wcSocket) {
            await window.wcSocket.executeAsGM("updateReductionPct", `${containerItem.parent.id}.${containerItem.id}`, pct);
          } else {
            await containerItem.update({ [`flags.${MODULE_ID}.reductionPct`]: pct });
          }
          ui.notifications?.info(
            game.i18n.format("weighty-containers.reductionSet.notification", { pct, containerName: containerItem.name }) ||
            `${MODULE_ID}: reduction set to ${pct}% for "${containerItem.name}"`
          );
        }
      },
      cancel: {
        label: game.i18n.localize("weighty-containers.reductionDialog.cancel") || "Cancel"
      }
    },
    default: "ok"
  });
  dlg.render(true);
}