import { MODULE_ID } from "../constants.js";
import { getItem } from "../core/containers.js";
import { isContainer } from "../core/weight.js";
import { LOG } from "../foundry/logger.js";
import { openReductionDialog } from "./container-rules-app.js";

function renderApplication(app, force = false) {
  if (!app?.rendered || typeof app.render !== "function") return;
  const ApplicationV2 = foundry.applications?.api?.ApplicationV2;
  if (ApplicationV2 && app instanceof ApplicationV2) return app.render({ force });
  return app.render(force);
}

export function registerSheetUiHooks() {
  const debounceTimers = new Map();
  const debouncedRender = (key, fn, delay = 100) => {
    clearTimeout(debounceTimers.get(key));
    debounceTimers.set(key, setTimeout(fn, delay));
  };

  // Inline gear only — no DOM capacity patching needed
  const onRender = (app, element) => {
    const el = element instanceof HTMLElement ? element : element?.[0] ?? element;
    if (el instanceof HTMLElement) {
      try { _ensureInlineGear(app, el); } catch (e) { LOG.error("Inline gear failed", e); }
    }
  };

  Hooks.on("renderItemSheet", onRender);
  Hooks.on("renderContainerSheet", onRender);
  Hooks.on("renderItemSheet5e", onRender);
  Hooks.on("renderContainerSheet5e", onRender);

  // Rerender on changes
  Hooks.on("updateItem", (item) => {
    const actor = item.parent;
    if (!actor) return;
    if (isContainer(item) || item.system?.container) {
      debouncedRender(`actor:${actor.id}`, () => {
        renderApplication(actor.sheet, false);
      });
    }
    if (isContainer(item)) {
      debouncedRender(`item:${item.id}`, () => {
        renderApplication(item.sheet, false);
      });
    }
    const cid = item.system?.container;
    if (cid) {
      const c = getItem(actor, cid);
      if (c?.sheet?.rendered) {
        debouncedRender(`item:${cid}`, () => renderApplication(c.sheet, false));
      }
    }
  });

  const onItemChange = (item) => {
    const actor = item.parent;
    if (!actor) return;
    const cid = item.system?.container;
    if (cid) {
      const c = getItem(actor, cid);
      debouncedRender(`item:${cid}`, () => renderApplication(c?.sheet, false));
    }
    debouncedRender(`actor:${actor.id}`, () => renderApplication(actor.sheet, false));
  };

  Hooks.on("createItem", onItemChange);
  Hooks.on("deleteItem", onItemChange);
}

function _ensureInlineGear(app, element) {
  const doc = app?.document ?? app?.item ?? app?.object;
  if (!(doc instanceof Item) || doc.type !== "container") return;

  // A GM configures the rules; anyone who owns the container may read them, so
  // a player can see why their bag just refused an item.
  const isGM = game.user.isGM;
  if (!isGM && !doc.isOwner) return;

  const header = element.querySelector(".sheet-header, header.sheet-header, .item-header, .window-header");
  if (!header) return;
  if (header.querySelector(".wc-inline-gear")) return;

  const label = game.i18n.localize(
    `${MODULE_ID}.${isGM ? "configBtn.title" : "configBtn.view"}`
  );
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "wc-inline-gear";
  btn.title = label;
  btn.setAttribute("aria-label", label);
  btn.innerHTML = `<i class="fas ${isGM ? "fa-cog" : "fa-eye"}" inert></i>`;
  btn.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    openReductionDialog(doc, { readOnly: !isGM });
  });

  const controls = header.querySelector(".header-controls, .controls, .toggles, .item-controls, .window-title");
  if (controls) controls.after(btn);
  else header.appendChild(btn);
}

