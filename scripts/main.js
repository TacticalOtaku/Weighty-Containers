// ─────────────────────────────────────────────────────────
// Weighty Containers - Foundry VTT v14.363 / dnd5e 5.3.3
// ─────────────────────────────────────────────────────────

import {
  LBS_PER_KG,
  MODULE_ID,
  PREVIEW_BASE_WEIGHT
} from "./constants.js";
import {
  buildContainerIndex,
  computeActorCarriedLbs as computeActorCarriedLbsCore,
  computeAdjustedLoad as computeAdjustedLoadCore,
  getItem
} from "./core/containers.js";
import {
  getContainerRestrictions,
  normalizeToken,
  parseTokenList,
  validateContainerRestrictions as validateContainerRestrictionsCore
} from "./core/restrictions.js";
import {
  clamp,
  getCapacityLbs as resolveCapacityLbs,
  getReductionPct,
  isContainer,
  num
} from "./core/weight.js";
import { LOG } from "./foundry/logger.js";
import { WCSocket } from "./foundry/socket.js";
import { registerEnforcementHooks } from "./foundry/enforcement.js";
import { installDebugApi } from "./foundry/debug.js";
import {
  patchContainerDataGetters,
  registerEncumbrancePatch,
  registerModuleSettings
} from "./foundry/runtime.js";

const wcSocket = new WCSocket(LOG);

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

function lbsToDisplay(lbs) {
  return isMetricUnit() ? lbs / LBS_PER_KG : lbs;
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

function renderApplication(app, force = false) {
  if (!app?.rendered || typeof app.render !== "function") return;
  const ApplicationV2 = foundry.applications?.api?.ApplicationV2;
  if (ApplicationV2 && app instanceof ApplicationV2) return app.render({ force });
  return app.render(force);
}

// ══════════════════════ Container-specific Helpers ══════════════════════

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

function makeContainerConfigUpdate(config) {
  return {
    [`flags.${MODULE_ID}.reductionPct`]: clamp(Math.round(num(config.reductionPct, 0)), 0, 100),
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
  return getReductionPct(containerItem) === clamp(Math.round(num(config.reductionPct, 0)), 0, 100)
    && sameTokens(saved.allowedTypes, config.allowedTypes)
    && sameTokens(saved.allowedSubtypes, config.allowedSubtypes)
    && sameTokens(saved.requiredProperties, config.requiredProperties)
    && sameTokens(saved.forbiddenProperties, config.forbiddenProperties)
    && saved.propertyMatchMode === (config.propertyMatchMode === "any" ? "any" : "all");
}

function validateContainerRestrictions(containerItem, itemData) {
  return validateContainerRestrictionsCore(containerItem, itemData, {
    weaponTypeMap: CONFIG.DND5E?.weaponTypeMap ?? {}
  });
}

/**
 * dnd5e 5.3.x: system.capacity = { count, volume: {...}, weight: { value, units } }
 */
function getCapacityLbs(containerItem) {
  const capacityLbs = resolveCapacityLbs(containerItem, getSystemWeightUnit());
  if (capacityLbs == null) {
    LOG.debug("capacity not resolved", {
      item: containerItem?.name,
      capacity: containerItem?.system?.capacity
    });
  }
  return capacityLbs;
}

// ══════════════════════ Index & Load Calculation ══════════════════════

function computeAdjustedLoad(actor, containerId, idx = null, memo = null, visited = null) {
  return computeAdjustedLoadCore(actor, containerId, {
    includeNested: game.settings.get(MODULE_ID, "includeNested"),
    defaultUnit: getSystemWeightUnit(),
    index: idx,
    memo,
    visited,
    onCycle: cycleId => LOG.warn("Cycle detected", { containerId: cycleId })
  });
}

function computeActorCarriedLbs(actor) {
  return computeActorCarriedLbsCore(actor, {
    includeNested: game.settings.get(MODULE_ID, "includeNested"),
    defaultUnit: getSystemWeightUnit(),
    onCycle: containerId => LOG.warn("Cycle detected", { containerId })
  });
}

registerModuleSettings(LOG);

// ══════════════════════ Ready ══════════════════════

Hooks.once("ready", () => {
  wcSocket.register("notifyExceedRemote", _socketNotifyExceed);
  wcSocket.init();

  patchContainerDataGetters({
    logger: LOG,
    computeAdjustedLoad,
    getCapacityLbs,
    lbsToDisplay
  });
  registerEncumbrancePatch({
    logger: LOG,
    computeActorCarriedLbs,
    lbsToDisplay
  });
  registerEnforcementHooks({ logger: LOG, socket: wcSocket });
  _registerUIHooks();
  installDebugApi({
    computeActorCarriedLbs,
    computeAdjustedLoad,
    getCapacityLbs,
    lbsToDisplay,
    validateContainerRestrictions
  });

  LOG.info("ready", {
    system: game.system?.id,
    systemVersion: game.system?.version,
    foundryVersion: game.version
  });
});

// ══════════════════════ Socket Handlers ══════════════════════

function _socketNotifyExceed(data) {
  if (typeof data?.msg !== "string" || data.msg.length > 1000) {
    LOG.warn("Rejected invalid notification socket payload");
    return;
  }
  ui.notifications?.warn(data.msg);
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
      previewBefore: PREVIEW_BASE_WEIGHT,
      previewAfter: Math.max(0, PREVIEW_BASE_WEIGHT * (1 - this.draft.reductionPct / 100)).toLocaleString(game.i18n.lang, {
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
    const value = clamp(Math.round(num(target.value, 0)), 0, 100);
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
    const root = target.closest(".cr-multiselect");
    const name = root?.dataset.select;
    if (!name) return;
    const token = normalizeToken(target.value);
    const values = new Set(this.draft[name]);
    target.checked ? values.add(token) : values.delete(token);
    this._setSelection(name, Array.from(values));
  }

  _onLocalClick(event) {
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
      numeric.value = clamp(num(numeric.value, 0) + delta, 0, 100);
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
        : clamp(current + (event.key === "ArrowDown" ? 1 : -1), 0, visible.length - 1);
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
    const after = Math.max(0, PREVIEW_BASE_WEIGHT * (1 - this.draft.reductionPct / 100));
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
