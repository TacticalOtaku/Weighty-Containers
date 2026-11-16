import { I18N, MODULE_ID, PREVIEW_BASE_WEIGHT } from "../constants.js";
import {
  RULE_SELECTION_NAMES,
  containerConfigMatches,
  getRulePreset,
  listRulePresets,
  makeContainerConfigUpdate,
  normalizeReductionPct
} from "../core/rules.js";
import { notifyContainerRulesUpdated } from "../foundry/api.js";
import { getContainerRawPreviewWeight } from "../foundry/containers.js";
import { bypassOption } from "../foundry/enforcement.js";
import { LOG } from "../foundry/logger.js";
import { getModuleSetting, setModuleSetting } from "../foundry/runtime.js";
import { getWeightUnitLabel } from "../integrations/dnd5e.js";
import {
  ContainerRulesMultiselectController,
  escapeHtml,
  renderRuleMultiselect
} from "./container-rules-multiselect.js";
import { ContainerRulesState } from "./container-rules-state.js";

const OPEN_CONTAINER_RULE_APPS = new Map();

const DEFAULT_WINDOW_WIDTH = 880;
const DEFAULT_WINDOW_HEIGHT = 720;
const MIN_WINDOW_WIDTH = 360;
const MIN_WINDOW_HEIGHT = 440;
const VIEWPORT_MARGIN = 24;

function getCenteredWindowPosition(viewportWidth, viewportHeight) {
  const availableWidth = Math.max(MIN_WINDOW_WIDTH, viewportWidth - (VIEWPORT_MARGIN * 2));
  const availableHeight = Math.max(MIN_WINDOW_HEIGHT, viewportHeight - (VIEWPORT_MARGIN * 2));
  const width = Math.min(DEFAULT_WINDOW_WIDTH, availableWidth);
  const height = Math.min(DEFAULT_WINDOW_HEIGHT, availableHeight);

  return {
    width,
    height,
    left: Math.max(0, Math.round((viewportWidth - width) / 2)),
    top: Math.max(0, Math.round((viewportHeight - height) / 2))
  };
}

const RULE_TAB_GROUP = "primary";
const RULE_TABS = Object.freeze([
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

function ruleTabsConfig({ readOnly = false } = {}) {
  const tabs = RULE_TABS.filter(tab => !(readOnly && tab.gmOnly));
  return { tabs, initial: tabs[0]?.id };
}

/** DOM-safe window id. The uuid keeps two unlinked tokens of one actor apart. */
function rulesWindowId(containerItem) {
  const key = containerItem.uuid
    ?? `${containerItem.parent?.id ?? "world"}.${containerItem.id}`;
  return `${MODULE_ID}-rules-${String(key).replace(/[^A-Za-z0-9_-]/g, "-")}`;
}

const ContainerRulesApplication = foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2
);

class ContainerRulesApp extends ContainerRulesApplication {
  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-rules`,
    // `anvil` opts this window into the design system in styles/anvil.css.
    classes: ["container-rules", "anvil"],
    tag: "form",
    position: { width: DEFAULT_WINDOW_WIDTH, height: DEFAULT_WINDOW_HEIGHT },
    window: {
      icon: "fa-solid fa-gear",
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
      selectTab: ContainerRulesApp._selectTabAction,
      selectVisible: ContainerRulesApp._selectVisible,
      showUnavailable: ContainerRulesApp._showUnavailable,
      toggleSelect: ContainerRulesApp._toggleSelect,
      applyPreset: ContainerRulesApp._applyPreset,
      setTheme: ContainerRulesApp._setTheme
    }
  };

  /** Presentation only — icons for the three theme choices. */
  static THEME_ICONS = {
    auto: "fa-solid fa-circle-half-stroke",
    light: "fa-solid fa-sun",
    dark: "fa-solid fa-moon"
  };

  static PARTS = {
    content: {
      template: `modules/${MODULE_ID}/templates/container-rules.hbs`,
      // The window re-renders while it is open (another GM saving rules for
      // this container), and derived data is rebuilt each time. Naming the
      // scroller here lets Foundry put the pane back where the user left it.
      scrollable: [".cr-panes"]
    },
    footer: { template: `modules/${MODULE_ID}/templates/container-rules-footer.hbs` }
  };

  /** Tab configuration consumed by ApplicationV2's own tab machinery. */
  static TABS = {
    [RULE_TAB_GROUP]: { tabs: [...RULE_TABS], initial: RULE_TABS[0].id }
  };

  constructor(containerItem, options = {}) {
    const title = game.i18n.localize(`${I18N}.configDialog.title`);
    const centeredPosition = getCenteredWindowPosition(window.innerWidth, window.innerHeight);
    super({
      ...options,
      id: rulesWindowId(containerItem),
      position: { ...centeredPosition, ...options.position },
      window: { ...options.window, title }
    });
    this.containerItem = containerItem;
    // Players who own the actor may look at the rules that just rejected their
    // item; only a GM may change them.
    this.readOnly = options.readOnly ?? !game.user?.isGM;
    // ApplicationV2 seeds tabGroups from `static TABS` in a class field
    // initialiser, which runs before this body and cannot know who is looking.
    this.tabGroups[RULE_TAB_GROUP] = ruleTabsConfig({ readOnly: this.readOnly }).initial;
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
    this._paneScroll = 0;
    this._confirmingClose = null;
    this._documentHooks = [];
  }

  /**
   * Follow the container while the window is open: another GM may save rules
   * for it, or it may be deleted outright.
   */
  _watchDocument() {
    if (this._documentHooks.length) return;
    const isThisItem = item => item?.uuid && item.uuid === this.containerItem?.uuid;
    const onUpdate = (item, changes, options, userId) => {
      if (!isThisItem(item)) return;
      this.containerItem = item;
      if (userId === game.user?.id || !foundry.utils.hasProperty(changes, `flags.${MODULE_ID}`)) return;
      if (this._dirty) {
        ui.notifications?.warn(game.i18n.format(`${I18N}.configDialog.changedElsewhere`, {
          containerName: item.name
        }));
        return;
      }
      this.rules = ContainerRulesState.fromItem(item);
      this.multiselect.setRules(this.rules);
      this._initialSnapshot = this.rules.snapshot();
      this.render();
    };
    const onDelete = item => {
      if (isThisItem(item)) this.close({ force: true });
    };
    this._documentHooks = [
      ["updateItem", Hooks.on("updateItem", onUpdate)],
      ["deleteItem", Hooks.on("deleteItem", onDelete)]
    ];
  }

  _unwatchDocument() {
    for (const [name, id] of this._documentHooks) Hooks.off(name, id);
    this._documentHooks = [];
  }

  /**
   * What the reduction slider previews against.
   *
   * The container's real contents when they can be read, falling back to the
   * sample weight for an empty or compendium container.
   */
  _previewBasis() {
    const preview = getContainerRawPreviewWeight(this.containerItem);
    const unit = preview?.unit ?? getWeightUnitLabel(this.containerItem?.system?.weight?.units);
    if (preview && preview.raw > 0) return { base: preview.raw, unit, actual: true };
    return { base: PREVIEW_BASE_WEIGHT, unit, actual: false };
  }

  _formatWeight(value) {
    return Number(value).toLocaleString(game.i18n.lang, { maximumFractionDigits: 2 });
  }

  /** The stored preference, defaulting to following Foundry. */
  get theme() {
    return getModuleSetting("theme") ?? "auto";
  }

  /**
   * Pin the window to a theme, or let it follow Foundry.
   */
  applyAnvilTheme() {
    const root = this.element;
    if (!root) return;
    const theme = this.theme;
    if (theme === "light" || theme === "dark") root.dataset.avTheme = theme;
    else delete root.dataset.avTheme;
    for (const button of root.querySelectorAll("[data-action='setTheme']")) {
      button.setAttribute("aria-pressed", String(button.dataset.theme === theme));
    }
  }

  /**
   * A one-line description of what a preset actually sets.
   */
  _describePreset(config = {}) {
    const bits = [];
    if (typeof config.reductionPct === "number") {
      bits.push(`${config.reductionPct}%`);
    }
    for (const name of RULE_SELECTION_NAMES) {
      const values = config[name];
      if (!Array.isArray(values) || !values.length) continue;
      const named = this.rules.labelsFor(name, values).map(entry => entry.label);
      bits.push(named.slice(0, 2).join(", ") + (named.length > 2 ? ` +${named.length - 2}` : ""));
    }
    return bits.join(" · ");
  }

  /**
   * Presets are GM-only, so a player's window has two tabs, not three.
   */
  _getTabsConfig(group) {
    if (group !== RULE_TAB_GROUP) return super._getTabsConfig(group);
    return ruleTabsConfig({ readOnly: this.readOnly });
  }

  /** The tab currently shown, as ApplicationV2 records it. */
  get activeTab() {
    return this.tabGroups[RULE_TAB_GROUP];
  }

  async _prepareContext(options) {
    // With a single tab group, ApplicationV2 already puts `tabs` in here.
    const context = await super._prepareContext(options);
    const propertyGroups = this.rules.catalogs.requiredProperties;
    const preview = this._previewBasis();
    return {
      ...context,
      idPrefix: this.id,
      containerName: this.containerItem.name,
      readOnly: this.readOnly,
      themeOptions: ["auto", "light", "dark"].map(value => ({
        value,
        icon: ContainerRulesApp.THEME_ICONS[value],
        label: game.i18n.localize(`${I18N}.theme.${value}`),
        active: this.theme === value
      })),
      presets: this.readOnly ? [] : listRulePresets().map(preset => ({
        id: preset.id,
        icon: preset.icon,
        label: game.i18n.localize(preset.label),
        summary: this._describePreset(preset.config)
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
        idPrefix: this.id,
        groups: this.rules.catalogs.allowedTypes,
        selectedValues: this.rules.allowedTypes,
        placeholder: game.i18n.localize(`${I18N}.configDialog.anyTypes`)
      }),
      allowedSubtypesSelect: renderRuleMultiselect({
        name: "allowedSubtypes",
        idPrefix: this.id,
        groups: this.rules.catalogs.allowedSubtypes,
        selectedValues: this.rules.allowedSubtypes,
        placeholder: game.i18n.localize(`${I18N}.configDialog.anySubtypes`)
      }),
      requiredPropertiesSelect: renderRuleMultiselect({
        name: "requiredProperties",
        idPrefix: this.id,
        groups: propertyGroups,
        selectedValues: this.rules.requiredProperties,
        placeholder: game.i18n.localize(`${I18N}.configDialog.anyProperties`)
      }),
      forbiddenPropertiesSelect: renderRuleMultiselect({
        name: "forbiddenProperties",
        idPrefix: this.id,
        groups: this.rules.catalogs.forbiddenProperties,
        selectedValues: this.rules.forbiddenProperties,
        placeholder: game.i18n.localize(`${I18N}.configDialog.anyProperties`)
      })
    };
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    this._watchDocument();
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
    this.element.querySelector(".cr-panes")?.addEventListener("scroll", event => {
      this.multiselect.closeAll();
      // Remembered here rather than read back after a render: by then Foundry
      // has already clamped it against content that is still being drawn.
      this._paneScroll = event.currentTarget.scrollTop;
    }, { signal, passive: true });
    document.addEventListener("pointerdown", event => {
      if (!this.element?.contains(event.target)) this.multiselect.closeAll();
    }, { signal });
    window.addEventListener("resize", () => {
      this.multiselect.closeAll();
      this._positionTabMarker();
    }, { signal, passive: true });

    this.element.querySelector(".window-content")?.classList.add("anvil-ground");
    this.applyAnvilTheme();
    this._selectTab(this.activeTab, { focus: false });

    this._installDirtyIndicator();
    this._refreshAll();
    this._applyReadOnly();

    const panes = this.element.querySelector(".cr-panes");
    if (panes && this._paneScroll && panes.scrollTop !== this._paneScroll) {
      panes.scrollTop = this._paneScroll;
    }
    requestAnimationFrame(() => {
      if (this.element !== renderedElement || !renderedElement.isConnected) return;
      renderedElement.classList.add("cr-ready");
      this._motionReady = true;
      this._positionTabMarker();
    });
  }

  _onPosition(position) {
    super._onPosition(position);
    this.multiselect.closeAll();
    this._positionTabMarker();
  }

  async close(options = {}) {
    const force = typeof options === "boolean" ? options : options?.force;
    if (this._dirty && !force && !this._closingAfterSave) {
      // Escape, the header X and Cancel can all ask at once; one question is enough.
      if (this._confirmingClose) return this;
      this._confirmingClose = foundry.applications.api.DialogV2.confirm({
        classes: ["anvil", "wc-confirm"],
        render: (_event, dialog) => {
          // Share the client preference with the module's secondary window.
          dialog.applyAnvilTheme = () => {
            const theme = this.theme;
            if (theme === "light" || theme === "dark") dialog.element.dataset.avTheme = theme;
            else delete dialog.element.dataset.avTheme;
          };
          dialog.applyAnvilTheme();
        },
        window: { title: game.i18n.localize(`${I18N}.configDialog.unsaved.title`) },
        content: `<p>${escapeHtml(game.i18n.localize(`${I18N}.configDialog.unsaved.message`))}</p>`,
        yes: { label: game.i18n.localize(`${I18N}.configDialog.unsaved.discard`) },
        no: { label: game.i18n.localize(`${I18N}.configDialog.unsaved.continue`) },
        rejectClose: false
      });
      let confirmed;
      try {
        confirmed = await this._confirmingClose;
      } finally {
        this._confirmingClose = null;
      }
      if (!confirmed) return this;
    }
    this._listenersAbort?.abort();
    this._unwatchDocument();
    return super.close(options);
  }

  static async _onSubmit() {
    await this._save();
  }

  static _cancel() {
    return this.close();
  }

  static _clearSelect(event, target) {
    if (this.readOnly) return;
    this.multiselect.setSelection(target.dataset.selectName, []);
  }

  static _selectVisible(event, target) {
    if (this.readOnly) return;
    this.multiselect.bulkVisible(target.dataset.selectName, true);
  }

  static _deselectVisible(event, target) {
    if (this.readOnly) return;
    this.multiselect.bulkVisible(target.dataset.selectName, false);
  }

  static _removeSelection(event, target) {
    if (this.readOnly) return;
    const name = target.dataset.selectName;
    this.multiselect.removeSelection(name, target.dataset.token);
  }

  static _removeUnavailable() {
    if (this.readOnly) return;
    this.multiselect.removeUnavailableSubtypes();
  }

  static _resolveConflict(event, target) {
    if (this.readOnly) return;
    this.multiselect.resolvePropertyConflicts(target.dataset.keep);
  }

  static _selectTabAction(event, target) {
    this._selectTab(target.dataset.tab);
  }

  static _showUnavailable() {
    this.multiselect.showUnavailable();
  }

  static _toggleSelect(event, target) {
    this.multiselect.toggle(target.dataset.selectName);
  }

  static async _setTheme(event, target) {
    const theme = target.dataset.theme;
    if (!["auto", "light", "dark"].includes(theme) || theme === this.theme) return;
    await setModuleSetting("theme", theme);
    this.applyAnvilTheme();
  }

  static _applyPreset(event, target) {
    if (this.readOnly) return;
    const preset = getRulePreset(target.dataset.presetId);
    if (!preset) return;
    const touched = this.rules.applyConfig(preset.config);
    this.multiselect.syncInputs(touched);
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
    ui.notifications?.info(game.i18n.format(`${I18N}.presets.applied`, {
      preset: game.i18n.localize(preset.label)
    }));
  }

  /** Lock every control when a non-GM is looking at the rules. */
  _applyReadOnly() {
    if (!this.readOnly) return;
    this.element.classList.add("cr-readonly");
    // The tab bar, the theme switch and Close all stay live — a player still
    // needs to read every pane and shut the window. The lists stay openable
    // and searchable too, so a selection past the third chip can be read.
    const viewing = "[data-select-search], .cr-select-toggle, [data-action='showUnavailable']";
    for (const control of this.element.querySelectorAll(
      ".cr-hero input, .cr-panes input, .cr-panes button"
    )) {
      if (!control.matches(viewing)) control.disabled = true;
    }
    for (const combo of this.element.querySelectorAll(".cr-combobox")) {
      combo.setAttribute("aria-readonly", "true");
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
    const value = this.rules.setReductionPct(target.value);
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

    // The window is a <form>: Enter in the search box or the % field would
    // otherwise submit it, saving and closing mid-edit. Saving is the button
    // or Ctrl+S; Enter in the percentage just commits the typed value.
    if (event.key === "Enter" && event.target.matches?.('input:not([type="checkbox"]):not([type="radio"])')) {
      event.preventDefault();
      if (event.target.matches('[name="reductionPct"]')) {
        event.target.dispatchEvent(new Event("input", { bubbles: true }));
      }
      return;
    }

    const numeric = event.target.matches?.('[name="reductionPct"]') ? event.target : null;
    if (numeric && event.shiftKey && ["ArrowUp", "ArrowDown"].includes(event.key)) {
      event.preventDefault();
      const delta = event.key === "ArrowUp" ? 5 : -5;
      const current = Number(numeric.value);
      numeric.value = normalizeReductionPct((Number.isFinite(current) ? current : 0) + delta);
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
    this.multiselect.setPropertyError(this._hasErrors);
    for (const name of ["requiredProperties", "forbiddenProperties"]) {
      const error = this.element.querySelector(`[data-property-error="${name}"]`);
      if (!error) continue;
      error.hidden = !this._hasErrors;
      if (this._hasErrors) {
        error.innerHTML = `${escapeHtml(game.i18n.format(`${I18N}.configDialog.propertyConflict`, {
          properties: labels.join(", ")
        }))} <button type="button" data-action="resolveConflict" data-keep="${name}">${escapeHtml(
          game.i18n.localize(`${I18N}.configDialog.actions.moveHere`)
        )}</button>`;
      }
    }
    const save = this.element.querySelector("[data-save-button]");
    if (save) {
      save.disabled = this._hasErrors;
      save.querySelector("span").textContent = game.i18n.localize(
        `${I18N}.configDialog.${this._hasErrors ? "fixErrors" : "save"}`
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
    indicator.innerHTML = `<i class="fa-solid fa-circle" aria-hidden="true"></i><span>${escapeHtml(
      game.i18n.localize(`${I18N}.configDialog.changed`)
    )}</span>`;
    indicator.title = game.i18n.localize(`${I18N}.configDialog.changed`);
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

  /**
   * Show one pane and move the tab marker to it.
   */
  _selectTab(name, { focus = true } = {}) {
    const group = RULE_TAB_GROUP;
    const nav = this.element?.querySelector(
      `.tabs [data-group="${group}"][data-tab="${name}"]`
    );
    // changeTab throws when the tab is not in the DOM, which is the normal
    // case for a player asked to show the GM-only presets pane.
    if (!nav) return;

    this.changeTab(name, group, { force: true });

    // Core marks the nav with aria-pressed; these are role="tab" buttons, so
    // they need aria-selected and a single tab stop in the bar.
    for (const tab of this.element.querySelectorAll(`.cr-tab[data-group="${group}"]`)) {
      const active = tab.dataset.tab === name;
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
    }

    this.multiselect.closeAll();
    this._positionTabMarker();
    if (!focus) return;
    this.element
      .querySelector(`.cr-pane[data-tab="${name}"]`)
      ?.querySelector("input, .cr-combobox, button")
      ?.focus({ preventScroll: true });
  }

  _positionTabMarker() {
    const marker = this.element.querySelector(".cr-tab-marker");
    const active = this.element.querySelector(".cr-tab.active");
    if (!marker || !active) return;
    const bar = active.parentElement.getBoundingClientRect();
    const rect = active.getBoundingClientRect();
    marker.style.setProperty("--cr-marker-x", `${rect.left - bar.left}px`);
    marker.style.setProperty("--cr-marker-w", `${rect.width}px`);
  }

  async _save() {
    if (this.readOnly) return;
    this._refreshPropertyConflicts();
    if (this._hasErrors) {
      this._selectTab("properties");
      this.multiselect.focusSelect("requiredProperties");
      return;
    }

    const config = this.rules.toConfig();

    try {
      const currentItem = this.containerItem.parent?.items?.get(this.containerItem.id) ?? this.containerItem;
      // A GM editing rules must not be stopped by the rules: lowering a full
      // bag's reduction is a legitimate change, not an item being stuffed in.
      await currentItem.update(makeContainerConfigUpdate(config), bypassOption());
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
      ui.notifications?.error(game.i18n.localize(`${I18N}.configDialog.saveFailed`));
      return;
    }

    this._initialSnapshot = this.rules.snapshot();
    this._dirty = false;
    this._closingAfterSave = true;
    notifyContainerRulesUpdated(this.containerItem, config);
    ui.notifications?.info(game.i18n.format(`${I18N}.configSet.notification`, {
      containerName: this.containerItem.name
    }));
    await this.close({ force: true });
  }
}

export async function openReductionDialog(containerItem, options = {}) {
  if (!containerItem) {
    ui.notifications?.error(game.i18n.localize(`${I18N}.reductionDialog.errorNoItem`));
    return;
  }
  const key = containerItem.uuid ?? `${containerItem.parent?.id}.${containerItem.id}`;
  const existing = OPEN_CONTAINER_RULE_APPS.get(key);
  if (existing?.rendered) {
    if (existing.minimized) await existing.maximize();
    existing.bringToFront();
    return existing;
  }
  const app = new ContainerRulesApp(containerItem, options);
  OPEN_CONTAINER_RULE_APPS.set(key, app);
  app.addEventListener("close", () => OPEN_CONTAINER_RULE_APPS.delete(key), { once: true });
  await app.render({ force: true });
  return app;
}
