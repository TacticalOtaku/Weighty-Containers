import { MODULE_ID } from "../constants.js";

/**
 * Rule presets for the container dialog.
 *
 * A preset is a partial config: only the keys it names are applied, so a
 * "quiver" preset can constrain contents without touching the weight
 * reduction the GM already dialled in.
 *
 * Other modules extend the list through the public API:
 *
 *   game.modules.get("weighty-containers").api.registerRulePreset({
 *     id: "my-module.spell-satchel",
 *     label: "MYMODULE.SpellSatchel",
 *     icon: "fas fa-scroll",
 *     config: { allowedTypes: ["consumable"], allowedSubtypes: ["scroll"] }
 *   });
 *
 * @typedef {Object} RulePreset
 * @property {string} id
 * @property {string} label            Localization key or literal label.
 * @property {string} [icon]           Font Awesome classes.
 * @property {Object} config           Any subset of the rule config.
 */

const CONFIG_KEYS = [
  "reductionPct",
  "allowedTypes",
  "allowedSubtypes",
  "requiredProperties",
  "forbiddenProperties",
  "propertyMatchMode"
];

/** @type {RulePreset[]} */
const BUILT_IN = [
  {
    id: "wc.bagOfHolding",
    label: `${MODULE_ID}.presets.bagOfHolding`,
    icon: "fas fa-hat-wizard",
    config: { reductionPct: 100 }
  },
  {
    id: "wc.reducingBag",
    label: `${MODULE_ID}.presets.reducingBag`,
    icon: "fas fa-feather",
    config: { reductionPct: 50 }
  },
  {
    id: "wc.quiver",
    label: `${MODULE_ID}.presets.quiver`,
    icon: "fas fa-arrow-right",
    config: { allowedTypes: ["consumable"], allowedSubtypes: ["ammo", "ammunition"] }
  },
  {
    id: "wc.potionBelt",
    label: `${MODULE_ID}.presets.potionBelt`,
    icon: "fas fa-flask",
    config: { allowedTypes: ["consumable"], allowedSubtypes: ["potion"] }
  },
  {
    id: "wc.weaponRack",
    label: `${MODULE_ID}.presets.weaponRack`,
    icon: "fas fa-khanda",
    config: { allowedTypes: ["weapon"] }
  },
  {
    id: "wc.mundaneOnly",
    label: `${MODULE_ID}.presets.mundaneOnly`,
    icon: "fas fa-ban",
    config: { forbiddenProperties: ["mgc"] }
  },
  {
    id: "wc.clear",
    label: `${MODULE_ID}.presets.clear`,
    icon: "fas fa-eraser",
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

const registry = new Map(BUILT_IN.map(preset => [preset.id, preset]));

/**
 * Add or replace a preset.
 * @param {RulePreset} preset
 * @returns {boolean} whether it was accepted
 */
export function registerRulePreset(preset) {
  if (!preset?.id || !preset.config || typeof preset.config !== "object") return false;
  const config = {};
  for (const key of CONFIG_KEYS) {
    if (key in preset.config) config[key] = preset.config[key];
  }
  if (!Object.keys(config).length) return false;
  registry.set(preset.id, {
    id: preset.id,
    label: preset.label ?? preset.id,
    icon: preset.icon ?? "fas fa-wand-magic-sparkles",
    config
  });
  return true;
}

export function unregisterRulePreset(id) {
  return registry.delete(id);
}

/** @returns {RulePreset[]} */
export function listRulePresets() {
  return Array.from(registry.values());
}

export function getRulePreset(id) {
  return registry.get(id) ?? null;
}
