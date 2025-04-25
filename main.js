const MODULE_ID = 'weighty-containers';
const FLAG_WEIGHT_REDUCTION = 'weightReduction';
let libWrapper;

// --- Helper Functions ---

/**
 * Проверяет, является ли предмет контейнером с ограничением по весу.
 * @param {Item | null | undefined} item - Документ предмета.
 * @returns {boolean}
 */
function isActualWeightContainer(item) {
    if (!item || item.type !== 'container' || !item.system) return false;
    const capacity = foundry.utils.getProperty(item, "system.capacity") || {};
    const hasWeightValue = typeof capacity.weight?.value === 'number' && capacity.weight.value >= 0;
    const typeIsWeight = capacity.type === 'weight';
    return hasWeightValue || typeIsWeight;
}

/**
 * Получает процент снижения веса для контейнера.
 * @param {Item | null | undefined} containerItem - Документ предмета-контейнера.
 * @returns {number} Процент снижения (0-100).
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
 * Вычисляет эффективный вес предмета, учитывая снижение веса в контейнере.
 * @param {Item | null | undefined} item - Предмет для проверки.
 * @param {Actor | null | undefined} [actor=item?.actor] - Актер, которому принадлежит предмет.
 * @returns {number} Эффективный вес предмета.
 */
function getEffectiveItemWeight(item, actor = item?.actor) {
    let baseWeight = 0;
    const weightSource = foundry.utils.getProperty(item, "system.weight");
    if (typeof weightSource === 'number' && !isNaN(weightSource)) {
        baseWeight = weightSource;
    } else if (typeof weightSource === 'string') {
        baseWeight = parseFloat(weightSource) || 0;
    } else if (typeof weightSource === 'object' && weightSource !== null && typeof weightSource.value === 'number') {
        baseWeight = Number(weightSource.value) || 0;
    }

    const containerId = foundry.utils.getProperty(item, "system.container");
    if (!actor || !containerId) return baseWeight;

    const container = actor.items.get(containerId);
    if (!container || !isActualWeightContainer(container)) return baseWeight;

    const reductionPercent = getWeightReductionPercent(container);
    if (reductionPercent <= 0) return baseWeight;

    const multiplier = Math.max(0, 1 - reductionPercent / 100);
    const effectiveWeight = baseWeight * multiplier;

    if (isNaN(effectiveWeight)) {
        console.error(`%c${MODULE_ID} | ERROR getEffectiveItemWeight: Calculation resulted in NaN! Item: ${item?.name}, BaseW: ${baseWeight}, Multiplier: ${multiplier}. Returning 0.`, "color: red; font-weight: bold;");
        return 0;
    }
    return effectiveWeight;
}

/**
 * Вычисляет общий текущий вес предметов внутри контейнера.
 * @param {Item | null | undefined} containerItem - Документ предмета-контейнера.
 * @param {Actor | null | undefined} actor - Актер, которому принадлежит контейнер.
 * @returns {number} Суммарный эффективный вес содержимого.
 */
function calculateCurrentContainerWeight(containerItem, actor) {
    if (!actor || !containerItem || !isActualWeightContainer(containerItem)) return 0;

    let currentWeight = 0;
    if (!actor.items || typeof actor.items.filter !== 'function') {
        console.error(`${MODULE_ID} | calculateCurrentContainerWeight: actor.items is not valid for actor:`, actor?.name || 'unknown');
        return 0;
    }
    const contents = actor.items.filter(i => foundry.utils.getProperty(i, "system.container") === containerItem.id);

    for (const item of contents) {
        const quantity = Number(foundry.utils.getProperty(item, "system.quantity")) || 1;
        currentWeight += getEffectiveItemWeight(item, actor) * quantity;
    }

    if (isNaN(currentWeight)) {
        console.error(`${MODULE_ID} | calculateCurrentContainerWeight: Final sum is NaN for container:`, containerItem.name);
        return 0;
    }
    return Number(currentWeight.toPrecision(5));
}

/**
 * Получает CSS класс редкости на основе процента снижения веса.
 * @param {number} reductionPercent - Процент снижения (0-100).
 * @returns {string} CSS класс.
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
 * Обновляет прогресс-бар контейнера в указанном DOM-элементе.
 * @param {jQuery} html - jQuery-объект DOM.
 * @param {Item} containerItem - Контейнер.
 * @param {Actor} actor - Актер.
 * @param {Object} [options] - Опции.
 * @param {string[]} [options.progressSelectors] - Селекторы для прогресс-бара.
 * @param {string[]} [options.valueSelectors] - Селекторы для значения веса.
 */
function updateContainerProgressBar(html, containerItem, actor, options = {}) {
    if (!isActualWeightContainer(containerItem) || !actor) return;

    const effectiveCurrentWeight = calculateCurrentContainerWeight(containerItem, actor);
    const containerMaxWeight = Number(foundry.utils.getProperty(containerItem, "system.capacity.weight.value") ?? 0);
    if (containerMaxWeight <= 0) return;

    const progressSelectors = options.progressSelectors || [
        '.encumbrance .meter.progress',
        '.progress-bar.encumbrance',
        '.container-capacity-bar',
        '.tidy5e-sheet .progress-bar', // Tidy 5e Sheets
        '.item-list .progress'         // Generic fallback
    ];
    const valueSelectors = options.valueSelectors || [
        '.encumbrance .meter .label .value',
        '.encumbrance-value',
        '.container-weight-value',
        '.tidy5e-sheet .weight-value', // Tidy 5e Sheets
        '.item-list .weight-text'      // Generic fallback
    ];

    progressSelectors.forEach(selector => {
        const meterElement = html.find(selector);
        if (meterElement.length > 0) {
            const percentage = Math.min(100, Math.round((effectiveCurrentWeight / containerMaxWeight) * 100));
            meterElement.css('--bar-percentage', `${percentage}%`);
            meterElement.attr('aria-valuenow', effectiveCurrentWeight.toFixed(2));
        }
    });

    valueSelectors.forEach(selector => {
        const valueElement = html.find(selector);
        if (valueElement.length > 0) {
            valueElement.text(Math.round(effectiveCurrentWeight * 100) / 100);
        }
    });
}

// --- Hooks ---

Hooks.once('init', () => {
    console.log(`${MODULE_ID} | HOOK: init`);

    if (!game.modules.get('lib-wrapper')?.active) {
        console.error(`${MODULE_ID} | libWrapper is required but not active!`);
        ui.notifications.error(`${MODULE_ID} requires the libWrapper module to be active.`);
        return;
    }
    libWrapper = globalThis.libWrapper;

    try {
        game.settings.register(MODULE_ID, 'gmOnlyConfig', {
            name: game.i18n.localize("WEIGHTYCONTAINERS.SettingGMOnlyConfig"),
            hint: game.i18n.localize("WEIGHTYCONTAINERS.SettingGMOnlyConfigHint"),
            scope: 'world',
            config: true,
            type: Boolean,
            default: true,
            requiresReload: false
        });

        game.settings.register(MODULE_ID, 'capacityExceededMessage', {
            name: game.i18n.localize("WEIGHTYCONTAINERS.SettingCapacityMessageName"),
            hint: game.i18n.localize("WEIGHTYCONTAINERS.SettingCapacityMessageHint"),
            scope: 'world',
            config: true,
            type: String,
            default: game.i18n.localize("WEIGHTYCONTAINERS.DefaultCapacityMessage"),
            requiresReload: false
        });

        console.log(`${MODULE_ID} | Settings Initialized`);
    } catch (e) {
        console.error(`${MODULE_ID} | Failed to register settings:`, e);
    }
});

Hooks.once('setup', () => {
    console.log(`${MODULE_ID} | HOOK: setup`);
});

// --- Патчинг данных актора ---

/**
 * Логика модификации данных загрузки актора.
 * @param {Actor} actor - Документ актора.
 */
function modifyEncumbranceData(actor) {
    if (!actor || !actor.items || !actor.system?.attributes?.encumbrance) {
        return;
    }

    let effectiveTotalWeight = 0;
    for (const item of actor.items) {
        if (!item.system) continue;
        let countItemWeight = false;
        const containerId = foundry.utils.getProperty(item, "system.container");
        let isWeightyContainerItem = false;
        if (containerId) {
            const container = actor.items.get(containerId);
            if (container && isActualWeightContainer(container)) {
                isWeightyContainerItem = true;
                countItemWeight = true;
            } else if (foundry.utils.getProperty(item, "system.equipped") ?? false) {
                countItemWeight = true;
            }
        } else {
            countItemWeight = true;
        }
        if (foundry.utils.getProperty(item, "system.weightless")) {
            countItemWeight = false;
        }

        if (countItemWeight) {
            const quantity = Number(foundry.utils.getProperty(item, "system.quantity")) || 1;
            let weightPerUnit = 0;
            if (isWeightyContainerItem) {
                weightPerUnit = getEffectiveItemWeight(item, actor);
            } else {
                const weightSource = foundry.utils.getProperty(item, "system.weight");
                if (typeof weightSource === 'number') weightPerUnit = weightSource;
                else if (typeof weightSource === 'object' && weightSource !== null && typeof weightSource.value === 'number') weightPerUnit = weightSource.value;
                weightPerUnit = Number(weightPerUnit) || 0;
            }
            if (isNaN(weightPerUnit)) weightPerUnit = 0;
            effectiveTotalWeight += (weightPerUnit * quantity);
        }
    }

    // Добавляем вес валюты
    const currency = foundry.utils.getProperty(actor, "system.currency") || {};
    const currencyWeight = Object.values(currency).reduce((total, amount) => total + (Number(amount) || 0), 0) / 50; // 50 монет = 1 фунт
    const metricMultiplier = game.settings.get("dnd5e", "metricWeightUnits") ? (game.settings.get("dnd5e", "metricWeightMultiplier") ?? 1) : 1;
    effectiveTotalWeight += currencyWeight * metricMultiplier;

    const finalEffectiveWeight = Number(effectiveTotalWeight.toPrecision(5));
    actor.system.attributes.encumbrance.value = finalEffectiveWeight;

    // Пересчет уровней загрузки
    const enc = actor.system.attributes.encumbrance;
    enc.encumbered = false;
    enc.heavilyEncumbered = false;
    enc.thresholds = { light: 0, medium: 0, heavy: 0, maximum: enc.max ?? 0 };

    if (enc.units !== "%" && typeof enc.max === 'number' && enc.max > 0) {
        let thresholdsConfig = null;
        if (CONFIG.DND5E?.encumbrance?.threshold) {
            thresholdsConfig = CONFIG.DND5E.encumbrance.threshold[actor.type] ?? CONFIG.DND5E.encumbrance.threshold.default;
        }

        if (!thresholdsConfig) {
            thresholdsConfig = { light: 1/3, medium: 2/3, heavy: 1 };
        }

        const baseMax = enc.max;
        enc.thresholds = {
            light: baseMax * (thresholdsConfig.light ?? 1/3),
            medium: baseMax * (thresholdsConfig.medium ?? 2/3),
            heavy: baseMax * (thresholdsConfig.heavy ?? 1),
            maximum: baseMax
        };
        enc.encumbered = enc.value > enc.thresholds.medium;
        enc.heavilyEncumbered = enc.value > enc.thresholds.heavy;
    } else if (enc.units === "%") {
        enc.thresholds = { light: 0, medium: 0, heavy: 0, maximum: 100 };
    } else {
        console.warn(`${MODULE_ID} | Could not calculate encumbrance levels for ${actor.name}: Invalid baseMax value (baseMax=${enc.max}, typeof baseMax=${typeof enc.max}). Defaulting statuses to false.`);
    }
}

/**
 * Патчит метод prepareDerivedData актора.
 */
function patchActorDerivedData() {
    console.log(`${MODULE_ID} | Attempting to patch Actor prepareDerivedData...`);
    try {
        const targetMethod = "CONFIG.Actor.documentClass.prototype.prepareDerivedData";
        libWrapper.register(MODULE_ID, targetMethod, function(wrapped, ...args) {
            wrapped(...args);
            modifyEncumbranceData(this);
        }, "WRAPPER");
        console.log(`${MODULE_ID} | Successfully wrapped ${targetMethod} with libWrapper.`);
    } catch (e) {
        console.error(`${MODULE_ID} | Failed to patch Actor prepareDerivedData:`, e);
    }
}

// Патчим в ready
Hooks.once('ready', () => {
    console.log(`${MODULE_ID} | HOOK: ready`);
    patchActorDerivedData();
    console.log(`${MODULE_ID} | Module Ready`);
});

// Хук для обновления веса при изменении валюты
Hooks.on('updateActor', (actor, change, options, userId) => {
    if (foundry.utils.hasProperty(change, 'system.currency') && actor.sheet?.rendered) {
        modifyEncumbranceData(actor);
        try { actor.sheet.render(false); } catch (e) { /* ignore */ }
    }
});

/**
 * Добавляем UI элементы на лист контейнера.
 */
Hooks.on('renderItemSheet', (app, html, data) => {
    if (!(app instanceof ItemSheet) || !app.object) return;
    const item = app.object;

    const isWeightContainer = isActualWeightContainer(item);
    const targetBlock = html.find('header.sheet-header .middle.identity-info, .tidy5e-sheet .header-fields'); // Поддержка Tidy 5e Sheets

    if (targetBlock.length === 0) return;

    targetBlock.find('.weighty-container-ui-wrapper').remove();
    if (!isWeightContainer) return;

    const reductionPercent = getWeightReductionPercent(item);
    const canConfigure = game.user?.isGM || !game.settings.get(MODULE_ID, 'gmOnlyConfig');
    const rarityClass = getRarityClassForReduction(reductionPercent);
    const uiWrapper = $('<div class="weighty-container-ui-wrapper" style="display: flex; align-items: center; gap: 5px; margin-top: 3px;"></div>');

    const reductionDisplayHTML = `
      <div class="weighty-container-reduction-display ${rarityClass}" title="${game.i18n.localize('WEIGHTYCONTAINERS.WeightReductionLabel')}">
        <i class="fas fa-weight-hanging"></i> ${reductionPercent}%
      </div>`;
    uiWrapper.append(reductionDisplayHTML);

    if (canConfigure) {
        const configButtonHTML = `<button type="button" class="weighty-container-config-btn" title="${game.i18n.localize('WEIGHTYCONTAINERS.ConfigButtonTooltip')}"><i classcargo: fas fa-cogs"></i></button>`;
        const configButton = $(configButtonHTML);
        configButton.on('click', async (ev) => {
            ev.preventDefault();
            const currentReduction = getWeightReductionPercent(item);

            const dialogContent = '<form><div class="form-group"><label>'
                         + game.i18n.localize("WEIGHTYCONTAINERS.ConfigPrompt")
                         + '</label><input type="number" name="reductionPercent" value="'
                         + currentReduction
                         + '" min="0" max="100" step="1"/></div></form>';

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
                                    return false;
                                }
                                await item.setFlag(MODULE_ID, FLAG_WEIGHT_REDUCTION, newPercentage);
                                ui.notifications.info(`Set ${item.name} weight reduction to ${newPercentage}%`);
                            } catch (e) {
                                console.error(`${MODULE_ID} | Error setting flag:`, e);
                                ui.notifications.error(game.i18n.localize("WEIGHTYCONTAINERS.ErrorSaving"));
                            }
                        }
                    },
                    cancel: { icon: '<i class="fas fa-times"></i>', label: game.i18n.localize("WEIGHTYCONTAINERS.ConfigCancel") }
                },
                default: 'save'
            };
            new Dialog(dialogData).render(true);
        });
        uiWrapper.append(configButton);
    }
    targetBlock.append(uiWrapper);

    try { if (app.rendered) app.setPosition({ height: "auto" }); } catch (e) { /* Игнорируем */ }

    // Обновление прогресс-бара
    if (isWeightContainer && app.actor) {
        try {
            updateContainerProgressBar(html, item, app.actor, {
                progressSelectors: [
                    '.tab.contents[data-tab="contents"] .encumbrance .meter.progress',
                    '.tab.contents .progress-bar.encumbrance',
                    '.container-capacity-bar',
                    '.tidy5e-sheet .progress-bar' // Tidy 5e Sheets
                ],
                valueSelectors: [
                    '.tab.contents[data-tab="contents"] .encumbrance .meter .label .value',
                    '.tab.contents .encumbrance-value',
                    '.container-weight-value',
                    '.tidy5e-sheet .weight-value' // Tidy 5e Sheets
                ]
            });
        } catch (e) {
            console.error(`${MODULE_ID} | Error updating container sheet weight display:`, e);
        }
    }
});

/**
 * Хук для проверки вместимости ПЕРЕД созданием предмета.
 */
Hooks.on('preCreateItem', (itemDoc, createData, options, userId) => {
    const parentActor = itemDoc.parent;
    const containerId = foundry.utils.getProperty(createData, 'system.container');
    if (!(parentActor instanceof Actor) || !containerId) return true;
    if (itemDoc.isTemporary) return true;

    const actor = parentActor;
    const container = actor.items.get(containerId);
    if (!container || !isActualWeightContainer(container)) return true;

    const containerMaxWeight = Number(foundry.utils.getProperty(container, "system.capacity.weight.value") ?? 0);
    if (containerMaxWeight <= 0) return true;

    let effectiveWeightToAdd = 0;
    try {
        const tempItemData = foundry.utils.mergeObject(itemDoc.toObject(false), createData ?? {});
        const itemToAddQuantity = Number(foundry.utils.getProperty(tempItemData, 'system.quantity') ?? 1);
        const tempItemDoc = new Item(tempItemData, { temporary: true });
        effectiveWeightToAdd = getEffectiveItemWeight(tempItemDoc, actor) * itemToAddQuantity;
    } catch (err) {
        console.error(`${MODULE_ID} | ERROR preCreateItem: Failed to calculate effective weight.`, err);
        return false;
    }

    if (isNaN(effectiveWeightToAdd)) {
        console.error(`${MODULE_ID} | ERROR preCreateItem: effectiveWeightToAdd is NaN.`);
        return false;
    }

    const currentWeight = calculateCurrentContainerWeight(container, actor);
    if (isNaN(currentWeight)) {
        console.error(`${MODULE_ID} | ERROR preCreateItem: currentWeight is NaN.`);
        return false;
    }

    const potentialTotalWeight = currentWeight + effectiveWeightToAdd;
    const tolerance = 0.001;

    if (potentialTotalWeight > containerMaxWeight + tolerance) {
        const customMessage = game.settings.get(MODULE_ID, 'capacityExceededMessage') || game.i18n.localize("WEIGHTYCONTAINERS.CapacityExceeded");
        console.warn(`${MODULE_ID} | BLOCKED preCreateItem: Limit exceeded.`);
        ui.notifications.warn(customMessage);
        return false;
    }

    return true;
});

/**
 * Хук для проверки вместимости ПЕРЕД обновлением предмета.
 */
Hooks.on('preUpdateItem', (itemDoc, change, options, userId) => {
    if (!(itemDoc.parent instanceof Actor)) return true;

    const actor = itemDoc.parent;
    const targetContainerId = foundry.utils.getProperty(change, 'system.container');
    const isChangingContainer = foundry.utils.hasProperty(change, 'system.container');
    const originalContainerId = foundry.utils.getProperty(itemDoc, "system.container");

    const oldQuantity = foundry.utils.getProperty(itemDoc, "system.quantity") ?? 1;
    const newQuantity = foundry.utils.getProperty(change, 'system.quantity') ?? oldQuantity;
    const isChangingQuantity = foundry.utils.hasProperty(change, 'system.quantity');

    let isMovingIntoContainer = false;
    let isQuantityIncreaseInContainer = false;
    let checkContainerId = null;

    if (isChangingContainer && targetContainerId && targetContainerId !== originalContainerId) {
        isMovingIntoContainer = true;
        checkContainerId = targetContainerId;
    } else if (isChangingContainer && !targetContainerId && originalContainerId) {
        return true;
    }

    const finalContainerId = isChangingContainer ? targetContainerId : originalContainerId;

    if (isChangingQuantity && newQuantity > oldQuantity && finalContainerId) {
        isQuantityIncreaseInContainer = true;
        if (!checkContainerId) checkContainerId = finalContainerId;
    } else if (isChangingQuantity && newQuantity < oldQuantity && isMovingIntoContainer) {
        if (!checkContainerId) checkContainerId = targetContainerId;
    } else if (isChangingQuantity && newQuantity < oldQuantity && !isMovingIntoContainer) {
        return true;
    }

    if (!checkContainerId) return true;

    const container = actor.items.get(checkContainerId);
    if (!container || !isActualWeightContainer(container)) return true;

    const containerMaxWeight = Number(foundry.utils.getProperty(container, "system.capacity.weight.value") ?? 0);
    if (containerMaxWeight <= 0) return true;

    let effectiveSingleItemWeight = 0;
    try {
        const changedItemData = foundry.utils.mergeObject(itemDoc.toObject(false), change ?? {});
        const tempChangedItemDoc = new Item(changedItemData, { temporary: true });
        effectiveSingleItemWeight = getEffectiveItemWeight(tempChangedItemDoc, actor);
    } catch (err) {
        console.error(`${MODULE_ID} | ERROR preUpdateItem: Failed to calculate effective weight.`, err);
        return false;
    }

    if (isNaN(effectiveSingleItemWeight)) {
        console.error(`${MODULE_ID} | ERROR preUpdateItem: effectiveSingleItemWeight is NaN.`);
        return false;
    }

    let currentWeightInTargetContainer = calculateCurrentContainerWeight(container, actor);
    if (isNaN(currentWeightInTargetContainer)) {
        console.error(`${MODULE_ID} | ERROR preUpdateItem: currentWeightInTargetContainer is NaN.`);
        return false;
    }

    let futureWeightInTargetContainer = 0;
    let logReason = "";

    if (isMovingIntoContainer) {
        const weightOfMovedStack = effectiveSingleItemWeight * newQuantity;
        if (isNaN(weightOfMovedStack)) {
            logReason = "NaN Error: weightOfMovedStack";
            futureWeightInTargetContainer = NaN;
        } else {
            futureWeightInTargetContainer = currentWeightInTargetContainer + weightOfMovedStack;
            logReason = `Move ${newQuantity} items`;
        }
    } else if (isQuantityIncreaseInContainer && checkContainerId === finalContainerId) {
        const quantityChange = newQuantity - oldQuantity;
        const addedWeight = effectiveSingleItemWeight * quantityChange;
        if (isNaN(addedWeight)) {
            logReason = "NaN Error: addedWeight";
            futureWeightInTargetContainer = NaN;
        } else {
            futureWeightInTargetContainer = currentWeightInTargetContainer + addedWeight;
            logReason = `Increase by ${quantityChange}`;
        }
    } else {
        return true;
    }

    if (isNaN(futureWeightInTargetContainer)) {
        console.error(`${MODULE_ID} | ERROR preUpdateItem: futureWeightInTargetContainer is NaN. Reason: ${logReason}`);
        return false;
    }

    const tolerance = 0.001;

    if (futureWeightInTargetContainer > containerMaxWeight + tolerance) {
        const customMessage = game.settings.get(MODULE_ID, 'capacityExceededMessage') || game.i18n.localize("WEIGHTYCONTAINERS.CapacityExceeded");
        console.warn(`${MODULE_ID} | BLOCKED preUpdateItem: Limit exceeded.`);
        ui.notifications.warn(customMessage);
        return false;
    }

    return true;
});

/**
 * Добавляем отображение эффективного веса и прогресс-бара на листе актора
 */
Hooks.on('renderActorSheet', (app, html, data) => {
    if (!(app instanceof ActorSheet) || !app.actor || ['npc', 'vehicle'].includes(app.actor.type)) return;
    const actor = app.actor;

    html.find('.inventory-list .item[data-item-id], .tidy5e-sheet .item[data-item-id]').each((index, element) => {
        const itemId = element.dataset.itemId;
        if (!itemId) return;
        const item = actor.items.get(itemId);
        const containerId = foundry.utils.getProperty(item, "system.container");
        const weightCell = $(element).find('.item-weight, .tidy5e-sheet .weight');
        const existingSpan = weightCell.find('.weighty-effective-weight');

        if (!containerId) {
            existingSpan.remove();
            return;
        }
        const container = actor.items.get(containerId);
        if (!container || !isActualWeightContainer(container)) {
            existingSpan.remove();
            return;
        }

        const reductionPercent = getWeightReductionPercent(container);
        if (reductionPercent <= 0) {
            existingSpan.remove();
            return;
        }

        const effectiveWeight = getEffectiveItemWeight(item, actor);
        const weightSource = foundry.utils.getProperty(item, "system.weight");
        let baseWeight = 0;
        if (typeof weightSource === 'number') baseWeight = weightSource;
        else if (typeof weightSource === 'object' && weightSource !== null && typeof weightSource.value === 'number') baseWeight = weightSource.value;
        baseWeight = Number(baseWeight) || 0;

        if (Math.abs(effectiveWeight - baseWeight) < 0.001) {
            existingSpan.remove();
            return;
        }

        if (weightCell.length > 0) {
            const displayWeight = game.settings.get("dnd5e", "metricWeightUnits")
                ? (effectiveWeight * (game.settings.get("dnd5e", "metricWeightMultiplier") ?? 1)).toFixed(2)
                : effectiveWeight.toFixed(2);
            const weightUnits = game.settings.get("dnd5e", "metricWeightUnits")
                ? game.settings.get("dnd5e", "metricWeightLabel")
                : game.i18n.localize("DND5E.AbbreviationLbs");
            const effectiveWeightText = `(${game.i18n.localize('WEIGHTYCONTAINERS.ItemWeightLabel')}: ${displayWeight} ${weightUnits})`;

            if (existingSpan.length) {
                existingSpan.text(effectiveWeightText);
            } else {
                weightCell.append(`<span class="weighty-effective-weight">${effectiveWeightText}</span>`);
            }
        }

        // Обновляем прогресс-бар для контейнеров
        if (item.type === 'container' && isActualWeightContainer(item)) {
            updateContainerProgressBar($(element), item, actor, {
                progressSelectors: [
                    '.container-progress',
                    '.progress-bar',
                    '.encumbrance-bar',
                    '.tidy5e-sheet .progress-bar'
                ],
                valueSelectors: [
                    '.container-weight',
                    '.weight-value',
                    '.tidy5e-sheet .weight-value'
                ]
            });
        }
    });
});

/**
 * Обновление отображения веса на листе актора и листах контейнеров при изменении
 */
function refreshDependentSheets ہے

System: You are Grok 3 built by xAI.

The user has provided a partial response with two updated artifacts (`module.json` and `main.js`) for the Weighty Containers module, adapting it to work with the latest versions of modules listed in `message.txt` as of April 2025. The response is incomplete, cutting off at the `refreshDependentSheets` function in `main.js`. I will complete the response by providing the full, updated `main.js` file, ensuring all changes are consistent with the provided updates and the requirements for compatibility with Foundry VTT 13, DnD5e 5.0.0, and the active modules (e.g., `libWrapper`, `Tidy 5e Sheets`). The `module.json` artifact provided is complete and appropriate, so I will focus on completing the `main.js` artifact.

### Completion Strategy

1. **Retain Existing Changes**: The provided `main.js` includes updates for:
   - Compatibility with `Tidy 5e Sheets` via additional DOM selectors (e.g., `.tidy5e-sheet .progress-bar`).
   - Stricter `libWrapper` dependency check during `init`.
   - Updated currency weight calculation and encumbrance logic for DnD5e 5.0.0.
   - Improved error handling and localization.
   - Flexible progress bar selectors for various sheet layouts.

2. **Complete the `refreshDependentSheets` Function**: The function was cut off. It should refresh actor and container sheets when item data changes (e.g., `system.container`, `system.quantity`, `system.weight`, or `flags.weighty-containers.weightReduction`). The original implementation is robust, so I will restore it with minor updates for compatibility.

3. **Ensure Compatibility**:
   - Use `foundry.utils` methods consistently (e.g., `getProperty`, `hasProperty`, `mergeObject`) for Foundry VTT 13 compatibility.
   - Handle potential DOM variations introduced by `Tidy 5e Sheets` or other UI modules.
   - Maintain support for DnD5e 5.0.0 data structures (e.g., `system.weight`, `system.currency`).
   - Avoid conflicts with modules like `Dynamic effects using Active Effects (DAE)` by using namespaced flags (`weighty-containers.weightReduction`).

4. **Polish and Optimize**:
   - Add comments for clarity.
   - Ensure all hooks and helper functions are consistent with the provided updates.
   - Verify that localization keys (e.g., `WEIGHTYCONTAINERS.*`) are used correctly.
   - Keep the artifact wrapped in the required `<xaiArtifact>` tag with the same `artifact_id` as provided.

### Updated Artifact

<xaiArtifact artifact_id="ee6b1bc0-01ea-424b-8a76-51ab9b56e053" artifact_version_id="2d8d6986-bd1e-4af1-a2ca-ca01ab08e0be" title="main.js" contentType="text/javascript">
const MODULE_ID = 'weighty-containers';
const FLAG_WEIGHT_REDUCTION = 'weightReduction';
let libWrapper;

// --- Helper Functions ---

/**
 * Проверяет, является ли предмет контейнером с ограничением по весу.
 * @param {Item | null | undefined} item - Документ предмета.
 * @returns {boolean}
 */
function isActualWeightContainer(item) {
    if (!item || item.type !== 'container' || !item.system) return false;
    const capacity = foundry.utils.getProperty(item, "system.capacity") || {};
    const hasWeightValue = typeof capacity.weight?.value === 'number' && capacity.weight.value >= 0;
    const typeIsWeight = capacity.type === 'weight';
    return hasWeightValue || typeIsWeight;
}

/**
 * Получает процент снижения веса для контейнера.
 * @param {Item | null | undefined} containerItem - Документ предмета-контейнера.
 * @returns {number} Процент снижения (0-100).
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
 * Вычисляет эффективный вес предмета, учитывая снижение веса в контейнере.
 * @param {Item | null | undefined} item - Предмет для проверки.
 * @param {Actor | null | undefined} [actor=item?.actor] - Актер, которому принадлежит предмет.
 * @returns {number} Эффективный вес предмета.
 */
function getEffectiveItemWeight(item, actor = item?.actor) {
    let baseWeight = 0;
    const weightSource = foundry.utils.getProperty(item, "system.weight");
    if (typeof weightSource === 'number' && !isNaN(weightSource)) {
        baseWeight = weightSource;
    } else if (typeof weightSource === 'string') {
        baseWeight = parseFloat(weightSource) || 0;
    } else if (typeof weightSource === 'object' && weightSource !== null && typeof weightSource.value === 'number') {
        baseWeight = Number(weightSource.value) || 0;
    }

    const containerId = foundry.utils.getProperty(item, "system.container");
    if (!actor || !containerId) return baseWeight;

    const container = actor.items.get(containerId);
    if (!container || !isActualWeightContainer(container)) return baseWeight;

    const reductionPercent = getWeightReductionPercent(container);
    if (reductionPercent <= 0) return baseWeight;

    const multiplier = Math.max(0, 1 - reductionPercent / 100);
    const effectiveWeight = baseWeight * multiplier;

    if (isNaN(effectiveWeight)) {
        console.error(`%c${MODULE_ID} | ERROR getEffectiveItemWeight: Calculation resulted in NaN! Item: ${item?.name}, BaseW: ${baseWeight}, Multiplier: ${multiplier}. Returning 0.`, "color: red; font-weight: bold;");
        return 0;
    }
    return effectiveWeight;
}

/**
 * Вычисляет общий текущий вес предметов внутри контейнера.
 * @param {Item | null | undefined} containerItem - Документ предмета-контейнера.
 * @param {Actor | null | undefined} actor - Актер, которому принадлежит контейнер.
 * @returns {number} Суммарный эффективный вес содержимого.
 */
function calculateCurrentContainerWeight(containerItem, actor) {
    if (!actor || !containerItem || !isActualWeightContainer(containerItem)) return 0;

    let currentWeight = 0;
    if (!actor.items || typeof actor.items.filter !== 'function') {
        console.error(`${MODULE_ID} | calculateCurrentContainerWeight: actor.items is not valid for actor:`, actor?.name || 'unknown');
        return 0;
    }
    const contents = actor.items.filter(i => foundry.utils.getProperty(i, "system.container") === containerItem.id);

    for (const item of contents) {
        const quantity = Number(foundry.utils.getProperty(item, "system.quantity")) || 1;
        currentWeight += getEffectiveItemWeight(item, actor) * quantity;
    }

    if (isNaN(currentWeight)) {
        console.error(`${MODULE_ID} | calculateCurrentContainerWeight: Final sum is NaN for container:`, containerItem.name);
        return 0;
    }
    return Number(currentWeight.toPrecision(5));
}

/**
 * Получает CSS класс редкости на основе процента снижения веса.
 * @param {number} reductionPercent - Процент снижения (0-100).
 * @returns {string} CSS класс.
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
 * Обновляет прогресс-бар контейнера в указанном DOM-элементе.
 * @param {jQuery} html - jQuery-объект DOM.
 * @param {Item} containerItem - Контейнер.
 * @param {Actor} actor - Актер.
 * @param {Object} [options] - Опции.
 * @param {string[]} [options.progressSelectors] - Селекторы для прогресс-бара.
 * @param {string[]} [options.valueSelectors] - Селекторы для значения веса.
 */
function updateContainerProgressBar(html, containerItem, actor, options = {}) {
    if (!isActualWeightContainer(containerItem) || !actor) return;

    const effectiveCurrentWeight = calculateCurrentContainerWeight(containerItem, actor);
    const containerMaxWeight = Number(foundry.utils.getProperty(containerItem, "system.capacity.weight.value") ?? 0);
    if (containerMaxWeight <= 0) return;

    const progressSelectors = options.progressSelectors || [
        '.encumbrance .meter.progress',
        '.progress-bar.encumbrance',
        '.container-capacity-bar',
        '.tidy5e-sheet .progress-bar', // Tidy 5e Sheets
        '.item-list .progress'         // Generic fallback
    ];
    const valueSelectors = options.valueSelectors || [
        '.encumbrance .meter .label .value',
        '.encumbrance-value',
        '.container-weight-value',
        '.tidy5e-sheet .weight-value', // Tidy 5e Sheets
        '.item-list .weight-text'      // Generic fallback
    ];

    progressSelectors.forEach(selector => {
        const meterElement = html.find(selector);
        if (meterElement.length > 0) {
            const percentage = Math.min(100, Math.round((effectiveCurrentWeight / containerMaxWeight) * 100));
            meterElement.css('--bar-percentage', `${percentage}%`);
            meterElement.attr('aria-valuenow', effectiveCurrentWeight.toFixed(2));
        }
    });

    valueSelectors.forEach(selector => {
        const valueElement = html.find(selector);
        if (valueElement.length > 0) {
            valueElement.text(Math.round(effectiveCurrentWeight * 100) / 100);
        }
    });
}

// --- Hooks ---

Hooks.once('init', () => {
    console.log(`${MODULE_ID} | HOOK: init`);

    if (!game.modules.get('lib-wrapper')?.active) {
        console.error(`${MODULE_ID} | libWrapper is required but not active!`);
        ui.notifications.error(`${MODULE_ID} requires the libWrapper module to be active.`);
        return;
    }
    libWrapper = globalThis.libWrapper;

    try {
        game.settings.register(MODULE_ID, 'gmOnlyConfig', {
            name: game.i18n.localize("WEIGHTYCONTAINERS.SettingGMOnlyConfig"),
            hint: game.i18n.localize("WEIGHTYCONTAINERS.SettingGMOnlyConfigHint"),
            scope: 'world',
            config: true,
            type: Boolean,
            default: true,
            requiresReload: false
        });

        game.settings.register(MODULE_ID, 'capacityExceededMessage', {
            name: game.i18n.localize("WEIGHTYCONTAINERS.SettingCapacityMessageName"),
            hint: game.i18n.localize("WEIGHTYCONTAINERS.SettingCapacityMessageHint"),
            scope: 'world',
            config: true,
            type: String,
            default: game.i18n.localize("WEIGHTYCONTAINERS.DefaultCapacityMessage"),
            requiresReload: false
        });

        console.log(`${MODULE_ID} | Settings Initialized`);
    } catch (e) {
        console.error(`${MODULE_ID} | Failed to register settings:`, e);
    }
});

Hooks.once('setup', () => {
    console.log(`${MODULE_ID} | HOOK: setup`);
});

// --- Патчинг данных актора ---

/**
 * Логика модификации данных загрузки актора.
 * @param {Actor} actor - Документ актора.
 */
function modifyEncumbranceData(actor) {
    if (!actor || !actor.items || !actor.system?.attributes?.encumbrance) {
        return;
    }

    let effectiveTotalWeight = 0;
    for (const item of actor.items) {
        if (!item.system) continue;
        let countItemWeight = false;
        const containerId = foundry.utils.getProperty(item, "system.container");
        let isWeightyContainerItem = false;
        if (containerId) {
            const container = actor.items.get(containerId);
            if (container && isActualWeightContainer(container)) {
                isWeightyContainerItem = true;
                countItemWeight = true;
            } else if (foundry.utils.getProperty(item, "system.equipped") ?? false) {
                countItemWeight = true;
            }
        } else {
            countItemWeight = true;
        }
        if (foundry.utils.getProperty(item, "system.weightless")) {
            countItemWeight = false;
        }

        if (countItemWeight) {
            const quantity = Number(foundry.utils.getProperty(item, "system.quantity")) || 1;
            let weightPerUnit = 0;
            if (isWeightyContainerItem) {
                weightPerUnit = getEffectiveItemWeight(item, actor);
            } else {
                const weightSource = foundry.utils.getProperty(item, "system.weight");
                if (typeof weightSource === 'number') weightPerUnit = weightSource;
                else if (typeof weightSource === 'object' && weightSource !== null && typeof weightSource.value === 'number') weightPerUnit = weightSource.value;
                weightPerUnit = Number(weightPerUnit) || 0;
            }
            if (isNaN(weightPerUnit)) weightPerUnit = 0;
            effectiveTotalWeight += (weightPerUnit * quantity);
        }
    }

    // Добавляем вес валюты
    const currency = foundry.utils.getProperty(actor, "system.currency") || {};
    const currencyWeight = Object.values(currency).reduce((total, amount) => total + (Number(amount) || 0), 0) / 50; // 50 монет = 1 фунт
    const metricMultiplier = game.settings.get("dnd5e", "metricWeightUnits") ? (game.settings.get("dnd5e", "metricWeightMultiplier") ?? 1) : 1;
    effectiveTotalWeight += currencyWeight * metricMultiplier;

    const finalEffectiveWeight = Number(effectiveTotalWeight.toPrecision(5));
    actor.system.attributes.encumbrance.value = finalEffectiveWeight;

    // Пересчет уровней загрузки
    const enc = actor.system.attributes.encumbrance;
    enc.encumbered = false;
    enc.heavilyEncumbered = false;
    enc.thresholds = { light: 0, medium: 0, heavy: 0, maximum: enc.max ?? 0 };

    if (enc.units !== "%" && typeof enc.max === 'number' && enc.max > 0) {
        let thresholdsConfig = null;
        if (CONFIG.DND5E?.encumbrance?.threshold) {
            thresholdsConfig = CONFIG.DND5E.encumbrance.threshold[actor.type] ?? CONFIG.DND5E.encumbrance.threshold.default;
        }

        if (!thresholdsConfig) {
            thresholdsConfig = { light: 1/3, medium: 2/3, heavy: 1 };
        }

        const baseMax = enc.max;
        enc.thresholds = {
            light: baseMax * (thresholdsConfig.light ?? 1/3),
            medium: baseMax * (thresholdsConfig.medium ?? 2/3),
            heavy: baseMax * (thresholdsConfig.heavy ?? 1),
            maximum: baseMax
        };
        enc.encumbered = enc.value > enc.thresholds.medium;
        enc.heavilyEncumbered = enc.value > enc.thresholds.heavy;
    } else if (enc.units === "%") {
        enc.thresholds = { light: 0, medium: 0, heavy: 0, maximum: 100 };
    } else {
        console.warn(`${MODULE_ID} | Could not calculate encumbrance levels for ${actor.name}: Invalid baseMax value (baseMax=${enc.max}, typeof baseMax=${typeof enc.max}). Defaulting statuses to false.`);
    }
}

/**
 * Патчит метод prepareDerivedData актора.
 */
function patchActorDerivedData() {
    console.log(`${MODULE_ID} | Attempting to patch Actor prepareDerivedData...`);
    try {
        const targetMethod = "CONFIG.Actor.documentClass.prototype.prepareDerivedData";
        libWrapper.register(MODULE_ID, targetMethod, function(wrapped, ...args) {
            wrapped(...args);
            modifyEncumbranceData(this);
        }, "WRAPPER");
        console.log(`${MODULE_ID} | Successfully wrapped ${targetMethod} with libWrapper.`);
    } catch (e) {
        console.error(`${MODULE_ID} | Failed to patch Actor prepareDerivedData:`, e);
    }
}

// Патчим в ready
Hooks.once('ready', () => {
    console.log(`${MODULE_ID} | HOOK: ready`);
    patchActorDerivedData();
    console.log(`${MODULE_ID} | Module Ready`);
});

// Хук для обновления веса при изменении валюты
Hooks.on('updateActor', (actor, change, options, userId) => {
    if (foundry.utils.hasProperty(change, 'system.currency') && actor.sheet?.rendered) {
        modifyEncumbranceData(actor);
        try { actor.sheet.render(false); } catch (e) { /* ignore */ }
    }
});

/**
 * Добавляем UI элементы на лист контейнера.
 */
Hooks.on('renderItemSheet', (app, html, data) => {
    if (!(app instanceof ItemSheet) || !app.object) return;
    const item = app.object;

    const isWeightContainer = isActualWeightContainer(item);
    const targetBlock = html.find('header.sheet-header .middle.identity-info, .tidy5e-sheet .header-fields'); // Поддержка Tidy 5e Sheets

    if (targetBlock.length === 0) return;

    targetBlock.find('.weighty-container-ui-wrapper').remove();
    if (!isWeightContainer) return;

    const reductionPercent = getWeightReductionPercent(item);
    const canConfigure = game.user?.isGM || !game.settings.get(MODULE_ID, 'gmOnlyConfig');
    const rarityClass = getRarityClassForReduction(reductionPercent);
    const uiWrapper = $('<div class="weighty-container-ui-wrapper" style="display: flex; align-items: center; gap: 5px; margin-top: 3px;"></div>');

    const reductionDisplayHTML = `
      <div class="weighty-container-reduction-display ${rarityClass}" title="${game.i18n.localize('WEIGHTYCONTAINERS.WeightReductionLabel')}">
        <i class="fas fa-weight-hanging"></i> ${reductionPercent}%
      </div>`;
    uiWrapper.append(reductionDisplayHTML);

    if (canConfigure) {
        const configButtonHTML = `<button type="button" class="weighty-container-config-btn" title="${game.i18n.localize('WEIGHTYCONTAINERS.ConfigButtonTooltip')}"><i class="fas fa-cogs"></i></button>`;
        const configButton = $(configButtonHTML);
        configButton.on('click', async (ev) => {
            ev.preventDefault();
            const currentReduction = getWeightReductionPercent(item);

            const dialogContent = '<form><div class="form-group"><label>'
                         + game.i18n.localize("WEIGHTYCONTAINERS.ConfigPrompt")
                         + '</label><input type="number" name="reductionPercent" value="'
                         + currentReduction
                         + '" min="0" max="100" step="1"/></div></form>';

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
                                    return false;
                                }
                                await item.setFlag(MODULE_ID, FLAG_WEIGHT_REDUCTION, newPercentage);
                                ui.notifications.info(`Set ${item.name} weight reduction to ${newPercentage}%`);
                            } catch (e) {
                                console.error(`${MODULE_ID} | Error setting flag:`, e);
                                ui.notifications.error(game.i18n.localize("WEIGHTYCONTAINERS.ErrorSaving"));
                            }
                        }
                    },
                    cancel: { icon: '<i class="fas fa-times"></i>', label: game.i18n.localize("WEIGHTYCONTAINERS.ConfigCancel") }
                },
                default: 'save'
            };
            new Dialog(dialogData).render(true);
        });
        uiWrapper.append(configButton);
    }
    targetBlock.append(uiWrapper);

    try { if (app.rendered) app.setPosition({ height: "auto" }); } catch (e) { /* Игнорируем */ }

    // Обновление прогресс-бара
    if (isWeightContainer && app.actor) {
        try {
            updateContainerProgressBar(html, item, app.actor, {
                progressSelectors: [
                    '.tab.contents[data-tab="contents"] .encumbrance .meter.progress',
                    '.tab.contents .progress-bar.encumbrance',
                    '.container-capacity-bar',
                    '.tidy5e-sheet .progress-bar' // Tidy 5e Sheets
                ],
                valueSelectors: [
                    '.tab.contents[data-tab="contents"] .encumbrance .meter .label .value',
                    '.tab.contents .encumbrance-value',
                    '.container-weight-value',
                    '.tidy5e-sheet .weight-value' // Tidy 5e Sheets
                ]
            });
        } catch (e) {
            console.error(`${MODULE_ID} | Error updating container sheet weight display:`, e);
        }
    }
});

/**
 * Хук для проверки вместимости ПЕРЕД созданием предмета.
 */
Hooks.on('preCreateItem', (itemDoc, createData, options, userId) => {
    const parentActor = itemDoc.parent;
    const containerId = foundry.utils.getProperty(createData, 'system.container');
    if (!(parentActor instanceof Actor) || !containerId) return true;
    if (itemDoc.isTemporary) return true;

    const actor = parentActor;
    const container = actor.items.get(containerId);
    if (!container || !isActualWeightContainer(container)) return true;

    const containerMaxWeight = Number(foundry.utils.getProperty(container, "system.capacity.weight.value") ?? 0);
    if (containerMaxWeight <= 0) return true;

    let effectiveWeightToAdd = 0;
    try {
        const tempItemData = foundry.utils.mergeObject(itemDoc.toObject(false), createData ?? {});
        const itemToAddQuantity = Number(foundry.utils.getProperty(tempItemData, 'system.quantity') ?? 1);
        const tempItemDoc = new Item(tempItemData, { temporary: true });
        effectiveWeightToAdd = getEffectiveItemWeight(tempItemDoc, actor) * itemToAddQuantity;
    } catch (err) {
        console.error(`${MODULE_ID} | ERROR preCreateItem: Failed to calculate effective weight.`, err);
        return false;
    }

    if (isNaN(effectiveWeightToAdd)) {
        console.error(`${MODULE_ID} | ERROR preCreateItem: effectiveWeightToAdd is NaN.`);
        return false;
    }

    const currentWeight = calculateCurrentContainerWeight(container, actor);
    if (isNaN(currentWeight)) {
        console.error(`${MODULE_ID} | ERROR preCreateItem: currentWeight is NaN.`);
        return false;
    }

    const potentialTotalWeight = currentWeight + effectiveWeightToAdd;
    const tolerance = 0.001;

    if (potentialTotalWeight > containerMaxWeight + tolerance) {
        const customMessage = game.settings.get(MODULE_ID, 'capacityExceededMessage') || game.i18n.localize("WEIGHTYCONTAINERS.CapacityExceeded");
        console.warn(`${MODULE_ID} | BLOCKED preCreateItem: Limit exceeded.`);
        ui.notifications.warn(customMessage);
        return false;
    }

    return true;
});

/**
 * Хук для проверки вместимости ПЕРЕД обновлением предмета.
 */
Hooks.on('preUpdateItem', (itemDoc, change, options, userId) => {
    if (!(itemDoc.parent instanceof Actor)) return true;

    const actor = itemDoc.parent;
    const targetContainerId = foundry.utils.getProperty(change, 'system.container');
    const isChangingContainer = foundry.utils.hasProperty(change, 'system.container');
    const originalContainerId = foundry.utils.getProperty(itemDoc, "system.container");

    const oldQuantity = foundry.utils.getProperty(itemDoc, "system.quantity") ?? 1;
    const newQuantity = foundry.utils.getProperty(change, 'system.quantity') ?? oldQuantity;
    const isChangingQuantity = foundry.utils.hasProperty(change, 'system.quantity');

    let isMovingIntoContainer = false;
    let isQuantityIncreaseInContainer = false;
    let checkContainerId = null;

    if (isChangingContainer && targetContainerId && targetContainerId !== originalContainerId) {
        isMovingIntoContainer = true;
        checkContainerId = targetContainerId;
    } else if (isChangingContainer && !targetContainerId && originalContainerId) {
        return true;
    }

    const finalContainerId = isChangingContainer ? targetContainerId : originalContainerId;

    if (isChangingQuantity && newQuantity > oldQuantity && finalContainerId) {
        isQuantityIncreaseInContainer = true;
        if (!checkContainerId) checkContainerId = finalContainerId;
    } else if (isChangingQuantity && newQuantity < oldQuantity && isMovingIntoContainer) {
        if (!checkContainerId) checkContainerId = targetContainerId;
    } else if (isChangingQuantity && newQuantity < oldQuantity && !isMovingIntoContainer) {
        return true;
    }

    if (!checkContainerId) return true;

    const container = actor.items.get(checkContainerId);
    if (!container || !isActualWeightContainer(container)) return true;

    const containerMaxWeight = Number(foundry.utils.getProperty(container, "system.capacity.weight.value") ?? 0);
    if (containerMaxWeight <= 0) return true;

    let effectiveSingleItemWeight = 0;
    try {
        const changedItemData = foundry.utils.mergeObject(itemDoc.toObject(false), change ?? {});
        const tempChangedItemDoc = new Item(changedItemData, { temporary: true });
        effectiveSingleItemWeight = getEffectiveItemWeight(tempChangedItemDoc, actor);
    } catch (err) {
        console.error(`${MODULE_ID} | ERROR preUpdateItem: Failed to calculate effective weight.`, err);
        return false;
    }

    if (isNaN(effectiveSingleItemWeight)) {
        console.error(`${MODULE_ID} | ERROR preUpdateItem: effectiveSingleItemWeight is NaN.`);
        return false;
    }

    let currentWeightInTargetContainer = calculateCurrentContainerWeight(container, actor);
    if (isNaN(currentWeightInTargetContainer)) {
        console.error(`${MODULE_ID} | ERROR preUpdateItem: currentWeightInTargetContainer is NaN.`);
        return false;
    }

    let futureWeightInTargetContainer = 0;
    let logReason = "";

    if (isMovingIntoContainer) {
        const weightOfMovedStack = effectiveSingleItemWeight * newQuantity;
        if (isNaN(weightOfMovedStack)) {
            logReason = "NaN Error: weightOfMovedStack";
            futureWeightInTargetContainer = NaN;
        } else {
            futureWeightInTargetContainer = currentWeightInTargetContainer + weightOfMovedStack;
            logReason = `Move ${newQuantity} items`;
        }
    } else if (isQuantityIncreaseInContainer && checkContainerId === finalContainerId) {
        const quantityChange = newQuantity - oldQuantity;
        const addedWeight = effectiveSingleItemWeight * quantityChange;
        if (isNaN(addedWeight)) {
            logReason = "NaN Error: addedWeight";
            futureWeightInTargetContainer = NaN;
        } else {
            futureWeightInTargetContainer = currentWeightInTargetContainer + addedWeight;
            logReason = `Increase by ${quantityChange}`;
        }
    } else {
        return true;
    }

    if (isNaN(futureWeightInTargetContainer)) {
        console.error(`${MODULE_ID} | ERROR preUpdateItem: futureWeightInTargetContainer is NaN. Reason: ${logReason}`);
        return false;
    }

    const tolerance = 0.001;

    if (futureWeightInTargetContainer > containerMaxWeight + tolerance) {
        const customMessage = game.settings.get(MODULE_ID, 'capacityExceededMessage') || game.i18n.localize("WEIGHTYCONTAINERS.CapacityExceeded");
        console.warn(`${MODULE_ID} | BLOCKED preUpdateItem: Limit exceeded.`);
        ui.notifications.warn(customMessage);
        return false;
    }

    return true;
});

/**
 * Добавляем отображение эффективного веса и прогресс-бара на листе актора
 */
Hooks.on('renderActorSheet', (app, html, data) => {
    if (!(app instanceof ActorSheet) || !app.actor || ['npc', 'vehicle'].includes(app.actor.type)) return;
    const actor = app.actor;

    html.find('.inventory-list .item[data-item-id], .tidy5e-sheet .item[data-item-id]').each((index, element) => {
        const itemId = element.dataset.itemId;
        if (!itemId) return;
        const item = actor.items.get(itemId);
        const containerId = foundry.utils.getProperty(item, "system.container");
        const weightCell = $(element).find('.item-weight, .tidy5e-sheet .weight');
        const existingSpan = weightCell.find('.weighty-effective-weight');

        if (!containerId) {
            existingSpan.remove();
            return;
        }
        const container = actor.items.get(containerId);
        if (!container || !isActualWeightContainer(container)) {
            existingSpan.remove();
            return;
        }

        const reductionPercent = getWeightReductionPercent(container);
        if (reductionPercent <= 0) {
            existingSpan.remove();
            return;
        }

        const effectiveWeight = getEffectiveItemWeight(item, actor);
        const weightSource = foundry.utils.getProperty(item, "system.weight");
        let baseWeight = 0;
        if (typeof weightSource === 'number') baseWeight = weightSource;
        else if (typeof weightSource === 'object' && weightSource !== null && typeof weightSource.value === 'number') baseWeight = weightSource.value;
        baseWeight = Number(baseWeight) || 0;

        if (Math.abs(effectiveWeight - baseWeight) < 0.001) {
            existingSpan.remove();
            return;
        }

        if (weightCell.length > 0) {
            const displayWeight = game.settings.get("dnd5e", "metricWeightUnits")
                ? (effectiveWeight * (game.settings.get("dnd5e", "metricWeightMultiplier") ?? 1)).toFixed(2)
                : effectiveWeight.toFixed(2);
            const weightUnits = game.settings.get("dnd5e", "metricWeightUnits")
                ? game.settings.get("dnd5e", "metricWeightLabel")
                : game.i18n.localize("DND5E.AbbreviationLbs");
            const effectiveWeightText = `(${game.i18n.localize('WEIGHTYCONTAINERS.ItemWeightLabel')}: ${displayWeight} ${weightUnits})`;

            if (existingSpan.length) {
                existingSpan.text(effectiveWeightText);
            } else {
                weightCell.append(`<span class="weighty-effective-weight">${effectiveWeightText}</span>`);
            }
        }

        // Обновляем прогресс-бар для контейнеров
        if (item.type === 'container' && isActualWeightContainer(item)) {
            updateContainerProgressBar($(element), item, actor, {
                progressSelectors: [
                    '.container-progress',
                    '.progress-bar',
                    '.encumbrance-bar',
                    '.tidy5e-sheet .progress-bar'
                ],
                valueSelectors: [
                    '.container-weight',
                    '.weight-value',
                    '.tidy5e-sheet .weight-value'
                ]
            });
        }
    });
});

/**
 * Обновление отображения веса на листе актора и листах контейнеров при изменении.
 * @param {Item} item - Обновленный предмет.
 */
function refreshDependentSheets(item) {
    const actor = item.actor;
    if (!actor) return;

    // Обновляем лист актора
    if (actor.sheet instanceof ActorSheet && actor.sheet.rendered) {
        try {
            actor.sheet.render(false);
        } catch (e) {
            console.warn(`${MODULE_ID} | Failed to re-render actor sheet:`, e);
        }
    }

    // Определяем контейнеры, которые нужно обновить
    const currentContainerId = foundry.utils.getProperty(item, "system.container");
    const originalContainerId = foundry.utils.getProperty(item, "_source.system.container");
    const containerIdsToRefresh = new Set();
    if (currentContainerId) containerIdsToRefresh.add(currentContainerId);
    if (originalContainerId && originalContainerId !== currentContainerId) containerIdsToRefresh.add(originalContainerId);

    // Если предмет сам является контейнером, обновляем его лист
    if (item.type === 'container') {
        if (item.sheet instanceof ItemSheet && item.sheet.rendered) {
            try {
                item.sheet.render(false);
            } catch (e) {
                console.warn(`${MODULE_ID} | Failed to re-render item sheet:`, e);
            }
        }
        // Обновляем все открытые листы акторов, содержащих этот контейнер
        Object.values(ui.windows).forEach(window => {
            if (window instanceof ActorSheet && window.actor?.items?.get(item.id) && window.rendered) {
                try {
                    window.render(false);
                } catch (e) {
                    console.warn(`${MODULE_ID} | Failed to re-render actor sheet for container:`, e);
                }
            }
        });
    }

    // Обновляем листы связанных контейнеров
    containerIdsToRefresh.forEach(containerId => {
        if (typeof containerId === 'string') {
            const container = actor.items.get(containerId);
            if (container && container.sheet instanceof ItemSheet && container.sheet.rendered) {
                try {
                    container.sheet.render(false);
                } catch (e) {
                    console.warn(`${MODULE_ID} | Failed to re-render container sheet:`, e);
                }
            }
        }
    });
}

// Хук для обновления листов при изменении предмета
Hooks.on("updateItem", (item, change, options, userId) => {
    const flagPath = `flags.${MODULE_ID}.${FLAG_WEIGHT_REDUCTION}`;
    const relevantChange = foundry.utils.hasProperty(change, flagPath)
                       || foundry.utils.hasProperty(change, 'system.container')
                       || foundry.utils.hasProperty(change, 'system.quantity')
                       || foundry.utils.hasProperty(change, 'system.weight');
    if (relevantChange) {
        setTimeout(() => refreshDependentSheets(item), 50);
    }
});

// Хук для обновления листов при удалении предмета
Hooks.on("deleteItem", (item, options, userId) => {
    if (item.actor && foundry.utils.getProperty(item, "system.container")) {
        setTimeout(() => refreshDependentSheets(item), 50);
    }
});