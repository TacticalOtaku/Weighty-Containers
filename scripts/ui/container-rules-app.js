import { MODULE_ID, PREVIEW_BASE_WEIGHT } from "../constants.js";
import {
  getRawContentsWeight,
  getWeightUnitLabel
} from "../integrations/dnd5e.js";
import { getRulePreset, listRulePresets } from "./rule-presets.js";
import { clamp, num } from "../core/weight.js";
import { notifyContainerRulesUpdated } from "../foundry/api.js";
import { LOG } from "../foundry/logger.js";
import {
  containerConfigMatches,
  escapeHtml,
  makeContainerConfigUpdate,
  renderRuleMultiselect
} from "./rule-presentation.js";
import { ContainerRulesState } from "./container-rules-state.js";
import { ContainerRulesMultiselectController } from "./container-rules-multiselect.js";
import {
  CONTAINER_RULES_WINDOW_SIZE,
  getCenteredWindowPosition
} from "./window-position.js";

const OPEN_CONTAINER_RULE_APPS = new Map();
const ContainerRulesApplication = foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2
);

class ContainerRulesApp extends ContainerRulesApplication {
  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-rules`,
    classes: ["container-rules"],
    tag: "form",
    position: { ...CONTAINER_RULES_WINDOW_SIZE },
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
      toggleSelect: ContainerRulesApp._toggleSelect,
      applyPreset: ContainerRulesApp._applyPreset
    }
  };

  static PARTS = {
    content: { template: `modules/${MODULE_ID}/templates/container-rules.hbs` },
    footer: { template: `modules/${MODULE_ID}/templates/container-rules-footer.hbs` }
  };

  constructor(containerItem, options = {}) {
    const title = game.i18n.localize(`${MODULE_ID}.configDialog.title`);
    const centeredPosition = getCenteredWindowPosition(window.innerWidth, window.innerHeight);
    super({
      ...options,
      id: `${MODULE_ID}-rules-${containerItem.parent?.id ?? "world"}-${containerItem.id}`,
      position: { ...centeredPosition, ...options.position },
      window: { ...options.window, title }
    });
    this.containerItem = containerItem;
    // Players who own the actor may look at the rules that just rejected their
    // item; only a GM may change them.
    this.readOnly = options.readOnly ?? !game.user?.isGM;
    this.rules = ContainerRulesState.fromItem(containerItem);
    this.multiselect = new ContainerRulesMultiselectController({
      rules: this.rules,
      getElement: () => this.element,
      animate: (...args) => this._animate(...args),
      onSelectionChange: () => {
        this._refreshPropertyConflicts();
        this._afterDraftChange();
      }
    });
    this._initialSnapshot = this.rules.snapshot();
    this._dirty = false;
    this._hasErrors = false;
    this._closingAfterSave = false;
    this._listenersAbort = null;
    this._motionReady = false;
  }

  /**
   * What the reduction slider previews against.
   *
   * The container's real contents when they can be read - a GM setting a bag
   * of holding wants to see "13.5 -> 6.8 lb", not an abstract sample - falling
   * back to the sample weight for an empty or compendium container.
   */
  _previewBasis() {
    const raw = getRawContentsWeight(this.containerItem);
    const unit = getWeightUnitLabel(this.containerItem?.system?.weight?.units);
    if (typeof raw === "number" && raw > 0) return { base: raw, unit, actual: true };
    return { base: PREVIEW_BASE_WEIGHT, unit, actual: false };
  }

  _formatWeight(value) {
    return Number(value).toLocaleString(game.i18n.lang, { maximumFractionDigits: 2 });
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const propertyGroups = this.rules.catalogs.requiredProperties;
    const preview = this._previewBasis();
    return {
      ...context,
      containerName: this.containerItem.name,
      readOnly: this.readOnly,
      presets: this.readOnly ? [] : listRulePresets().map(preset => ({
        id: preset.id,
        icon: preset.icon,
        label: game.i18n.localize(preset.label)
      })),
      reductionPct: this.rules.reductionPct,
      previewUnit: preview.unit,
      previewIsActual: preview.actual,
      previewBefore: this._formatWeight(preview.base),
      previewAfter: this._formatWeight(this.rules.previewAfter(preview.base)),
      modeAll: this.rules.propertyMatchMode === "all",
      modeAny: this.rules.propertyMatchMode === "any",
      allowedTypesSelect: renderRuleMultiselect({
        name: "allowedTypes",
        groups: this.rules.catalogs.allowedTypes,
        selectedValues: this.rules.allowedTypes,
        placeholder: game.i18n.localize(`${MODULE_ID}.configDialog.anyTypes`)
      }),
      allowedSubtypesSelect: renderRuleMultiselect({
        name: "allowedSubtypes",
        groups: this.rules.catalogs.allowedSubtypes,
        selectedValues: this.rules.allowedSubtypes,
        placeholder: game.i18n.localize(`${MODULE_ID}.configDialog.anySubtypes`)
      }),
      requiredPropertiesSelect: renderRuleMultiselect({
        name: "requiredProperties",
        groups: propertyGroups,
        selectedValues: this.rules.requiredProperties,
        placeholder: game.i18n.localize(`${MODULE_ID}.configDialog.anyProperties`)
      }),
      forbiddenPropertiesSelect: renderRuleMultiselect({
        name: "forbiddenProperties",
        groups: this.rules.catalogs.forbiddenProperties,
        selectedValues: this.rules.forbiddenProperties,
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
      this.multiselect.closeAll();
      this._updateActiveSection();
    }, { signal, passive: true });
    document.addEventListener("pointerdown", event => {
      if (!this.element?.contains(event.target)) this.multiselect.closeAll();
    }, { signal });
    window.addEventListener("resize", () => this.multiselect.closeAll(), { signal, passive: true });

    this._installDirtyIndicator();
    this._refreshAll();
    this._applyReadOnly();
    requestAnimationFrame(() => {
      if (this.element !== renderedElement || !renderedElement.isConnected) return;
      renderedElement.classList.add("cr-ready");
      this._motionReady = true;
    });
  }

  _onPosition(position) {
    super._onPosition(position);
    this.multiselect.closeAll();
  }

  async close(options = {}) {
    const force = typeof options === "boolean" ? options : options?.force;
    if (this._dirty && !force && !this._closingAfterSave) {
      const confirmed = await foundry.applications.api.DialogV2.confirm({
        window: { title: game.i18n.localize(`${MODULE_ID}.configDialog.unsaved.title`) },
        content: `<p>${escapeHtml(game.i18n.localize(`${MODULE_ID}.configDialog.unsaved.message`))}</p>`,
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
    this.multiselect.setSelection(target.dataset.selectName, []);
  }

  static _selectVisible(event, target) {
    this.multiselect.bulkVisible(target.dataset.selectName, true);
  }

  static _deselectVisible(event, target) {
    this.multiselect.bulkVisible(target.dataset.selectName, false);
  }

  static _removeSelection(event, target) {
    const name = target.dataset.selectName;
    this.multiselect.removeSelection(name, target.dataset.token);
  }

  static _removeUnavailable() {
    this.multiselect.removeUnavailableSubtypes();
  }

  static _resolveConflict(event, target) {
    this.multiselect.resolvePropertyConflicts(target.dataset.keep);
  }

  static _scrollSection(event, target) {
    this._scrollToSection(target.dataset.section);
  }

  static _showUnavailable() {
    this.multiselect.showUnavailable();
  }

  static _toggleSection(event, target) {
    if (this.element.getBoundingClientRect().width >= 600) return;
    target.closest(".cr-section")?.classList.toggle("is-collapsed");
  }

  static _toggleSelect(event, target) {
    this.multiselect.toggle(target.dataset.selectName);
  }

  static _applyPreset(event, target) {
    if (this.readOnly) return;
    const preset = getRulePreset(target.dataset.presetId);
    if (!preset) return;
    const touched = this.rules.applyConfig(preset.config);
    for (const name of touched) this.multiselect.syncSelection(name);
    for (const input of this.element.querySelectorAll(
      '[name="reductionPct"], [name="reductionRange"]'
    )) {
      input.value = this.rules.reductionPct;
    }
    const mode = this.element.querySelector(
      `[name="propertyMatchMode"][value="${this.rules.propertyMatchMode}"]`
    );
    if (mode) mode.checked = true;
    this._refreshAll();
    ui.notifications?.info(game.i18n.format(`${MODULE_ID}.presets.applied`, {
      preset: game.i18n.localize(preset.label)
    }));
  }

  /** Lock every control when a non-GM is looking at the rules. */
  _applyReadOnly() {
    if (!this.readOnly) return;
    this.element.classList.add("cr-readonly");
    for (const control of this.element.querySelectorAll("input, button")) {
      if (control.closest(".cr-nav")) continue;
      control.disabled = true;
    }
    for (const combo of this.element.querySelectorAll(".cr-combobox")) {
      combo.setAttribute("aria-disabled", "true");
      combo.setAttribute("tabindex", "-1");
    }
    this.element.querySelector("[data-save-button]")?.remove();
  }

  _onInput(event) {
    const target = event.target;
    if (target.matches("[data-select-search]")) {
      this.multiselect.applyFilter(target.closest(".cr-multiselect"));
      return;
    }
    if (!target.matches('[name="reductionPct"], [name="reductionRange"]')) return;
    const value = clamp(Math.round(num(target.value, 0)), 0, 100);
    this.rules.setReductionPct(value);
    for (const input of this.element.querySelectorAll('[name="reductionPct"], [name="reductionRange"]')) {
      if (input !== target) input.value = value;
    }
    this._refreshPreview();
    this._afterDraftChange();
  }

  _onChange(event) {
    const target = event.target;
    if (target.matches('[name="propertyMatchMode"]')) {
      this.rules.setPropertyMatchMode(target.value);
      this._afterDraftChange();
      return;
    }
    this.multiselect.handleChange(target);
  }

  _onLocalClick(event) {
    this.multiselect.handleLocalClick(event);
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

    this.multiselect.handleKeyDown(event);
  }

  _refreshAll() {
    this.multiselect.refreshAll();
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

  _refreshPropertyConflicts() {
    const conflicts = this.rules.propertyConflicts();
    this._hasErrors = conflicts.length > 0;
    const labels = this.rules.selectionLabels("requiredProperties")
      .filter(entry => conflicts.includes(entry.value))
      .map(entry => entry.label);
    for (const name of ["requiredProperties", "forbiddenProperties"]) {
      const root = this.multiselect.root(name);
      root?.classList.toggle("is-invalid", this._hasErrors);
      root?.querySelector(".cr-combobox")?.setAttribute("aria-invalid", String(this._hasErrors));
      const error = this.element.querySelector(`[data-property-error="${name}"]`);
      if (!error) continue;
      error.hidden = !this._hasErrors;
      if (this._hasErrors) {
        error.innerHTML = `${escapeHtml(game.i18n.format(`${MODULE_ID}.configDialog.propertyConflict`, {
          properties: labels.join(", ")
        }))} <button type="button" data-action="resolveConflict" data-keep="${name}">${escapeHtml(
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
    const { base } = this._previewBasis();
    const value = this.element.querySelector("[data-preview-after]");
    const formatted = this._formatWeight(this.rules.previewAfter(base));
    const changed = value?.textContent !== formatted;
    if (value) value.textContent = formatted;
    const range = this.element.querySelector('[name="reductionRange"]');
    range?.style.setProperty("--cr-range-progress", `${this.rules.reductionPct}%`);
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
    const lines = this.rules.summaryLines();
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
    const { restrictions: restrictionsCount, properties: propertyCount } = this.rules.counts();
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
    indicator.innerHTML = `<i class="fas fa-circle" aria-hidden="true"></i> ${escapeHtml(
      game.i18n.localize(`${MODULE_ID}.configDialog.changed`)
    )}`;
    indicator.hidden = true;
    this.window.header.insertBefore(indicator, this.window.controls ?? this.window.close);
  }

  _refreshDirtyState() {
    const wasDirty = this._dirty;
    this._dirty = this.rules.snapshot() !== this._initialSnapshot;
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
    if (this.readOnly) return;
    this._refreshPropertyConflicts();
    if (this._hasErrors) {
      this._scrollToSection("properties");
      this.multiselect.root("requiredProperties")?.querySelector(".cr-combobox")?.focus();
      return;
    }

    const config = this.rules.toConfig();

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

    this._initialSnapshot = this.rules.snapshot();
    this._dirty = false;
    this._closingAfterSave = true;
    notifyContainerRulesUpdated(this.containerItem, config);
    ui.notifications?.info(game.i18n.format(`${MODULE_ID}.configSet.notification`, {
      containerName: this.containerItem.name
    }));
    await this.close({ force: true });
  }
}

export async function openReductionDialog(containerItem, options = {}) {
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
  const app = new ContainerRulesApp(containerItem, options);
  OPEN_CONTAINER_RULE_APPS.set(key, app);
  app.addEventListener("close", () => OPEN_CONTAINER_RULE_APPS.delete(key), { once: true });
  await app.render({ force: true });
  return app;
}
