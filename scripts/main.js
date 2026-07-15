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
  const addItemType = (type, label = null) => {
    const token = normalizeToken(type);
    if (!/^[a-z][a-z0-9_-]*$/.test(token) || token === "base") return;
    addOption(itemTypes, token, typeof label === "string" ? label : `TYPES.Item.${token}`);
  };

  for (const type of valuesFromConfig(game.system?.documentTypes?.Item)) addItemType(type, `TYPES.Item.${type}`);
  for (const [type, label] of Object.entries(CONFIG.Item?.typeLabels ?? {})) addItemType(type, label);

  for (const type of ["weapon", "consumable", "equipment", "tool", "loot", "container", "backpack", "spell", "feat"]) {
    addItemType(type, `TYPES.Item.${type}`);
  }

  const options = Array.from(itemTypes, ([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label, game.i18n.lang));

  return [{ label: game.i18n.localize(`${MODULE_ID}.configDialog.groups.itemTypes`), options }];
}

function getRuleSubtypeGroups() {
  const dnd5e = CONFIG.DND5E ?? {};
  const groups = [];
  const addGroup = (key, labelKey, types = []) => {
    const options = optionsFromConfig(dnd5e[key]);
    if (options.length) groups.push({
      key,
      label: game.i18n.localize(`${MODULE_ID}.configDialog.groups.${labelKey}`),
      options,
      types
    });
  };

  groups.push({
    key: "weaponRange",
    label: game.i18n.localize(`${MODULE_ID}.configDialog.groups.weaponRange`),
    types: ["weapon"],
    options: [
      { value: "melee", label: game.i18n.localize(`${MODULE_ID}.configDialog.option.melee`) },
      { value: "ranged", label: game.i18n.localize(`${MODULE_ID}.configDialog.option.ranged`) }
    ]
  });

  addGroup("weaponTypes", "weaponTypes", ["weapon"]);
  addGroup("consumableTypes", "consumableTypes", ["consumable"]);
  addGroup("equipmentTypes", "equipmentTypes", ["equipment"]);
  addGroup("armorTypes", "armorTypes", ["equipment"]);
  addGroup("toolTypes", "toolTypes", ["tool"]);
  addGroup("lootTypes", "lootTypes", ["loot"]);

  if (!groups.some(g => g.options.length)) {
    groups.push({
      key: "commonSubtypes",
      label: game.i18n.localize(`${MODULE_ID}.configDialog.groups.commonSubtypes`),
      types: [],
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
    if (options.length) groups.push({
      key,
      label: game.i18n.localize(`${MODULE_ID}.configDialog.groups.${labelKey}`),
      options
    });
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
      if (options.length) groups.push({
        key: `validProperties-${itemType}`,
        label: localizeConfigLabel(`TYPES.Item.${itemType}`, itemType),
        options
      });
    }
  }

  if (!groups.length) {
    groups.push({
      key: "itemProperties",
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

function prepareRuleGroups(groups, selectedValues) {
  const selected = new Set(parseTokenList(selectedValues));
  const known = new Set(groups.flatMap(group => group.options.map(option => normalizeToken(option.value))));
  const unknownOptions = Array.from(selected)
    .filter(value => !known.has(value))
    .map(value => ({ value, label: value }));
  if (!unknownOptions.length) return groups;
  return [...groups, {
    key: "savedValues",
    label: game.i18n.localize(`${MODULE_ID}.configDialog.groups.savedValues`),
    options: unknownOptions,
    saved: true,
    types: []
  }];
}

function renderRuleMultiselect({ name, groups, selectedValues, placeholder }) {
  const selected = new Set(parseTokenList(selectedValues));
  const allGroups = prepareRuleGroups(groups, selectedValues);
  const panelId = `wc-${name}-options`;
  const checkedAttr = value => selected.has(normalizeToken(value)) ? " checked" : "";
  const groupMarkup = allGroups.map((group, groupIndex) => {
    const groupKey = group.key ?? `group-${groupIndex}`;
    const groupTypes = (group.types ?? []).map(normalizeToken).filter(Boolean).join(" ");
    const options = group.options.map(option => {
      const value = normalizeToken(option.value);
      return `
        <label class="cr-option-row" data-search="${_escapeHtml(`${option.label} ${value}`.toLocaleLowerCase())}">
          <input type="checkbox" name="${_escapeHtml(name)}" value="${_escapeHtml(value)}"
                 data-label="${_escapeHtml(option.label)}"${checkedAttr(value)}>
          <span class="cr-checkbox-mark" aria-hidden="true"><i class="fas fa-check"></i></span>
          <span class="cr-option-label">${_escapeHtml(option.label)}</span>
        </label>`;
    }).join("");
    return `
      <section class="cr-option-group" data-group="${_escapeHtml(groupKey)}"
               data-types="${_escapeHtml(groupTypes)}"${group.saved ? ' data-saved="true"' : ""}>
        <label class="cr-option-group-header">
          <input type="checkbox" data-group-toggle="true">
          <span class="cr-checkbox-mark" aria-hidden="true"><i class="fas fa-check"></i></span>
          <span>${_escapeHtml(group.label)}</span>
          <span class="cr-group-count" aria-hidden="true"></span>
        </label>
        <div class="cr-option-group-items">${options}</div>
      </section>`;
  }).join("");

  return `
    <div class="cr-multiselect" data-select="${_escapeHtml(name)}" data-placeholder="${_escapeHtml(placeholder)}">
      <div class="cr-combobox" role="combobox" tabindex="0" aria-haspopup="listbox"
           aria-expanded="false" aria-controls="${panelId}">
        <div class="cr-selection" data-selection></div>
        <button type="button" class="cr-icon-button cr-select-clear" data-action="clearSelect"
                data-select-name="${_escapeHtml(name)}" aria-label="${_escapeHtml(game.i18n.localize(`${MODULE_ID}.configDialog.actions.clear`))}"
                title="${_escapeHtml(game.i18n.localize(`${MODULE_ID}.configDialog.actions.clear`))}">
          <i class="fas fa-xmark"></i>
        </button>
        <button type="button" class="cr-icon-button cr-select-toggle" data-action="toggleSelect"
                data-select-name="${_escapeHtml(name)}" aria-label="${_escapeHtml(game.i18n.localize(`${MODULE_ID}.configDialog.actions.open`))}">
          <i class="fas fa-chevron-down"></i>
        </button>
      </div>
      <div id="${panelId}" class="cr-select-panel" role="listbox" aria-multiselectable="true"
           popover="manual" hidden>
        <div class="cr-select-toolbar">
          <label class="cr-search">
            <i class="fas fa-magnifying-glass" aria-hidden="true"></i>
            <input type="search" data-select-search autocomplete="off"
                   placeholder="${_escapeHtml(game.i18n.localize(`${MODULE_ID}.configDialog.search`))}">
          </label>
          <div class="cr-select-actions">
            <button type="button" data-action="selectVisible" data-select-name="${_escapeHtml(name)}">
              ${_escapeHtml(game.i18n.localize(`${MODULE_ID}.configDialog.actions.selectVisible`))}
            </button>
            <button type="button" data-action="deselectVisible" data-select-name="${_escapeHtml(name)}">
              ${_escapeHtml(game.i18n.localize(`${MODULE_ID}.configDialog.actions.deselectVisible`))}
            </button>
            <button type="button" data-action="clearSelect" data-select-name="${_escapeHtml(name)}">
              ${_escapeHtml(game.i18n.localize(`${MODULE_ID}.configDialog.actions.clear`))}
            </button>
            <span class="cr-select-total" data-select-total></span>
          </div>
        </div>
        <div class="cr-options">${groupMarkup}</div>
        <div class="cr-select-result" data-select-result></div>
      </div>
    </div>`;
}

function getContainerRestrictions(containerItem) {
  const flags = containerItem?.flags?.[MODULE_ID] ?? {};
  return {
    allowedTypes: parseTokenList(flags.allowedTypes),
    allowedSubtypes: parseTokenList(flags.allowedSubtypes),
    requiredProperties: parseTokenList(flags.requiredProperties),
    forbiddenProperties: parseTokenList(flags.forbiddenProperties),
    propertyMatchMode: flags.propertyMatchMode === "any" ? "any" : "all"
  };
}

function makeContainerConfigUpdate(config) {
  return {
    [`flags.${MODULE_ID}.reductionPct`]: Math.clamp(Math.round(num(config.reductionPct, 0)), 0, 100),
    [`flags.${MODULE_ID}.allowedTypes`]: parseTokenList(config.allowedTypes),
    [`flags.${MODULE_ID}.allowedSubtypes`]: parseTokenList(config.allowedSubtypes),
    [`flags.${MODULE_ID}.requiredProperties`]: parseTokenList(config.requiredProperties),
    [`flags.${MODULE_ID}.forbiddenProperties`]: parseTokenList(config.forbiddenProperties),
    [`flags.${MODULE_ID}.propertyMatchMode`]: config.propertyMatchMode === "any" ? "any" : "all"
  };
}

function containerConfigMatches(containerItem, config) {
  const saved = getContainerRestrictions(containerItem);
  const sameTokens = (left, right) => {
    const a = Array.from(new Set(parseTokenList(left))).sort();
    const b = Array.from(new Set(parseTokenList(right))).sort();
    return a.length === b.length && a.every((value, index) => value === b[index]);
  };
  return getReductionPct(containerItem) === Math.clamp(Math.round(num(config.reductionPct, 0)), 0, 100)
    && sameTokens(saved.allowedTypes, config.allowedTypes)
    && sameTokens(saved.allowedSubtypes, config.allowedSubtypes)
    && sameTokens(saved.requiredProperties, config.requiredProperties)
    && sameTokens(saved.forbiddenProperties, config.forbiddenProperties)
    && saved.propertyMatchMode === (config.propertyMatchMode === "any" ? "any" : "all");
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
  if (!restrictions.allowedTypes.length
      && !restrictions.allowedSubtypes.length
      && !restrictions.requiredProperties.length
      && !restrictions.forbiddenProperties.length) {
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

  const propertyTokens = getItemPropertyTokens(itemData);
  const requiredMatches = restrictions.propertyMatchMode === "any"
    ? restrictions.requiredProperties.some(token => propertyTokens.has(token))
    : restrictions.requiredProperties.every(token => propertyTokens.has(token));
  if (restrictions.requiredProperties.length && !requiredMatches) {
    return { ok: false, reason: "property", restrictions };
  }

  if (restrictions.forbiddenProperties.some(token => propertyTokens.has(token))) {
    return { ok: false, reason: "forbiddenProperty", restrictions };
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
  if (restrictions.forbiddenProperties.length) details.push(game.i18n.format(`${MODULE_ID}.restrictionMessage.forbiddenProperties`, {
    properties: restrictions.forbiddenProperties.join(", ")
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
  await container.update(makeContainerConfigUpdate(config));
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

const OPEN_CONTAINER_RULE_APPS = new Map();
const ContainerRulesApplication = foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2
);

class ContainerRulesApp extends ContainerRulesApplication {
  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-rules`,
    classes: ["container-rules"],
    tag: "form",
    position: { width: 880, height: 720 },
    window: {
      icon: "fas fa-gear",
      minimizable: true,
      resizable: true
    },
    form: {
      closeOnSubmit: false,
      handler: ContainerRulesApp._onSubmit
    },
    actions: {
      cancel: ContainerRulesApp._cancel,
      clearSelect: ContainerRulesApp._clearSelect,
      deselectVisible: ContainerRulesApp._deselectVisible,
      removeSelection: ContainerRulesApp._removeSelection,
      removeUnavailable: ContainerRulesApp._removeUnavailable,
      resolveConflict: ContainerRulesApp._resolveConflict,
      scrollSection: ContainerRulesApp._scrollSection,
      selectVisible: ContainerRulesApp._selectVisible,
      showUnavailable: ContainerRulesApp._showUnavailable,
      toggleSection: ContainerRulesApp._toggleSection,
      toggleSelect: ContainerRulesApp._toggleSelect
    }
  };

  static PARTS = {
    content: { template: `modules/${MODULE_ID}/templates/container-rules.hbs` },
    footer: { template: `modules/${MODULE_ID}/templates/container-rules-footer.hbs` }
  };

  constructor(containerItem, options = {}) {
    const title = game.i18n.localize(`${MODULE_ID}.configDialog.title`);
    super({
      ...options,
      id: `${MODULE_ID}-rules-${containerItem.parent?.id ?? "world"}-${containerItem.id}`,
      window: { ...options.window, title }
    });
    this.containerItem = containerItem;
    const restrictions = getContainerRestrictions(containerItem);
    this.draft = {
      reductionPct: getReductionPct(containerItem),
      allowedTypes: [...restrictions.allowedTypes],
      allowedSubtypes: [...restrictions.allowedSubtypes],
      requiredProperties: [...restrictions.requiredProperties],
      forbiddenProperties: [...restrictions.forbiddenProperties],
      propertyMatchMode: restrictions.propertyMatchMode
    };
    this.catalogs = {
      allowedTypes: getRuleItemTypeGroups(),
      allowedSubtypes: getRuleSubtypeGroups(),
      requiredProperties: getRulePropertyGroups(),
      forbiddenProperties: getRulePropertyGroups()
    };
    this._initialSnapshot = this._snapshot();
    this._dirty = false;
    this._hasErrors = false;
    this._closingAfterSave = false;
    this._listenersAbort = null;
    this._motionReady = false;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const propertyGroups = this.catalogs.requiredProperties;
    return {
      ...context,
      containerName: this.containerItem.name,
      reductionPct: this.draft.reductionPct,
      previewAfter: Math.max(0, 10 * (1 - this.draft.reductionPct / 100)).toLocaleString(game.i18n.lang, {
        maximumFractionDigits: 1
      }),
      modeAll: this.draft.propertyMatchMode === "all",
      modeAny: this.draft.propertyMatchMode === "any",
      allowedTypesSelect: renderRuleMultiselect({
        name: "allowedTypes",
        groups: this.catalogs.allowedTypes,
        selectedValues: this.draft.allowedTypes,
        placeholder: game.i18n.localize(`${MODULE_ID}.configDialog.anyTypes`)
      }),
      allowedSubtypesSelect: renderRuleMultiselect({
        name: "allowedSubtypes",
        groups: this.catalogs.allowedSubtypes,
        selectedValues: this.draft.allowedSubtypes,
        placeholder: game.i18n.localize(`${MODULE_ID}.configDialog.anySubtypes`)
      }),
      requiredPropertiesSelect: renderRuleMultiselect({
        name: "requiredProperties",
        groups: propertyGroups,
        selectedValues: this.draft.requiredProperties,
        placeholder: game.i18n.localize(`${MODULE_ID}.configDialog.anyProperties`)
      }),
      forbiddenPropertiesSelect: renderRuleMultiselect({
        name: "forbiddenProperties",
        groups: this.catalogs.forbiddenProperties,
        selectedValues: this.draft.forbiddenProperties,
        placeholder: game.i18n.localize(`${MODULE_ID}.configDialog.anyProperties`)
      })
    };
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    const renderedElement = this.element;
    this._motionReady = false;
    renderedElement.classList.remove("cr-ready");
    this._listenersAbort?.abort();
    this._listenersAbort = new AbortController();
    const { signal } = this._listenersAbort;

    this.element.addEventListener("change", event => this._onChange(event), { signal });
    this.element.addEventListener("click", event => this._onLocalClick(event), { signal });
    this.element.addEventListener("input", event => this._onInput(event), { signal });
    this.element.addEventListener("keydown", event => this._onKeyDown(event), { signal });
    this.element.querySelector(".cr-main")?.addEventListener("scroll", () => {
      this._closeAllSelects();
      this._updateActiveSection();
    }, { signal, passive: true });
    document.addEventListener("pointerdown", event => {
      if (!this.element?.contains(event.target)) this._closeAllSelects();
    }, { signal });
    window.addEventListener("resize", () => this._closeAllSelects(), { signal, passive: true });

    this._installDirtyIndicator();
    this._refreshAll();
    requestAnimationFrame(() => {
      if (this.element !== renderedElement || !renderedElement.isConnected) return;
      renderedElement.classList.add("cr-ready");
      this._motionReady = true;
    });
  }

  _onPosition(position) {
    super._onPosition(position);
    this._closeAllSelects();
  }

  async close(options = {}) {
    this._closeAllSelects();
    const force = typeof options === "boolean" ? options : options?.force;
    if (this._dirty && !force && !this._closingAfterSave) {
      const confirmed = await foundry.applications.api.DialogV2.confirm({
        window: { title: game.i18n.localize(`${MODULE_ID}.configDialog.unsaved.title`) },
        content: `<p>${_escapeHtml(game.i18n.localize(`${MODULE_ID}.configDialog.unsaved.message`))}</p>`,
        yes: { label: game.i18n.localize(`${MODULE_ID}.configDialog.unsaved.discard`) },
        no: { label: game.i18n.localize(`${MODULE_ID}.configDialog.unsaved.continue`) },
        rejectClose: false
      });
      if (!confirmed) return this;
    }
    this._listenersAbort?.abort();
    return super.close(options);
  }

  static async _onSubmit(event, form, formData) {
    await this._save();
  }

  static _cancel(event, target) {
    return this.close();
  }

  static _clearSelect(event, target) {
    this._setSelection(target.dataset.selectName, []);
  }

  static _selectVisible(event, target) {
    this._bulkVisible(target.dataset.selectName, true);
  }

  static _deselectVisible(event, target) {
    this._bulkVisible(target.dataset.selectName, false);
  }

  static _removeSelection(event, target) {
    const name = target.dataset.selectName;
    this._setSelection(name, this.draft[name].filter(value => value !== normalizeToken(target.dataset.token)));
  }

  static _removeUnavailable() {
    const unavailable = new Set(this._getUnavailableSubtypeValues());
    this._setSelection("allowedSubtypes", this.draft.allowedSubtypes.filter(value => !unavailable.has(value)));
  }

  static _resolveConflict(event, target) {
    const keep = target.dataset.keep;
    const removeFrom = keep === "requiredProperties" ? "forbiddenProperties" : "requiredProperties";
    const conflicts = new Set(this._propertyConflicts());
    this._setSelection(removeFrom, this.draft[removeFrom].filter(value => !conflicts.has(value)));
  }

  static _scrollSection(event, target) {
    this._scrollToSection(target.dataset.section);
  }

  static _showUnavailable() {
    const root = this._selectRoot("allowedSubtypes");
    root?.classList.toggle("show-unavailable");
    this._applySelectFilter(root);
    if (root && !root.classList.contains("is-open")) this._openSelect(root);
  }

  static _toggleSection(event, target) {
    if (this.element.getBoundingClientRect().width >= 600) return;
    target.closest(".cr-section")?.classList.toggle("is-collapsed");
  }

  static _toggleSelect(event, target) {
    const root = this._selectRoot(target.dataset.selectName);
    if (!root) return;
    root.classList.contains("is-open") ? this._closeSelect(root) : this._openSelect(root);
  }

  _onInput(event) {
    const target = event.target;
    if (target.matches("[data-select-search]")) {
      this._applySelectFilter(target.closest(".cr-multiselect"));
      return;
    }
    if (!target.matches('[name="reductionPct"], [name="reductionRange"]')) return;
    const value = Math.clamp(Math.round(num(target.value, 0)), 0, 100);
    this.draft.reductionPct = value;
    for (const input of this.element.querySelectorAll('[name="reductionPct"], [name="reductionRange"]')) {
      if (input !== target) input.value = value;
    }
    this._refreshPreview();
    this._afterDraftChange();
  }

  _onChange(event) {
    const target = event.target;
    if (target.matches('[name="propertyMatchMode"]')) {
      this.draft.propertyMatchMode = target.value === "any" ? "any" : "all";
      this._afterDraftChange();
      return;
    }
    if (target.matches("[data-group-toggle]")) {
      const root = target.closest(".cr-multiselect");
      const group = target.closest(".cr-option-group");
      const name = root?.dataset.select;
      if (!name || !group) return;
      const values = new Set(this.draft[name]);
      for (const input of group.querySelectorAll('.cr-option-row input[type="checkbox"]')) {
        const token = normalizeToken(input.value);
        target.checked ? values.add(token) : values.delete(token);
      }
      this._setSelection(name, Array.from(values));
      return;
    }
    if (!target.matches('.cr-option-row input[type="checkbox"]')) return;
    this._applyOptionInput(target);
  }

  _applyOptionInput(input) {
    const root = input.closest(".cr-multiselect");
    const name = root?.dataset.select;
    if (!name) return;
    const token = normalizeToken(input.value);
    const values = new Set(this.draft[name]);
    input.checked ? values.add(token) : values.delete(token);
    this._setSelection(name, Array.from(values));
  }

  _onLocalClick(event) {
    const row = event.target.closest?.(".cr-option-row");
    if (row && !event.target.matches?.('input[type="checkbox"]')) {
      const input = row.querySelector('input[type="checkbox"]');
      if (!input || input.disabled) return;
      event.preventDefault();
      input.checked = !input.checked;
      this._applyOptionInput(input);
      return;
    }
    const combo = event.target.closest(".cr-combobox");
    if (!combo || event.target.closest("button")) return;
    const root = combo.closest(".cr-multiselect");
    root.classList.contains("is-open") ? this._closeSelect(root) : this._openSelect(root);
  }

  _onKeyDown(event) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      this.submit();
      return;
    }

    const numeric = event.target.matches?.('[name="reductionPct"]') ? event.target : null;
    if (numeric && event.shiftKey && ["ArrowUp", "ArrowDown"].includes(event.key)) {
      event.preventDefault();
      const delta = event.key === "ArrowUp" ? 5 : -5;
      numeric.value = Math.clamp(num(numeric.value, 0) + delta, 0, 100);
      numeric.dispatchEvent(new Event("input", { bubbles: true }));
      return;
    }

    if (event.key === "Escape") {
      const open = this.element.querySelector(".cr-multiselect.is-open");
      if (open) {
        event.preventDefault();
        event.stopPropagation();
        this._closeSelect(open);
      }
      return;
    }

    const combo = event.target.closest?.(".cr-combobox");
    if (combo && ["Enter", " ", "ArrowDown"].includes(event.key)) {
      event.preventDefault();
      const root = combo.closest(".cr-multiselect");
      if (!root.classList.contains("is-open")) this._openSelect(root);
      if (event.key === "ArrowDown") this._focusSelectRow(root, 0);
      return;
    }

    const rowInput = event.target.matches?.('.cr-option-row input[type="checkbox"]') ? event.target : null;
    if (!rowInput || !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const root = rowInput.closest(".cr-multiselect");
    const visible = this._visibleRowInputs(root);
    const current = visible.indexOf(rowInput);
    const index = event.key === "Home" ? 0
      : event.key === "End" ? visible.length - 1
        : Math.clamp(current + (event.key === "ArrowDown" ? 1 : -1), 0, visible.length - 1);
    visible[index]?.focus();
  }

  _selectRoot(name) {
    return this.element?.querySelector?.(`.cr-multiselect[data-select="${name}"]`) ?? null;
  }

  _snapshot() {
    return JSON.stringify({
      reductionPct: this.draft.reductionPct,
      allowedTypes: [...this.draft.allowedTypes].sort(),
      allowedSubtypes: [...this.draft.allowedSubtypes].sort(),
      requiredProperties: [...this.draft.requiredProperties].sort(),
      forbiddenProperties: [...this.draft.forbiddenProperties].sort(),
      propertyMatchMode: this.draft.propertyMatchMode
    });
  }

  _setSelection(name, values) {
    if (!Object.hasOwn(this.draft, name)) return;
    this.draft[name] = Array.from(new Set(parseTokenList(values)));
    const root = this._selectRoot(name);
    const selected = new Set(this.draft[name]);
    for (const input of root?.querySelectorAll?.('.cr-option-row input[type="checkbox"]') ?? []) {
      input.checked = selected.has(normalizeToken(input.value));
    }
    this._refreshMultiselect(root);
    if (name === "allowedTypes") {
      this._applySelectFilter(this._selectRoot("allowedSubtypes"));
      this._refreshSubtypeWarning();
    }
    if (name === "allowedSubtypes") this._refreshSubtypeWarning();
    this._refreshPropertyConflicts();
    this._afterDraftChange();
  }

  _bulkVisible(name, checked) {
    const root = this._selectRoot(name);
    if (!root) return;
    const values = new Set(this.draft[name]);
    for (const input of this._visibleRowInputs(root)) {
      const token = normalizeToken(input.value);
      checked ? values.add(token) : values.delete(token);
    }
    this._setSelection(name, Array.from(values));
  }

  _visibleRowInputs(root) {
    if (!root) return [];
    return Array.from(root.querySelectorAll('.cr-option-row input[type="checkbox"]'))
      .filter(input => !input.closest(".cr-option-row").hidden && !input.closest(".cr-option-group").hidden);
  }

  _refreshAll() {
    for (const name of ["allowedTypes", "allowedSubtypes", "requiredProperties", "forbiddenProperties"]) {
      this._refreshMultiselect(this._selectRoot(name));
    }
    this._applySelectFilter(this._selectRoot("allowedSubtypes"));
    this._refreshSubtypeWarning();
    this._refreshPropertyConflicts();
    this._refreshPreview();
    this._refreshSummary();
    this._refreshBadges();
    this._refreshDirtyState();
  }

  _motionAllowed() {
    return this._motionReady && !globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  }

  _animate(element, keyframes, options = {}) {
    if (!element || !this._motionAllowed() || typeof element.animate !== "function") return;
    element.animate(keyframes, {
      duration: 180,
      easing: "cubic-bezier(.2, .8, .2, 1)",
      ...options
    });
  }

  _refreshMultiselect(root) {
    if (!root) return;
    const name = root.dataset.select;
    const selected = new Set(this.draft[name]);
    const labels = this._selectionLabels(name);
    const selection = root.querySelector("[data-selection]");
    const visibleLabels = labels.slice(0, 3);
    const chips = visibleLabels.map(({ value, label }) => `
      <button type="button" class="cr-chip" data-action="removeSelection"
              data-select-name="${_escapeHtml(name)}" data-token="${_escapeHtml(value)}"
              title="${_escapeHtml(game.i18n.localize(`${MODULE_ID}.configDialog.actions.remove`))}">
        <span>${_escapeHtml(label)}</span><i class="fas fa-xmark" aria-hidden="true"></i>
      </button>`).join("");
    const more = labels.length > 3 ? `<span class="cr-chip cr-chip-more">+${labels.length - 3}</span>` : "";
    const placeholder = `<span class="cr-placeholder">${_escapeHtml(root.dataset.placeholder)}</span>`;
    const mobile = `<span class="cr-mobile-selection">${_escapeHtml(game.i18n.format(`${MODULE_ID}.configDialog.selectedCount`, { count: labels.length }))}</span>`;
    const previousCount = Number(root.dataset.selectionCount ?? -1);
    selection.innerHTML = labels.length ? `${chips}${more}${mobile}` : placeholder;
    selection.title = labels.map(entry => entry.label).join(", ");
    root.dataset.selectionCount = String(labels.length);
    if (previousCount >= 0 && previousCount !== labels.length) {
      for (const [index, chip] of Array.from(selection.querySelectorAll(".cr-chip")).entries()) {
        this._animate(chip, [
          { opacity: .35, transform: "translateY(3px) scale(.96)" },
          { opacity: 1, transform: "translateY(0) scale(1)" }
        ], { delay: Math.min(index, 3) * 24 });
      }
    }

    const clear = root.querySelector(".cr-select-clear");
    if (clear) clear.hidden = selected.size === 0;
    const uniqueOptions = new Set(Array.from(root.querySelectorAll('.cr-option-row input[type="checkbox"]'))
      .map(input => normalizeToken(input.value)));
    const total = root.querySelector("[data-select-total]");
    if (total) total.textContent = game.i18n.format(`${MODULE_ID}.configDialog.selectedOf`, {
      selected: selected.size,
      total: uniqueOptions.size
    });
    const result = root.querySelector("[data-select-result]");
    if (result) result.textContent = game.i18n.format(`${MODULE_ID}.configDialog.selectedCount`, { count: selected.size });

    for (const row of root.querySelectorAll(".cr-option-row")) {
      const input = row.querySelector('input[type="checkbox"]');
      row.classList.toggle("is-selected", input.checked);
      row.setAttribute("aria-selected", String(input.checked));
    }
    for (const group of root.querySelectorAll(".cr-option-group")) this._refreshGroupState(group);
  }

  _refreshGroupState(group) {
    const inputs = Array.from(group.querySelectorAll('.cr-option-row input[type="checkbox"]'));
    const checked = inputs.filter(input => input.checked).length;
    const toggle = group.querySelector("[data-group-toggle]");
    if (toggle) {
      toggle.checked = inputs.length > 0 && checked === inputs.length;
      toggle.indeterminate = checked > 0 && checked < inputs.length;
    }
    const count = group.querySelector(".cr-group-count");
    if (count) count.textContent = `${checked} / ${inputs.length}`;
  }

  _selectionLabels(name) {
    const labelMap = new Map();
    for (const group of prepareRuleGroups(this.catalogs[name], this.draft[name])) {
      for (const option of group.options) labelMap.set(normalizeToken(option.value), option.label);
    }
    return this.draft[name].map(value => ({ value, label: labelMap.get(value) ?? value }));
  }

  _applySelectFilter(root) {
    if (!root) return;
    const query = normalizeToken(root.querySelector("[data-select-search]")?.value);
    const allowedTypes = new Set(this.draft.allowedTypes);
    const showUnavailable = root.classList.contains("show-unavailable");
    for (const group of root.querySelectorAll(".cr-option-group")) {
      const groupTypes = parseTokenList(group.dataset.types?.replaceAll(" ", ","));
      const typeAvailable = root.dataset.select !== "allowedSubtypes"
        || !allowedTypes.size
        || (!group.hasAttribute("data-saved") && (!groupTypes.length || groupTypes.some(type => allowedTypes.has(type))));
      const allowHiddenSelection = showUnavailable && Array.from(group.querySelectorAll('.cr-option-row input[type="checkbox"]'))
        .some(input => input.checked);
      let visibleCount = 0;
      for (const row of group.querySelectorAll(".cr-option-row")) {
        const matchesSearch = !query || row.dataset.search.includes(query);
        row.hidden = !(matchesSearch && (typeAvailable || (allowHiddenSelection && row.querySelector("input").checked)));
        if (!row.hidden) visibleCount += 1;
      }
      group.hidden = visibleCount === 0;
      group.classList.toggle("is-unavailable", !typeAvailable);
      this._refreshGroupState(group);
    }
  }

  _getUnavailableSubtypeValues() {
    if (!this.draft.allowedTypes.length) return [];
    const selectedTypes = new Set(this.draft.allowedTypes);
    const available = new Set();
    for (const group of this.catalogs.allowedSubtypes) {
      const types = new Set((group.types ?? []).map(normalizeToken));
      if (types.size && !Array.from(types).some(type => selectedTypes.has(type))) continue;
      for (const option of group.options) available.add(normalizeToken(option.value));
    }
    return this.draft.allowedSubtypes.filter(value => !available.has(value));
  }

  _refreshSubtypeWarning() {
    const values = this._getUnavailableSubtypeValues();
    const warning = this.element.querySelector("[data-subtype-warning]");
    if (!warning) return;
    warning.hidden = values.length === 0;
    const text = warning.querySelector("[data-warning-text]");
    if (text) text.textContent = game.i18n.format(`${MODULE_ID}.configDialog.unavailableSubtypes`, { count: values.length });
  }

  _propertyConflicts() {
    const forbidden = new Set(this.draft.forbiddenProperties);
    return this.draft.requiredProperties.filter(value => forbidden.has(value));
  }

  _refreshPropertyConflicts() {
    const conflicts = this._propertyConflicts();
    this._hasErrors = conflicts.length > 0;
    const labels = this._selectionLabels("requiredProperties")
      .filter(entry => conflicts.includes(entry.value))
      .map(entry => entry.label);
    for (const name of ["requiredProperties", "forbiddenProperties"]) {
      const root = this._selectRoot(name);
      root?.classList.toggle("is-invalid", this._hasErrors);
      root?.querySelector(".cr-combobox")?.setAttribute("aria-invalid", String(this._hasErrors));
      const error = this.element.querySelector(`[data-property-error="${name}"]`);
      if (!error) continue;
      error.hidden = !this._hasErrors;
      if (this._hasErrors) {
        error.innerHTML = `${_escapeHtml(game.i18n.format(`${MODULE_ID}.configDialog.propertyConflict`, {
          properties: labels.join(", ")
        }))} <button type="button" data-action="resolveConflict" data-keep="${name}">${_escapeHtml(
          game.i18n.localize(`${MODULE_ID}.configDialog.actions.moveHere`)
        )}</button>`;
      }
    }
    const save = this.element.querySelector("[data-save-button]");
    if (save) {
      save.disabled = this._hasErrors;
      save.querySelector("span").textContent = game.i18n.localize(
        `${MODULE_ID}.configDialog.${this._hasErrors ? "fixErrors" : "save"}`
      );
    }
  }

  _refreshPreview() {
    const after = Math.max(0, 10 * (1 - this.draft.reductionPct / 100));
    const value = this.element.querySelector("[data-preview-after]");
    const formatted = after.toLocaleString(game.i18n.lang, { maximumFractionDigits: 1 });
    const changed = value?.textContent !== formatted;
    if (value) value.textContent = formatted;
    const range = this.element.querySelector('[name="reductionRange"]');
    range?.style.setProperty("--cr-range-progress", `${this.draft.reductionPct}%`);
    if (changed) {
      this._animate(value, [
        { opacity: .45, transform: "translateY(3px) scale(.94)" },
        { opacity: 1, transform: "translateY(0) scale(1)" }
      ], { duration: 210 });
    }
  }

  _refreshSummary() {
    const summary = this.element.querySelector("[data-rule-summary]");
    if (!summary) return;
    const typeLabels = this._selectionLabels("allowedTypes").map(entry => entry.label);
    const subtypeLabels = this._selectionLabels("allowedSubtypes").map(entry => entry.label);
    const requiredLabels = this._selectionLabels("requiredProperties").map(entry => entry.label);
    const forbiddenLabels = this._selectionLabels("forbiddenProperties").map(entry => entry.label);
    const lines = [game.i18n.format(`${MODULE_ID}.configDialog.summary.reduction`, { pct: this.draft.reductionPct })];
    lines.push(typeLabels.length
      ? game.i18n.format(`${MODULE_ID}.configDialog.summary.types`, { values: typeLabels.join(", ") })
      : game.i18n.localize(`${MODULE_ID}.configDialog.summary.anyTypes`));
    if (subtypeLabels.length) lines.push(game.i18n.format(`${MODULE_ID}.configDialog.summary.subtypes`, {
      values: subtypeLabels.join(", ")
    }));
    if (requiredLabels.length) lines.push(game.i18n.format(
      `${MODULE_ID}.configDialog.summary.${this.draft.propertyMatchMode === "any" ? "requiredAny" : "requiredAll"}`,
      { values: requiredLabels.join(", ") }
    ));
    if (forbiddenLabels.length) lines.push(game.i18n.format(`${MODULE_ID}.configDialog.summary.forbidden`, {
      values: forbiddenLabels.join(", ")
    }));
    if (!requiredLabels.length && !forbiddenLabels.length) {
      lines.push(game.i18n.localize(`${MODULE_ID}.configDialog.summary.noProperties`));
    }
    summary.replaceChildren(...lines.map(line => {
      const paragraph = document.createElement("p");
      paragraph.textContent = line;
      return paragraph;
    }));
    this._animate(summary, [
      { opacity: .55, transform: "translateY(2px)" },
      { opacity: 1, transform: "translateY(0)" }
    ]);
  }

  _refreshBadges() {
    const restrictionsCount = this.draft.allowedTypes.length + this.draft.allowedSubtypes.length;
    const propertyCount = this.draft.requiredProperties.length + this.draft.forbiddenProperties.length;
    const restrictions = this.element.querySelector('[data-nav-badge="restrictions"]');
    const properties = this.element.querySelector('[data-nav-badge="properties"]');
    if (restrictions) {
      restrictions.textContent = restrictionsCount || "";
      restrictions.hidden = restrictionsCount === 0;
    }
    if (properties) {
      properties.textContent = this._hasErrors ? "!" : (propertyCount || "");
      properties.hidden = !this._hasErrors && propertyCount === 0;
      properties.classList.toggle("is-danger", this._hasErrors);
    }
  }

  _afterDraftChange() {
    this._refreshSummary();
    this._refreshBadges();
    this._refreshDirtyState();
  }

  _installDirtyIndicator() {
    if (!this.window?.header || this.window.header.querySelector(".cr-dirty-state")) return;
    const indicator = document.createElement("span");
    indicator.className = "cr-dirty-state";
    indicator.innerHTML = `<i class="fas fa-circle" aria-hidden="true"></i> ${_escapeHtml(
      game.i18n.localize(`${MODULE_ID}.configDialog.changed`)
    )}`;
    indicator.hidden = true;
    this.window.header.insertBefore(indicator, this.window.controls ?? this.window.close);
  }

  _refreshDirtyState() {
    const wasDirty = this._dirty;
    this._dirty = this._snapshot() !== this._initialSnapshot;
    const indicator = this.window?.header?.querySelector(".cr-dirty-state");
    if (indicator) {
      indicator.hidden = !this._dirty;
      if (!wasDirty && this._dirty) {
        this._animate(indicator, [
          { opacity: 0, transform: "translateX(5px)" },
          { opacity: 1, transform: "translateX(0)" }
        ], { duration: 220 });
      }
    }
  }

  _openSelect(root) {
    this._closeAllSelects(root);
    root.classList.add("is-open");
    const panel = root.querySelector(".cr-select-panel");
    panel.hidden = false;
    try {
      panel.showPopover?.();
    } catch {
      panel.removeAttribute("popover");
    }
    root.querySelector(".cr-combobox")?.setAttribute("aria-expanded", "true");
    this._applySelectFilter(root);
    this._positionSelectPanel(root);
    requestAnimationFrame(() => root.querySelector("[data-select-search]")?.focus());
  }

  _closeSelect(root) {
    if (!root) return;
    root.classList.remove("is-open");
    const panel = root.querySelector(".cr-select-panel");
    if (panel) {
      try {
        if (panel.matches(":popover-open")) panel.hidePopover();
      } catch {}
      panel.hidden = true;
      panel.removeAttribute("style");
    }
    root.querySelector(".cr-combobox")?.setAttribute("aria-expanded", "false");
  }

  _closeAllSelects(except = null) {
    for (const root of this.element?.querySelectorAll?.(".cr-multiselect.is-open") ?? []) {
      if (root !== except) this._closeSelect(root);
    }
  }

  _positionSelectPanel(root) {
    const combo = root.querySelector(".cr-combobox");
    const panel = root.querySelector(".cr-select-panel");
    if (!combo || !panel) return;
    const rect = combo.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom - 12;
    const above = rect.top - 12;
    const openUp = below < 280 && above > below;
    const available = Math.max(180, Math.min(380, openUp ? above : below));
    Object.assign(panel.style, {
      left: `${rect.left}px`,
      width: `${rect.width}px`,
      maxHeight: `${available}px`,
      top: openUp ? "auto" : `${rect.bottom + 4}px`,
      bottom: openUp ? `${window.innerHeight - rect.top + 4}px` : "auto"
    });
    root.classList.toggle("opens-up", openUp);
  }

  _focusSelectRow(root, index) {
    this._visibleRowInputs(root)[index]?.focus();
  }

  _scrollToSection(name) {
    const main = this.element.querySelector(".cr-main");
    const section = this.element.querySelector(`[data-section="${name}"]`);
    if (!main || !section) return;
    section.classList.remove("is-collapsed");
    const top = section.getBoundingClientRect().top - main.getBoundingClientRect().top + main.scrollTop - 16;
    main.scrollTo({
      top: Math.max(0, top),
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"
    });
    section.querySelector("input, .cr-combobox")?.focus({ preventScroll: true });
  }

  _updateActiveSection() {
    const main = this.element.querySelector(".cr-main");
    if (!main) return;
    const sections = Array.from(main.querySelectorAll(".cr-section"));
    const mainTop = main.getBoundingClientRect().top;
    const active = sections.reduce((current, section) => (
      section.getBoundingClientRect().top - mainTop <= 90 ? section : current
    ), sections[0]);
    for (const nav of this.element.querySelectorAll(".cr-nav-button")) {
      nav.classList.toggle("is-active", nav.dataset.section === active?.dataset.section);
    }
  }

  async _save() {
    this._refreshPropertyConflicts();
    if (this._hasErrors) {
      this._scrollToSection("properties");
      this._selectRoot("requiredProperties")?.querySelector(".cr-combobox")?.focus();
      return;
    }

    const config = {
      reductionPct: this.draft.reductionPct,
      allowedTypes: [...this.draft.allowedTypes],
      allowedSubtypes: [...this.draft.allowedSubtypes],
      requiredProperties: [...this.draft.requiredProperties],
      forbiddenProperties: [...this.draft.forbiddenProperties],
      propertyMatchMode: this.draft.propertyMatchMode
    };

    try {
      const currentItem = this.containerItem.parent?.items?.get(this.containerItem.id) ?? this.containerItem;
      await currentItem.update(makeContainerConfigUpdate(config));
      const persistedItem = currentItem.parent?.items?.get(currentItem.id) ?? currentItem;
      if (!containerConfigMatches(persistedItem, config)) {
        throw new Error("Container configuration update completed without persisting the requested flags");
      }
      this.containerItem = persistedItem;
    } catch (error) {
      LOG.error("Failed to save container configuration", {
        container: this.containerItem?.name,
        uuid: this.containerItem?.uuid,
        config,
        error
      });
      ui.notifications?.error(game.i18n.localize(`${MODULE_ID}.configDialog.saveFailed`));
      return;
    }

    this._initialSnapshot = this._snapshot();
    this._dirty = false;
    this._closingAfterSave = true;
    ui.notifications?.info(game.i18n.format(`${MODULE_ID}.configSet.notification`, {
      containerName: this.containerItem.name
    }));
    await this.close({ force: true });
  }
}

async function openReductionDialog(containerItem) {
  if (!containerItem) {
    ui.notifications?.error(game.i18n.localize(`${MODULE_ID}.reductionDialog.errorNoItem`));
    return;
  }
  const key = containerItem.uuid ?? `${containerItem.parent?.id}.${containerItem.id}`;
  const existing = OPEN_CONTAINER_RULE_APPS.get(key);
  if (existing?.rendered) {
    existing.bringToFront();
    return existing;
  }
  const app = new ContainerRulesApp(containerItem);
  OPEN_CONTAINER_RULE_APPS.set(key, app);
  app.addEventListener("close", () => OPEN_CONTAINER_RULE_APPS.delete(key), { once: true });
  await app.render({ force: true });
  return app;
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
