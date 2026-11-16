import test from "node:test";
import assert from "node:assert/strict";

test("public dialog opener returns a rendered and centered ApplicationV2", async () => {
  class ApplicationV2 {
    // Real ApplicationV2 declares tabGroups as a class field seeded from
    // `static TABS`, before any subclass constructor body runs.
    tabGroups = Object.entries(this.constructor.TABS ?? {})
      .reduce((groups, [id, { initial }]) => Object.assign(groups, { [id]: initial ?? null }), {});

    constructor(options) {
      this.id = options.id;
      this.position = options.position;
      this.rendered = false;
    }

    addEventListener() {}

    async render() {
      this.rendered = true;
      return this;
    }
  }

  globalThis.window = { innerWidth: 1770, innerHeight: 1329 };
  globalThis.CONFIG = {
    DND5E: {},
    Item: { typeLabels: {} }
  };
  globalThis.game = {
    i18n: {
      lang: "en",
      localize: key => key,
      format: key => key
    },
    system: { documentTypes: { Item: [] } },
    user: { isGM: true }
  };
  globalThis.foundry = {
    applications: {
      api: {
        ApplicationV2,
        HandlebarsApplicationMixin: Base => Base
      }
    }
  };

  const { openReductionDialog } = await import(
    "../scripts/ui/container-rules-app.js?position-regression"
  );
  const app = await openReductionDialog({
    id: "container",
    uuid: "Actor.actor.Item.container",
    name: "Container",
    flags: {},
    parent: { id: "actor" }
  });

  assert.equal(app.rendered, true);
  assert.equal(app.position.width, 880);
  assert.equal(app.position.height, 720);
  assert.equal(app.position.left, Math.round((window.innerWidth - app.position.width) / 2));
  assert.equal(app.position.top, Math.round((window.innerHeight - app.position.height) / 2));
});
