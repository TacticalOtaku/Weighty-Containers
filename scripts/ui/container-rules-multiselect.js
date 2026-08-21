import { MODULE_ID } from "../constants.js";
import { normalizeToken, parseTokenList } from "../core/restrictions.js";
import { clamp } from "../core/weight.js";
import { RULE_SELECTION_NAMES } from "./container-rules-state.js";
import { escapeHtml } from "./rule-presentation.js";

export class ContainerRulesMultiselectController {
  constructor({ rules, getElement, animate, onSelectionChange }) {
    this.rules = rules;
    this.getElement = getElement;
    this.animate = animate;
    this.onSelectionChange = onSelectionChange;
  }

  get element() {
    return this.getElement();
  }

  root(name) {
    return this.element?.querySelector?.(`.cr-multiselect[data-select="${name}"]`) ?? null;
  }

  setSelection(name, values) {
    if (!this.rules.setSelection(name, values)) return;
    this.syncSelection(name);
    this.onSelectionChange(name);
  }

  removeSelection(name, token) {
    if (!this.rules.removeSelection(name, token)) return;
    this.syncSelection(name);
    this.onSelectionChange(name);
  }

  removeUnavailableSubtypes() {
    this.rules.removeUnavailableSubtypes();
    this.syncSelection("allowedSubtypes");
    this.onSelectionChange("allowedSubtypes");
  }

  resolvePropertyConflicts(keep) {
    const changed = this.rules.resolvePropertyConflicts(keep);
    this.syncSelection(changed);
    this.onSelectionChange(changed);
  }

  syncSelection(name) {
    const root = this.root(name);
    const selected = new Set(this.rules.getSelection(name));
    for (const input of root?.querySelectorAll?.('.cr-option-row input[type="checkbox"]') ?? []) {
      input.checked = selected.has(normalizeToken(input.value));
    }
    this.refresh(root);
    if (name === "allowedTypes") {
      this.applyFilter(this.root("allowedSubtypes"));
      this.refreshSubtypeWarning();
    }
    if (name === "allowedSubtypes") this.refreshSubtypeWarning();
  }

  bulkVisible(name, checked) {
    const root = this.root(name);
    if (!root) return;
    const values = new Set(this.rules.getSelection(name));
    for (const input of this.visibleRowInputs(root)) {
      const token = normalizeToken(input.value);
      checked ? values.add(token) : values.delete(token);
    }
    this.setSelection(name, Array.from(values));
  }

  visibleRowInputs(root) {
    if (!root) return [];
    return Array.from(root.querySelectorAll('.cr-option-row input[type="checkbox"]'))
      .filter(input => (
        !input.closest(".cr-option-row").hidden
        && !input.closest(".cr-option-group").hidden
      ));
  }

  refreshAll() {
    for (const name of RULE_SELECTION_NAMES) this.refresh(this.root(name));
    this.applyFilter(this.root("allowedSubtypes"));
    this.refreshSubtypeWarning();
  }

  refresh(root) {
    if (!root) return;
    const name = root.dataset.select;
    const selected = new Set(this.rules.getSelection(name));
    const labels = this.rules.selectionLabels(name);
    const selection = root.querySelector("[data-selection]");
    const visibleLabels = labels.slice(0, 3);
    const chips = visibleLabels.map(({ value, label }) => `
      <button type="button" class="cr-chip" data-action="removeSelection"
              data-select-name="${escapeHtml(name)}" data-token="${escapeHtml(value)}"
              title="${escapeHtml(game.i18n.localize(`${MODULE_ID}.configDialog.actions.remove`))}">
        <span>${escapeHtml(label)}</span><i class="fas fa-xmark" aria-hidden="true"></i>
      </button>`).join("");
    const more = labels.length > 3
      ? `<span class="cr-chip cr-chip-more">+${labels.length - 3}</span>`
      : "";
    const placeholder = `<span class="cr-placeholder">${escapeHtml(root.dataset.placeholder)}</span>`;
    const mobile = `<span class="cr-mobile-selection">${escapeHtml(game.i18n.format(
      `${MODULE_ID}.configDialog.selectedCount`,
      { count: labels.length }
    ))}</span>`;
    const previousCount = Number(root.dataset.selectionCount ?? -1);
    selection.innerHTML = labels.length ? `${chips}${more}${mobile}` : placeholder;
    selection.title = labels.map(entry => entry.label).join(", ");
    root.dataset.selectionCount = String(labels.length);
    if (previousCount >= 0 && previousCount !== labels.length) {
      for (const [index, chip] of Array.from(selection.querySelectorAll(".cr-chip")).entries()) {
        this.animate(chip, [
          { opacity: .35, transform: "translateY(3px) scale(.96)" },
          { opacity: 1, transform: "translateY(0) scale(1)" }
        ], { delay: Math.min(index, 3) * 24 });
      }
    }

    const clear = root.querySelector(".cr-select-clear");
    if (clear) clear.hidden = selected.size === 0;
    const uniqueOptions = new Set(Array.from(
      root.querySelectorAll('.cr-option-row input[type="checkbox"]')
    ).map(input => normalizeToken(input.value)));
    const total = root.querySelector("[data-select-total]");
    if (total) total.textContent = game.i18n.format(`${MODULE_ID}.configDialog.selectedOf`, {
      selected: selected.size,
      total: uniqueOptions.size
    });
    const result = root.querySelector("[data-select-result]");
    if (result) result.textContent = game.i18n.format(
      `${MODULE_ID}.configDialog.selectedCount`,
      { count: selected.size }
    );

    for (const row of root.querySelectorAll(".cr-option-row")) {
      const input = row.querySelector('input[type="checkbox"]');
      row.classList.toggle("is-selected", input.checked);
      row.setAttribute("aria-selected", String(input.checked));
    }
    for (const group of root.querySelectorAll(".cr-option-group")) {
      this.refreshGroupState(group);
    }
  }

  refreshGroupState(group) {
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

  applyFilter(root) {
    if (!root) return;
    const query = normalizeToken(root.querySelector("[data-select-search]")?.value);
    const allowedTypes = new Set(this.rules.allowedTypes);
    const showUnavailable = root.classList.contains("show-unavailable");
    for (const group of root.querySelectorAll(".cr-option-group")) {
      const groupTypes = parseTokenList(group.dataset.types?.replaceAll(" ", ","));
      const typeAvailable = root.dataset.select !== "allowedSubtypes"
        || !allowedTypes.size
        || (!group.hasAttribute("data-saved") && (
          !groupTypes.length || groupTypes.some(type => allowedTypes.has(type))
        ));
      const allowHiddenSelection = showUnavailable && Array.from(
        group.querySelectorAll('.cr-option-row input[type="checkbox"]')
      ).some(input => input.checked);
      let visibleCount = 0;
      for (const row of group.querySelectorAll(".cr-option-row")) {
        const matchesSearch = !query || row.dataset.search.includes(query);
        row.hidden = !(matchesSearch && (
          typeAvailable || (allowHiddenSelection && row.querySelector("input").checked)
        ));
        if (!row.hidden) visibleCount += 1;
      }
      group.hidden = visibleCount === 0;
      group.classList.toggle("is-unavailable", !typeAvailable);
      this.refreshGroupState(group);
    }
  }

  refreshSubtypeWarning() {
    const values = this.rules.unavailableSubtypeValues();
    const warning = this.element?.querySelector("[data-subtype-warning]");
    if (!warning) return;
    warning.hidden = values.length === 0;
    const text = warning.querySelector("[data-warning-text]");
    if (text) text.textContent = game.i18n.format(
      `${MODULE_ID}.configDialog.unavailableSubtypes`,
      { count: values.length }
    );
  }

  handleChange(target) {
    if (target.matches("[data-group-toggle]")) {
      const root = target.closest(".cr-multiselect");
      const group = target.closest(".cr-option-group");
      const name = root?.dataset.select;
      if (!name || !group) return true;
      const values = new Set(this.rules.getSelection(name));
      for (const input of group.querySelectorAll('.cr-option-row input[type="checkbox"]')) {
        const token = normalizeToken(input.value);
        target.checked ? values.add(token) : values.delete(token);
      }
      this.setSelection(name, Array.from(values));
      return true;
    }
    if (!target.matches('.cr-option-row input[type="checkbox"]')) return false;
    const root = target.closest(".cr-multiselect");
    const name = root?.dataset.select;
    if (!name) return true;
    const token = normalizeToken(target.value);
    const values = new Set(this.rules.getSelection(name));
    target.checked ? values.add(token) : values.delete(token);
    this.setSelection(name, Array.from(values));
    return true;
  }

  handleLocalClick(event) {
    const combo = event.target.closest(".cr-combobox");
    if (!combo || event.target.closest("button")) return false;
    const root = combo.closest(".cr-multiselect");
    root.classList.contains("is-open") ? this.close(root) : this.open(root);
    return true;
  }

  handleKeyDown(event) {
    if (event.key === "Escape") {
      const open = this.element?.querySelector(".cr-multiselect.is-open");
      if (!open) return false;
      event.preventDefault();
      event.stopPropagation();
      this.close(open);
      return true;
    }

    const combo = event.target.closest?.(".cr-combobox");
    if (combo && ["Enter", " ", "ArrowDown"].includes(event.key)) {
      event.preventDefault();
      const root = combo.closest(".cr-multiselect");
      if (!root.classList.contains("is-open")) this.open(root);
      if (event.key === "ArrowDown") this.focusRow(root, 0);
      return true;
    }

    const rowInput = event.target.matches?.('.cr-option-row input[type="checkbox"]')
      ? event.target
      : null;
    if (!rowInput || !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      return false;
    }
    event.preventDefault();
    const root = rowInput.closest(".cr-multiselect");
    const visible = this.visibleRowInputs(root);
    const current = visible.indexOf(rowInput);
    const index = event.key === "Home" ? 0
      : event.key === "End" ? visible.length - 1
        : clamp(current + (event.key === "ArrowDown" ? 1 : -1), 0, visible.length - 1);
    visible[index]?.focus();
    return true;
  }

  showUnavailable() {
    const root = this.root("allowedSubtypes");
    root?.classList.toggle("show-unavailable");
    this.applyFilter(root);
    if (root && !root.classList.contains("is-open")) this.open(root);
  }

  toggle(name) {
    const root = this.root(name);
    if (!root) return;
    root.classList.contains("is-open") ? this.close(root) : this.open(root);
  }

  open(root) {
    this.closeAll(root);
    root.classList.add("is-open");
    const panel = root.querySelector(".cr-select-panel");
    panel.hidden = false;
    try {
      panel.showPopover?.();
    } catch {
      panel.removeAttribute("popover");
    }
    root.querySelector(".cr-combobox")?.setAttribute("aria-expanded", "true");
    this.applyFilter(root);
    this.positionPanel(root);
    requestAnimationFrame(() => root.querySelector("[data-select-search]")?.focus());
  }

  close(root) {
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

  closeAll(except = null) {
    for (const root of this.element?.querySelectorAll?.(".cr-multiselect.is-open") ?? []) {
      if (root !== except) this.close(root);
    }
  }

  positionPanel(root) {
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

  focusRow(root, index) {
    this.visibleRowInputs(root)[index]?.focus();
  }
}
