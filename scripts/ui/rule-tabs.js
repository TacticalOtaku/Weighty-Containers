import { MODULE_ID } from "../constants.js";

/**
 * The rules window's tabs. Shared by the window and the offline preview
 * fixture (tools/preview-ui.mjs), so the two cannot drift apart.
 */
export const RULE_TABS = Object.freeze([
  {
    id: "presets",
    icon: "fas fa-wand-magic-sparkles",
    labelKey: `${MODULE_ID}.presets.label`,
    gmOnly: true
  },
  {
    id: "restrictions",
    icon: "fas fa-shield-halved",
    labelKey: `${MODULE_ID}.configDialog.sections.restrictions`,
    badge: "restrictions"
  },
  {
    id: "properties",
    icon: "fas fa-tags",
    labelKey: `${MODULE_ID}.configDialog.sections.properties`,
    badge: "properties"
  }
]);

/**
 * @param {Object} options
 * @param {(key: string) => string} options.localize
 * @param {boolean} options.readOnly  Players do not get the GM-only tabs.
 * @param {string} options.activeTab
 */
export function buildRuleTabs({ localize, readOnly, activeTab }) {
  return RULE_TABS
    .filter(tab => !(readOnly && tab.gmOnly))
    .map(({ id, icon, labelKey, badge }) => ({
      id,
      icon,
      label: localize(labelKey),
      ...(badge ? { badge } : {}),
      active: id === activeTab
    }));
}
