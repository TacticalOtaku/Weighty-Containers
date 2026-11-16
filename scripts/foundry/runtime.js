import { I18N, LOG_LEVELS, MODULE_ID } from "../constants.js";
import { computeContainerLoadFromContents } from "../core/containers.js";
import { getReductionPct } from "../core/rules.js";
import { convertWeightToLbs, lbsToUnit } from "../core/weight.js";
import {
  CONTAINER_DATA_MODEL_PATH,
  getContainerDataModelClass,
  getSystemWeightUnit,
  getUnitConversionTable
} from "../integrations/dnd5e.js";
import { LOG } from "./logger.js";

export const NOTIFY_SCOPES = ["self", "selfAndGm", "everyone"];

/**
 * Theme for this module's own windows.
 * `auto` follows Foundry, which in turn can follow the operating system.
 */
export const THEMES = ["auto", "light", "dark"];

export const MODULE_SETTING_DEFAULTS = Object.freeze({
  enforceMode: "block",
  includeNested: true,
  notifyScope: "selfAndGm",
  theme: "auto",
  logLevel: "warn",
  logStacks: false,
  logBufferLimit: 500,
  exceedMessageText: ""
});

function parseNonNegativeInt(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/**
 * Read a module setting with a safe fallback to its canonical default when
 * Foundry globals are not ready or mocked partially in tests.
 */
export function getModuleSetting(key) {
  const fallback = MODULE_SETTING_DEFAULTS[key];
  try {
    const value = globalThis.game?.settings?.get?.(MODULE_ID, key);
    return value === undefined ? fallback : value;
  } catch {
    return fallback;
  }
}

export function setModuleSetting(key, value) {
  return globalThis.game?.settings?.set?.(MODULE_ID, key, value);
}

export function registerModuleSettings() {
  Hooks.once("init", () => {
    // i18n is initialised *after* the init hook, so localizing here would store
    // raw keys. Foundry localizes setting names, hints and choice labels when
    // it renders the settings form, so hand it keys and let it do that.
    game.settings.register(MODULE_ID, "enforceMode", {
      name: `${I18N}.enforceMode.name`,
      hint: `${I18N}.enforceMode.hint`,
      scope: "world",
      config: true,
      restricted: true,
      type: String,
      choices: {
        block: `${I18N}.enforceMode.block`,
        warn: `${I18N}.enforceMode.warn`
      },
      default: MODULE_SETTING_DEFAULTS.enforceMode
    });
    game.settings.register(MODULE_ID, "includeNested", {
      name: `${I18N}.includeNested.name`,
      hint: `${I18N}.includeNested.hint`,
      scope: "world",
      config: true,
      restricted: true,
      type: Boolean,
      default: MODULE_SETTING_DEFAULTS.includeNested,
      // Only the capacity bar (computed when a container sheet renders) and
      // enforcement read this; encumbrance always counts nested contents, so
      // no actor needs re-preparing - redrawing open container sheets is enough.
      onChange: () => {
        for (const app of foundry.applications?.instances?.values() ?? []) {
          if (app.document?.type === "container" && app.rendered) app.render();
        }
      }
    });
    game.settings.register(MODULE_ID, "notifyScope", {
      name: `${I18N}.notifyScope.name`,
      hint: `${I18N}.notifyScope.hint`,
      scope: "world",
      config: true,
      restricted: true,
      type: String,
      choices: Object.fromEntries(NOTIFY_SCOPES.map(scope => [
        scope,
        `${I18N}.notifyScope.${scope}`
      ])),
      default: MODULE_SETTING_DEFAULTS.notifyScope
    });
    game.settings.register(MODULE_ID, "theme", {
      name: `${I18N}.theme.name`,
      hint: `${I18N}.theme.hint`,
      scope: "client",
      config: true,
      restricted: false,
      type: String,
      choices: Object.fromEntries(THEMES.map(theme => [
        theme,
        `${I18N}.theme.${theme}`
      ])),
      default: MODULE_SETTING_DEFAULTS.theme,
      onChange: () => {
        for (const app of foundry.applications?.instances?.values() ?? []) {
          app.applyAnvilTheme?.();
        }
      }
    });
    game.settings.register(MODULE_ID, "logLevel", {
      name: `${I18N}.logLevel.name`,
      hint: `${I18N}.logLevel.hint`,
      scope: "client",
      config: true,
      restricted: false,
      type: String,
      choices: Object.fromEntries(LOG_LEVELS.map(level => [
        level,
        `${I18N}.logLevel.${level}`
      ])),
      default: MODULE_SETTING_DEFAULTS.logLevel,
      onChange: value => LOG.setLevel(value)
    });
    game.settings.register(MODULE_ID, "logStacks", {
      name: `${I18N}.logStacks.name`,
      hint: `${I18N}.logStacks.hint`,
      scope: "client",
      config: true,
      restricted: false,
      type: Boolean,
      default: MODULE_SETTING_DEFAULTS.logStacks,
      onChange: value => { LOG.withStacks = value; }
    });
    game.settings.register(MODULE_ID, "logBufferLimit", {
      name: `${I18N}.logBufferLimit.name`,
      hint: `${I18N}.logBufferLimit.hint`,
      scope: "client",
      config: true,
      restricted: false,
      type: Number,
      default: MODULE_SETTING_DEFAULTS.logBufferLimit,
      onChange: value => {
        LOG.bufferLimit = parseNonNegativeInt(value, MODULE_SETTING_DEFAULTS.logBufferLimit);
      }
    });
    // World scope: the text is shown to whoever the rejection is sent to, so
    // it has to be the GM's text, not whatever the acting player typed into
    // their own client settings.
    game.settings.register(MODULE_ID, "exceedMessageText", {
      name: `${I18N}.exceedMessageText.name`,
      hint: `${I18N}.exceedMessageText.hint`,
      scope: "world",
      config: true,
      restricted: true,
      type: String,
      default: MODULE_SETTING_DEFAULTS.exceedMessageText
    });

    LOG.setLevel(getModuleSetting("logLevel"));
    LOG.withStacks = Boolean(getModuleSetting("logStacks"));
    LOG.bufferLimit = parseNonNegativeInt(
      getModuleSetting("logBufferLimit"),
      MODULE_SETTING_DEFAULTS.logBufferLimit
    );
    LOG.info("init complete");
  });
}

/**
 * Install the ContainerData patch at `setup`: dnd5e has registered its data
 * models by then, and no world document has been prepared yet, so every
 * actor is prepared with the reduction from the start. Only if that fails is
 * it retried at `ready`, followed by a one-off re-preparation of the actors.
 */
export function registerContainerPatch() {
  let patched = false;
  Hooks.once("setup", () => {
    patched = patchContainerDataGetters();
  });
  Hooks.once("ready", () => {
    if (patched) return;
    if (patchContainerDataGetters()) refreshPreparedActors();
  });
}

/**
 * Scale dnd5e's own contents weight by the container's reduction.
 */
export function patchContainerDataGetters({
  includeNested = () => getModuleSetting("includeNested") !== false
} = {}) {
  const containerDataClass = getContainerDataModelClass();
  if (!containerDataClass) {
    LOG.error(
      `Could not find ContainerData at ${CONTAINER_DATA_MODEL_PATH}. `
      + "Weight reduction will not be applied to sheets or encumbrance."
    );
    return false;
  }

  const prototype = containerDataClass.prototype;
  if (prototype[`__${MODULE_ID}_patched`]) {
    LOG.debug("ContainerData already patched");
    return true;
  }

  const descriptor = Object.getOwnPropertyDescriptor(prototype, "contentsWeight");
  if (!descriptor?.get) {
    LOG.error("contentsWeight getter not found on ContainerData prototype", {
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
  patchComputeCapacity(prototype, { includeNested });
  Object.defineProperty(prototype, `__${MODULE_ID}_patched`, {
    value: true,
    enumerable: false
  });
  LOG.info("Patched ContainerData.contentsWeight getter");
  return true;
}

/**
 * Contents weight of a container counting sub-containers by their own weight
 * only, in the container's weight units, with its reduction applied. Delegates
 * to core load calculation so capacity bars never drift from enforcement.
 * @returns {number|Promise<number>}
 */
export function directContentsWeight(containerData) {
  const defaultUnit = getSystemWeightUnit();
  const unitTable = getUnitConversionTable();
  const units = containerData.weight?.units || defaultUnit;
  const currencyLbs = () => convertWeightToLbs(
    containerData.currencyWeight,
    units,
    defaultUnit,
    unitTable
  );
  const sum = contents => {
    const result = computeContainerLoadFromContents(containerData.parent, contents ?? [], {
      includeNested: false,
      defaultUnit,
      unitTable,
      currencyLbs
    });
    const loadLbs = result?.load ?? 0;
    return Math.max(0, Number(lbsToUnit(loadLbs, units, unitTable).toFixed(4)));
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
function patchComputeCapacity(prototype, { includeNested }) {
  const original = prototype.computeCapacity;
  if (typeof original !== "function") {
    LOG.debug("computeCapacity not found on ContainerData; capacity bar left as is");
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
 */
export function refreshPreparedActors() {
  let refreshed = 0;
  for (const actor of game.actors ?? []) {
    try {
      actor.reset();
      refreshed += 1;
    } catch (error) {
      LOG.warn("Could not refresh actor after patching", { actor: actor?.name, error });
    }
  }
  for (const token of game.scenes?.contents?.flatMap(scene => scene.tokens.contents) ?? []) {
    if (token.actorLink || !token.actor) continue;
    try { token.actor.reset(); } catch { /* one broken synthetic actor must not stop the others */ }
  }
  LOG.info("refreshed prepared actors", { refreshed });
  return refreshed;
}
