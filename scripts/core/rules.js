import { I18N, MODULE_ID } from "../constants.js";

export const RULE_SELECTION_NAMES = Object.freeze([
  "allowedTypes",
  "allowedSubtypes",
  "requiredProperties",
  "forbiddenProperties"
]);

export const RULE_CONFIG_KEYS = Object.freeze([
  "reductionPct",
  ...RULE_SELECTION_NAMES,
  "propertyMatchMode"
]);

export function normalizeToken(value) {
  return String(value ?? "").trim().toLowerCase();
}

export function parseTokenList(value) {
  if (Array.isArray(value)) {
    return value.map(normalizeToken).filter(Boolean);
  }
  return String(value ?? "")
    .split(/[,\n;]/)
    .map(normalizeToken)
    .filter(Boolean);
}

function uniqueTokens(value) {
  return Array.from(new Set(parseTokenList(value)));
}

export function normalizeReductionPct(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(100, Math.max(0, Math.round(parsed)));
}

export function getReductionPct(containerItem) {
  return normalizeReductionPct(containerItem?.flags?.[MODULE_ID]?.reductionPct ?? 0);
}

export function getItemPropertyTokens(itemData) {
  const properties = itemData?.system?.properties;
  const tokens = new Set();
  // dnd5e keeps properties in a Set; `toObject()` data carries them as an array.
  if (properties instanceof Set || Array.isArray(properties)) {
    for (const property of properties) tokens.add(normalizeToken(property));
  }
  tokens.delete("");
  return tokens;
}

export function getContainerRestrictions(containerItem) {
  const flags = containerItem?.flags?.[MODULE_ID] ?? {};
  return {
    allowedTypes: parseTokenList(flags.allowedTypes),
    allowedSubtypes: parseTokenList(flags.allowedSubtypes),
    requiredProperties: parseTokenList(flags.requiredProperties),
    forbiddenProperties: parseTokenList(flags.forbiddenProperties),
    propertyMatchMode: flags.propertyMatchMode === "any" ? "any" : "all"
  };
}

export function getContainerRuleConfig(containerItem) {
  return {
    reductionPct: getReductionPct(containerItem),
    ...getContainerRestrictions(containerItem)
  };
}

export function makeContainerConfigUpdate(config = {}) {
  return {
    [`flags.${MODULE_ID}.reductionPct`]: normalizeReductionPct(config.reductionPct),
    [`flags.${MODULE_ID}.allowedTypes`]: parseTokenList(config.allowedTypes),
    [`flags.${MODULE_ID}.allowedSubtypes`]: parseTokenList(config.allowedSubtypes),
    [`flags.${MODULE_ID}.requiredProperties`]: parseTokenList(config.requiredProperties),
    [`flags.${MODULE_ID}.forbiddenProperties`]: parseTokenList(config.forbiddenProperties),
    [`flags.${MODULE_ID}.propertyMatchMode`]: config.propertyMatchMode === "any" ? "any" : "all"
  };
}

export function containerConfigMatches(containerItem, config = {}) {
  const saved = getContainerRuleConfig(containerItem);
  const sameTokens = (left, right) => {
    const a = uniqueTokens(left).sort();
    const b = uniqueTokens(right).sort();
    return a.length === b.length && a.every((value, index) => value === b[index]);
  };
  return saved.reductionPct === normalizeReductionPct(config.reductionPct)
    && RULE_SELECTION_NAMES.every(name => sameTokens(saved[name], config[name]))
    && saved.propertyMatchMode === (config.propertyMatchMode === "any" ? "any" : "all");
}

function getItemMatchTokens(itemData, weaponTypeMap = {}) {
  const tokens = new Set();
  const add = value => {
    const token = normalizeToken(value);
    if (token) tokens.add(token);
  };

  add(itemData?.type);
  const typeData = itemData?.system?.type;
  if (typeData && typeof typeData === "object") {
    add(typeData.value);
    add(typeData.subtype);
    add(typeData.baseItem);
    add(typeData.identifier);
    add(weaponTypeMap[typeData.value]);
  }

  const attackType = itemData?.system?.attackType;
  add(typeof attackType === "function" ? null : attackType);
  // Properties are deliberately not subtype tokens: they have their own
  // required/forbidden rules, and letting them satisfy a subtype rule makes
  // any property key that happens to share a subtype's name slip through.
  return tokens;
}

export function validateContainerRestrictions(
  containerItem,
  itemData,
  { weaponTypeMap = {} } = {}
) {
  const restrictions = getContainerRestrictions(containerItem);
  if (!restrictions.allowedTypes.length
      && !restrictions.allowedSubtypes.length
      && !restrictions.requiredProperties.length
      && !restrictions.forbiddenProperties.length) {
    return { ok: true, restrictions };
  }

  const itemType = normalizeToken(itemData?.type);
  if (restrictions.allowedTypes.length
      && !restrictions.allowedTypes.includes(itemType)) {
    return { ok: false, reason: "type", restrictions };
  }

  const matchTokens = getItemMatchTokens(itemData, weaponTypeMap);
  if (restrictions.allowedSubtypes.length
      && !restrictions.allowedSubtypes.some(token => matchTokens.has(token))) {
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

/**
 * Built-in and third-party rule presets for containers.
 *
 * A preset is a partial config: only the keys it names are applied, so a
 * "quiver" preset can constrain contents without touching the weight
 * reduction the GM already dialled in.
 */
const BUILT_IN_PRESETS = [
  {
    id: "wc.bagOfHolding",
    label: `${I18N}.presets.bagOfHolding`,
    icon: "fa-solid fa-hat-wizard",
    config: { reductionPct: 100 }
  },
  {
    id: "wc.reducingBag",
    label: `${I18N}.presets.reducingBag`,
    icon: "fa-solid fa-feather",
    config: { reductionPct: 50 }
  },
  {
    id: "wc.quiver",
    label: `${I18N}.presets.quiver`,
    icon: "fa-solid fa-arrow-right",
    // dnd5e 5.x calls this consumable subtype `ammo`. Listing a speculative
    // `ammunition` alias alongside it does nothing except show up as a raw
    // token wherever the selection is rendered back as labels.
    config: { allowedTypes: ["consumable"], allowedSubtypes: ["ammo"] }
  },
  {
    id: "wc.potionBelt",
    label: `${I18N}.presets.potionBelt`,
    icon: "fa-solid fa-flask",
    config: { allowedTypes: ["consumable"], allowedSubtypes: ["potion"] }
  },
  {
    id: "wc.weaponRack",
    label: `${I18N}.presets.weaponRack`,
    icon: "fa-solid fa-khanda",
    config: { allowedTypes: ["weapon"] }
  },
  {
    id: "wc.mundaneOnly",
    label: `${I18N}.presets.mundaneOnly`,
    icon: "fa-solid fa-ban",
    config: { forbiddenProperties: ["mgc"] }
  },
  {
    id: "wc.clear",
    label: `${I18N}.presets.clear`,
    icon: "fa-solid fa-eraser",
    config: {
      reductionPct: 0,
      allowedTypes: [],
      allowedSubtypes: [],
      requiredProperties: [],
      forbiddenProperties: [],
      propertyMatchMode: "all"
    }
  }
];

const presetRegistry = new Map(BUILT_IN_PRESETS.map(preset => [preset.id, preset]));

/**
 * Add or replace a preset.
 * @param {Object} preset
 * @returns {boolean} whether it was accepted
 */
export function registerRulePreset(preset) {
  if (!preset?.id || !preset.config || typeof preset.config !== "object") return false;
  const config = {};
  for (const key of RULE_CONFIG_KEYS) {
    if (key in preset.config) config[key] = preset.config[key];
  }
  if (!Object.keys(config).length) return false;
  presetRegistry.set(preset.id, {
    id: preset.id,
    label: preset.label ?? preset.id,
    icon: preset.icon ?? "fa-solid fa-wand-magic-sparkles",
    config
  });
  return true;
}

export function unregisterRulePreset(id) {
  return presetRegistry.delete(id);
}

export function listRulePresets() {
  return Array.from(presetRegistry.values());
}

export function getRulePreset(id) {
  return presetRegistry.get(id) ?? null;
}
