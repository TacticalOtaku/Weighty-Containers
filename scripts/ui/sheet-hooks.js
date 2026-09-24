import { MODULE_ID } from "../constants.js";
import { LOG } from "../foundry/logger.js";
import { openReductionDialog } from "./container-rules-app.js";

/**
 * The rules button on dnd5e's container sheet.
 *
 * Re-rendering is left to dnd5e: `PhysicalItemTemplate#_renderContainers`
 * already redraws the actor sheet and every enclosing container when an item
 * inside one changes, and a container's own sheet redraws with its document.
 */
export function registerSheetUiHooks() {
  // ContainerSheet extends ItemSheet5e; ApplicationV2 fires the render hook
  // for every class in the chain, so the base class catches the container
  // sheet and any subclass another module registers for containers.
  Hooks.on("renderItemSheet5e", (app, element) => {
    try {
      ensureRulesButton(app, element);
    } catch (error) {
      LOG.error("Could not add the container rules button", error);
    }
  });
}

function ensureRulesButton(app, element) {
  const doc = app?.document;
  if (!(doc instanceof Item) || doc.type !== "container") return;

  // A GM configures the rules; anyone who owns the container may read them, so
  // a player can see why their bag just refused an item.
  const isGM = game.user.isGM;
  if (!isGM && !doc.isOwner) return;

  const root = element instanceof HTMLElement ? element : app.element;
  if (!(root instanceof HTMLElement) || root.querySelector(".wc-inline-gear")) return;

  const label = game.i18n.localize(`${MODULE_ID}.${isGM ? "configBtn.title" : "configBtn.view"}`);
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.tooltip = label;
  button.setAttribute("aria-label", label);
  button.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    openReductionDialog(doc, { readOnly: !isGM });
  });

  // The window frame survives part re-renders, so a header button is added
  // once and sits with Foundry's own header controls.
  const header = app.window?.header;
  if (header) {
    button.className = `header-control icon fa-solid ${isGM ? "fa-gear" : "fa-eye"} wc-inline-gear`;
    const anchor = [app.window.controls, app.window.close]
      .find(node => node?.parentElement === header) ?? null;
    header.insertBefore(button, anchor);
    return;
  }

  // Frameless (embedded) sheets: fall back to the sheet's own header.
  const sheetHeader = root.querySelector(".sheet-header");
  if (!sheetHeader) return;
  button.className = "wc-inline-gear";
  button.innerHTML = `<i class="fa-solid ${isGM ? "fa-gear" : "fa-eye"}" inert></i>`;
  sheetHeader.append(button);
}
