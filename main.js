const MODULE_ID = 'weighty-containers';
const FLAG_WEIGHT_REDUCTION = 'weightReduction';
const SOCKET_NAME = `module.${MODULE_ID}`;
let libWrapper; // Variable for libWrapper

// --- Helper Functions ---

/**
 * Checks if an item is a container with weight-based capacity.
 * @param {Item | null | undefined} item - The item document.
 * @returns {boolean}
 */
function isActualWeightContainer(item) {
    if (!item || item.type !== 'container' || !item.system) return false;
    const hasWeightValue = typeof item.system.capacity?.weight?.value === 'number' && item.system.capacity.weight.value >= 0;
    const typeIsWeight = item.system.capacity?.type === 'weight';
    return hasWeightValue || typeIsWeight;
}

/**
 * Gets the weight reduction percentage for a container.
 * @param {Item | null | undefined} containerItem - The container item document.
 * @returns {number} Reduction percentage (0-100).
 */
function getWeightReductionPercent(containerItem) {
    if (!containerItem || typeof containerItem !== 'object' || containerItem.type !== 'container') return 0;
    let flagValue = undefined;
    try {
        flagValue = containerItem.getFlag(MODULE_ID, FLAG_WEIGHT_REDUCTION);
    } catch (e) {
        console.error(`${MODULE_ID} | Error calling getFlag for ${containerItem.name}:`, e);
        flagValue = foundry.utils.getProperty(containerItem, `flags.${MODULE_ID}.${FLAG_WEIGHT_REDUCTION}`);
    }
    return Number(flagValue) || 0;
}

/**
 * Returns weight display settings based on D&D 5e configuration.
 * @returns {{ multiplier: number, units: string, currencyWeight: boolean }}
 */
function getWeightDisplaySettings() {
    const DND5E = CONFIG.DND5E; // Cache D&D5e configuration for convenience

    // Determine if metric system is used.
    // "metricWeightSystem" is the correct setting key for D&D5e 3.x and newer.
    const isMetric = game.settings.get("dnd5e", "metricWeightSystem") ?? false;

    // Determine the multiplier for weight conversion.
    // If metric is used, apply the system's conversion multiplier. Otherwise, multiplier is 1.
    // Base item weights in D&D5e are typically in pounds.
    let systemMetricMultiplier = 0.5; // Default fallback, similar to original module's 1 pound ≈ 0.5 kg
    if (DND5E?.encumbrance && typeof DND5E.encumbrance.metricConversionMultiplier === 'number') {
        // This is often ~0.453592 for lbs to kg.
        systemMetricMultiplier = DND5E.encumbrance.metricConversionMultiplier;
    }
    // The 'multiplier' in this function's return value is used to convert the base weight
    // (assumed to be in pounds from item.system.weight) to the currently selected display units.
    // If the display is metric, we apply the conversion. If display is imperial, base weight is already in lbs.
    const multiplier = isMetric ? systemMetricMultiplier : 1;


    // Determine weight units for display
    let units = "";
    if (isMetric) {
        // 1. Try user-defined setting for metric units
        units = game.settings.get("dnd5e", "metricWeightUnits")?.trim();
        // 2. If not set, try system default metric units key from CONFIG.DND5E and localize it
        if (!units) {
            const configUnitKey = DND5E?.encumbrance?.metricWeightUnits; // This is a localization KEY (e.g., "DND5E.UnitKg")
            if (configUnitKey) {
                units = game.i18n.localize(configUnitKey);
                // If localization returns the key itself, it means the key wasn't found.
                if (units === configUnitKey) units = "";
            }
        }
        // 3. Absolute fallback if units are still not determined
        if (!units) {
            units = "kg";
        }
    } else { // Imperial units
        // 1. Try user-defined setting for imperial units
        units = game.settings.get("dnd5e", "imperialWeightUnits")?.trim();
        // 2. If not set, try system default imperial units key from CONFIG.DND5E and localize it
        if (!units) {
            const configUnitKey = DND5E?.encumbrance?.imperialWeightUnits; // This is a localization KEY (e.g., "DND5E.AbbreviationLbs")
            if (configUnitKey) {
                units = game.i18n.localize(configUnitKey);
                // If localization returns the key itself, it means the key wasn't found.
                if (units === configUnitKey) units = "";
            }
        }
        // 3. Absolute fallback if units are still not determined
        if (!units) {
            units = "lbs";
        }
    }

    // Get currency weight setting
    const currencyWeight = game.settings.get("dnd5e", "currencyWeight") ?? true;

    return { multiplier, units, currencyWeight };
}


/**
 * Calculates the effective weight of an item, considering container weight reduction and metric system.
 * @param {Item | null | undefined} item - The item to check.
 * @param {Actor | null | undefined} [actor=item?.actor] - The actor owning the item.
 * @param {boolean} [applyMetric=true] - Whether to apply the metric multiplier.
 * @returns {number} The effective weight of the item.
 */
function getEffectiveItemWeight(item, actor = item?.actor, applyMetric = true) {
    const weightSource = foundry.utils.getProperty(item, "system.weight");
    let baseWeight = 0;
    if (typeof weightSource === 'number' && !isNaN(weightSource)) {
        baseWeight = weightSource;
    } else if (typeof weightSource === 'string') {
        baseWeight = parseFloat(weightSource) || 0;
    } else if (typeof weightSource === 'object' && weightSource !== null && typeof weightSource.value === 'number') {
        baseWeight = Number(weightSource.value) || 0;
    } else {
        baseWeight = 0;
    }

    const containerId = foundry.utils.getProperty(item, "system.container");
    if (!actor || !containerId) {
        return applyMetric ? baseWeight * getWeightDisplaySettings().multiplier : baseWeight;
    }

    const container = actor.items.get(containerId);
    if (!container || !isActualWeightContainer(container)) {
        return applyMetric ? baseWeight * getWeightDisplaySettings().multiplier : baseWeight;
    }

    const reductionPercent = getWeightReductionPercent(container);
    if (reductionPercent <= 0) {
        return applyMetric ? baseWeight * getWeightDisplaySettings().multiplier : baseWeight;
    }

    const reductionMultiplier = Math.max(0, 1 - reductionPercent / 100);
    const effectiveWeightPreMetric = baseWeight * reductionMultiplier;

    if (isNaN(effectiveWeightPreMetric)) {
        console.error(`%c${MODULE_ID} | ERROR getEffectiveItemWeight: Calculation resulted in NaN! Item: ${item?.name}, BaseW: ${baseWeight}, ReductionMultiplier: ${reductionMultiplier}. Returning 0.`, "color: red; font-weight: bold;");
        return 0;
    }
    return applyMetric ? effectiveWeightPreMetric * getWeightDisplaySettings().multiplier : effectiveWeightPreMetric;
}

/**
 * Calculates the total current weight of items inside a container.
 * @param {Item | null | undefined} containerItem - The container item document.
 * @param {Actor | null | undefined} actor - The actor owning the container.
 * @param {boolean} [applyMetric=true] - Whether to apply the metric multiplier for display.
 * @returns {number} The total effective weight of contents.
 */
function calculateCurrentContainerWeight(containerItem, actor, applyMetric = true) {
    if (!actor || !containerItem || !isActualWeightContainer(containerItem)) return 0;

    let currentWeight = 0;
    if (!actor.items || typeof actor.items.filter !== 'function') {
        console.error(`${MODULE_ID} | calculateCurrentContainerWeight: actor.items is not valid for actor:`, actor.name);
        return 0;
    }
    const contents = actor.items.filter(i => foundry.utils.getProperty(i, "system.container") === containerItem.id);

    for (const item of contents) {
        const quantity = Number(foundry.utils.getProperty(item, "system.quantity")) || 1;
        // When summing up for container total, items inside already have reduction applied.
        // We need their weight without the display metric multiplier initially, then apply it to the sum.
        currentWeight += getEffectiveItemWeight(item, actor, false) * quantity;
    }

    if (isNaN(currentWeight)) {
        console.error(`${MODULE_ID} | calculateCurrentContainerWeight: Sum before metric is NaN for container:`, containerItem.name);
        return 0;
    }
    // Apply metric multiplier to the total sum if requested
    const finalWeight = applyMetric ? currentWeight * getWeightDisplaySettings().multiplier : currentWeight;

    if (isNaN(finalWeight)) {
        console.error(`${MODULE_ID} | calculateCurrentContainerWeight: Final sum is NaN for container:`, containerItem.name);
        return 0;
    }
    return Number(finalWeight.toPrecision(5));
}

/**
 * Gets the CSS rarity class based on the weight reduction percentage.
 * @param {number} reductionPercent - Reduction percentage (0-100).
 * @returns {string} CSS class.
 */
function getRarityClassForReduction(reductionPercent) {
    if (reductionPercent >= 95) return 'rarity-artifact';
    if (reductionPercent >= 75) return 'rarity-legendary';
    if (reductionPercent >= 50) return 'rarity-very-rare';
    if (reductionPercent >= 25) return 'rarity-rare';
    if (reductionPercent > 0) return 'rarity-uncommon';
    return 'rarity-common';
}

/**
 * Updates the container progress bar in the specified DOM element.
 * @param {jQuery} html - jQuery DOM object.
 * @param {Item} containerItem - The container item.
 * @param {Actor} actor - The actor.
 * @param {Object} [options] - Options.
 * @param {string[]} [options.progressSelectors] - Selectors for the progress bar.
 * @param {string[]} [options.valueSelectors] - Selectors for the weight value.
 */
function updateContainerProgressBar(html, containerItem, actor, options = {}) {
    if (!isActualWeightContainer(containerItem) || !actor) return;

    const { units, multiplier: displayMultiplier } = getWeightDisplaySettings(); // Multiplier here is for display unit conversion
    // Current weight is calculated with item reductions, then converted to display units
    const effectiveCurrentWeight = calculateCurrentContainerWeight(containerItem, actor, true);

    // Max weight from the container item is in its base unit (likely lbs).
    // It needs to be converted to display units for comparison and display.
    const containerMaxWeightBase = Number(foundry.utils.getProperty(containerItem, "system.capacity.weight.value") ?? 0);
    const containerMaxWeightDisplay = containerMaxWeightBase * displayMultiplier;

    if (containerMaxWeightDisplay <= 0) return;

    const progressSelectors = options.progressSelectors || [
        '.encumbrance-bar',
        '.progress-bar.encumbrance',
        '.container-capacity-bar'
    ];
    const valueSelectors = options.valueSelectors || [
        '.encumbrance .encumbrance-label',
        '.encumbrance-value',
        '.container-weight-value'
    ];

    progressSelectors.forEach(selector => {
        const meterElement = html.find(selector);
        if (meterElement.length > 0) {
            const percentage = Math.min(100, Math.round((effectiveCurrentWeight / containerMaxWeightDisplay) * 100));
            meterElement.css('--bar-percentage', `${percentage}%`);
            meterElement.attr('aria-valuenow', effectiveCurrentWeight.toFixed(2));
        }
    });

    valueSelectors.forEach(selector => {
        const valueElement = html.find(selector);
        if (valueElement.length > 0) {
            valueElement.text(`${effectiveCurrentWeight.toFixed(2)} ${units}`);
        }
    });
}

// --- Socket Handlers for Multiplayer Sync ---

/**
 * Registers the socket for synchronization of changes.
 */
function registerSocket() {
    game.socket.on(SOCKET_NAME, ({ type, data }) => {
        if (type === 'updateContainer') {
            const { itemId, actorId } = data;
            const actor = game.actors.get(actorId);
            const item = actor?.items.get(itemId); // itemId can be null for actor-wide updates like currency
            if (item && item.sheet?.rendered) {
                item.sheet.render(false);
            }
            if (actor && actor.sheet?.rendered) {
                actor.sheet.render(false);
            }
            // If only actorId is provided, it might be a general refresh request for that actor
            if (!itemId && actor && actor.sheet?.rendered) {
                actor.sheet.render(false);
            }
        }
    });
}

/**
 * Broadcasts a container update to all clients.
 * @param {string | null} itemId - The container’s ID, or null for actor-wide refresh.
 * @param {string} actorId - The actor’s ID.
 */
function broadcastContainerUpdate(itemId, actorId) {
    if (!actorId) return; // Actor ID is essential
    game.socket.emit(SOCKET_NAME, {
        type: 'updateContainer',
        data: { itemId, actorId }
    });
}

// --- Hooks ---

Hooks.once('init', () => {
    console.log(`${MODULE_ID} | HOOK: init`);

    console.log(`${MODULE_ID} | Checking for libWrapper...`);
    if (game.modules.get('lib-wrapper')?.active) {
        libWrapper = globalThis.libWrapper;
        console.log(`${MODULE_ID} | libWrapper found and active.`);
    } else {
        console.log(`${MODULE_ID} | libWrapper not found. Using manual patching.`);
    }

    try {
        game.settings.register(MODULE_ID, 'gmOnlyConfig', {
            name: "GM Only Config", // Fallback, localization might not be ready
            hint: "If checked, only GMs can change container weight reduction settings.",
            scope: 'world',
            config: true,
            type: Boolean,
            default: true,
            onChange: () => ui.windows && Object.values(ui.windows).forEach(w => w instanceof ItemSheet && w.render())
        });

        game.settings.register(MODULE_ID, 'capacityExceededMessage', {
            name: "Capacity Exceeded Message", // Fallback
            hint: "The message shown when trying to overfill a container. Default: 'Container capacity exceeded!'",
            scope: 'world',
            config: true,
            type: String,
            default: "Container capacity exceeded!"
        });

        // Localize settings names and hints once i18n is ready
        Hooks.once('i18nInit', () => {
            game.settings.settings.get(`${MODULE_ID}.gmOnlyConfig`).name = game.i18n.localize("WEIGHTYCONTAINERS.SettingGMOnlyConfig");
            game.settings.settings.get(`${MODULE_ID}.gmOnlyConfig`).hint = game.i18n.localize("WEIGHTYCONTAINERS.SettingGMOnlyConfigHint");
            game.settings.settings.get(`${MODULE_ID}.capacityExceededMessage`).name = game.i18n.localize("WEIGHTYCONTAINERS.SettingCapacityMessageName");
            game.settings.settings.get(`${MODULE_ID}.capacityExceededMessage`).hint = game.i18n.localize("WEIGHTYCONTAINERS.SettingCapacityMessageHint");
            if (game.settings.settings.get(`${MODULE_ID}.capacityExceededMessage`).default === "Container capacity exceeded!") { // Only set if it's still the fallback
                 game.settings.settings.get(`${MODULE_ID}.capacityExceededMessage`).default = game.i18n.localize("WEIGHTYCONTAINERS.DefaultCapacityMessage");
            }
        });


        console.log(`${MODULE_ID} | Settings Initialized`);
    } catch (e) {
        console.error(`${MODULE_ID} | Failed to register settings:`, e);
    }
});

Hooks.once('setup', () => {
    console.log(`${MODULE_ID} | HOOK: setup`);
    registerSocket();
});

// --- Actor Data Patching ---

/**
 * Logic for modifying actor encumbrance data.
 * @param {Actor} actor - The actor document.
 */
function modifyEncumbranceData(actor) {
    if (!actor || !actor.items || !actor.system?.attributes?.encumbrance) {
        return;
    }

    const { multiplier: displayUnitsMultiplier, currencyWeight } = getWeightDisplaySettings();
    let effectiveTotalWeightBaseUnits = 0; // Accumulate in base units (lbs) before final conversion

    for (const item of actor.items) {
        if (!item.system) continue;

        let countItemWeight = false;
        const containerId = foundry.utils.getProperty(item, "system.container");

        if (foundry.utils.getProperty(item, "system.weightless")) { // Weightless items contribute 0
            countItemWeight = false;
        } else if (containerId) {
            const container = actor.items.get(containerId);
            // If inside a weight-based container, its weight is handled by getEffectiveItemWeight (which applies reduction)
            // If inside a non-weight-based container (e.g., by type not 'weight'), its weight counts if equipped
            // or if it's not a container itself (to avoid double counting container weight if system adds it separately)
            if (container && isActualWeightContainer(container)) {
                countItemWeight = true; // Weight reduction will be applied by getEffectiveItemWeight
            } else if (foundry.utils.getProperty(item, "system.equipped") ?? false) {
                // For items in non-weight-reducing containers, or outside containers, count if equipped
                countItemWeight = true;
            } else if (!container && item.type !== 'container') {
                 // For items outside any container, count if not a container itself (assuming container weight is counted)
                 countItemWeight = true;
            } else if (!container && item.type === 'container' && isActualWeightContainer(item)) {
                 // For actual weight containers themselves (not their content) that are not in another container.
                 countItemWeight = true;
            }
        } else { // Item is not in any container
            countItemWeight = true;
        }


        if (countItemWeight) {
            const quantity = Number(foundry.utils.getProperty(item, "system.quantity")) || 1;
            let weightPerUnitBase = 0; // Weight per unit in base system units (lbs)

            if (containerId && actor.items.get(containerId) && isActualWeightContainer(actor.items.get(containerId))) {
                // For items inside weighty containers, getEffectiveItemWeight gives the reduced weight in base units (lbs)
                weightPerUnitBase = getEffectiveItemWeight(item, actor, false); // `false` for applyMetric means "give me base unit weight"
            } else {
                // For items not in weighty containers, or for the containers themselves
                const weightSource = foundry.utils.getProperty(item, "system.weight");
                if (typeof weightSource === 'number') weightPerUnitBase = weightSource;
                else if (typeof weightSource === 'object' && weightSource !== null && typeof weightSource.value === 'number') weightPerUnitBase = weightSource.value;
                else if (typeof weightSource === 'string') weightPerUnitBase = parseFloat(weightSource) || 0;
                weightPerUnitBase = Number(weightPerUnitBase) || 0;
            }

            if (isNaN(weightPerUnitBase)) weightPerUnitBase = 0;
            effectiveTotalWeightBaseUnits += (weightPerUnitBase * quantity);
        }
    }

    // Add currency weight if enabled (currency weight is typically defined in lbs)
    if (currencyWeight) {
        const currency = foundry.utils.getProperty(actor, "system.currency") || {};
        const coinsPerLb = game.settings.get("dnd5e", "coinsWeight") || CONFIG.DND5E?.encumbrance?.currencyPerWeight?.imperial || 50;
        const currencyWeightValue = Object.values(currency).reduce((total, amount) => total + (Number(amount) || 0), 0) / coinsPerLb;
        effectiveTotalWeightBaseUnits += currencyWeightValue;
    }

    // Now convert the total accumulated base weight to the display units for actor.system.attributes.encumbrance.value
    const finalEffectiveWeightDisplayUnits = Number((effectiveTotalWeightBaseUnits * displayUnitsMultiplier).toPrecision(5));
    actor.system.attributes.encumbrance.value = finalEffectiveWeightDisplayUnits;

    // Recalculate encumbrance levels
    const enc = actor.system.attributes.encumbrance;
    enc.encumbered = false;
    enc.heavilyEncumbered = false;
    // Thresholds should be based on the actor's max capacity in base units (lbs), then converted for display if needed.
    // However, enc.max is ALREADY in display units usually (or needs to be if metric) by the system.
    // For D&D5e, max is typically derived from STR * multiplier (e.g. 15 or 7.5 for metric)
    // We need to ensure our `value` and `thresholds` are using the same unit system.
    // `displayUnitsMultiplier` from `getWeightDisplaySettings` tells us how to convert lbs to current display units.
    // Actor's `enc.max` (from D&D5e system) should already be in the correct display units.

    enc.thresholds = { light: 0, medium: 0, heavy: 0, maximum: enc.max ?? 0 };

    if (enc.units !== "%" && typeof enc.max === 'number' && enc.max > 0) {
        let thresholdsConfig = CONFIG.DND5E?.encumbrance?.threshold?.[actor.type] ?? CONFIG.DND5E?.encumbrance?.threshold?.default;

        if (!thresholdsConfig) {
            thresholdsConfig = { light: 1/3, medium: 2/3, heavy: 1 }; // Fallback
        }

        // enc.max is assumed to be already in the correct display units by the D&D5e system
        const maxInDisplayUnits = enc.max;

        enc.thresholds = {
            light: maxInDisplayUnits * (thresholdsConfig.light ?? 1/3),
            medium: maxInDisplayUnits * (thresholdsConfig.medium ?? 2/3),
            heavy: maxInDisplayUnits * (thresholdsConfig.heavy ?? 1),
            maximum: maxInDisplayUnits
        };

        enc.encumbered = enc.value > enc.thresholds.medium;
        enc.heavilyEncumbered = enc.value > enc.thresholds.heavy;

    } else if (enc.units === "%") { // e.g. variant encumbrance with percentages
        enc.thresholds = { light: 50, medium: 75, heavy: 90, maximum: 100 }; // Example, adjust as needed
        enc.encumbered = enc.value > enc.thresholds.medium; // Or however D&D5e handles % encumbrance
        enc.heavilyEncumbered = enc.value > enc.thresholds.heavy;
    } else {
        console.warn(`${MODULE_ID} | Could not calculate encumbrance levels for ${actor.name}: Invalid enc.max or units. Defaulting statuses to false.`);
    }
}


/**
 * Patches the Actor prepareDerivedData method.
 */
function patchActorDerivedData() {
    console.log(`${MODULE_ID} | Attempting to patch Actor prepareDerivedData...`);
    try {
        const targetMethod = "CONFIG.Actor.documentClass.prototype.prepareDerivedData";

        if (libWrapper) {
            libWrapper.register(MODULE_ID, targetMethod, function(wrapped, ...args) {
                wrapped(...args);
                modifyEncumbranceData(this);
            }, "WRAPPER");
            console.log(`${MODULE_ID} | Successfully wrapped ${targetMethod} with libWrapper.`);
        } else {
            console.warn(`${MODULE_ID} | Attempting manual patch for ${targetMethod}...`);
            const originalMethod = foundry.utils.getProperty(CONFIG, "Actor.documentClass.prototype.prepareDerivedData");
            if (typeof originalMethod !== 'function') {
                console.error(`${MODULE_ID} | Failed to find original method ${targetMethod} for manual patching!`);
                return;
            }
            CONFIG.Actor.documentClass.prototype.prepareDerivedData = function(...args) {
                originalMethod.apply(this, args);
                modifyEncumbranceData(this);
            };
            console.log(`${MODULE_ID} | Manually patched ${targetMethod}.`);
        }
    } catch (e) {
        console.error(`${MODULE_ID} | Failed to patch Actor prepareDerivedData:`, e);
    }
}

// Patch in ready
Hooks.once('ready', () => {
    console.log(`${MODULE_ID} | HOOK: ready`);
    patchActorDerivedData();

    // Initialize settings default messages after i18n is ready
    if (game.settings.get(MODULE_ID, 'capacityExceededMessage') === "Container capacity exceeded!") {
        // Only update if it's the initial fallback string
        const localizedDefault = game.i18n.localize("WEIGHTYCONTAINERS.DefaultCapacityMessage");
        if (localizedDefault && localizedDefault !== "WEIGHTYCONTAINERS.DefaultCapacityMessage") {
            // If localization exists and is not the key itself, update the game setting if user hasn't changed it
            // This is a bit tricky because we can't easily know if user set it to "Container capacity exceeded!" explicitly.
            // A better approach would be to register with an empty default and set it here, or use a placeholder.
            // For now, we assume if it's the hardcoded English fallback, it wasn't localized yet.
            // game.settings.set(MODULE_ID, 'capacityExceededMessage', localizedDefault); // This might overwrite user choice.
            // Better: The i18nInit hook for settings already handles this for the *default* value.
        }
    }
    console.log(`${MODULE_ID} | Module Ready`);
});

// Hook for updating weight on currency change
Hooks.on('updateActor', (actor, change, options, userId) => {
    if (foundry.utils.hasProperty(change, 'system.currency') && actor.sheet?.rendered) {
        // modifyEncumbranceData(actor); // This will be called by prepareDerivedData due to data update
        // actor.sheet.render(false); // This will also be handled by data update cycle
        // Simply broadcasting should be enough if prepareDerivedData is correctly patched
        // and the sheet re-renders on data changes.
        // However, an explicit broadcast ensures other clients are synced for currency changes affecting weight.
        broadcastContainerUpdate(null, actor.id); // null itemId signifies actor-wide update potential
    }
});

/**
 * Adds UI elements to the container sheet.
 */
Hooks.on('renderItemSheet', (app, html, data) => {
    if (!(app instanceof ItemSheet) || !app.object) return;
    const item = app.object;

    const isWeightContainer = isActualWeightContainer(item);
    // For D&D 5e 3.x/4.x item sheets, a common place for such info is near the item name or weight.
    // .window-header is too high. .sheet-header .profile is good.
    let targetBlock = html.find('.sheet-header .profile-img-container'); // D&D5e 3.x/4.x common pattern
    if (targetBlock.length === 0) targetBlock = html.find('header.sheet-header'); // More generic fallback
    if (targetBlock.length === 0) targetBlock = html.find('.item-properties'); // Another fallback
    if (targetBlock.length === 0) return; // Still no suitable block

    const existingUiWrapper = targetBlock.parent().find('.weighty-container-ui-wrapper');
    existingUiWrapper.remove();

    if (!isWeightContainer) return;

    const reductionPercent = getWeightReductionPercent(item);
    const canConfigure = game.user?.isGM || !game.settings.get(MODULE_ID, 'gmOnlyConfig');
    const rarityClass = getRarityClassForReduction(reductionPercent);
    const uiWrapper = $('<div class="weighty-container-ui-wrapper" style="display: flex; flex-direction: column; align-items: flex-start; gap: 3px; margin-top: 5px; margin-left: 5px; width: fit-content;"></div>');

    const reductionDisplayHTML = `
      <div class="weighty-container-reduction-display ${rarityClass}" title="${game.i18n.localize('WEIGHTYCONTAINERS.WeightReductionLabel')}" style="font-size: var(--font-size-12, 12px); padding: 2px 4px; border: 1px solid #888; border-radius: 3px; background: rgba(0,0,0,0.05);">
        <i class="fas fa-weight-hanging"></i> ${reductionPercent}% ${game.i18n.localize('WEIGHTYCONTAINERS.ReductionSuffix')}
      </div>`;
    uiWrapper.append(reductionDisplayHTML);

    if (canConfigure) {
        const configButtonHTML = `<button type="button" class="weighty-container-config-btn" title="${game.i18n.localize('WEIGHTYCONTAINERS.ConfigButtonTooltip')}" style="line-height: normal; padding: 2px 5px;"><i class="fas fa-cogs"></i> ${game.i18n.localize('WEIGHTYCONTAINERS.ConfigButtonLabel')}</button>`;
        const configButton = $(configButtonHTML);
        configButton.on('click', async (ev) => {
            ev.preventDefault();
            const currentReduction = getWeightReductionPercent(item);

            const dialogContent = `<form><div class="form-group"><label>`
                         + game.i18n.localize("WEIGHTYCONTAINERS.ConfigPrompt")
                         + `</label><input type="number" name="reductionPercent" value="`
                         + currentReduction
                         + `" min="0" max="100" step="1"/></div></form>`;

            const dialogData = {
                title: game.i18n.localize("WEIGHTYCONTAINERS.ConfigWindowTitle"),
                content: dialogContent,
                buttons: {
                    save: {
                        icon: '<i class="fas fa-save"></i>',
                        label: game.i18n.localize("WEIGHTYCONTAINERS.ConfigSave"),
                        callback: async (jqHtml) => {
                            try {
                                const inputVal = jqHtml.find('input[name="reductionPercent"]').val();
                                const newPercentage = parseInt(inputVal || "0", 10);

                                if (isNaN(newPercentage) || newPercentage < 0 || newPercentage > 100) {
                                    ui.notifications.warn(game.i18n.localize("WEIGHTYCONTAINERS.InvalidPercentage"));
                                    return false; // Keep dialog open
                                }
                                await item.setFlag(MODULE_ID, FLAG_WEIGHT_REDUCTION, newPercentage);
                                // No need for ui.notifications.info, flag change will trigger sheet re-render.
                                // broadcastContainerUpdate is handled by the updateItem hook
                            } catch (e) {
                                console.error(`${MODULE_ID} | Error setting flag:`, e);
                                ui.notifications.error("Error saving weight reduction setting.");
                            }
                        }
                    },
                    cancel: { icon: '<i class="fas fa-times"></i>', label: game.i18n.localize("WEIGHTYCONTAINERS.ConfigCancel") }
                },
                default: 'save',
                render: html => { // autofocus the input
                    html.find('input[name="reductionPercent"]').focus().select();
                }
            };
            new Dialog(dialogData).render(true);
        });
        uiWrapper.append(configButton);
    }
    // Insert after the chosen block, or as a child if it's a more general container
    if (targetBlock.is('header.sheet-header') || targetBlock.is('.item-properties')) {
        targetBlock.append(uiWrapper);
    } else {
         targetBlock.after(uiWrapper); // Place it after the profile image or similar specific element
    }


    try { if (app.rendered) app.setPosition({ height: "auto" }); } catch (e) { /* Ignore */ }

    // Update progress bar using the new function
    if (isWeightContainer && app.actor) { // Progress bar only makes sense if container is on an actor
        try {
            // Selectors need to be robust for D&D5e 3.x/4.x item sheets
            const contentsTab = html.find('.tab[data-tab="contents"]');
            if (contentsTab.length > 0) {
                 updateContainerProgressBar(contentsTab, item, app.actor, {
                    progressSelectors: [
                        '.encumbrance .encumbrance-bar', // D&D5e 2.x/3.x style
                        '.container-capacity .bar',    // D&D5e 4.x style
                        '.progress-bar.encumbrance'     // Generic
                    ],
                    valueSelectors: [
                        '.encumbrance .encumbrance-label', // D&D5e 2.x/3.x
                        '.container-capacity .value',     // D&D5e 4.x
                        '.encumbrance-value'              // Generic
                    ]
                });
            }
        } catch (e) {
            console.error(`${MODULE_ID} | Error updating container sheet weight display:`, e);
        }
    }
});

/**
 * Hook to check capacity BEFORE item creation.
 */
Hooks.on('preCreateItem', (itemDoc, createData, options, userId) => {
    if (game.userId !== userId && !game.user.isGM) return true; // Only active player or GM can trigger this check effectively
    const parentActor = itemDoc.parent;
    const containerId = foundry.utils.getProperty(createData, 'system.container') ?? foundry.utils.getProperty(itemDoc.toObject(false), 'system.container'); // Check createData first, then itemDoc's current state if not in createData
    if (!(parentActor instanceof Actor) || !containerId) return true;
    if (itemDoc.isTemporary) return true;

    const actor = parentActor;
    const container = actor.items.get(containerId);
    if (!container || !isActualWeightContainer(container)) return true;

    const { multiplier: displayMultiplier } = getWeightDisplaySettings();
    const containerMaxWeightBase = Number(foundry.utils.getProperty(container, "system.capacity.weight.value") ?? 0);
    if (containerMaxWeightBase <= 0) return true; // Infinite capacity or not weight based

    let effectiveWeightToAddBase = 0;
    try {
        // Create a temporary item with the final data to accurately calculate its weight
        const tempItemData = foundry.utils.mergeObject(itemDoc.toObject(false), createData);
        tempItemData.system = foundry.utils.mergeObject(itemDoc.system?.toObject() ?? {}, createData.system ?? {});
        if (!tempItemData._id) tempItemData._id = foundry.utils.randomID(); // Needs an ID for some system calcs

        const tempItemDoc = new Item.implementation(tempItemData, { temporary: true, parent: actor });
        const itemToAddQuantity = Number(foundry.utils.getProperty(tempItemData, 'system.quantity') ?? 1);
        // Get weight in base units (lbs), reduction applied if relevant for this container
        effectiveWeightToAddBase = getEffectiveItemWeight(tempItemDoc, actor, false) * itemToAddQuantity;
    } catch (err) {
        console.error(`${MODULE_ID} | ERROR preCreateItem: Failed to calculate effective weight.`, err);
        ui.notifications.error("Error calculating item weight for capacity check.");
        return false;
    }

    if (isNaN(effectiveWeightToAddBase)) {
        console.error(`${MODULE_ID} | ERROR preCreateItem: effectiveWeightToAddBase is NaN.`);
        ui.notifications.error("Item weight calculation resulted in NaN.");
        return false;
    }

    // Current weight of container contents in base units (lbs)
    const currentWeightBase = calculateCurrentContainerWeight(container, actor, false);
    if (isNaN(currentWeightBase)) {
        console.error(`${MODULE_ID} | ERROR preCreateItem: currentWeightBase is NaN.`);
        ui.notifications.error("Container current weight calculation resulted in NaN.");
        return false;
    }

    const potentialTotalWeightBase = currentWeightBase + effectiveWeightToAddBase;
    const tolerance = 0.001; // Tolerance for floating point comparisons

    if (potentialTotalWeightBase > containerMaxWeightBase + tolerance) {
        const customMessage = game.settings.get(MODULE_ID, 'capacityExceededMessage') || game.i18n.localize("WEIGHTYCONTAINERS.CapacityExceeded") || "Container capacity exceeded!";
        ui.notifications.warn(customMessage.replace("{item}", itemDoc.name).replace("{container}", container.name));
        return false;
    }

    return true;
});

/**
 * Hook to check capacity BEFORE item update.
 */
Hooks.on('preUpdateItem', (itemDoc, change, options, userId) => {
    if (game.userId !== userId && !game.user.isGM) return true;
    if (!(itemDoc.parent instanceof Actor)) return true;
    if (itemDoc.isTemporary) return true;

    const actor = itemDoc.parent;

    // Determine the target container ID
    const originalContainerId = foundry.utils.getProperty(itemDoc, "system.container");
    const isChangingContainer = foundry.utils.hasProperty(change, 'system.container');
    const targetContainerId = isChangingContainer ? foundry.utils.getProperty(change, 'system.container') : originalContainerId;

    // If not moving into a container or already in a container, no capacity check needed here
    if (!targetContainerId) return true;

    const container = actor.items.get(targetContainerId);
    if (!container || !isActualWeightContainer(container)) return true; // Target is not a weighty container

    const { multiplier: displayMultiplier } = getWeightDisplaySettings();
    const containerMaxWeightBase = Number(foundry.utils.getProperty(container, "system.capacity.weight.value") ?? 0);
    if (containerMaxWeightBase <= 0) return true; // Infinite capacity or not relevant

    // Check if quantity is changing
    const oldQuantity = foundry.utils.getProperty(itemDoc, "system.quantity") ?? 1;
    const newQuantity = foundry.utils.getProperty(change, 'system.quantity') ?? oldQuantity;
    const isChangingQuantity = foundry.utils.hasProperty(change, 'system.quantity');


    // Scenarios to check:
    // 1. Moving an item INTO this container (targetContainerId is set, and different from original or original was null)
    // 2. Increasing quantity of an item ALREADY IN this container
    // We only care if the net effect is ADDING weight to this specific container.

    let weightChangeBase = 0; // Change in weight in base units (lbs) for *this* item stack
    let isAddingToThisContainer = false;

    // Create a temporary item reflecting the proposed changes to get its single unit weight
    const changedItemData = foundry.utils.mergeObject(itemDoc.toObject(false), change);
    changedItemData.system = foundry.utils.mergeObject(itemDoc.system?.toObject() ?? {}, change.system ?? {});
    if (!changedItemData._id) changedItemData._id = itemDoc.id; // Use existing ID
    const tempChangedItemDoc = new Item.implementation(changedItemData, { temporary: true, parent: actor });
    const effectiveSingleItemWeightBase = getEffectiveItemWeight(tempChangedItemDoc, actor, false); // Weight in base units, reduction applied by its *target* container

    if (isNaN(effectiveSingleItemWeightBase)) {
        console.error(`${MODULE_ID} | ERROR preUpdateItem: effectiveSingleItemWeightBase is NaN for item ${itemDoc.name}.`);
        ui.notifications.error("Item weight calculation error during update.");
        return false;
    }

    if (isChangingContainer && targetContainerId !== originalContainerId) { // Item is moving
        if (targetContainerId === container.id) { // Moving INTO this container
            isAddingToThisContainer = true;
            weightChangeBase = effectiveSingleItemWeightBase * newQuantity;
        }
        // If moving OUT of this container, that's fine, no capacity check needed for *this* container.
        // The 'preCreateItem' or another 'preUpdateItem' for the *new* container would handle that.
    } else if (targetContainerId === container.id && isChangingQuantity && newQuantity > oldQuantity) { // Quantity increase within this container
        isAddingToThisContainer = true;
        const quantityIncrease = newQuantity - oldQuantity;
        weightChangeBase = effectiveSingleItemWeightBase * quantityIncrease;
    }

    if (!isAddingToThisContainer || weightChangeBase <= 0) { // Not adding weight or reducing/no change
        return true;
    }

    // Calculate current weight in the target container *excluding* the item being updated if it's already there
    let currentWeightInTargetContainerBase = calculateCurrentContainerWeight(container, actor, false);
    if (originalContainerId === targetContainerId) { // If item was already in this container
        const originalItemWeightContribution = getEffectiveItemWeight(itemDoc, actor, false) * oldQuantity; // Use itemDoc for original state
        currentWeightInTargetContainerBase -= originalItemWeightContribution;
    }
    currentWeightInTargetContainerBase = Math.max(0, currentWeightInTargetContainerBase); // Ensure no negative weight due to float issues


    if (isNaN(currentWeightInTargetContainerBase)) {
        console.error(`${MODULE_ID} | ERROR preUpdateItem: currentWeightInTargetContainerBase is NaN.`);
        return false;
    }

    const potentialTotalWeightBase = currentWeightInTargetContainerBase + weightChangeBase;
    const tolerance = 0.001;

    if (potentialTotalWeightBase > containerMaxWeightBase + tolerance) {
        const customMessage = game.settings.get(MODULE_ID, 'capacityExceededMessage') || game.i18n.localize("WEIGHTYCONTAINERS.CapacityExceeded") || "Container capacity exceeded!";
        const itemName = foundry.utils.getProperty(change, 'name') || itemDoc.name;
        ui.notifications.warn(customMessage.replace("{item}", itemName).replace("{container}", container.name));
        return false;
    }

    return true;
});


/**
 * Adds effective weight display and progress bars to the actor sheet.
 */
Hooks.on('renderActorSheet', (app, html, data) => {
    if (!(app instanceof ActorSheet) || !app.actor || ['npc', 'vehicle'].includes(app.actor.type)) return;
    const actor = app.actor;

    const { units, multiplier: displayUnitsMultiplier } = getWeightDisplaySettings();

    html.find('.items-list .item[data-item-id], .inventory-list .item[data-item-id]').each((index, element) => {
        const $element = $(element);
        const itemId = $element.data('itemId');
        if (!itemId) return;

        const item = actor.items.get(itemId);
        if (!item) return;

        const containerId = foundry.utils.getProperty(item, "system.container");
        const weightCell = $element.find('.item-weight, .weight'); // Common selectors for weight cell
        const existingSpan = weightCell.find('.weighty-effective-weight');

        if (!containerId) { existingSpan.remove(); return; } // Not in a container

        const container = actor.items.get(containerId);
        if (!container || !isActualWeightContainer(container)) { // In a container, but not a "weighty" one
            existingSpan.remove(); return;
        }

        const reductionPercent = getWeightReductionPercent(container);
        if (reductionPercent <= 0) { // In a weighty container, but no reduction applied
            existingSpan.remove(); return;
        }

        // Item is in a weighty container with active reduction.
        // Calculate its effective weight in display units.
        const effectiveWeightDisplay = getEffectiveItemWeight(item, actor, true); // true for display units

        // Get its original base weight for comparison (in system base units, e.g. lbs)
        const weightSource = foundry.utils.getProperty(item, "system.weight");
        let baseWeightItem = 0;
        if (typeof weightSource === 'number') baseWeightItem = weightSource;
        else if (typeof weightSource === 'object' && weightSource !== null && typeof weightSource.value === 'number') baseWeightItem = weightSource.value;
        else if (typeof weightSource === 'string') baseWeightItem = parseFloat(weightSource) || 0;
        baseWeightItem = Number(baseWeightItem) || 0;

        const originalWeightDisplay = baseWeightItem * displayUnitsMultiplier; // Original weight in display units

        // Only show effective weight if it's meaningfully different from original display weight
        if (Math.abs(effectiveWeightDisplay - originalWeightDisplay) < 0.001) {
            existingSpan.remove(); return;
        }

        if (weightCell.length > 0) {
            const displayWeightText = effectiveWeightDisplay.toFixed(2);
            // Using a more compact "(Eff: X units)"
            const effectiveWeightText = ` (${game.i18n.localize('WEIGHTYCONTAINERS.EffectiveAbbreviation')}: ${displayWeightText} ${units})`;

            if (existingSpan.length) {
                existingSpan.text(effectiveWeightText);
            } else {
                weightCell.append(`<span class="weighty-effective-weight" style="font-size: 0.9em; opacity: 0.8;">${effectiveWeightText}</span>`);
            }
        }

        // Update progress bar for containers listed in the actor’s inventory
        if (item.type === 'container' && isActualWeightContainer(item)) {
            // D&D 5e character sheet often has a specific structure for containers
            const containerElement = $element.find('.item-controls .container-capacity'); // For D&D 5e 4.x
            if (containerElement.length > 0) {
                updateContainerProgressBar(containerElement.parent(), item, actor, { // Pass the parent of the capacity display
                    progressSelectors: ['.bar'],
                    valueSelectors: ['.value']
                });
            } else { // Fallback for other sheet structures or older D&D5e
                 updateContainerProgressBar($element, item, actor, {
                    progressSelectors: ['.encumbrance-bar', '.progress-bar'],
                    valueSelectors: ['.encumbrance-label', '.item-weight .value'] // Assuming value might be nested
                });
            }
        }
    });
});

/**
 * Updates weight display on actor and container sheets upon changes.
 */
function refreshDependentSheets(item) {
    if (!item) return;
    const actor = item.actor;
    if (!actor) return;

    // Actor sheet refresh is usually handled by data updates causing prepareDerivedData
    // and subsequent render. Explicit render can sometimes cause issues if data isn't fully synced.
    // if (actor.sheet instanceof ActorSheet && actor.sheet.rendered) {
    // try { actor.sheet.render(false); } catch(e) { /* ignore */ }
    // }

    const currentContainerId = foundry.utils.getProperty(item, "system.container");
    const originalContainerId = foundry.utils.getProperty(item, "_source.system.container"); // From before update

    const containerIdsToRefresh = new Set();
    if (currentContainerId) containerIdsToRefresh.add(currentContainerId);
    if (originalContainerId && originalContainerId !== currentContainerId) containerIdsToRefresh.add(originalContainerId);

    // If the item itself is a container, its own sheet might need refresh
    if (item.type === 'container' && item.sheet instanceof ItemSheet && item.sheet.rendered) {
        try { item.sheet.render(false); } catch(e) { /* ignore */ }
    }

    // Refresh sheets of containers that hold/held this item
    containerIdsToRefresh.forEach(containerId => {
        if (typeof containerId === 'string') {
            const container = actor.items.get(containerId);
            if (container && container.sheet instanceof ItemSheet && container.sheet.rendered) {
                try { container.sheet.render(false); } catch(e) { /* ignore */ }
            }
        }
    });

    // Broadcast so other clients also update their views
    // If item is a container, use its ID. If item is content, use its container's ID if relevant, or actor ID for general refresh.
    let broadcastItemId = item.id;
    if(item.type !== 'container' && currentContainerId) broadcastItemId = currentContainerId;
    else if (item.type !== 'container' && !currentContainerId && originalContainerId) broadcastItemId = originalContainerId;

    broadcastContainerUpdate(broadcastItemId, actor.id);
}

Hooks.on("updateItem", (item, change, options, userId) => {
    // Check for relevant changes that affect weight or container status
    const flagPath = `flags.${MODULE_ID}.${FLAG_WEIGHT_REDUCTION}`;
    const relevantChange = foundry.utils.hasProperty(change, flagPath)
                       || foundry.utils.hasProperty(change, 'system.container')
                       || foundry.utils.hasProperty(change, 'system.quantity')
                       || foundry.utils.hasProperty(change, 'system.weight')
                       || (item.type === 'container' && foundry.utils.hasProperty(change, 'system.capacity.weight.value')); // Max capacity change

    if (relevantChange && item.actor) { // Only if item is owned
        foundry.utils.debounce(() => {
            // Actor's prepareDerivedData will run due to item update, recalculating encumbrance.
            // Actor sheet should re-render automatically if its data changes.
            // We mainly need to ensure item sheets are refreshed.
            refreshDependentSheets(item);
        }, 100)(); // Debounce to avoid quick successive updates
    }
});

Hooks.on("createItem", (item, options, userId) => {
    // When an item is added to a container
    if (item.actor && foundry.utils.getProperty(item, "system.container")) {
        foundry.utils.debounce(() => refreshDependentSheets(item), 100)();
    }
});

Hooks.on("deleteItem", (item, options, userId) => {
    // When an item is removed from a container or a container itself is deleted
    if (item.actor && (foundry.utils.getProperty(item, "system.container") || item.type === 'container')) {
        foundry.utils.debounce(() => {
             // Similar to updateItem, actor data will re-prepare.
             // refreshDependentSheets handles item sheets and broadcasts.
            const tempItemStateForRefresh = item.toObject(false); // Get data before it's fully gone for context
            if (!tempItemStateForRefresh.actor) tempItemStateForRefresh.actor = item.actor; // ensure actor context
            refreshDependentSheets(new Item.implementation(tempItemStateForRefresh, {temporary: true, parent: item.actor}));

        },100)();
    }
});

// Add some localization keys directly if not provided by a lang file
Hooks.once('i18nInit', () => {
    const WCH_l = (key, fallback) => game.i18n.translations.WEIGHTYCONTAINERS?.[key] ? game.i18n.localize(`WEIGHTYCONTAINERS.${key}`) : fallback;

    if (!game.i18n.translations.WEIGHTYCONTAINERS) {
        game.i18n.translations.WEIGHTYCONTAINERS = {};
    }
    const defaults = {
        "SettingGMOnlyConfig": "GM Only Configuration",
        "SettingGMOnlyConfigHint": "If checked, only Game Masters can alter the weight reduction settings of containers.",
        "SettingCapacityMessageName": "Capacity Exceeded Message",
        "SettingCapacityMessageHint": "Message displayed when trying to add an item to a full container. Use {item} and {container} for names.",
        "DefaultCapacityMessage": "Cannot add {item}, {container} is full!",
        "WeightReductionLabel": "Weight Reduction",
        "ReductionSuffix": "Red.",
        "ConfigButtonTooltip": "Configure Weight Reduction",
        "ConfigButtonLabel": "Config",
        "ConfigPrompt": "Enter weight reduction percentage (0-100):",
        "ConfigWindowTitle": "Set Container Weight Reduction",
        "ConfigSave": "Save",
        "ConfigCancel": "Cancel",
        "InvalidPercentage": "Please enter a number between 0 and 100.",
        "CapacityExceeded": "Container capacity exceeded!",
        "ItemWeightLabel": "Eff. Wt.", // Effective Weight (short)
        "EffectiveAbbreviation": "Eff" // Even shorter
    };
    for (const [key, value] of Object.entries(defaults)) {
        if (!game.i18n.translations.WEIGHTYCONTAINERS[key]) {
            game.i18n.translations.WEIGHTYCONTAINERS[key] = value;
        }
    }
});

--- END OF FILE main.js ---