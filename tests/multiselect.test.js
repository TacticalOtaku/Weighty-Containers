import test from "node:test";
import assert from "node:assert/strict";

import { ContainerRulesMultiselectController } from "../scripts/ui/container-rules-multiselect.js";
import { ContainerRulesState } from "../scripts/ui/container-rules-state.js";

// The smallest DOM the controller needs: compound selectors (tag, .class,
// [attr], [attr="value"]) joined by descendant spaces, closest() and matches().
const camel = name => name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

class FakeElement {
  constructor(tag, { classes = [], attrs = {}, data = {} } = {}, children = []) {
    this.tag = tag;
    this.classSet = new Set(classes);
    this.attrs = { ...attrs };
    this.dataset = { ...data };
    this.hidden = false;
    this.checked = false;
    this.indeterminate = false;
    this.value = attrs.value ?? "";
    this.textContent = "";
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

  hasAttribute(name) {
    if (name.startsWith("data-")) return camel(name.slice(5)) in this.dataset;
    return name in this.attrs;
  }

  getAttribute(name) {
    if (name.startsWith("data-")) return this.dataset[camel(name.slice(5))] ?? null;
    return this.attrs[name] ?? null;
  }

  setAttribute(name, value) { this.attrs[name] = String(value); }

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

const h = (tag, options, children) => new FakeElement(tag, options, children);

function row(name, value, label) {
  return h("label", { classes: ["cr-option-row"], data: { search: `${label} ${value}`.toLowerCase() } }, [
    h("input", { attrs: { type: "checkbox", name, value } })
  ]);
}

function group(name, key, types, options) {
  return h("section", { classes: ["cr-option-group"], data: { group: key, types: types.join(" ") } }, [
    h("label", { classes: ["cr-option-group-header"] }, [
      h("input", { attrs: { type: "checkbox" }, data: { groupToggle: "true" } }),
      h("span", { classes: ["cr-group-count"] })
    ]),
    h("div", { classes: ["cr-option-group-items"] }, options.map(([value, label]) => row(name, value, label)))
  ]);
}

function multiselect(name, groups) {
  return h("div", { classes: ["cr-multiselect"], data: { select: name, placeholder: name } }, [
    h("div", { classes: ["cr-combobox"] }, [h("div", { data: { selection: "" } })]),
    h("div", { classes: ["cr-select-panel"] }, [
      h("input", { attrs: { type: "search" }, data: { selectSearch: "" } }),
      h("div", { classes: ["cr-options"] }, groups)
    ])
  ]);
}

function setup() {
  globalThis.game = { i18n: { localize: key => key, format: key => key } };
  const typeOptions = [["weapon", "Weapon"], ["consumable", "Consumable"]];
  const weaponOptions = [["simpleM", "Simple Melee"], ["martialR", "Martial Ranged"]];
  const consumableOptions = [["potion", "Potion"], ["ammo", "Ammunition"]];
  const catalogs = {
    allowedTypes: [{ label: "Types", options: typeOptions.map(([value, label]) => ({ value, label })) }],
    allowedSubtypes: [
      { key: "weaponTypes", label: "Weapons", types: ["weapon"], options: weaponOptions.map(([value, label]) => ({ value, label })) },
      { key: "consumableTypes", label: "Consumables", types: ["consumable"], options: consumableOptions.map(([value, label]) => ({ value, label })) }
    ],
    requiredProperties: [],
    forbiddenProperties: []
  };
  const element = h("form", {}, [
    multiselect("allowedTypes", [group("allowedTypes", "types", [], typeOptions)]),
    multiselect("allowedSubtypes", [
      group("allowedSubtypes", "weaponTypes", ["weapon"], weaponOptions),
      group("allowedSubtypes", "consumableTypes", ["consumable"], consumableOptions)
    ])
  ]);
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
  assert.deepEqual(controller.visibleRowInputs(subtypes).map(input => input.value), ["martialR"]);

  controller.bulkVisible("allowedSubtypes", true);
  assert.deepEqual(rules.allowedSubtypes, ["martialr"]);
});
