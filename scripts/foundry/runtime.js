import { LOG_LEVELS, MODULE_ID } from "../constants.js";
import { clamp, getReductionPct, num } from "../core/weight.js";

export function registerModuleSettings(logger) {
  Hooks.once("init", () => {
    game.settings.register(MODULE_ID, "enforceMode", {
      name: `${MODULE_ID}.enforceMode.name`,
      hint: `${MODULE_ID}.enforceMode.hint`,
      scope: "world",
      config: true,
      restricted: true,
      type: String,
      choices: {
        block: game.i18n.localize(`${MODULE_ID}.enforceMode.block`),
        warn: game.i18n.localize(`${MODULE_ID}.enforceMode.warn`)
      },
      default: "block"
    });
    game.settings.register(MODULE_ID, "includeNested", {
      name: `${MODULE_ID}.includeNested.name`,
      hint: `${MODULE_ID}.includeNested.hint`,
      scope: "world",
      config: true,
      restricted: true,
      type: Boolean,
      default: true
    });
    game.settings.register(MODULE_ID, "logLevel", {
      name: `${MODULE_ID}.logLevel.name`,
      hint: `${MODULE_ID}.logLevel.hint`,
      scope: "client",
      config: true,
      restricted: false,
      type: String,
      choices: Object.fromEntries(LOG_LEVELS.map(level => [
        level,
        game.i18n.localize(`${MODULE_ID}.logLevel.${level}`)
      ])),
      default: "warn",
      onChange: value => logger.setLevel(value)
    });
    game.settings.register(MODULE_ID, "logStacks", {
      name: `${MODULE_ID}.logStacks.name`,
      hint: `${MODULE_ID}.logStacks.hint`,
      scope: "client",
      config: true,
      restricted: false,
      type: Boolean,
      default: false,
      onChange: value => { logger.withStacks = value; }
    });
    game.settings.register(MODULE_ID, "logBufferLimit", {
      name: `${MODULE_ID}.logBufferLimit.name`,
      hint: `${MODULE_ID}.logBufferLimit.hint`,
      scope: "client",
      config: true,
      restricted: false,
      type: Number,
      default: 500,
      onChange: value => { logger.bufferLimit = Math.max(0, num(value, 500)); }
    });
    game.settings.register(MODULE_ID, "exceedMessageText", {
      name: `${MODULE_ID}.exceedMessageText.name`,
      hint: `${MODULE_ID}.exceedMessageText.hint`,
      scope: "client",
      config: true,
      restricted: false,
      type: String,
      default: ""
    });

    try {
      logger.setLevel(game.settings.get(MODULE_ID, "logLevel"));
      logger.withStacks = game.settings.get(MODULE_ID, "logStacks");
      logger.bufferLimit = Math.max(
        0,
        num(game.settings.get(MODULE_ID, "logBufferLimit"), 500)
      );
    } catch {}
    logger.info("init complete");
  });
}

export function patchContainerDataGetters({
  logger,
  computeAdjustedLoad,
  getCapacityLbs,
  lbsToDisplay
}) {
  const containerDataClass = CONFIG.Item.dataModels?.container;
  if (!containerDataClass) {
    logger.error("Could not find ContainerData class at CONFIG.Item.dataModels.container");
    logger.warn("Falling back to DOM-based patching");
    registerDOMFallback({
      computeAdjustedLoad,
      getCapacityLbs,
      lbsToDisplay
    });
    return;
  }

  const prototype = containerDataClass.prototype;
  const contentsDescriptor = Object.getOwnPropertyDescriptor(
    prototype,
    "contentsWeight"
  );
  if (contentsDescriptor?.get) {
    const originalContentsWeight = contentsDescriptor.get;
    Object.defineProperty(prototype, "contentsWeight", {
      get() {
        const rawValue = originalContentsWeight.call(this);
        const item = this.parent;
        if (!item || getReductionPct(item) === 0 || !item.parent) {
          return rawValue;
        }
        const adjustedLbs = computeAdjustedLoad(item.parent, item.id).load;
        const adjustedDisplay = Number(lbsToDisplay(adjustedLbs).toFixed(2));
        logger.trace("contentsWeight getter override", {
          container: item.name,
          raw: rawValue,
          adjusted: adjustedDisplay,
          reduction: getReductionPct(item)
        });
        return adjustedDisplay;
      },
      configurable: true,
      enumerable: contentsDescriptor.enumerable ?? true
    });
    logger.info("Patched ContainerData.contentsWeight getter");
  } else {
    logger.warn("contentsWeight getter not found on ContainerData prototype", {
      descriptor: contentsDescriptor,
      protoKeys: Object.getOwnPropertyNames(prototype)
    });
  }

  const totalDescriptor = Object.getOwnPropertyDescriptor(
    prototype,
    "totalWeight"
  );
  if (totalDescriptor?.get) {
    const originalTotalWeight = totalDescriptor.get;
    Object.defineProperty(prototype, "totalWeight", {
      get() {
        const item = this.parent;
        if (!item || getReductionPct(item) === 0) {
          return originalTotalWeight.call(this);
        }
        const ownWeight = num(this.weight?.value, 0) * num(this.quantity, 1);
        const contentsWeight = this.contentsWeight;
        const currencyWeight = num(this.currencyWeight, 0);
        const total = Number((
          ownWeight + contentsWeight + currencyWeight
        ).toFixed(2));
        logger.trace("totalWeight getter override", {
          container: item.name,
          own: ownWeight,
          contents: contentsWeight,
          currency: currencyWeight,
          total
        });
        return total;
      },
      configurable: true,
      enumerable: totalDescriptor.enumerable ?? true
    });
    logger.info("Patched ContainerData.totalWeight getter");
  } else {
    logger.debug("totalWeight getter not found — may not be needed");
  }
}

function registerDOMFallback({
  computeAdjustedLoad,
  getCapacityLbs,
  lbsToDisplay
}) {
  const onRender = (app, element) => {
    const root = element instanceof HTMLElement
      ? element
      : element?.[0] ?? element;
    if (!(root instanceof HTMLElement)) return;

    const item = app?.document ?? app?.item ?? app?.object;
    if (!(item instanceof Item)
        || item.type !== "container"
        || !item.parent
        || getReductionPct(item) === 0) {
      return;
    }

    const capacityLbs = getCapacityLbs(item);
    if (!capacityLbs) return;
    const loadDisplay = lbsToDisplay(
      computeAdjustedLoad(item.parent, item.id).load
    );
    const capacityDisplay = lbsToDisplay(capacityLbs);
    const percentage = capacityDisplay > 0
      ? clamp(Math.round((loadDisplay / capacityDisplay) * 100), 0, 100)
      : 0;

    const meter = root.querySelector('[role="meter"]');
    if (meter) {
      meter.setAttribute("aria-valuenow", String(loadDisplay.toFixed(2)));
      meter.setAttribute("aria-valuemax", String(capacityDisplay.toFixed(2)));
      const fill = meter.querySelector(".fill, .bar, [style]");
      if (fill) fill.style.width = `${percentage}%`;
    }

    const ratioPattern = /([0-9]+(?:[.,][0-9]+)?)\s*\/\s*([0-9]+(?:[.,][0-9]+)?)/;
    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT,
      null
    );
    let node;
    while ((node = walker.nextNode())) {
      const match = node.textContent.match(ratioPattern);
      if (!match) continue;
      const renderedMaximum = Number(match[2].replace(",", "."));
      if (Math.abs(renderedMaximum - capacityDisplay) >= 0.1) continue;
      node.textContent = node.textContent.replace(
        ratioPattern,
        `${loadDisplay.toFixed(2)} / ${capacityDisplay.toFixed(2)}`
      );
      break;
    }
  };

  Hooks.on("renderItemSheet", onRender);
  Hooks.on("renderContainerSheet", onRender);
}

export function registerEncumbrancePatch({
  logger,
  computeActorCarriedLbs,
  lbsToDisplay
}) {
  if (typeof libWrapper === "undefined") {
    logger.error("lib-wrapper not found!");
    return;
  }
  try {
    libWrapper.register(
      MODULE_ID,
      "CONFIG.Actor.documentClass.prototype.prepareDerivedData",
      function wcPrepareDerivedData(wrapped, ...args) {
        wrapped(...args);
        try {
          const encumbrance = this.system?.attributes?.encumbrance;
          if (!encumbrance) return;
          encumbrance.value = Number(
            lbsToDisplay(computeActorCarriedLbs(this)).toFixed(2)
          );
          encumbrance.pct = encumbrance.max > 0
            ? clamp(
              Math.round((encumbrance.value / encumbrance.max) * 100),
              0,
              100
            )
            : 0;
        } catch (error) {
          logger.error("Encumbrance patch failed", {
            actor: this?.name,
            error
          });
        }
      },
      "WRAPPER"
    );
    logger.info("libWrapper: Actor.prepareDerivedData patched");
  } catch (error) {
    logger.error("Failed to register libWrapper for Actor.prepareDerivedData", error);
  }
}
