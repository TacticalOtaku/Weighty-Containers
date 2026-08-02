import test from "node:test";
import assert from "node:assert/strict";

test("Foundry entry module loads with the documented platform surface", async () => {
  class ApplicationV2 {}

  globalThis.CONFIG = {
    DND5E: {},
    Item: { dataModels: {}, typeLabels: {} },
    Actor: {}
  };
  globalThis.Hooks = {
    once() {},
    on() {}
  };
  globalThis.game = {
    settings: {
      get() { return false; },
      register() {}
    },
    i18n: {
      lang: "en",
      localize: key => key,
      format: key => key
    },
    system: { documentTypes: { Item: [] } }
  };
  globalThis.foundry = {
    utils: {
      escapeHTML: value => String(value)
    },
    applications: {
      api: {
        ApplicationV2,
        HandlebarsApplicationMixin: Base => Base,
        DialogV2: {}
      }
    }
  };
  globalThis.Item = class Item {};

  await assert.doesNotReject(() => import("../scripts/main.js?smoke"));
});
