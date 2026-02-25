# 📦 Weighty Containers

A Foundry VTT module for the **dnd5e** system that adds weight reduction mechanics to containers, enforces capacity limits, and adjusts actor encumbrance calculations accordingly.

---

## ✨ Features

### Container Weight Reduction
Assign a **weight reduction percentage** (0–100%) to any container. Items stored inside will have their effective weight reduced by that amount when calculating encumbrance and container load.

**Example:** A *Bag of Holding* with 50% reduction containing 20 lb of items will only contribute 10 lb to the character's carried weight.

### Capacity Enforcement
When an item is added to a container, the module checks whether the container's weight capacity would be exceeded. Two modes are available:
- **Block** — the action is cancelled entirely
- **Warn** — a notification is shown but the action proceeds

Enforcement triggers on:
- Adding items to a container
- Increasing item quantity inside a container
- Increasing item weight inside a container
- Moving items between containers

### Nested Container Support
Optionally include the contents of nested containers when calculating a parent container's load. Each container applies its own reduction independently.

### Accurate Encumbrance
The module patches the actor's encumbrance calculation to reflect reduced container weights. The encumbrance bar on the character sheet displays the correct adjusted value.

### Native UI Integration
The container's capacity bar renders correct reduced values **natively** — no DOM hacking or visual artifacts. The module overrides computed data getters so the system template receives adjusted values before rendering.

---

## 📋 Requirements

| Component | Version |
|---|---|
| Foundry VTT | **v13** (verified 13.351) |
| dnd5e | **5.1.0 – 5.2.5** |
| [lib-wrapper](https://foundryvtt.com/packages/lib-wrapper) | **≥ 1.12.0.0** (required) |
| [socketlib](https://foundryvtt.com/packages/socketlib) | any (optional) |

---

## 🚀 Installation

### Method 1: Manifest URL
1. Open Foundry VTT → **Settings** → **Add-on Modules** → **Install Module**
2. Paste the manifest URL:
https://raw.githubusercontent.com/TacticalOtaku/Weighty-Containers/main/module.json
3. Click **Install**

### Method 2: Manual
1. Download the latest release from [GitHub Releases](https://github.com/TacticalOtaku/Weighty-Containers/releases)
2. Extract to `Data/modules/weighty-containers/`
3. Restart Foundry VTT

---

## 🎮 Usage

### Setting Up a Container

1. Open a container item sheet (any item with type "Container")
2. **GM only:** Click the ⚙ gear icon in the sheet header or the **Reduction** button in the title bar
3. Enter a reduction percentage (0–100%)
4. Click **Save**

The container's capacity bar will immediately reflect the reduced weight of its contents.

### Example Setup

| Container | Reduction | Contents | Raw Weight | Effective Weight |
|---|---|---|---|---|
| Backpack | 0% | 30 lb of gear | 30 lb | 30 lb |
| Bag of Holding | 50% | 40 lb of gear | 40 lb | 20 lb |
| Portable Hole | 100% | 100 lb of gear | 100 lb | 0 lb |

---

## ⚙ Settings

### World Settings (GM only)

| Setting | Description | Default |
|---|---|---|
| **Behavior on exceed** | Block or warn when a container would exceed capacity | Block |
| **Include nested containers** | Count nested container contents toward parent load | Enabled |

### Client Settings (per user)

| Setting | Description | Default |
|---|---|---|
| **Custom exceed notification** | Override the default capacity exceeded message | Empty (use default) |
| **Log level** | Diagnostic log verbosity (off/error/warn/info/debug/trace) | Warn |
| **Include stack traces** | Attach stack traces to log entries | Disabled |
| **Log buffer size** | Max log entries kept in memory | 500 |