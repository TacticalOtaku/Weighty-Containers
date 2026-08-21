import test from "node:test";
import assert from "node:assert/strict";

test("rule presentation exposes saved-value group preparation", async () => {
  globalThis.game = {
    i18n: { localize: key => key }
  };
  const { prepareRuleGroups } = await import("../scripts/ui/rule-presentation.js");
  const groups = [{
    key: "known",
    label: "Known",
    options: [{ value: "weapon", label: "Weapon" }]
  }];

  assert.deepEqual(prepareRuleGroups(groups, ["weapon", "custom"]), [
    groups[0],
    {
      key: "savedValues",
      label: "weighty-containers.configDialog.groups.savedValues",
      options: [{ value: "custom", label: "custom" }],
      saved: true,
      types: []
    }
  ]);
});

test("container rules window starts centered at its intended size", async () => {
  const { getCenteredWindowPosition } = await import("../scripts/ui/window-position.js");

  assert.deepEqual(getCenteredWindowPosition(1770, 1329), {
    width: 880,
    height: 720,
    left: 445,
    top: 305
  });
});

test("public dialog opener returns a rendered and centered ApplicationV2", async () => {
  class ApplicationV2 {
    constructor(options) {
      this.id = options.id;
      this.position = options.position;
      this.rendered = false;
    }

    addEventListener() {}

    async render(options) {
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
    system: { documentTypes: { Item: [] } }
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
