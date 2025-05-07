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
        // console.error(`${MODULE_ID} | Error calling getFlag for ${containerItem.name}:`, e);
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

    const isMetric = game.settings.get("dnd5e", "metricWeightSystem") ?? false;

    let systemMetricMultiplier = 0.5;
    if (DND5E?.encumbrance && typeof DND5E.encumbrance.metricConversionMultiplier === 'number') {
        systemMetricMultiplier = DND5E.encumbrance.metricConversionMultiplier;
    }
    const multiplier = isMetric ? systemMetricMultiplier : 1;

    let units = "";
    if (isMetric) {
        units = game.settings.get("dnd5e", "metricWeightUnits")?.trim();
        if (!units) {
            const configUnitKey = DND5E?.encumbrance?.metricWeightUnits;
            if (configUnitKey) {
                units = game.i18n.localize(configUnitKey);
                if (units === configUnitKey) units = "";
            }
        }
        if (!units) units = "kg";
    } else {
        units = game.settings.get("dnd5e", "imperialWeightUnits")?.trim();
        if (!units) {
            const configUnitKey = DND5E?.encumbrance?.imperialWeightUnits;
            if (configUnitKey) {
                units = game.i18n.localize(configUnitKey);
                if (units === configUnitKey) units = "";
            }
        }
        if (!units) units = "lbs";
    }

    const currencyWeight = game.settings.get("dnd5e", "currencyWeight") ?? true;
    return { multiplier, units, currencyWeight };
}

/**
 * Calculates the effective weight of an item, considering container weight reduction and metric system.
 * @param {Item | null | undefined} item - The item to check.
 * @param {Actor | null | undefined} [actor=item?.actor] - The actor owning the item.
 * @param {boolean} [applyDisplayMultiplier=true] - Whether to apply the display unit multiplier. If false, returns weight in base system units (e.g., lbs).
 * @returns {number} The effective weight of the item.
 */
function getEffectiveItemWeight(item, actor = item?.actor, applyDisplayMultiplier = true) {
    const weightSource = foundry.utils.getProperty(item, "system.weight");
    let baseWeight = 0; // This is item's own weight, in system's base unit (e.g. lbs)
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
    let effectiveWeightBaseUnits = baseWeight;

    if (actor && containerId) {
        const container = actor.items.get(containerId);
        if (container && isActualWeightContainer(container)) {
            const reductionPercent = getWeightReductionPercent(container);
            if (reductionPercent > 0) {
                const reductionMultiplier = Math.max(0, 1 - reductionPercent / 100);
                effectiveWeightBaseUnits = baseWeight * reductionMultiplier;
            }
        }
    }

    if (isNaN(effectiveWeightBaseUnits)) {
        console.error(`%c${MODULE_ID} | ERROR getEffectiveItemWeight: Calculation resulted in NaN! Item: ${item?.name}, BaseW: ${baseWeight}. Returning 0.`, "color: red; font-weight: bold;");
        return 0;
    }

    if (applyDisplayMultiplier) {
        return effectiveWeightBaseUnits * getWeightDisplaySettings().multiplier;
    }
    return effectiveWeightBaseUnits;
}

/**
 * Calculates the total current weight of items inside a container.
 * @param {Item | null | undefined} containerItem - The container item document.
 * @param {Actor | null | undefined} actor - The actor owning the container.
 * @param {boolean} [applyDisplayMultiplier=true] - Whether to apply the display unit multiplier to the final sum.
 * @returns {number} The total effective weight of contents.
 */
function calculateCurrentContainerWeight(containerItem, actor, applyDisplayMultiplier = true) {
    if (!actor || !containerItem || !isActualWeightContainer(containerItem)) return 0;

    let currentWeightBaseUnits = 0;
    if (!actor.items || typeof actor.items.filter !== 'function') {
        console.error(`${MODULE_ID} | calculateCurrentContainerWeight: actor.items is not valid for actor:`, actor.name);
        return 0;
    }
    const contents = actor.items.filter(i => foundry.utils.getProperty(i, "system.container") === containerItem.id);

    for (const item of contents) {
        const quantity = Number(foundry.utils.getProperty(item, "system.quantity")) || 1;
        // Get effective weight of item in base units (reduction applied if container is this one)
        currentWeightBaseUnits += getEffectiveItemWeight(item, actor, false) * quantity;
    }

    if (isNaN(currentWeightBaseUnits)) {
        console.error(`${MODULE_ID} | calculateCurrentContainerWeight: Sum before display mult is NaN for container:`, containerItem.name);
        return 0;
    }

    const finalWeight = applyDisplayMultiplier ? currentWeightBaseUnits * getWeightDisplaySettings().multiplier : currentWeightBaseUnits;

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
 * @param {jQuery} html - jQuery DOM object (representing the container of the bar and value).
 * @param {Item} containerItem - The container item.
 * @param {Actor} actor - The actor.
 * @param {Object} [options] - Options.
 * @param {string[]} [options.progressSelectors] - Selectors for the progress bar relative to html.
 * @param {string[]} [options.valueSelectors] - Selectors for the weight value relative to html.
 */
function updateContainerProgressBar(html, containerItem, actor, options = {}) {
    if (!isActualWeightContainer(containerItem) || !actor) return;

    const { units, multiplier: displayUnitsMultiplier } = getWeightDisplaySettings();
    // Current weight of contents, in display units
    const effectiveCurrentWeightDisplay = calculateCurrentContainerWeight(containerItem, actor, true);

    // Max weight from the container item is in its base unit (likely lbs).
    const containerMaxWeightBase = Number(foundry.utils.getProperty(containerItem, "system.capacity.weight.value") ?? 0);
    // Convert max weight to display units for comparison and display.
    const containerMaxWeightDisplay = containerMaxWeightBase * displayUnitsMultiplier;

    if (containerMaxWeightDisplay <= 0) { // Hide bar if no max capacity
         options.progressSelectors?.forEach(selector => html.find(selector).parent().hide());
         options.valueSelectors?.forEach(selector => html.find(selector).text(`- / - ${units}`));
        return;
    }
    options.progressSelectors?.forEach(selector => html.find(selector).parent().show());

    const progressSelectors = options.progressSelectors || [
        '.encumbrance-bar',
        '.progress-bar.encumbrance',
        '.container-capacity-bar',
        '.bar' // Common for D&D 5e 4.x container capacity display
    ];
    const valueSelectors = options.valueSelectors || [
        '.encumbrance .encumbrance-label',
        '.encumbrance-value',
        '.container-weight-value',
        '.value' // Common for D&D 5e 4.x container capacity display
    ];

    progressSelectors.forEach(selector => {
        const meterElement = html.find(selector);
        if (meterElement.length > 0) {
            const percentage = Math.min(100, Math.round((effectiveCurrentWeightDisplay / containerMaxWeightDisplay) * 100));
            meterElement.css('--bar-percentage', `${percentage}%`); // For CSS driven bars
            meterElement.width(`${percentage}%`); // For width driven bars
            meterElement.attr('aria-valuenow', effectiveCurrentWeightDisplay.toFixed(2));
            meterElement.attr('aria-valuemax', containerMaxWeightDisplay.toFixed(2));
        }
    });

    valueSelectors.forEach(selector => {
        const valueElement = html.find(selector);
        if (valueElement.length > 0) {
            valueElement.text(`${effectiveCurrentWeightDisplay.toFixed(2)} / ${containerMaxWeightDisplay.toFixed(2)} ${units}`);
        }
    });
}

// --- Socket Handlers for Multiplayer Sync ---

/**
 * Registers the socket for synchronization of changes.
 */
function registerSocket() {
    if (game.socket) {
        game.socket.on(SOCKET_NAME, ({ type, data }) => {
            if (type === 'updateContainer') {
                const { itemId, actorId } = data;
                const actor = game.actors.get(actorId);
                if (!actor) return;

                const item = itemId ? actor.items.get(itemId) : null;

                if (actor.sheet?.rendered) {
                    actor.sheet.render(false);
                }
                if (item && item.sheet?.rendered) {
                    item.sheet.render(false);
                }
                // If a container was updated, also refresh sheets of actors who might have that container open
                if (item && item.type === 'container') {
                    Object.values(ui.windows).forEach(win => {
                        if (win instanceof ItemSheet && win.object.id === item.id && win.rendered) {
                            win.render(false);
                        }
                    });
                }
            }
        });
    }
}

/**
 * Broadcasts a container update to all clients.
 * @param {string | null} itemId - The container’s ID, or null for actor-wide refresh.
 * @param {string} actorId - The actor’s ID.
 */
function broadcastContainerUpdate(itemId, actorId) {
    if (!actorId || !game.socket) return;
    game.socket.emit(SOCKET_NAME, {
        type: 'updateContainer',
        data: { itemId, actorId }
    });
}

// --- Hooks ---

Hooks.once('init', () => {
    console.log(`${MODULE_ID} | HOOK: init`);

    if (game.modules.get('lib-wrapper')?.active) {
        libWrapper = globalThis.libWrapper;
        console.log(`${MODULE_ID} | libWrapper found and active.`);
    } else {
        console.warn(`${MODULE_ID} | libWrapper not found or not active. Using manual patching if possible.`);
    }

    game.settings.register(MODULE_ID, 'gmOnlyConfig', {
        name: "WEIGHTYCONTAINERS.SettingGMOnlyConfig",
        hint: "WEIGHTYCONTAINERS.SettingGMOnlyConfigHint",
        scope: 'world',
        config: true,
        type: Boolean,
        default: true,
        onChange: () => ui.windows && Object.values(ui.windows).forEach(w => {
            if (w instanceof ItemSheet && w.object?.type === 'container' && w.rendered) w.render()
        })
    });

    game.settings.register(MODULE_ID, 'capacityExceededMessage', {
        name: "WEIGHTYCONTAINERS.SettingCapacityMessageName",
        hint: "WEIGHTYCONTAINERS.SettingCapacityMessageHint",
        scope: 'world',
        config: true,
        type: String,
        default: "WEIGHTYCONTAINERS.DefaultCapacityMessage"
    });

    Hooks.once('i18nInit', () => {
        console.log(`${MODULE_ID} | i18nInit hook called`); // Диагностика
        if (!game?.i18n?.translations) {
            console.warn(`${MODULE_ID} | game.i18n.translations is not initialized. Skipping localization setup.`);
            return;
        }
        console.log(`${MODULE_ID} | Localization setup completed`); // Диагностика
    });
    console.log(`${MODULE_ID} | Settings Initialized`);
});

Hooks.once('setup', () => {
    console.log(`${MODULE_ID} | HOOK: setup`);
    registerSocket();
});

// --- Actor Data Patching ---
function modifyEncumbranceData(actor) {
    if (!actor || !actor.items || !actor.system?.attributes?.encumbrance) {
        return;
    }

    const { multiplier: displayUnitsMultiplier, currencyWeight, units: displayUnits } = getWeightDisplaySettings();
    let effectiveTotalWeightBaseUnits = 0;

    for (const item of actor.items) {
        if (!item.system) continue;

        // Skip items that are themselves containers and are within another container,
        // unless D&D5e system specifically counts weight of contained containers.
        // For simplicity, we assume a container's own weight is what's on its item card,
        // and its contents are handled separately.
        // The D&D5e system's `Actor#prepareEmbeddedDocuments` usually handles this,
        // by setting item `isContainer` and potentially `totalWeight`.
        // Our goal is to modify the weight of *items* based on their container's reduction.

        let countItemWeight = true; // Assume we count item weight unless specified otherwise

        // If an item is "weightless" in the dnd5e system, it should contribute 0.
        if (foundry.utils.getProperty(item, "system.weightless") === true) {
            countItemWeight = false;
        }

        if (countItemWeight) {
            const quantity = Number(foundry.utils.getProperty(item, "system.quantity")) || 1;
            // getEffectiveItemWeight with false flag returns weight in base units (lbs), with reduction applied
            const weightPerUnitBase = getEffectiveItemWeight(item, actor, false);

            if (isNaN(weightPerUnitBase)) {
                console.warn(`${MODULE_ID} | NaN weight for item ${item.name} on actor ${actor.name}`);
                continue;
            }
            effectiveTotalWeightBaseUnits += (weightPerUnitBase * quantity);
        }
    }

    if (currencyWeight) {
        const currency = foundry.utils.getProperty(actor, "system.currency") || {};
        const coinsPerLb = game.settings.get("dnd5e", "coinsWeight") ?? CONFIG.DND5E?.encumbrance?.currencyPerWeight?.imperial ?? 50;
        if (coinsPerLb > 0) {
            const currencyAmount = Object.values(currency).reduce((total, amount) => total + (Number(amount) || 0), 0);
            effectiveTotalWeightBaseUnits += currencyAmount / coinsPerLb;
        }
    }

    const finalEffectiveWeightDisplayUnits = Number((effectiveTotalWeightBaseUnits * displayUnitsMultiplier).toPrecision(5));

    // Update actor's encumbrance value. This is what dnd5e sheet reads.
    actor.system.attributes.encumbrance.value = finalEffectiveWeightDisplayUnits;
    actor.system.attributes.encumbrance.units = displayUnits; // Ensure units are also updated

    // D&D5e system recalculates thresholds and encumbered status in its own prepareDerivedData based on this .value
    // For D&D5e, actor.system.attributes.encumbrance.max is calculated from STR.
    // It also has actor.system.attributes.encumbrance.powerfulBuild.
    // The system itself will use enc.value and enc.max (already in display units) to set enc.pct, enc.encumbered etc.
    // So, we just need to provide the correct `enc.value`.
}

function patchActorDerivedData() {
    console.log(`${MODULE_ID} | Attempting to patch Actor prepareDerivedData...`);
    const targetMethodPath = "CONFIG.Actor.documentClass.prototype.prepareDerivedData";

    if (libWrapper) {
        try {
            libWrapper.register(MODULE_ID, targetMethodPath, function(wrapped, ...args) {
                wrapped(...args); // Call original first so base values are set
                modifyEncumbranceData(this);
            }, "WRAPPER");
            console.log(`${MODULE_ID} | Successfully wrapped ${targetMethodPath} with libWrapper.`);
        } catch (e) {
            console.error(`${MODULE_ID} | Failed to wrap ${targetMethodPath} with libWrapper:`, e);
        }
    } else {
        console.warn(`${MODULE_ID} | libWrapper not active. Attempting manual patch for ${targetMethodPath}...`);
        try {
            const originalMethod = foundry.utils.getProperty(CONFIG.Actor.documentClass.prototype, "prepareDerivedData");
            if (typeof originalMethod !== 'function') {
                console.error(`${MODULE_ID} | Failed to find original method ${targetMethodPath} for manual patching!`);
                return;
            }
            CONFIG.Actor.documentClass.prototype.prepareDerivedData = function(...args) {
                originalMethod.apply(this, args);
                modifyEncumbranceData(this);
            };
            console.log(`${MODULE_ID} | Manually patched ${targetMethodPath}.`);
        } catch (e) {
            console.error(`${MODULE_ID} | Failed to manually patch ${targetMethodPath}:`, e);
        }
    }
}

Hooks.once('ready', () => {
    console.log(`${MODULE_ID} | HOOK: ready`);
    patchActorDerivedData();
    console.log(`${MODULE_ID} | Module Ready`);
});

Hooks.on('updateActor', (actor, change, options, userId) => {
    if (foundry.utils.hasProperty(change, 'system.currency')) {
        // prepareDerivedData will be called, which calls modifyEncumbranceData.
        // Actor sheet should re-render. We just need to notify other clients if currency changed.
        if (game.user.id === userId) { // Only the user making the change broadcasts
            broadcastContainerUpdate(null, actor.id);
        }
    }
});

Hooks.on('renderItemSheet', (app, html, data) => {
    if (!(app instanceof ItemSheet) || !app.object) return;
    const item = app.object;

    const isWeightContainer = isActualWeightContainer(item);
    let targetBlock = html.find('.sheet-header .profile-img-container');
    if (targetBlock.length === 0) targetBlock = html.find('header.sheet-header .profile'); // D&D5e 3.x
    if (targetBlock.length === 0) targetBlock = html.find('header.sheet-header');
    if (targetBlock.length === 0) return;

    const wrapperClass = 'weighty-container-ui-wrapper';
    targetBlock.parent().find(`.${wrapperClass}`).remove(); // Remove any existing UI

    if (!isWeightContainer) return;

    const reductionPercent = getWeightReductionPercent(item);
    const canConfigure = game.user?.isGM || !game.settings.get(MODULE_ID, 'gmOnlyConfig');
    const rarityClass = getRarityClassForReduction(reductionPercent);
    const uiWrapper = $(`<div class="${wrapperClass}" style="display: flex; flex-direction: column; align-items: flex-start; gap: 3px; margin-top: 5px; margin-left: 5px; width: fit-content; order: 2;"></div>`); // order: 2 to try and place after image usually

    const reductionDisplayHTML = `
      <div class="weighty-container-reduction-display ${rarityClass}" title="${game.i18n.localize('WEIGHTYCONTAINERS.WeightReductionLabel')}" style="font-size: var(--font-size-12, 12px); padding: 2px 4px; border: 1px solid #888; border-radius: 3px; background: rgba(0,0,0,0.05);">
        <i class="fas fa-weight-hanging"></i> ${reductionPercent}% ${game.i18n.localize('WEIGHTYCONTAINERS.ReductionSuffix')}
      </div>`;
    uiWrapper.append(reductionDisplayHTML);

    if (canConfigure) {
        const configButton = $(`<button type="button" class="weighty-container-config-btn" title="${game.i18n.localize('WEIGHTYCONTAINERS.ConfigButtonTooltip')}" style="line-height: normal; padding: 2px 5px;"><i class="fas fa-cogs"></i> ${game.i18n.localize('WEIGHTYCONTAINERS.ConfigButtonLabel')}</button>`);
        configButton.on('click', async (ev) => {
            ev.preventDefault();
            const currentReduction = getWeightReductionPercent(item);
            const dialogContent = `<form><div class="form-group"><label>${game.i18n.localize("WEIGHTYCONTAINERS.ConfigPrompt")}</label><input type="number" name="reductionPercent" value="${currentReduction}" min="0" max="100" step="1"/></div></form>`;
            new Dialog({
                title: game.i18n.localize("WEIGHTYCONTAINERS.ConfigWindowTitle"),
                content: dialogContent,
                buttons: {
                    save: {
                        icon: '<i class="fas fa-save"></i>',
                        label: game.i18n.localize("WEIGHTYCONTAINERS.ConfigSave"),
                        callback: async (jqHtml) => {
                            const inputVal = jqHtml.find('input[name="reductionPercent"]').val();
                            const newPercentage = parseInt(inputVal || "0", 10);
                            if (isNaN(newPercentage) || newPercentage < 0 || newPercentage > 100) {
                                ui.notifications.warn(game.i18n.localize("WEIGHTYCONTAINERS.InvalidPercentage"));
                                return false;
                            }
                            await item.setFlag(MODULE_ID, FLAG_WEIGHT_REDUCTION, newPercentage);
                        }
                    },
                    cancel: { icon: '<i class="fas fa-times"></i>', label: game.i18n.localize("WEIGHTYCONTAINERS.ConfigCancel") }
                },
                default: 'save',
                render: html => html.find('input[name="reductionPercent"]').focus().select()
            }).render(true);
        });
        uiWrapper.append(configButton);
    }

    if (targetBlock.is('header.sheet-header .profile') || targetBlock.is('header.sheet-header .profile-img-container') ) {
        targetBlock.after(uiWrapper); // Common placement for D&D5e
    } else {
        targetBlock.append(uiWrapper); // Fallback
    }

    try { if (app.rendered) app.setPosition({ height: "auto" }); } catch (e) { /* Ignore */ }

    if (isWeightContainer && item.actor) { // Progress bar needs actor context
        const contentsTab = html.find('.tab[data-tab="contents"]');
        if (contentsTab.length > 0) {
            const capacityDisplay = contentsTab.find('.encumbrance, .container-capacity'); // D&D5e 2.x/3.x and 4.x
            if (capacityDisplay.length) {
                updateContainerProgressBar(capacityDisplay, item, item.actor); // options will use defaults
            }
        }
    }
});

Hooks.on('preCreateItem', (itemDoc, createData, options, userId) => {
    if (game.userId !== userId && !game.user.isGM) return true;
    const parentActor = itemDoc.parent;
    const containerId = foundry.utils.getProperty(createData, 'system.container') ?? foundry.utils.getProperty(itemDoc.toObject(false), 'system.container');
    if (!(parentActor instanceof Actor) || !containerId) return true;
    if (itemDoc.isTemporary) return true;

    const actor = parentActor;
    const container = actor.items.get(containerId);
    if (!container || !isActualWeightContainer(container)) return true;

    const containerMaxWeightBase = Number(foundry.utils.getProperty(container, "system.capacity.weight.value") ?? 0);
    if (containerMaxWeightBase <= 0) return true;

    let effectiveWeightToAddBase = 0;
    try {
        const tempItemData = foundry.utils.mergeObject(itemDoc.toObject(false), createData); // createData overrides itemDoc data
        if (!tempItemData.system) tempItemData.system = {}; // ensure system object
        foundry.utils.mergeObject(tempItemData.system, createData.system ?? {}, {inplace: true}); // merge system data
        if (!tempItemData._id) tempItemData._id = foundry.utils.randomID();

        // Crucially, set the container ID on the temp item for getEffectiveItemWeight
        if (containerId) tempItemData.system.container = containerId;

        const tempItemDoc = new Item.implementation(tempItemData, { temporary: true, parent: actor });
        const itemToAddQuantity = Number(foundry.utils.getProperty(tempItemData, 'system.quantity') ?? 1);
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

    const currentWeightBase = calculateCurrentContainerWeight(container, actor, false);
    if (isNaN(currentWeightBase)) {
        console.error(`${MODULE_ID} | ERROR preCreateItem: currentWeightBase is NaN.`);
        return false;
    }

    const potentialTotalWeightBase = currentWeightBase + effectiveWeightToAddBase;
    const tolerance = 0.001;

    if (potentialTotalWeightBase > containerMaxWeightBase + tolerance) {
        let msg = game.settings.get(MODULE_ID, 'capacityExceededMessage');
        if (!msg) {
            msg = game.i18n.localize("WEIGHTYCONTAINERS.CapacityExceeded");
        }
        msg = msg.replace("{item}", (createData.name || itemDoc.name)).replace("{container}", container.name);
        ui.notifications.warn(msg);
        return false;
    }
    return true;
});

Hooks.on('preUpdateItem', (itemDoc, change, options, userId) => {
    if (game.userId !== userId && !game.user.isGM) return true;
    if (!(itemDoc.parent instanceof Actor)) return true;
    if (itemDoc.isTemporary) return true;

    const actor = itemDoc.parent;
    const originalContainerId = foundry.utils.getProperty(itemDoc, "system.container");
    const isChangingContainer = foundry.utils.hasProperty(change, 'system.container');
    const targetContainerId = isChangingContainer ? foundry.utils.getProperty(change, 'system.container') : originalContainerId;

    if (!targetContainerId) return true; // Not moving into or within a container relevant to this check

    const container = actor.items.get(targetContainerId);
    if (!container || !isActualWeightContainer(container)) return true;

    const containerMaxWeightBase = Number(foundry.utils.getProperty(container, "system.capacity.weight.value") ?? 0);
    if (containerMaxWeightBase <= 0) return true;

    const oldQuantity = foundry.utils.getProperty(itemDoc, "system.quantity") ?? 1;
    const newQuantity = foundry.utils.getProperty(change, 'system.quantity') ?? oldQuantity;

    // Create a temporary item reflecting ALL proposed changes (including potential new container ID)
    const changedItemData = foundry.utils.mergeObject(itemDoc.toObject(false), change);
    if (!changedItemData.system) changedItemData.system = {};
    foundry.utils.mergeObject(changedItemData.system, change.system ?? {}, {inplace: true});
    // Ensure the temp item uses the TARGET container ID for weight calculation
    if (targetContainerId) changedItemData.system.container = targetContainerId;
    else delete changedItemData.system.container; // if moving out of all containers

    const tempChangedItemDoc = new Item.implementation(changedItemData, { temporary: true, parent: actor });
    const effectiveSingleItemWeightBase = getEffectiveItemWeight(tempChangedItemDoc, actor, false);

    if (isNaN(effectiveSingleItemWeightBase)) {
        console.error(`${MODULE_ID} | ERROR preUpdateItem: effectiveSingleItemWeightBase is NaN for item ${itemDoc.name}.`);
        return false;
    }

    let weightChangeInTargetContainerBase = 0;

    if (isChangingContainer && targetContainerId !== originalContainerId) { // Item is moving
        if (targetContainerId === container.id) { // Moving INTO this specific container
            weightChangeInTargetContainerBase = effectiveSingleItemWeightBase * newQuantity;
        } else { // Moving to a different container or out entirely, no check for *this* specific container.
            return true;
        }
    } else if (targetContainerId === container.id && newQuantity > oldQuantity) { // Quantity increase within this container
        const quantityIncrease = newQuantity - oldQuantity;
        weightChangeInTargetContainerBase = effectiveSingleItemWeightBase * quantityIncrease;
    } else { // Quantity decrease, or no relevant change for *this* container
        return true;
    }

    if (weightChangeInTargetContainerBase <= 0) return true; // Not adding net weight

    let currentWeightInTargetContainerBase = calculateCurrentContainerWeight(container, actor, false);
    // If the item was already in this container, its original contribution must be subtracted
    // before adding its new contribution, to correctly assess the *change*.
    // However, the weightChangeInTargetContainerBase already represents the NET ADDED weight.
    // So, currentWeightBase is simply the container's current contents.

    if (originalContainerId === targetContainerId) {
        // If item was ALREADY in this container, its *original* weight contribution is part of currentWeightInTargetContainerBase.
        // We need to subtract that original contribution if we are checking the total capacity against the *new* total.
        // Let original single item weight be calculated based on itemDoc and originalContainerId (which is targetContainerId here)
        const originalItemDocForWeight = new Item.implementation(itemDoc.toObject(false), {temporary: true, parent:actor});
        if (originalContainerId) originalItemDocForWeight.system.container = originalContainerId;
        const originalSingleItemWeightBase = getEffectiveItemWeight(originalItemDocForWeight, actor, false);
        currentWeightInTargetContainerBase -= originalSingleItemWeightBase * oldQuantity;
        currentWeightInTargetContainerBase = Math.max(0, currentWeightInTargetContainerBase); // safety
    }

    const potentialTotalWeightBase = currentWeightInTargetContainerBase + (effectiveSingleItemWeightBase * newQuantity) ; // Add the full new stack weight

    const tolerance = 0.001;
    if (potentialTotalWeightBase > containerMaxWeightBase + tolerance) {
        let msg = game.settings.get(MODULE_ID, 'capacityExceededMessage');
        if (!msg) {
            msg = game.i18n.localize("WEIGHTYCONTAINERS.CapacityExceeded");
        }
        const itemName = foundry.utils.getProperty(change, 'name') || itemDoc.name;
        msg = msg.replace("{item}", itemName).replace("{container}", container.name);
        ui.notifications.warn(msg);
        return false;
    }
    return true;
});

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
        const weightCell = $element.find('.item-weight, .weight');
        const existingSpan = weightCell.find('.weighty-effective-weight');
        existingSpan.remove(); // Clear previous first

        if (containerId) {
            const container = actor.items.get(containerId);
            if (container && isActualWeightContainer(container)) {
                const reductionPercent = getWeightReductionPercent(container);
                if (reductionPercent > 0) {
                    const effectiveWeightDisplay = getEffectiveItemWeight(item, actor, true);
                    const weightSource = foundry.utils.getProperty(item, "system.weight");
                    let baseWeightItem = 0;
                    if (typeof weightSource === 'number') baseWeightItem = weightSource;
                    else if (typeof weightSource === 'object' && weightSource?.value !== undefined) baseWeightItem = Number(weightSource.value) || 0;
                    else if (typeof weightSource === 'string') baseWeightItem = parseFloat(weightSource) || 0;

                    const originalWeightDisplay = baseWeightItem * displayUnitsMultiplier;

                    if (Math.abs(effectiveWeightDisplay - originalWeightDisplay) > 0.001 && weightCell.length > 0) {
                        const displayWeightText = effectiveWeightDisplay.toFixed(Math.max(1, Number.isInteger(effectiveWeightDisplay) ? 0 : 2));
                        const effectiveWeightSpan = $(`<span class="weighty-effective-weight" style="font-size: 0.9em; opacity: 0.8;"> (${game.i18n.localize('WEIGHTYCONTAINERS.EffectiveAbbreviation')}: ${displayWeightText} ${units})</span>`);
                        // Try to append after the main weight text, not inside another span
                        const mainWeightTextNode = weightCell.contents().filter((_, el) => el.nodeType === Node.TEXT_NODE && el.textContent.trim() !== "").first();
                        if (mainWeightTextNode.length) mainWeightTextNode.after(effectiveWeightSpan);
                        else weightCell.append(effectiveWeightSpan);
                    }
                }
            }
        }

        if (item.type === 'container' && isActualWeightContainer(item)) {
            // For D&D 5e 4.x, capacity is often in .item-controls > .container-capacity
            let capacityDisplay = $element.find('.item-controls .container-capacity');
            if (capacityDisplay.length === 0) { // Fallback for older or different sheets
                capacityDisplay = $element.find('.encumbrance'); // Look for general encumbrance div for this item
            }
            if (capacityDisplay.length > 0) {
                updateContainerProgressBar(capacityDisplay, item, actor);
            }
        }
    });
});

function refreshActorAndItemSheets(actorId, itemId = null) {
    const actor = game.actors.get(actorId);
    if (!actor) return;

    if (actor.sheet?.rendered) {
        actor.sheet.render(false);
    }

    if (itemId) {
        const item = actor.items.get(itemId);
        if (item && item.sheet?.rendered) {
            item.sheet.render(false);
        }
        // If the item itself is a container, or was in a container, refresh related sheets
        if (item?.type === 'container') {
            Object.values(ui.windows).forEach(win => {
                if (win instanceof ItemSheet && win.object.id === item.id && win.rendered) {
                    win.render(false);
                }
            });
        }
        const itemContainerId = foundry.utils.getProperty(item, "system.container");
        if(itemContainerId) {
            const container = actor.items.get(itemContainerId);
            if (container && container.sheet?.rendered) container.sheet.render(false);
        }
    }
    // Also refresh sheets of any open containers for this actor
    actor.items.filter(i => i.type === 'container' && i.sheet?.rendered).forEach(c => c.sheet.render(false));
}

Hooks.on("updateItem", (item, change, options, userId) => {
    if (!item.actor) return;
    const flagPath = `flags.${MODULE_ID}.${FLAG_WEIGHT_REDUCTION}`;
    const relevantChange = foundry.utils.hasProperty(change, flagPath)
                       || foundry.utils.hasProperty(change, 'system.container')
                       || foundry.utils.hasProperty(change, 'system.quantity')
                       || foundry.utils.hasProperty(change, 'system.weight')
                       || (item.type === 'container' && foundry.utils.hasProperty(change, 'system.capacity.weight.value'));

    if (relevantChange) {
        foundry.utils.debounce(() => {
            refreshActorAndItemSheets(item.actor.id, item.id);
            if (game.user.id === userId) { // Only user initiating change broadcasts
                let broadcastItemId = item.id;
                // If content changed container, broadcast update for old and new container if they are different
                const oldContainerId = foundry.utils.getProperty(item, "_source.system.container");
                const newContainerId = foundry.utils.getProperty(item, "system.container");
                if (newContainerId && newContainerId !== oldContainerId) broadcastContainerUpdate(newContainerId, item.actor.id);
                if (oldContainerId && oldContainerId !== newContainerId) broadcastContainerUpdate(oldContainerId, item.actor.id);
                broadcastContainerUpdate(item.id, item.actor.id); // broadcast for the item itself too
            }
        }, 150)();
    }
});

Hooks.on("createItem", (itemDoc, options, userId) => {
    if (itemDoc.actor) {
        foundry.utils.debounce(() => {
            refreshActorAndItemSheets(itemDoc.actor.id, itemDoc.id);
            if (game.user.id === userId) {
                const containerId = foundry.utils.getProperty(itemDoc, "system.container");
                if (containerId) broadcastContainerUpdate(containerId, itemDoc.actor.id);
                broadcastContainerUpdate(null, itemDoc.actor.id); // General actor update
            }
        }, 150)();
    }
});

Hooks.on("deleteItem", (itemDoc, options, userId) => {
    const actor = itemDoc.actor;
    const itemType = itemDoc.type;
    const itemContainerId = foundry.utils.getProperty(itemDoc.toObject(false), "system.container"); // Get from data as itemDoc might be gone
    const deletedItemId = itemDoc.id;

    if (actor && (itemContainerId || itemType === 'container')) {
        foundry.utils.debounce(() => {
            // Actor sheet will re-render due to data change.
            // We need to ensure other relevant sheets are updated or closed, and other clients are notified.
            if (actor.sheet?.rendered) {
                actor.sheet.render(false);
            }

            let containerToRefreshId = itemContainerId; // If item was in a container, that container needs refresh.

            if (itemType === 'container') {
                // If the deleted item was a container, its own sheet (if open) should close.
                // Other clients also need to know this container is gone.
                Object.values(ui.windows).forEach(win => {
                    if (win instanceof ItemSheet && win.object.id === deletedItemId && win.rendered) {
                        win.close();
                    }
                });
                // If the deleted container was itself inside another container, that parent container might need an update
                // but this scenario is less common for "weighty" containers.
                containerToRefreshId = deletedItemId; // Signal this container ID was deleted
            }

            if (containerToRefreshId && containerToRefreshId !== deletedItemId) { // if it was content in a container
                const container = actor.items.get(containerToRefreshId);
                if (container && container.sheet?.rendered) {
                    container.sheet.render(false);
                }
            }

            if (game.user.id === userId) {
                if (containerToRefreshId) broadcastContainerUpdate(containerToRefreshId, actor.id);
                broadcastContainerUpdate(null, actor.id); // General actor update as well
            }

        }, 150)();
    }
});