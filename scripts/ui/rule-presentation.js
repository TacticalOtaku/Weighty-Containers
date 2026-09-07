import { MODULE_ID } from "../constants.js";
import {
  getContainerRestrictions,
  normalizeToken,
  parseTokenList
} from "../core/restrictions.js";
import { clamp, getReductionPct, num } from "../core/weight.js";
import {
  getItemDocumentTypes,
  getItemTypeLabels,
  getPropertyCatalogs,
  getSubtypeCatalogs,
  getValidPropertiesByItemType,
  isPhysicalItemType
} from "../integrations/dnd5e.js";

export function escapeHtml(value) {
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

// Presentation stays at the UI boundary; D&D5e configuration discovery is
// owned by the integration adapter.
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

// Only item types that can physically sit in a container are offered. Spells,
// classes and feats can never be put in a bag, and listing them buries the
// handful of types a GM actually wants.
export function getRuleItemTypeGroups() {
  const itemTypes = new Map();

  for (const type of valuesFromConfig(getItemDocumentTypes())) {
    if (isPhysicalItemType(type)) addOption(itemTypes, type, `TYPES.Item.${type}`);
  }
  for (const [type, label] of Object.entries(getItemTypeLabels())) {
    if (isPhysicalItemType(type)) addOption(itemTypes, type, label);
  }

  for (const type of ["weapon", "consumable", "equipment", "tool", "loot", "container"]) {
    addOption(itemTypes, type, `TYPES.Item.${type}`);
  }

  const options = Array.from(itemTypes, ([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label, game.i18n.lang));

  return [{ label: game.i18n.localize(`${MODULE_ID}.configDialog.groups.itemTypes`), options }];
}

export function getRuleSubtypeGroups() {
  const groups = [];
  const addGroup = ({ key, labelKey, types = [], values }) => {
    const options = optionsFromConfig(values);
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

  for (const catalog of getSubtypeCatalogs()) addGroup(catalog);

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

export function getRulePropertyGroups() {
  const groups = [];
  const seen = new Set();
  const addGroup = ({ key, labelKey, values }) => {
    const options = optionsFromConfig(values).filter(option => {
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

  for (const catalog of getPropertyCatalogs()) addGroup(catalog);

  for (const [itemType, properties] of Object.entries(getValidPropertiesByItemType())) {
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

export function prepareRuleGroups(groups, selectedValues) {
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

export function renderRuleMultiselect({ name, groups, selectedValues, placeholder }) {
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
        <label class="cr-option-row" data-search="${escapeHtml(`${option.label} ${value}`.toLocaleLowerCase())}">
          <input type="checkbox" name="${escapeHtml(name)}" value="${escapeHtml(value)}"
                 data-label="${escapeHtml(option.label)}"${checkedAttr(value)}>
          <span class="cr-checkbox-mark" aria-hidden="true"><i class="fas fa-check"></i></span>
          <span class="cr-option-label">${escapeHtml(option.label)}</span>
        </label>`;
    }).join("");
    return `
      <section class="cr-option-group" data-group="${escapeHtml(groupKey)}"
               data-types="${escapeHtml(groupTypes)}"${group.saved ? ' data-saved="true"' : ""}>
        <label class="cr-option-group-header">
          <input type="checkbox" data-group-toggle="true">
          <span class="cr-checkbox-mark" aria-hidden="true"><i class="fas fa-check"></i></span>
          <span>${escapeHtml(group.label)}</span>
          <span class="cr-group-count" aria-hidden="true"></span>
        </label>
        <div class="cr-option-group-items">${options}</div>
      </section>`;
  }).join("");

  return `
    <div class="cr-multiselect" data-select="${escapeHtml(name)}" data-placeholder="${escapeHtml(placeholder)}">
      <div class="cr-combobox" role="combobox" tabindex="0" aria-haspopup="listbox"
           aria-expanded="false" aria-controls="${panelId}">
        <div class="cr-selection" data-selection></div>
        <button type="button" class="cr-icon-button cr-select-clear" data-action="clearSelect"
                data-select-name="${escapeHtml(name)}" aria-label="${escapeHtml(game.i18n.localize(`${MODULE_ID}.configDialog.actions.clear`))}"
                title="${escapeHtml(game.i18n.localize(`${MODULE_ID}.configDialog.actions.clear`))}">
          <i class="fas fa-xmark"></i>
        </button>
        <button type="button" class="cr-icon-button cr-select-toggle" data-action="toggleSelect"
                data-select-name="${escapeHtml(name)}" aria-label="${escapeHtml(game.i18n.localize(`${MODULE_ID}.configDialog.actions.open`))}">
          <i class="fas fa-chevron-down"></i>
        </button>
      </div>
      <div id="${panelId}" class="cr-select-panel" role="listbox" aria-multiselectable="true"
           popover="manual" hidden>
        <div class="cr-select-toolbar">
          <label class="cr-search">
            <i class="fas fa-magnifying-glass" aria-hidden="true"></i>
            <input type="search" data-select-search autocomplete="off"
                   placeholder="${escapeHtml(game.i18n.localize(`${MODULE_ID}.configDialog.search`))}">
          </label>
          <div class="cr-select-actions">
            <button type="button" data-action="selectVisible" data-select-name="${escapeHtml(name)}">
              ${escapeHtml(game.i18n.localize(`${MODULE_ID}.configDialog.actions.selectVisible`))}
            </button>
            <button type="button" data-action="deselectVisible" data-select-name="${escapeHtml(name)}">
              ${escapeHtml(game.i18n.localize(`${MODULE_ID}.configDialog.actions.deselectVisible`))}
            </button>
            <button type="button" data-action="clearSelect" data-select-name="${escapeHtml(name)}">
              ${escapeHtml(game.i18n.localize(`${MODULE_ID}.configDialog.actions.clear`))}
            </button>
            <span class="cr-select-total" data-select-total></span>
          </div>
        </div>
        <div class="cr-options">${groupMarkup}</div>
        <div class="cr-select-result" data-select-result></div>
      </div>
    </div>`;
}

export function makeContainerConfigUpdate(config) {
  return {
    [`flags.${MODULE_ID}.reductionPct`]: clamp(Math.round(num(config.reductionPct, 0)), 0, 100),
    [`flags.${MODULE_ID}.allowedTypes`]: parseTokenList(config.allowedTypes),
    [`flags.${MODULE_ID}.allowedSubtypes`]: parseTokenList(config.allowedSubtypes),
    [`flags.${MODULE_ID}.requiredProperties`]: parseTokenList(config.requiredProperties),
    [`flags.${MODULE_ID}.forbiddenProperties`]: parseTokenList(config.forbiddenProperties),
    [`flags.${MODULE_ID}.propertyMatchMode`]: config.propertyMatchMode === "any" ? "any" : "all"
  };
}

export function containerConfigMatches(containerItem, config) {
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
