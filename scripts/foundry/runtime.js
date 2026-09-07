import { LOG_LEVELS, MODULE_ID } from "../constants.js";
import { getReductionPct, num } from "../core/weight.js";
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
      default: true
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
export function patchContainerDataGetters({ logger }) {
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
  Object.defineProperty(prototype, `__${MODULE_ID}_patched`, {
    value: true,
    enumerable: false
  });
  logger.info("Patched ContainerData.contentsWeight getter");
  return true;
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
