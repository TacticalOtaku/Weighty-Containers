import { I18N } from "../constants.js";
import {
  RULE_SELECTION_NAMES,
  getContainerRuleConfig,
  normalizeReductionPct,
  normalizeToken,
  parseTokenList
} from "../core/rules.js";
import { getRuleCatalogs } from "../integrations/dnd5e.js";

export { RULE_SELECTION_NAMES };

export class ContainerRulesState {
  static fromItem(containerItem) {
    return new ContainerRulesState({
      draft: getContainerRuleConfig(containerItem),
      catalogs: getRuleCatalogs()
    });
  }

  constructor({ draft, catalogs }) {
    this.reductionPct = normalizeReductionPct(draft.reductionPct);
    this.allowedTypes = parseTokenList(draft.allowedTypes);
    this.allowedSubtypes = parseTokenList(draft.allowedSubtypes);
    this.requiredProperties = parseTokenList(draft.requiredProperties);
    this.forbiddenProperties = parseTokenList(draft.forbiddenProperties);
    this.propertyMatchMode = draft.propertyMatchMode === "any" ? "any" : "all";
    this.catalogs = catalogs;
  }

  setReductionPct(value) {
    this.reductionPct = normalizeReductionPct(value);
    return this.reductionPct;
  }

  setPropertyMatchMode(value) {
    this.propertyMatchMode = value === "any" ? "any" : "all";
  }

  getSelection(name) {
    return RULE_SELECTION_NAMES.includes(name) ? this[name] : [];
  }

  setSelection(name, values) {
    if (!RULE_SELECTION_NAMES.includes(name)) return false;
    this[name] = Array.from(new Set(parseTokenList(values)));
    return true;
  }

  removeSelection(name, token) {
    const normalized = normalizeToken(token);
    return this.setSelection(
      name,
      this.getSelection(name).filter(value => value !== normalized)
    );
  }

  labelsFor(name, tokens) {
    const labelMap = new Map();
    for (const group of this.catalogs[name] ?? []) {
      for (const option of group.options) {
        labelMap.set(normalizeToken(option.value), option.label);
      }
    }
    return parseTokenList(tokens).map(value => ({
      value,
      label: labelMap.get(value) ?? value
    }));
  }

  selectionLabels(name) {
    return this.labelsFor(name, this.getSelection(name));
  }

  unavailableSubtypeValues() {
    if (!this.allowedTypes.length) return [];
    const selectedTypes = new Set(this.allowedTypes);
    const available = new Set();
    for (const group of this.catalogs.allowedSubtypes ?? []) {
      const types = new Set((group.types ?? []).map(normalizeToken));
      if (types.size && !Array.from(types).some(type => selectedTypes.has(type))) continue;
      for (const option of group.options) available.add(normalizeToken(option.value));
    }
    return this.allowedSubtypes.filter(value => !available.has(value));
  }

  removeUnavailableSubtypes() {
    const unavailable = new Set(this.unavailableSubtypeValues());
    this.setSelection(
      "allowedSubtypes",
      this.allowedSubtypes.filter(value => !unavailable.has(value))
    );
  }

  propertyConflicts() {
    const forbidden = new Set(this.forbiddenProperties);
    return this.requiredProperties.filter(value => forbidden.has(value));
  }

  resolvePropertyConflicts(keep) {
    const removeFrom = keep === "requiredProperties"
      ? "forbiddenProperties"
      : "requiredProperties";
    const conflicts = new Set(this.propertyConflicts());
    this.setSelection(
      removeFrom,
      this.getSelection(removeFrom).filter(value => !conflicts.has(value))
    );
    return removeFrom;
  }

  /**
   * Apply a partial rule config, leaving anything it does not name alone.
   * @param {Object} config
   * @returns {string[]} the selection names that changed
   */
  applyConfig(config = {}) {
    const touched = [];
    if ("reductionPct" in config) this.setReductionPct(config.reductionPct);
    for (const name of RULE_SELECTION_NAMES) {
      if (!(name in config)) continue;
      this.setSelection(name, config[name]);
      touched.push(name);
    }
    if ("propertyMatchMode" in config) this.setPropertyMatchMode(config.propertyMatchMode);
    return touched;
  }

  previewAfter(baseWeight) {
    return Math.max(0, baseWeight * (1 - this.reductionPct / 100));
  }

  summaryLines(i18n = globalThis.game?.i18n) {
    const typeLabels = this.selectionLabels("allowedTypes").map(entry => entry.label);
    const subtypeLabels = this.selectionLabels("allowedSubtypes").map(entry => entry.label);
    const requiredLabels = this.selectionLabels("requiredProperties").map(entry => entry.label);
    const forbiddenLabels = this.selectionLabels("forbiddenProperties").map(entry => entry.label);
    const lines = [i18n.format(`${I18N}.configDialog.summary.reduction`, {
      pct: this.reductionPct
    })];
    lines.push(typeLabels.length
      ? i18n.format(`${I18N}.configDialog.summary.types`, { values: typeLabels.join(", ") })
      : i18n.localize(`${I18N}.configDialog.summary.anyTypes`));
    if (subtypeLabels.length) {
      lines.push(i18n.format(`${I18N}.configDialog.summary.subtypes`, {
        values: subtypeLabels.join(", ")
      }));
    }
    if (requiredLabels.length) {
      lines.push(i18n.format(
        `${I18N}.configDialog.summary.${this.propertyMatchMode === "any" ? "requiredAny" : "requiredAll"}`,
        { values: requiredLabels.join(", ") }
      ));
    }
    if (forbiddenLabels.length) {
      lines.push(i18n.format(`${I18N}.configDialog.summary.forbidden`, {
        values: forbiddenLabels.join(", ")
      }));
    }
    if (!requiredLabels.length && !forbiddenLabels.length) {
      lines.push(i18n.localize(`${I18N}.configDialog.summary.noProperties`));
    }
    return lines;
  }

  counts() {
    return {
      restrictions: this.allowedTypes.length + this.allowedSubtypes.length,
      properties: this.requiredProperties.length + this.forbiddenProperties.length
    };
  }

  snapshot() {
    return JSON.stringify({
      reductionPct: this.reductionPct,
      allowedTypes: [...this.allowedTypes].sort(),
      allowedSubtypes: [...this.allowedSubtypes].sort(),
      requiredProperties: [...this.requiredProperties].sort(),
      forbiddenProperties: [...this.forbiddenProperties].sort(),
      propertyMatchMode: this.propertyMatchMode
    });
  }

  toConfig() {
    return {
      reductionPct: this.reductionPct,
      allowedTypes: [...this.allowedTypes],
      allowedSubtypes: [...this.allowedSubtypes],
      requiredProperties: [...this.requiredProperties],
      forbiddenProperties: [...this.forbiddenProperties],
      propertyMatchMode: this.propertyMatchMode
    };
  }
}
