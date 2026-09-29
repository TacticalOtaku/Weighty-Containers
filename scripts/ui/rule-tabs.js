import { I18N } from "../constants.js";

/**
 * The rules window's tabs, in the shape ApplicationV2's `static TABS` expects.
 *
 * `_prepareTabs` spreads everything except `id` and `cssClass` into the
 * prepared tab, so `icon`, `label` and `badge` reach the template untouched.
 * `label` stays an i18n key — core does not localize it, the template does.
 */
export const RULE_TAB_GROUP = "primary";

export const RULE_TABS = Object.freeze([
  {
    id: "presets",
    icon: "fa-solid fa-wand-magic-sparkles",
    label: `${I18N}.presets.label`,
    gmOnly: true
  },
  {
    id: "restrictions",
    icon: "fa-solid fa-shield-halved",
    label: `${I18N}.configDialog.sections.restrictions`,
    badge: "restrictions"
  },
  {
    id: "properties",
    icon: "fa-solid fa-tags",
    label: `${I18N}.configDialog.sections.properties`,
    badge: "properties"
  }
]);

/**
 * The tab configuration for one viewer.
 *
 * Players do not get the GM-only tabs, so `initial` has to be recomputed with
 * them removed — `changeTab` throws when asked for a tab that is not in the
 * DOM, and a player's window has no presets tab to land on.
 *
 * @param {Object} options
 * @param {boolean} options.readOnly
 * @returns {{tabs: Object[], initial: string|undefined}}
 */
export function ruleTabsConfig({ readOnly = false } = {}) {
  const tabs = RULE_TABS.filter(tab => !(readOnly && tab.gmOnly));
  return { tabs, initial: tabs[0]?.id };
}
