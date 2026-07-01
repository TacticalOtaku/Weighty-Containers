// ─────────────────────────────────────────────────────────
// Weighty Containers - Foundry VTT v14.363 / dnd5e 5.3.3
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

function _escapeHtml(value) {
  const text = String(value ?? "");
  if (foundry.utils.escapeHTML) return foundry.utils.escapeHTML(text);
  return text.replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  }[c]));
}

// ══════════════════════ Item Helpers (dnd5e 5.3.x) ══════════════════════

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

function renderApplication(app, force = false) {
  if (!app?.rendered || typeof app.render !== "function") return;
  const ApplicationV2 = foundry.applications?.api?.ApplicationV2;
  if (ApplicationV2 && app instanceof ApplicationV2) return app.render({ force });
  return app.render(force);
}

// ══════════════════════ Container-specific Helpers ══════════════════════

function getReductionPct(containerItem) {
  const v = Number(containerItem?.flags?.[MODULE_ID]?.reductionPct ?? 0);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}

function normalizeToken(value) {
  return String(value ?? "").trim().toLowerCase();
}

function parseTokenList(value) {
  if (Array.isArray(value)) return value.map(normalizeToken).filter(Boolean);
  return String(value ?? "")
    .split(/[,\n;]/)
    .map(normalizeToken)
    .filter(Boolean);
}

function formatTokenList(values) {
  return Array.isArray(values) ? values.join(", ") : "";
}

function localizeConfigLabel(label, fallback = null) {
  if (!label) return fallback ?? "";
  return game.i18n.localize(String(label));
}

function addOption(map, value, label = null) {
  const key = normalizeToken(value);
  if (!key || map.has(key)) return;
  map.set(key, localizeConfigLabel(label, String(value)));
}

function optionsFromConfig(config) {
  const options = new Map();
  if (!config) return [];

  if (config instanceof Map) {
    for (const [value, label] of config.entries()) addOption(options, value, label);
  } else if (Array.isArray(config) || config instanceof Set) {
    for (const value of config) addOption(options, value);
  } else if (typeof config === "object") {
    for (const [value, label] of Object.entries(config)) {
      if (label && typeof label === "object" && !Array.isArray(label)) {
        addOption(options, value, label.label ?? label.name ?? value);
      } else {
        addOption(options, value, label);
      }
    }
  }

  return Array.from(options, ([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label, game.i18n.lang));
}

function valuesFromConfig(config) {
  if (!config) return [];
  if (config instanceof Map) return Array.from(config.keys());
  if (Array.isArray(config) || config instanceof Set) return Array.from(config);
  if (typeof config !== "object") return [config];

  const values = [];
  for (const [key, value] of Object.entries(config)) {
    if (value === false || value == null) continue;
    if (value === true || typeof value !== "object") {
      values.push(key);
      continue;
    }

    const nested = valuesFromConfig(value);
    if (nested.length) values.push(...nested);
    else values.push(key);
  }
  return values;
}

function getRuleItemTypeGroups() {
  const itemTypes = new Map();

  for (const type of valuesFromConfig(game.system?.documentTypes?.Item)) addOption(itemTypes, type, `TYPES.Item.${type}`);
  for (const [type, label] of Object.entries(CONFIG.Item?.typeLabels ?? {})) addOption(itemTypes, type, label);

  for (const type of ["weapon", "consumable", "equipment", "tool", "loot", "container", "backpack", "spell", "feat"]) {
    addOption(itemTypes, type, `TYPES.Item.${type}`);
  }

  const options = Array.from(itemTypes, ([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label, game.i18n.lang));

  return [{ label: game.i18n.localize(`${MODULE_ID}.configDialog.groups.itemTypes`), options }];
}

function getRuleSubtypeGroups() {
  const dnd5e = CONFIG.DND5E ?? {};
  const groups = [];
  const addGroup = (key, labelKey) => {
    const options = optionsFromConfig(dnd5e[key]);
    if (options.length) groups.push({ label: game.i18n.localize(`${MODULE_ID}.configDialog.groups.${labelKey}`), options });
  };

  groups.push({
    label: game.i18n.localize(`${MODULE_ID}.configDialog.groups.weaponRange`),
    options: [
      { value: "melee", label: game.i18n.localize(`${MODULE_ID}.configDialog.option.melee`) },
      { value: "ranged", label: game.i18n.localize(`${MODULE_ID}.configDialog.option.ranged`) }
    ]
  });

  addGroup("weaponTypes", "weaponTypes");
  addGroup("consumableTypes", "consumableTypes");
  addGroup("equipmentTypes", "equipmentTypes");
  addGroup("armorTypes", "armorTypes");
  addGroup("toolTypes", "toolTypes");
  addGroup("lootTypes", "lootTypes");

  if (!groups.some(g => g.options.length)) {
    groups.push({
      label: game.i18n.localize(`${MODULE_ID}.configDialog.groups.commonSubtypes`),
      options: [
        { value: "melee", label: game.i18n.localize(`${MODULE_ID}.configDialog.option.melee`) },
        { value: "ranged", label: game.i18n.localize(`${MODULE_ID}.configDialog.option.ranged`) },
        { value: "ammo", label: "Ammo" },
        { value: "potion", label: "Potion" },
        { value: "scroll", label: "Scroll" },
        { value: "wand", label: "Wand" },
        { value: "grenade", label: "Grenade" }
      ]
    });
  }

  return groups;
}

function getRulePropertyGroups() {
  const dnd5e = CONFIG.DND5E ?? {};
  const groups = [];
  const seen = new Set();
  const addGroup = (key, labelKey) => {
    const options = optionsFromConfig(dnd5e[key]).filter(option => {
      if (seen.has(option.value)) return false;
      seen.add(option.value);
      return true;
    });
    if (options.length) groups.push({ label: game.i18n.localize(`${MODULE_ID}.configDialog.groups.${labelKey}`), options });
  };

  addGroup("itemProperties", "itemProperties");
  addGroup("weaponProperties", "weaponProperties");
  addGroup("equipmentProperties", "equipmentProperties");
  addGroup("consumableProperties", "consumableProperties");

  const validProperties = dnd5e.validProperties;
  if (validProperties && typeof validProperties === "object") {
    for (const [itemType, properties] of Object.entries(validProperties)) {
      const options = optionsFromConfig(properties).filter(option => {
        if (seen.has(option.value)) return false;
        seen.add(option.value);
        return true;
      });
      if (options.length) groups.push({ label: localizeConfigLabel(`TYPES.Item.${itemType}`, itemType), options });
    }
  }

  if (!groups.length) {
    groups.push({
      label: game.i18n.localize(`${MODULE_ID}.configDialog.groups.itemProperties`),
      options: [
        { value: "amm", label: "Ammunition" },
        { value: "fin", label: "Finesse" },
        { value: "fir", label: "Firearm" },
        { value: "hvy", label: "Heavy" },
        { value: "lgt", label: "Light" },
        { value: "mgc", label: "Magical" },
        { value: "rch", label: "Reach" },
        { value: "rel", label: "Reload" },
        { value: "ret", label: "Returning" },
        { value: "thr", label: "Thrown" },
        { value: "two", label: "Two-Handed" },
        { value: "ver", label: "Versatile" }
      ]
    });
  }

  return groups;
}

function renderSelectOptions(groups, selectedValues) {
  const selected = new Set(parseTokenList(selectedValues));
  const selectedAttr = value => selected.has(normalizeToken(value)) ? " selected" : "";
  const option = ({ value, label }) => `<option value="${_escapeHtml(value)}"${selectedAttr(value)}>${_escapeHtml(label)}</option>`;
  return groups.map(group => {
    const options = group.options.map(option).join("");
    return `<optgroup label="${_escapeHtml(group.label)}">${options}</optgroup>`;
  }).join("");
}

function summarizeLabels(labels) {
  if (!labels.length) return game.i18n.localize(`${MODULE_ID}.configDialog.any`);
  if (labels.length <= 2) return labels.join(", ");
  return game.i18n.format(`${MODULE_ID}.configDialog.selectedSummary`, {
    first: labels.slice(0, 2).join(", "),
    count: labels.length - 2
  });
}

function selectedLabelsFromGroups(groups, selectedValues) {
  const selected = new Set(parseTokenList(selectedValues));
  const labels = [];
  for (const group of groups) {
    for (const option of group.options) {
      if (selected.has(normalizeToken(option.value))) labels.push(option.label);
    }
  }
  return labels;
}

function renderCheckboxDropdown(name, groups, selectedValues) {
  const selected = new Set(parseTokenList(selectedValues));
  const known = new Set(groups.flatMap(group => group.options.map(option => normalizeToken(option.value))));
  const unknownOptions = Array.from(selected)
    .filter(value => !known.has(value))
    .map(value => ({ value, label: value }));
  const allGroups = unknownOptions.length
    ? [...groups, { label: game.i18n.localize(`${MODULE_ID}.configDialog.groups.savedValues`), options: unknownOptions }]
    : groups;
  const checkedAttr = value => selected.has(normalizeToken(value)) ? " checked" : "";
  const summary = summarizeLabels(selectedLabelsFromGroups(allGroups, selectedValues));
  const groupMarkup = allGroups.map(group => {
    const options = group.options.map(option => `
      <label class="wc-check-row">
        <input type="checkbox" name="${_escapeHtml(name)}" value="${_escapeHtml(option.value)}"
               data-label="${_escapeHtml(option.label)}"${checkedAttr(option.value)}>
        <span>${_escapeHtml(option.label)}</span>
      </label>`).join("");
    return `
      <div class="wc-check-group">
        <div class="wc-check-group-title">${_escapeHtml(group.label)}</div>
        ${options}
      </div>`;
  }).join("");

  return `
    <details class="wc-check-dropdown" data-name="${_escapeHtml(name)}">
      <summary>
        <span class="wc-selection-text" data-placeholder="${_escapeHtml(game.i18n.localize(`${MODULE_ID}.configDialog.any`))}">
          ${_escapeHtml(summary)}
        </span>
      </summary>
      <div class="wc-check-panel">
        ${groupMarkup}
      </div>
    </details>`;
}

function getSelectedTokens(root, name) {
  const checkboxes = root?.querySelectorAll?.(`input[type="checkbox"][name="${name}"]:checked`) ?? [];
  if (checkboxes.length) {
    return Array.from(checkboxes)
      .map(input => normalizeToken(input.value))
      .filter(Boolean);
  }

  const select = root?.querySelector?.(`select[name="${name}"]`);
  if (!select) return [];
  return Array.from(select.selectedOptions ?? [])
    .map(option => normalizeToken(option.value))
    .filter(Boolean);
}

function updateCheckDropdownSummary(dropdown) {
  const text = dropdown?.querySelector?.(".wc-selection-text");
  if (!text) return;
  const labels = Array.from(dropdown.querySelectorAll('input[type="checkbox"]:checked'))
    .map(input => input.dataset.label || input.value)
    .filter(Boolean);
  const summary = summarizeLabels(labels);
  text.textContent = summary;
  text.title = labels.join(", ");
}

function registerCheckDropdownListeners() {
  if (registerCheckDropdownListeners.ready) return;
  registerCheckDropdownListeners.ready = true;
  document.addEventListener("change", (event) => {
    const checkbox = event.target?.closest?.('.wc-check-dropdown input[type="checkbox"]');
    if (!checkbox) return;
    updateCheckDropdownSummary(checkbox.closest(".wc-check-dropdown"));
  });
}

function getContainerRestrictions(containerItem) {
  const flags = containerItem?.flags?.[MODULE_ID] ?? {};
  return {
    allowedTypes: parseTokenList(flags.allowedTypes),
    allowedSubtypes: parseTokenList(flags.allowedSubtypes),
    requiredProperties: parseTokenList(flags.requiredProperties)
  };
}

function getChangeProperty(changes, path) {
  if (!changes) return undefined;
  if (Object.hasOwn(changes, path)) return changes[path];
  return foundry.utils.getProperty(changes, path);
}

function makeItemCandidate(item, changes = {}) {
  const source = item?.toObject?.() ?? {
    name: item?.name,
    type: item?.type,
    system: foundry.utils.deepClone(item?.system ?? {})
  };
  const expanded = foundry.utils.expandObject(changes ?? {});
  return foundry.utils.mergeObject(source, expanded, { inplace: false, applyOperators: true });
}

function getItemTypeData(itemData) {
  const typeData = itemData?.system?.type;
  return (typeData && typeof typeData === "object") ? typeData : {};
}

function getItemPropertyTokens(itemData) {
  const props = itemData?.system?.properties;
  const tokens = new Set();
  if (props instanceof Set) {
    for (const prop of props) tokens.add(normalizeToken(prop));
  } else if (Array.isArray(props)) {
    for (const prop of props) tokens.add(normalizeToken(prop));
  } else if (props && typeof props === "object") {
    for (const [key, value] of Object.entries(props)) {
      if (value) tokens.add(normalizeToken(key));
    }
  } else if (props) {
    tokens.add(normalizeToken(props));
  }
  tokens.delete("");
  return tokens;
}

function getItemMatchTokens(itemData) {
  const tokens = new Set();
  const add = value => {
    const token = normalizeToken(value);
    if (token) tokens.add(token);
  };

  add(itemData?.type);

  const typeData = getItemTypeData(itemData);
  add(typeData.value);
  add(typeData.subtype);
  add(typeData.baseItem);
  add(typeData.identifier);

  add(CONFIG.DND5E?.weaponTypeMap?.[typeData.value]);

  const systemAttackType = itemData?.system?.attackType;
  add(typeof systemAttackType === "function" ? null : systemAttackType);

  for (const prop of getItemPropertyTokens(itemData)) tokens.add(prop);

  return tokens;
}

function validateContainerRestrictions(containerItem, itemData) {
  const restrictions = getContainerRestrictions(containerItem);
  if (!restrictions.allowedTypes.length && !restrictions.allowedSubtypes.length && !restrictions.requiredProperties.length) {
    return { ok: true, restrictions };
  }

  const itemType = normalizeToken(itemData?.type);
  if (restrictions.allowedTypes.length && !restrictions.allowedTypes.includes(itemType)) {
    return { ok: false, reason: "type", restrictions };
  }

  const matchTokens = getItemMatchTokens(itemData);
  if (restrictions.allowedSubtypes.length && !restrictions.allowedSubtypes.some(token => matchTokens.has(token))) {
    return { ok: false, reason: "subtype", restrictions };
  }

  if (restrictions.requiredProperties.length && !restrictions.requiredProperties.every(token => matchTokens.has(token))) {
    return { ok: false, reason: "property", restrictions };
  }

  return { ok: true, restrictions };
}

function _makeRestrictionMessage({ containerName, itemName, restrictions }) {
  const details = [];
  if (restrictions.allowedTypes.length) details.push(game.i18n.format(`${MODULE_ID}.restrictionMessage.types`, {
    types: restrictions.allowedTypes.join(", ")
  }));
  if (restrictions.allowedSubtypes.length) details.push(game.i18n.format(`${MODULE_ID}.restrictionMessage.subtypes`, {
    subtypes: restrictions.allowedSubtypes.join(", ")
  }));
  if (restrictions.requiredProperties.length) details.push(game.i18n.format(`${MODULE_ID}.restrictionMessage.properties`, {
    properties: restrictions.requiredProperties.join(", ")
  }));

  return game.i18n.format(`${MODULE_ID}.restrictionMessage.default`, {
    containerName: containerName ?? "Container",
    itemName: itemName ?? "Item",
    rules: details.join("; ")
  });
}

function _notifyRestriction({ actorName, containerName, itemName, restrictions }) {
  const msg = _makeRestrictionMessage({ containerName, itemName, restrictions });
  wcSocket.executeForEveryone("notifyExceedRemote", { msg, actorName, containerName, itemName, restrictions });
  LOG.info("container restriction failed", { actorName, containerName, itemName, restrictions });
}

function _enforceContainerRestrictions(actor, container, itemData) {
  const result = validateContainerRestrictions(container, itemData);
  if (result.ok) return true;
  _notifyRestriction({
    actorName: actor?.name,
    containerName: container?.name,
    itemName: itemData?.name,
    restrictions: result.restrictions
  });
  if (game.settings.get(MODULE_ID, "enforceMode") === "block") return false;
  return true;
}

/**
 * dnd5e 5.3.x: system.capacity = { count, volume: {...}, weight: { value, units } }
 */
function getCapacityLbs(containerItem) {
  const cap = containerItem?.system?.capacity;
  if (!cap) return null;

  // dnd5e 5.3.x: capacity.weight.value + capacity.weight.units
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
      .wc-config-dialog {
        display: grid; gap: 12px; min-width: 360px;
      }
      .wc-config-field {
        display: grid; gap: 4px; font-weight: 600;
      }
      .wc-config-dialog input {
        width: 100%;
      }
      .wc-check-dropdown {
        position: relative;
        width: 100%;
        font-weight: 400;
      }
      .wc-check-dropdown summary {
        align-items: center;
        background: var(--color-bg-option, rgba(255,255,255,.08));
        border: 1px solid var(--color-border-light-tertiary, rgba(255,255,255,.22));
        border-radius: 4px;
        cursor: pointer;
        display: flex;
        gap: 0.5rem;
        min-height: 2rem;
        padding: 0.35rem 0.55rem;
      }
      .wc-check-dropdown summary::marker {
        color: var(--color-text-light-highlight, currentColor);
      }
      .wc-selection-text {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .wc-check-panel {
        background: var(--color-bg, #1f1b24);
        border: 1px solid var(--color-border-highlight, rgba(255,255,255,.28));
        border-radius: 4px;
        box-shadow: 0 8px 18px rgba(0,0,0,.35);
        box-sizing: border-box;
        left: 0;
        margin-top: 2px;
        max-height: 14rem;
        overflow: auto;
        padding: 0.35rem 0;
        position: absolute;
        right: 0;
        z-index: 20;
      }
      .wc-check-group + .wc-check-group {
        border-top: 1px solid rgba(255,255,255,.12);
        margin-top: 0.25rem;
        padding-top: 0.25rem;
      }
      .wc-check-group-title {
        color: var(--color-text-light-heading, currentColor);
        font-weight: 700;
        padding: 0.25rem 0.65rem;
      }
      .wc-check-row {
        align-items: center;
        display: flex;
        gap: 0.5rem;
        margin: 0;
        padding: 0.25rem 0.65rem;
      }
      .wc-check-row:hover {
        background: rgba(255,255,255,.08);
      }
      .wc-check-row input {
        flex: 0 0 auto;
        width: auto;
      }
      .wc-config-dialog .hint {
        color: var(--color-text-dark-secondary, #666);
        font-size: 0.85em;
        font-weight: 400;
      }
    `;
    document.head.appendChild(style);
  }
  registerCheckDropdownListeners();

  try {
    LOG.setLevel(game.settings.get(MODULE_ID, "logLevel"));
    LOG.withStacks = game.settings.get(MODULE_ID, "logStacks");
    LOG.bufferLimit = game.settings.get(MODULE_ID, "logBufferLimit");
  } catch {}

  LOG.info("init complete");
});

// ══════════════════════ Ready ══════════════════════

Hooks.once("ready", () => {
  wcSocket.register("updateContainerConfig", _socketUpdateContainerConfig);
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

async function _socketUpdateContainerConfig(containerId, config) {
  if (!game.user.isGM) return;
  const [actorId, itemId] = containerId.split(".");
  const actor = game.actors.get(actorId);
  if (!actor) return;
  const container = getItem(actor, itemId);
  if (!container) return;
  await container.update({
    [`flags.${MODULE_ID}.reductionPct`]: config.reductionPct,
    [`flags.${MODULE_ID}.allowedTypes`]: config.allowedTypes,
    [`flags.${MODULE_ID}.allowedSubtypes`]: config.allowedSubtypes,
    [`flags.${MODULE_ID}.requiredProperties`]: config.requiredProperties
  });
  LOG.info("Socket: container config updated", { container: container.name, config });
}

async function _socketNotifyExceed(data) {
  ui.notifications?.warn(data.msg);
}

// ══════════════════════════════════════════════════════════════════
// PRIMARY PATCH: Override ContainerData computed getters
// ══════════════════════════════════════════════════════════════════
// In dnd5e 5.3.x, ContainerData has computed getters:
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
  const containerId = getChangeProperty(data, "system.container") ?? item?.system?.container ?? null;
  if (!actor || !containerId) return;

  const container = getItem(actor, containerId);
  if (!container) return;
  const itemData = makeItemCandidate(item, data);

  if (_enforceContainerRestrictions(actor, container, itemData) === false) return false;

  const capacityLbs = getCapacityLbs(container);
  if (!capacityLbs) return;

  const { load: currentLbs } = computeAdjustedLoad(actor, containerId);
  const reduction = getReductionPct(container) / 100;

  const rawWeight = itemData?.system?.weight;
  let unitWeight = 0;
  let units = null;
  if (typeof rawWeight === "object" && rawWeight !== null) {
    unitWeight = num(rawWeight.value, 0);
    units = rawWeight.units || null;
  } else {
    unitWeight = num(rawWeight, 0);
  }
  const qty = num(itemData?.system?.quantity, 1);
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
  const explicitContainer = getChangeProperty(changes, "system.container");
  const newCid = explicitContainer !== undefined ? explicitContainer : currentCid;
  const itemData = makeItemCandidate(item, changes);

  if (newCid) {
    const container = getItem(actor, newCid);
    if (container && (_enforceContainerRestrictions(actor, container, itemData) === false)) return false;
  }

  // Quantity increase
  const quantityChange = getChangeProperty(changes, "system.quantity");
  if (quantityChange != null && newCid && newCid === currentCid) {
    const newQty = num(quantityChange, getItemQuantity(item));
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
  const weightChange = getChangeProperty(changes, "system.weight") ?? (
    getChangeProperty(changes, "system.weight.value") !== undefined ? itemData?.system?.weight : undefined
  );
  if (weightChange != null && newCid) {
    const container = getItem(actor, newCid);
    const capacityLbs = getCapacityLbs(container);
    if (capacityLbs) {
      const { load: currentLbs } = computeAdjustedLoad(actor, newCid);
      const reduction = getReductionPct(container) / 100;
      const oldTotalLbs = ownWeightLbs(item) * (1 - reduction);
      const newUnitW = getItemUnitWeight(itemData);
      const newUnits = getItemWeightUnits(itemData);
      const newTotalLbs = convertToLbs(newUnitW * getItemQuantity(itemData), newUnits) * (1 - reduction);
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
        renderApplication(actor.sheet, false);
      });
    }
    if (isContainer(item)) {
      debouncedRender(`item:${item.id}`, () => {
        renderApplication(item.sheet, false);
      });
    }
    const cid = item.system?.container;
    if (cid) {
      const c = getItem(actor, cid);
      if (c?.sheet?.rendered) {
        debouncedRender(`item:${cid}`, () => renderApplication(c.sheet, false));
      }
    }
  });

  const onItemChange = (item) => {
    const actor = item.parent;
    if (!actor) return;
    const cid = item.system?.container;
    if (cid) {
      const c = getItem(actor, cid);
      debouncedRender(`item:${cid}`, () => renderApplication(c?.sheet, false));
    }
    debouncedRender(`actor:${actor.id}`, () => renderApplication(actor.sheet, false));
  };

  Hooks.on("createItem", onItemChange);
  Hooks.on("deleteItem", onItemChange);
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
  btn.title = game.i18n.localize(`${MODULE_ID}.configBtn.title`);
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
  const restrictions = getContainerRestrictions(containerItem);
  const title = game.i18n.localize(`${MODULE_ID}.configDialog.title`);
  const saveLabel = game.i18n.localize(`${MODULE_ID}.reductionDialog.save`);
  const content = `
    <div class="wc-config-dialog">
      <label class="wc-config-field">
        ${game.i18n.localize(`${MODULE_ID}.reductionDialog.label`)}
        <input type="number" name="reductionPct" value="${cur}" min="0" max="100" step="1" autofocus>
      </label>
      <div class="wc-config-field">
        ${game.i18n.localize(`${MODULE_ID}.configDialog.allowedTypes.label`)}
        ${renderCheckboxDropdown("allowedTypes", getRuleItemTypeGroups(), restrictions.allowedTypes)}
        <span class="hint">${game.i18n.localize(`${MODULE_ID}.configDialog.allowedTypes.hint`)}</span>
      </div>
      <div class="wc-config-field">
        ${game.i18n.localize(`${MODULE_ID}.configDialog.allowedSubtypes.label`)}
        ${renderCheckboxDropdown("allowedSubtypes", getRuleSubtypeGroups(), restrictions.allowedSubtypes)}
        <span class="hint">${game.i18n.localize(`${MODULE_ID}.configDialog.allowedSubtypes.hint`)}</span>
      </div>
      <div class="wc-config-field">
        ${game.i18n.localize(`${MODULE_ID}.configDialog.requiredProperties.label`)}
        ${renderCheckboxDropdown("requiredProperties", getRulePropertyGroups(), restrictions.requiredProperties)}
        <span class="hint">${game.i18n.localize(`${MODULE_ID}.configDialog.requiredProperties.hint`)}</span>
      </div>
    </div>`;

  const config = await foundry.applications.api.DialogV2.prompt({
    window: { title, minimizable: false },
    content,
    ok: {
      label: saveLabel,
      callback: (event, button, dialog) => {
        const root = dialog?.element ?? button?.form ?? event?.currentTarget?.closest?.(".application");
        const pctValue = Number(root?.querySelector?.('input[name="reductionPct"]')?.value);
        return {
          reductionPct: Math.clamp(Math.round(Number.isFinite(pctValue) ? pctValue : 0), 0, 100),
          allowedTypes: getSelectedTokens(root, "allowedTypes"),
          allowedSubtypes: getSelectedTokens(root, "allowedSubtypes"),
          requiredProperties: getSelectedTokens(root, "requiredProperties")
        };
      }
    },
    rejectClose: false
  });

  if (!config) return;

  if (containerItem.parent && wcSocket._ready) {
    await wcSocket.executeAsGM("updateContainerConfig", `${containerItem.parent.id}.${containerItem.id}`, config);
  } else {
    await containerItem.update({
      [`flags.${MODULE_ID}.reductionPct`]: config.reductionPct,
      [`flags.${MODULE_ID}.allowedTypes`]: config.allowedTypes,
      [`flags.${MODULE_ID}.allowedSubtypes`]: config.allowedSubtypes,
      [`flags.${MODULE_ID}.requiredProperties`]: config.requiredProperties
    });
  }

  ui.notifications?.info(
    game.i18n.format(`${MODULE_ID}.configSet.notification`, { containerName: containerItem.name })
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
    getContainerRestrictions,
    validateContainerRestrictions,

    _findOpenApps() {
      const apps = [];
      if (foundry.applications?.instances instanceof Map) {
        for (const app of foundry.applications.instances.values()) apps.push(app);
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
      console.log("Restrictions:", getContainerRestrictions(item));
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
