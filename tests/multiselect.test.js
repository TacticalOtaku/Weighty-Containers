import test from "node:test";
import assert from "node:assert/strict";

import {
  ContainerRulesMultiselectController,
  prepareRuleGroups,
  renderRuleMultiselect
} from "../scripts/ui/container-rules-multiselect.js";
import { ContainerRulesState } from "../scripts/ui/container-rules-state.js";

const camel = name => name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
const decodeEntities = text => text
  .replaceAll("&amp;", "&")
  .replaceAll("&lt;", "<")
  .replaceAll("&gt;", ">")
  .replaceAll("&quot;", "\"")
  .replaceAll("&#39;", "'");

const VOID_TAGS = new Set(["input", "br", "hr", "img", "meta", "link"]);

class FakeElement {
  constructor(tag, { classes = [], attrs = {}, data = {} } = {}, children = []) {
    this.tag = tag;
    this.classSet = new Set(classes);
    this.attrs = { ...attrs };
    this.dataset = { ...data };
    this.hidden = "hidden" in attrs;
    this.checked = "checked" in attrs;
    this.indeterminate = false;
    this.value = attrs.value ?? "";
    this.textContent = "";
    this.title = attrs.title ?? "";
    this.parent = null;
    this.children = children;
    for (const child of children) child.parent = this;
    this.classList = {
      contains: name => this.classSet.has(name),
      add: name => this.classSet.add(name),
      remove: name => this.classSet.delete(name),
      toggle: (name, force = !this.classSet.has(name)) => {
        if (force) this.classSet.add(name); else this.classSet.delete(name);
        return force;
      }
    };
  }

  appendChild(child) {
    child.parent = this;
    this.children.push(child);
    return child;
  }

  hasAttribute(name) {
    if (name.startsWith("data-")) return camel(name.slice(5)) in this.dataset;
    return name in this.attrs;
  }

  getAttribute(name) {
    if (name.startsWith("data-")) return this.dataset[camel(name.slice(5))] ?? null;
    return this.attrs[name] ?? null;
  }

  setAttribute(name, value) {
    this.attrs[name] = String(value);
  }

  matchesCompound(compound) {
    const tag = compound.match(/^[a-z]+/)?.[0];
    if (tag && tag !== this.tag) return false;
    for (const [, name] of compound.matchAll(/\.([\w-]+)/g)) if (!this.classSet.has(name)) return false;
    for (const [, name, , value] of compound.matchAll(/\[([\w-]+)(="([^"]*)")?\]/g)) {
      if (!this.hasAttribute(name)) return false;
      if (value !== undefined && this.getAttribute(name) !== value) return false;
    }
    return true;
  }

  matches(selector) {
    const parts = selector.trim().split(/\s+(?![^[]*\])/);
    if (!this.matchesCompound(parts.at(-1))) return false;
    let node = this.parent;
    for (let i = parts.length - 2; i >= 0; i -= 1) {
      while (node && !node.matchesCompound(parts[i])) node = node.parent;
      if (!node) return false;
      node = node.parent;
    }
    return true;
  }

  *descendants() {
    for (const child of this.children) {
      yield child;
      yield* child.descendants();
    }
  }

  querySelectorAll(selector) {
    return Array.from(this.descendants()).filter(node => node.matches(selector));
  }

  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }

  closest(selector) {
    let node = this;
    while (node && !node.matches(selector)) node = node.parent;
    return node;
  }
}

/**
 * Parse real rendered HTML from `renderRuleMultiselect` into `FakeElement` nodes
 * so selector/attribute leaks between rendering and DOM control fail here.
 */
function parseHtml(html) {
  const root = new FakeElement("form");
  const stack = [root];
  const tokenPattern = /<\/([a-z0-9-]+)>|<([a-z0-9-]+)([^>]*)>/gi;
  for (const match of html.matchAll(tokenPattern)) {
    if (match[1]) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const tag = match[2].toLowerCase();
    const rawAttrs = match[3] ?? "";
    const attrs = {};
    const data = {};
    for (const attr of rawAttrs.matchAll(/([a-z0-9-]+)(?:="([^"]*)")?/gi)) {
      const name = attr[1];
      const val = attr[2] === undefined ? "" : decodeEntities(attr[2]);
      if (name.startsWith("data-")) data[camel(name.slice(5))] = val;
      else attrs[name] = val;
    }
    const classes = (attrs.class ?? "").trim().split(/\s+/).filter(Boolean);
    const node = new FakeElement(tag, { classes, attrs, data });
    stack.at(-1).appendChild(node);
    if (!VOID_TAGS.has(tag)) stack.push(node);
  }
  return root;
}

function setup() {
  globalThis.foundry = { utils: {} };
  globalThis.game = { i18n: { localize: key => key, format: key => key } };
  const typeOptions = [["weapon", "Weapon"], ["consumable", "Consumable"]].map(([value, label]) => ({ value, label }));
  const weaponOptions = [["simpleM", "Simple Melee"], ["martialR", "Martial Ranged"]].map(([value, label]) => ({ value, label }));
  const consumableOptions = [["potion", "Potion"], ["ammo", "Ammunition"]].map(([value, label]) => ({ value, label }));
  const catalogs = {
    allowedTypes: [{ key: "types", label: "Types", options: typeOptions }],
    allowedSubtypes: [
      { key: "weaponTypes", label: "Weapons", types: ["weapon"], options: weaponOptions },
      { key: "consumableTypes", label: "Consumables", types: ["consumable"], options: consumableOptions }
    ],
    requiredProperties: [],
    forbiddenProperties: []
  };
  const element = parseHtml([
    renderRuleMultiselect({
      name: "allowedTypes",
      groups: catalogs.allowedTypes,
      selectedValues: [],
      placeholder: "allowedTypes"
    }),
    renderRuleMultiselect({
      name: "allowedSubtypes",
      groups: catalogs.allowedSubtypes,
      selectedValues: [],
      placeholder: "allowedSubtypes"
    })
  ].join(""));

  const rules = new ContainerRulesState({ draft: {}, catalogs });
  const changes = [];
  const controller = new ContainerRulesMultiselectController({
    rules,
    getElement: () => element,
    animate: () => {},
    onSelectionChange: name => changes.push(name)
  });
  controller.refreshAll();
  return { element, rules, controller, changes };
}

test("prepareRuleGroups adds savedValues group for unknown persisted tokens", () => {
  globalThis.game = { i18n: { localize: key => key } };
  const groups = [{
    key: "known",
    label: "Known",
    options: [{ value: "weapon", label: "Weapon" }]
  }];

  assert.deepEqual(prepareRuleGroups(groups, ["weapon", "custom"]), [
    groups[0],
    {
      key: "savedValues",
      label: "WC.configDialog.groups.savedValues",
      options: [{ value: "custom", label: "custom" }],
      saved: true,
      types: []
    }
  ]);
});

test("a group toggle selects every option of its group and nothing else", () => {
  const { element, rules, controller, changes } = setup();
  const weapons = element.querySelector('.cr-option-group[data-group="weaponTypes"]');
  const toggle = weapons.querySelector("[data-group-toggle]");

  toggle.checked = true;
  assert.equal(controller.handleChange(toggle), true);
  assert.deepEqual(rules.allowedSubtypes.sort(), ["martialr", "simplem"]);
  assert.deepEqual(changes, ["allowedSubtypes"]);
  assert.equal(weapons.querySelector(".cr-group-count").textContent, "2 / 2");
  assert.equal(element.querySelector('.cr-option-group[data-group="consumableTypes"] [data-group-toggle]').checked, false);
});

test("subtype groups that no selected type can hold are hidden", () => {
  const { element, controller } = setup();
  const typeInput = element.querySelector('input[value="weapon"]');

  typeInput.checked = true;
  controller.handleChange(typeInput);
  assert.equal(element.querySelector('.cr-option-group[data-group="weaponTypes"]').hidden, false);
  const consumables = element.querySelector('.cr-option-group[data-group="consumableTypes"]');
  assert.equal(consumables.hidden, true);
  assert.equal(consumables.classList.contains("is-unavailable"), true);
});

test("search narrows the rows, and bulk selection only takes what is visible", () => {
  const { element, rules, controller } = setup();
  const subtypes = controller.root("allowedSubtypes");
  subtypes.querySelector("[data-select-search]").value = "ranged";

  controller.applyFilter(subtypes);
  assert.equal(element.querySelector('.cr-option-group[data-group="consumableTypes"]').hidden, true);
  assert.deepEqual(controller.visibleRowInputs(subtypes).map(input => input.value), ["martialr"]);

  controller.bulkVisible("allowedSubtypes", true);
  assert.deepEqual(rules.allowedSubtypes, ["martialr"]);
});
