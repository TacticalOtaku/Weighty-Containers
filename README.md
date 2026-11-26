<div align="center">

**English** · [Русский](README.ru.md)

# Weighty Containers

**Container weight reduction, capacity enforcement, and item restriction rules for D&D 5e in Foundry VTT**

Configure bags that reduce content weight, quivers restricted to ammunition, or weapon racks filtered by item properties — enforced automatically and fed straight into native `dnd5e` encumbrance calculations.

[![Release](https://img.shields.io/github/v/release/TacticalOtaku/Weighty-Containers?style=flat-square&label=Release&color=b8860b)](https://github.com/TacticalOtaku/Weighty-Containers/releases/latest)
[![CI](https://img.shields.io/github/actions/workflow/status/TacticalOtaku/Weighty-Containers/ci.yml?branch=main&style=flat-square&label=CI)](https://github.com/TacticalOtaku/Weighty-Containers/actions/workflows/ci.yml)
[![Foundry VTT](https://img.shields.io/badge/Foundry_VTT-v14_%2814.367%29-ff6400?style=flat-square)](https://foundryvtt.com/)
[![D&D 5e](https://img.shields.io/badge/D%26D_5e-5.3.3%2B-c62828?style=flat-square)](https://github.com/foundryvtt/dnd5e)
[![Languages](https://img.shields.io/badge/Languages-EN_%7C_RU-2e7d32?style=flat-square)](lang/)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-3b82f6?style=flat-square)](LICENSE)

[Installation](#installation) · [Screenshots](#screenshots) · [Quick Start](#quick-start) · [Features](#features) · [How Rules Work](#how-rules-work) · [Settings](#module-settings) · [API](API.md) · [Development](#development)

</div>

---

## Installation

In Foundry VTT (**Setup → Add-on Modules → Install Module**), paste the **Manifest URL**:

```text
https://github.com/TacticalOtaku/Weighty-Containers/releases/latest/download/module.json
```

**Requirements:** Foundry VTT **14** (verified `14.367`), D&D 5e **`5.3.3+`**. **No required module dependencies** (`socketlib` `1.0.0+` is optional — native Foundry sockets are used when absent; `libWrapper` is not required).  
**Manual install:** Download `weighty-containers-v<version>.zip` from [GitHub Releases](https://github.com/TacticalOtaku/Weighty-Containers/releases/latest), extract it into `Data/modules/weighty-containers` (with `module.json` at its root), and enable **Weighty Containers** in your D&D 5e world.

---

## Screenshots

![Dark theme — presets](docs/preview/dark-880-presets.png)
![Light theme — properties](docs/preview/light-880-properties.png)

---

## Quick Start

1. Log in as **Gamemaster** and open a **Container** item sheet.
2. Click the gear button (**Container Rules**) in the sheet header next to window controls.
3. Set the weight reduction percentage (the preview uses live contents weight when available, or a sample weight otherwise).
4. Optionally apply a preset or configure type, subtype, and property restrictions.
5. Review the summary footer and click **Save**.

Capacity itself is configured in `dnd5e`'s native container fields; Weighty Containers builds on top of those settings. Owning players see an eye button to inspect active rules in read-only mode without modifying them.

---

## Features

- **Weight reduction from 0% to 100%:** Slider, numeric input, and live result preview.
- **Capacity enforcement:** Enforces weight and item-count limits defined on `dnd5e` containers.
- **Content restrictions:** Filter allowed item types, categories, and subtypes.
- **Property rules:** Required and forbidden `dnd5e` item properties, matching either all required properties or any one.
- **Nested containers:** Accounts for nested container contents when checking outer container capacity.
- **Built-in presets:** One-click setups for common fantasy containers.
- **Block or warn mode:** Choose whether violations block moves or warn, and who sees rejection notices.
- **Light & dark themes:** Windows follow the **Anvil** design system — neutral surfaces, brass-amber accents, keyboard navigation, reduced-motion support, and Auto / Light / Dark overrides per client.
- **Ergonomic editor:** Searchable multiselect lists, rule summary bar, conflict highlighting, and unsaved-changes guard.
- **Player read access:** Container owners can inspect active rules read-only; only GMs can edit them.

---

## Compatibility & Integrations

| Component                   | Compatibility                        | Behavior                                                                                                                                                                                  |
| --------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Foundry VTT**             | `14` (verified `14.367`)             | Uses native ApplicationV2 / Foundry sockets                                                                                                                                               |
| **D&D 5e system**           | `5.3.3+` (verified `5.3.3`)          | Designed exclusively for `dnd5e`; other systems are unsupported                                                                                                                           |
| **socketlib** _(optional)_  | `1.0.0+`                             | Used when present; falls back cleanly to native Foundry sockets                                                                                                                           |
| **Item Piles** _(optional)_ | With or without `Item Piles: D&D 5e` | Transfers, trades, and "Take All" validate in Item Piles pre-hooks before any item leaves the source; containers moved with contents weigh full; warn mode displays warnings and proceeds |

---

## How Rules Work

### Weight

Reduction scales the counted weight of the container's **contents**, never the container's own base weight. At 50% reduction, 20 lb of contents contribute 10 lb, added to the bag's own weight.

The module patches `dnd5e`'s `ContainerData#contentsWeight` getter, so capacity bars, container totals, and actor encumbrance all reflect the reduction natively. Nested reductions compound down the chain. Containers with `dnd5e`'s `weightlessContents` property (such as a Bag of Holding) contribute zero content weight to their carrier while still tracking their own internal capacity as on the `dnd5e` sheet.

Unit conversions follow `CONFIG.DND5E.weightUnits` (e.g., `1 kg = 2.5 lb` in metric `dnd5e` worlds). Container coins use the container's `weight.units`, while actor coins use the world display unit. See [API.md](API.md#weight) for calculation details.

### Content Restrictions

On the **Restrictions** tab, pick allowed item types and subtypes/categories. Available subtypes follow the selected types (including ammunition subtypes like arrows and bolts). Leaving a list empty imposes no restriction for that dimension. Item properties are checked strictly on the **Properties** tab and do not satisfy subtype rules.

### Properties

On the **Properties** tab, configure:

- **Required properties:** an item must carry either **all** listed properties or **at least one**, depending on the match mode.
- **Forbidden properties:** matching any single forbidden property rejects the item.

Saving is blocked with a clear conflict message if the same property is both required and forbidden.

### Built-in Presets

| Preset             | Changes applied                                                      |
| ------------------ | -------------------------------------------------------------------- |
| **Bag of Holding** | 100% content weight reduction                                        |
| **Half Weight**    | 50% content weight reduction                                         |
| **Quiver**         | Consumables with ammunition subtype                                  |
| **Potion Belt**    | Consumables with potion subtype                                      |
| **Weapon Rack**    | Weapon items only                                                    |
| **No Magic**       | Forbids the `mgc` property                                           |
| **Reset All**      | Clears reduction and restrictions; resets required match mode to All |

Presets only overwrite the fields they define (for example, applying **Quiver** preserves your existing weight reduction). Remember to click **Save** after applying a preset.

---

## Module Settings

Open Foundry **Module Settings → Weighty Containers**:

| Setting                       | Purpose                                                                                                                                      | Default                     |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| **Over-capacity behavior**    | Block violating actions or warn only                                                                                                         | Block                       |
| **Include nested containers** | Count nested container contents toward outer capacity (disabling weighs sub-containers by own weight only; actor encumbrance stays accurate) | Enabled                     |
| **Who sees rejections**       | Acting player only; acting player, owners & GMs; or everyone                                                                                 | Acting player, owners & GMs |
| **Window theme**              | Auto, Light, or Dark                                                                                                                         | Auto                        |
| **Custom exceed message**     | GM override for capacity rejection text (`{containerName}`, `{before}`, `{delta}`, `{capacity}`, `{unit}`)                                   | Default message             |
| **Log level**                 | Diagnostic verbosity in browser console                                                                                                      | Warnings                    |

---

## Developer API

Weighty Containers exposes **Public API v2** for querying load/capacity, validating restrictions, opening the rules window, and registering custom presets (see [API.md](API.md)):

```js
Hooks.once("weighty-containers.ready", (api) => {
  api.registerRulePreset({
    id: "my-module.scroll-case",
    label: "Scroll Case",
    icon: "fas fa-scroll",
    config: {
      allowedTypes: ["consumable"],
      allowedSubtypes: ["scroll"],
    },
  });
});
```

---

## Development

Requires **Node.js 24+** (vanilla ES modules, no build step needed). GitHub Actions ([ci.yml](.github/workflows/ci.yml)) runs linting, unit tests, and package validation on pushes and PRs; tagged releases (`v*`) publish the archive and `module.json` via [release.yml](.github/workflows/release.yml).

```bash
npm install
npm run check    # ESLint and node --test suite
npm run deploy   # Copy module into Foundry Data/modules/weighty-containers
npm run package  # Validate module.json and build dist/weighty-containers-v<version>.zip
npm run release  # Run check and package
```

### Project Docs

| Document                                                               | Purpose                                                            |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------ |
| [API.md](API.md)                                                       | Public API v2 methods, `getCarriedShare`, events, and v1 migration |
| [DESIGN.md](DESIGN.md)                                                 | Anvil design tokens, components, and porting guidelines            |
| [docs/architecture.md](docs/architecture.md)                           | Codebase architecture and module layering                          |
| [tests/manual/foundry-v14-smoke.md](tests/manual/foundry-v14-smoke.md) | Manual Foundry VTT 14 verification checklist                       |
| [CHANGELOG.md](CHANGELOG.md)                                           | Version-by-version release notes                                   |
| [CONTRIBUTING.md](CONTRIBUTING.md)                                     | Issue reporting guidelines                                         |

---

## AI Disclosure

AI-assisted tools were used during development for tasks such as code drafting, refactoring, tests, documentation, and localization drafts. All architecture, code, behavior, user-facing copy, and Russian/English translations are reviewed, tested, and maintained by **TacticalOtaku**, who retains sole authorship and responsibility for the module.

All bundled package assets and user-facing materials comply with Foundry VTT's [AI Content Policy](https://foundryvtt.com/article/ai-policy/) — no pre-generated AI art, audio, or lore assets are included.

---

## Feedback & License

Pull Requests are disabled on this repository. Please report bugs or suggest features via [GitHub Issues](https://github.com/TacticalOtaku/Weighty-Containers/issues) (see [CONTRIBUTING.md](CONTRIBUTING.md)) and include:

- Foundry VTT, D&D 5e, and Weighty Containers versions;
- reproduction steps, expected vs. actual behavior, and user role (GM/Player);
- container rules, affected items, weight units, and whether nested containers are involved;
- console errors and output from `weightyCont.dumpLog()`.

Released under the **GNU General Public License v3.0** ([LICENSE](LICENSE)).
