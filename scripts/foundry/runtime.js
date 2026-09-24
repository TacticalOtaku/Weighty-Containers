import { LOG_LEVELS, MODULE_ID } from "../constants.js";
import { convertWeightToLbs, lbsToUnit } from "../core/units.js";
import { getReductionPct, isContainer, num } from "../core/weight.js";
import {
  CONTAINER_DATA_MODEL_PATH,
  getContainerDataModelClass,
  installUnitConversion
} from "../integrations/dnd5e.js";

export const NOTIFY_SCOPES = ["self", "selfAndGm", "everyone"];

/**
 * Theme for this module's own windows.
 * `auto` follows Foundry, which in turn can follow the operating system.
 */
export const THEMES = ["auto", "light", "dark"];

export function registerModuleSettings(logger) {
  Hooks.once("init", () => {
    // i18n is initialised *after* the init hook, so localizing here would store
    // raw keys. Foundry localizes setting names, hints and choice labels when
    // it renders the settings form, so hand it keys and let it do that.
    game.settings.register(MODULE_ID, "enforceMode", {
      name: `${MODULE_ID}.enforceMode.name`,
      hint: `${MODULE_ID}.enforceMode.hint`,
      scope: "world",
      config: true,
      restricted: true,
      type: String,
      choices: {
        block: `${MODULE_ID}.enforceMode.block`,
        warn: `${MODULE_ID}.enforceMode.warn`
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
      default: true,
      // Container sheets read the setting when they draw the capacity bar.
      onChange: () => {
        for (const app of foundry.applications?.instances?.values() ?? []) {
          if (app.document?.type === "container" && app.rendered) app.render();
        }
      }
    });
    game.settings.register(MODULE_ID, "notifyScope", {
      name: `${MODULE_ID}.notifyScope.name`,
      hint: `${MODULE_ID}.notifyScope.hint`,
      scope: "world",
      config: true,
      restricted: true,
      type: String,
      choices: Object.fromEntries(NOTIFY_SCOPES.map(scope => [
        scope,
        `${MODULE_ID}.notifyScope.${scope}`
      ])),
      default: "selfAndGm"
    });
    game.settings.register(MODULE_ID, "theme", {
      name: `${MODULE_ID}.theme.name`,
      hint: `${MODULE_ID}.theme.hint`,
      scope: "client",
      config: true,
      restricted: false,
      type: String,
      choices: Object.fromEntries(THEMES.map(theme => [
        theme,
        `${MODULE_ID}.theme.${theme}`
      ])),
      default: "auto",
      onChange: () => {
        for (const app of foundry.applications?.instances?.values() ?? []) {
          app.applyAnvilTheme?.();
        }
      }
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
        `${MODULE_ID}.logLevel.${level}`
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
    // World scope: the text is shown to whoever the rejection is sent to, so
    // it has to be the GM's text, not whatever the acting player typed into
    // their own client settings.
    game.settings.register(MODULE_ID, "exceedMessageText", {
      name: `${MODULE_ID}.exceedMessageText.name`,
      hint: `${MODULE_ID}.exceedMessageText.hint`,
      scope: "world",
      config: true,
      restricted: true,
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

/**
 * Adopt dnd5e's weight conversion table once CONFIG.DND5E is populated.
 * Runs at `setup`, before any sheet or actor data is prepared for display.
 */
export function registerUnitConversion(logger) {
  const install = () => {
    if (installUnitConversion()) logger.info("weight conversion adopted from CONFIG.DND5E");
    else logger.warn("CONFIG.DND5E.weightUnits not found - using built-in conversion");
  };
  Hooks.once("setup", install);
  Hooks.once("ready", install);
}

/**
 * Install the ContainerData patch at `setup`: dnd5e has registered its data
 * models by then, and no world document has been prepared yet, so every
 * actor is prepared with the reduction from the start. Only if that fails is
 * it retried at `ready`, followed by a one-off re-preparation of the actors.
 */
export function registerContainerPatch(logger) {
  let patched = false;
  Hooks.once("setup", () => {
    patched = patchContainerDataGetters({ logger });
  });
  Hooks.once("ready", () => {
    if (patched) return;
    if (patchContainerDataGetters({ logger })) refreshPreparedActors(logger);
  });
}

/**
 * Scale dnd5e's own contents weight by the container's reduction.
 *
 * Everything else is left to the system: `contentsWeight` already walks
 * sub-containers, honours `weightlessContents`, adds carried currency and
 * returns the number in the container's own `weight.units`. Because
 * `ContainerData#totalWeight` is built on this getter, and the actor's
 * encumbrance is built on `totalWeightIn()`, patching this one place makes the
 * reduction show up on the capacity bar, the inventory row and the encumbrance
 * track at once - with no second implementation to drift out of sync.
 */
export function patchContainerDataGetters({ logger, includeNested = readIncludeNested }) {
  const containerDataClass = getContainerDataModelClass();
  if (!containerDataClass) {
    logger.error(
      `Could not find ContainerData at ${CONTAINER_DATA_MODEL_PATH}. `
      + "Weight reduction will not be applied to sheets or encumbrance."
    );
    return false;
  }

  const prototype = containerDataClass.prototype;
  if (prototype[`__${MODULE_ID}_patched`]) {
    logger.debug("ContainerData already patched");
    return true;
  }

  const descriptor = Object.getOwnPropertyDescriptor(prototype, "contentsWeight");
  if (!descriptor?.get) {
    logger.error("contentsWeight getter not found on ContainerData prototype", {
      protoKeys: Object.getOwnPropertyNames(prototype)
    });
    return false;
  }

  const original = descriptor.get;
  const scale = (value, reduction) => Math.max(
    0,
    Number(((Number(value) || 0) * (1 - reduction)).toFixed(4))
  );

  Object.defineProperty(prototype, "contentsWeight", {
    get() {
      const raw = original.call(this);
      const reduction = getReductionPct(this.parent) / 100;
      if (!reduction) return raw;
      // Compendium containers resolve their contents asynchronously.
      if (raw instanceof Promise) return raw.then(value => scale(value, reduction));
      return scale(raw, reduction);
    },
    configurable: true,
    enumerable: descriptor.enumerable ?? true
  });
  patchComputeCapacity(prototype, { logger, includeNested });
  Object.defineProperty(prototype, `__${MODULE_ID}_patched`, {
    value: true,
    enumerable: false
  });
  logger.info("Patched ContainerData.contentsWeight getter");
  return true;
}

function readIncludeNested() {
  try {
    return game.settings.get(MODULE_ID, "includeNested") !== false;
  } catch {
    return true;
  }
}

/**
 * Contents weight of a container counting sub-containers by their own weight
 * only, in the container's weight units, with its reduction applied. This is
 * what the module enforces when "Include nested containers" is off.
 * @returns {number|Promise<number>}
 */
export function directContentsWeight(containerData) {
  const units = containerData.weight?.units;
  const reduction = getReductionPct(containerData.parent) / 100;
  const sum = contents => {
    let total = Number(containerData.currencyWeight) || 0;
    for (const child of contents ?? []) {
      if (isContainer(child)) {
        const own = convertWeightToLbs(child.system?.weight?.value, child.system?.weight?.units, units);
        total += lbsToUnit(own, units || "lb");
      } else {
        total += Number(child.system?.totalWeightIn?.(units)) || 0;
      }
    }
    return Math.max(0, Number((total * (1 - reduction)).toFixed(4)));
  };
  const contents = containerData.contents;
  if (contents instanceof Promise) return contents.then(sum);
  return sum(contents);
}

/**
 * Keep dnd5e's capacity bar in step with enforcement when nested contents are
 * excluded. Encumbrance is left alone - the weight is still carried - only
 * the container's own "how full am I" reading changes.
 */
function patchComputeCapacity(prototype, { logger, includeNested }) {
  const original = prototype.computeCapacity;
  if (typeof original !== "function") {
    logger.debug("computeCapacity not found on ContainerData; capacity bar left as is");
    return;
  }
  prototype.computeCapacity = async function computeCapacityWithRules(...args) {
    const context = await original.apply(this, args);
    if (includeNested() || !context || this.capacity?.count || !this.capacity?.weight?.value) {
      return context;
    }
    const value = await directContentsWeight(this);
    context.value = Math.round(value * 10) / 10;
    context.pct = context.max
      ? Math.min(100, Math.max(0, (context.value / context.max) * 100))
      : 0;
    return context;
  };
}

/**
 * Recompute every actor once after the patch lands.
 *
 * Actor data is prepared during world load, before `ready`, so without this the
 * first thing a GM sees is the unreduced encumbrance until something happens to
 * touch the actor.
 */
export function refreshPreparedActors(logger) {
  let refreshed = 0;
  for (const actor of game.actors ?? []) {
    try {
      actor.reset();
      refreshed += 1;
    } catch (error) {
      logger.warn("Could not refresh actor after patching", { actor: actor?.name, error });
    }
  }
  for (const token of game.scenes?.contents?.flatMap(scene => scene.tokens.contents) ?? []) {
    if (token.actorLink || !token.actor) continue;
    try { token.actor.reset(); } catch {}
  }
  logger.info("refreshed prepared actors", { refreshed });
  return refreshed;
}
