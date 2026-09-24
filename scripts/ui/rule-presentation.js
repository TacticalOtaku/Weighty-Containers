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
  const escape = globalThis.foundry?.utils?.escapeHTML;
  if (escape) return escape(text);
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

/**
 * Options of a catalog that are not already offered by an earlier group.
 * dnd5e's catalogs overlap (equipment types contain every armor type), and
 * the same checkbox twice in one list only reads as a bug.
 */
function takeUnseen(options, seen) {
  return options.filter(option => {
    if (seen.has(option.value)) return false;
    seen.add(option.value);
    return true;
  });
}

/** Nested subtype tables, e.g. consumableTypes.ammo.subtypes (arrow, bolt...). */
function nestedSubtypeGroups(catalog, seen) {
  const groups = [];
  if (!catalog.values || typeof catalog.values !== "object") return groups;
  for (const [parent, entry] of Object.entries(catalog.values)) {
    const subtypes = entry && typeof entry === "object" ? entry.subtypes : null;
    const options = takeUnseen(optionsFromConfig(subtypes), seen);
    if (!options.length) continue;
    groups.push({
      key: `${catalog.key}-${parent}`,
      label: localizeConfigLabel(entry.label, parent),
      options,
      types: catalog.types ?? []
    });
  }
  return groups;
}

export function getRuleSubtypeGroups() {
  const seen = new Set(["melee", "ranged"]);
  const groups = [{
    key: "weaponRange",
    label: game.i18n.localize(`${MODULE_ID}.configDialog.groups.weaponRange`),
    types: ["weapon"],
    options: [
      { value: "melee", label: game.i18n.localize(`${MODULE_ID}.configDialog.option.melee`) },
      { value: "ranged", label: game.i18n.localize(`${MODULE_ID}.configDialog.option.ranged`) }
    ]
  }];

  const nested = [];
  for (const catalog of getSubtypeCatalogs()) {
    const options = takeUnseen(optionsFromConfig(catalog.values), seen);
    if (options.length) groups.push({
      key: catalog.key,
      label: game.i18n.localize(`${MODULE_ID}.configDialog.groups.${catalog.labelKey}`),
      options,
      types: catalog.types ?? []
    });
    nested.push(catalog);
  }
  for (const catalog of nested) groups.push(...nestedSubtypeGroups(catalog, seen));

  return groups;
}

export function getRulePropertyGroups() {
  const groups = [];
  const seen = new Set();

  for (const catalog of getPropertyCatalogs()) {
    const options = takeUnseen(optionsFromConfig(catalog.values), seen);
    if (options.length) groups.push({
      key: catalog.key,
      label: game.i18n.localize(`${MODULE_ID}.configDialog.groups.${catalog.labelKey}`),
      options
    });
  }

  for (const [itemType, properties] of Object.entries(getValidPropertiesByItemType())) {
    const options = takeUnseen(optionsFromConfig(properties), seen);
    if (options.length) groups.push({
      key: `validProperties-${itemType}`,
      label: localizeConfigLabel(`TYPES.Item.${itemType}`, itemType),
      options
    });
  }

  return groups;
}

const RULE_GROUP_SOURCES = {
  allowedTypes: getRuleItemTypeGroups,
  allowedSubtypes: getRuleSubtypeGroups,
  requiredProperties: getRulePropertyGroups,
  forbiddenProperties: getRulePropertyGroups
};

/**
 * Human labels for stored rule tokens, e.g. `mgc` -> "Magical".
 * Unknown tokens, or a Foundry that is not ready yet, fall back to the token.
 * @param {string} name     One of the rule selection names.
 * @param {string[]} tokens
 * @returns {string[]}
 */
export function ruleTokenLabels(name, tokens) {
  const values = parseTokenList(tokens);
  let labels = new Map();
  try {
    for (const group of RULE_GROUP_SOURCES[name]?.() ?? []) {
      for (const option of group.options) {
        const key = normalizeToken(option.value);
        if (!labels.has(key)) labels.set(key, option.label);
      }
    }
  } catch {
    labels = new Map();
  }
  return values.map(value => labels.get(value) || value);
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

export function renderRuleMultiselect({ name, groups, selectedValues, placeholder, idPrefix = "wc" }) {
  const selected = new Set(parseTokenList(selectedValues));
  const allGroups = prepareRuleGroups(groups, selectedValues);
  // Several rules windows can be open at once; ids must not collide.
  const panelId = `${idPrefix}-${name}-options`;
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
           aria-expanded="false" aria-controls="${escapeHtml(panelId)}">
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
      <div id="${escapeHtml(panelId)}" class="cr-select-panel" role="listbox" aria-multiselectable="true"
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
        <div class="cr-options anvil-scroll">${groupMarkup}</div>
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
