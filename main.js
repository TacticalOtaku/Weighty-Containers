const MODULE_ID = 'weighty-containers';
const FLAG_WEIGHT_REDUCTION = 'weightReduction';
let libWrapper; // Переменная для libWrapper

// --- Helper Functions ---

/**
 * Проверяет, является ли предмет контейнером с ограничением по весу.
 * @param {Item | null | undefined} item - Документ предмета.
 * @returns {boolean}
 */
function isActualWeightContainer(item) {
    if (!item || item.type !== 'container' || !item.system) return false;
    const hasWeightValue = typeof item.system.capacity?.weight?.value === 'number' && item.system.capacity.weight.value > 0; // MODIFIED: > 0 для исключения нулевых или отрицательных значений
    const typeIsWeight = item.system.capacity?.type === 'weight';
    return hasWeightValue && typeIsWeight;
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
    const reduction = Number(flagValue) || 0;
    return Math.max(0, Math.min(100, reduction)); // MODIFIED: Ограничение 0-100
}

/**
 * Вычисляет эффективный вес предмета, учитывая снижение веса в контейнере и эффекты DAE.
 * @param {Item | null | undefined} item - Предмет для проверки.
 * @param {Actor | null | undefined} [actor=item?.actor] - Актер, которому принадлежит предмет.
 * @returns {number} Эффективный вес предмета.
 */
function getEffectiveItemWeight(item, actor = item?.actor) {
    if (!item || !item.system || !actor) {
        console.warn(`${MODULE_ID} | getEffectiveItemWeight: Invalid item or actor. Returning 0.`, { item, actor });
        return 0;
    }

    let weightSource = foundry.utils.getProperty(item, "system.weight");
    let baseWeight = 0;

    // Учет эффектов DAE, изменяющих вес предмета
    if (game.modules.get('dae')?.active && item?.effects) {
        const weightEffects = item.effects.filter(e => e.changes.some(c => c.key.includes('system.weight')));
        if (weightEffects.length) {
            weightEffects.forEach(effect => {
                effect.changes.forEach(change => {
                    if (change.key.includes('system.weight')) {
                        weightSource = Number(change.value) || weightSource;
                    }
                });
            });
        }
    }

    if (typeof weightSource === 'number' && !isNaN(weightSource)) {
        baseWeight = Math.max(0, weightSource); // MODIFIED: Не допускать отрицательный вес
    } else if (typeof weightSource === 'string') {
        baseWeight = parseFloat(weightSource) || 0;
    } else if (typeof weightSource === 'object' && weightSource !== null && typeof weightSource.value === 'number') {
        baseWeight = Math.max(0, Number(weightSource.value) || 0);
    } else {
        baseWeight = 0;
    }

    const containerId = foundry.utils.getProperty(item, "system.container");
    if (!containerId) return baseWeight;

    const container = actor.items.get(containerId);
    if (!container || !isActualWeightContainer(container)) return baseWeight;

    const reductionPercent = getWeightReductionPercent(container);
    const multiplier = Math.max(0, 1 - reductionPercent / 100);
    const effectiveWeight = baseWeight * multiplier;

    if (isNaN(effectiveWeight) || effectiveWeight < 0) {
        console.error(`%c${MODULE_ID} | ERROR getEffectiveItemWeight: Invalid calculation! Item: ${item?.name}, BaseW: ${baseWeight}, Multiplier: ${multiplier}. Returning 0.`, "color: red; font-weight: bold;");
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
    if (!actor || !containerItem || !isActualWeightContainer(containerItem)) {
        console.warn(`${MODULE_ID} | calculateCurrentContainerWeight: Invalid container or actor. Returning 0.`, { containerItem, actor });
        return 0;
    }

    let currentWeight = 0;
    if (!actor.items || typeof actor.items.filter !== 'function') {
        console.error(`${MODULE_ID} | calculateCurrentContainerWeight: actor.items is not valid for actor:`, actor.name);
        return 0;
    }
    const contents = actor.items.filter(i => foundry.utils.getProperty(i, "system.container") === containerItem.id);

    for (const item of contents) {
        const quantity = Math.max(1, Number(foundry.utils.getProperty(item, "system.quantity")) || 1); // MODIFIED: Гарантировать quantity >= 1
        const itemWeight = getEffectiveItemWeight(item, actor);
        if (isNaN(itemWeight)) {
            console.warn(`${MODULE_ID} | calculateCurrentContainerWeight: Invalid item weight for ${item.name}. Skipping.`);
            continue;
        }
        currentWeight += itemWeight * quantity;
    }

    if (isNaN(currentWeight) || currentWeight < 0) {
        console.error(`${MODULE_ID} | calculateCurrentContainerWeight: Invalid sum for container ${containerItem.name}. Returning 0.`, { currentWeight });
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
        '.tidy5e-sheet .encumbrance-bar',
        '.tidy5e .progress-bar',
        '.item-piles-progress',
        '.minimal-ui .encumbrance-bar'
    ];
    const valueSelectors = options.valueSelectors || [
        '.encumbrance .meter .label .value',
        '.encumbrance-value',
        '.container-weight-value',
        '.tidy5e-sheet .encumbrance-value',
        '.tidy5e .weight-value',
        '.item-piles-weight',
        '.minimal-ui .weight-value'
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

    console.log(`${MODULE_ID} | Checking for libWrapper...`);
    if (game.modules.get('lib-wrapper')?.active) {
        libWrapper = globalThis.libWrapper;
        console.log(`${MODULE_ID} | libWrapper found and active.`);
    } else {
        console.log(`${MODULE_ID} | libWrapper not found. Using manual patching.`);
    }

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
            name: "WEIGHTYCONTAINERS.SettingCapacityMessageName",
            hint: "WEIGHTYCONTAINERS.SettingCapacityMessageHint",
            scope: 'world',
            config: true,
            type: String,
            default: "Больно ты дохуя взял",
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

        const isEquipped = foundry.utils.getProperty(item, "system.equipped") ?? false;
        const equipmentSlot = foundry.utils.getProperty(item, "system.slot");
        if (containerId) {
             const container = actor.items.get(containerId);
             if (container && isActualWeightContainer(container)) {
                 isWeightyContainerItem = true;
                 countItemWeight = true;
             } else if (isEquipped || equipmentSlot) {
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

    // Учет веса валюты, включая Item Piles
    let currencyWeight = 0;
    const currency = foundry.utils.getProperty(actor, "system.currency") || {};
    currencyWeight = Object.values(currency).reduce((total, amount) => total + (Number(amount) || 0), 0) / 50;

    if (game.modules.get('item-piles')?.active) {
        const pileCurrency = foundry.utils.getProperty(actor, "system.itemPilesCurrency") || {};
        currencyWeight += Object.values(pileCurrency).reduce((total, amount) => total + (Number(amount) || 0), 0) / 50;
    }

    const metricMultiplier = game.settings.get("dnd5e", "metricWeightUnits") ? (game.settings.get("dnd5e", "metricWeightMultiplier") ?? 1) : 1;
    effectiveTotalWeight += currencyWeight * metricMultiplier;

    const finalEffectiveWeight = Number(effectiveTotalWeight.toPrecision(5));
    actor.system.attributes.encumbrance.value = finalEffectiveWeight;

    // --- Блок пересчета уровней v2 ---
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

        if (libWrapper) {
            libWrapper.register(MODULE_ID, targetMethod, function(wrapped, ...args) {
                wrapped(...args);
                modifyEncumbranceData(this);
            }, "WRAPPER");
            console.log(`${MODULE_ID} | Successfully wrapped ${targetMethod} with libWrapper.`);
        } else {
            console.warn(`${MODULE_ID} | Attempting manual patch for ${targetMethod}...`);
            const originalMethod = CONFIG.Actor.documentClass.prototype.prepareDerivedData;
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
    if (game.modules.get('item-piles')?.active && foundry.utils.hasProperty(change, 'system.itemPilesCurrency') && actor.sheet?.rendered) {
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
    const targetBlock = html.find('header.sheet-header .middle.identity-info');

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
                                ui.notifications.error("Error saving weight reduction setting.");
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

    if (isWeightContainer && app.actor) {
        try {
            updateContainerProgressBar(html, item, app.actor, {
                progressSelectors: [
                    '.tab.contents[data-tab="contents"] .encumbrance .meter.progress',
                    '.tab.contents .progress-bar.encumbrance',
                    '.container-capacity-bar',
                    '.tidy5e-sheet .encumbrance-bar',
                    '.tidy5e .progress-bar',
                    '.item-piles-progress'
                ],
                valueSelectors: [
                    '.tab.contents[data-tab="contents"] .encumbrance .meter .label .value',
                    '.tab.contents .encumbrance-value',
                    '.container-weight-value',
                    '.tidy5e-sheet .encumbrance-value',
                    '.tidy5e .weight-value',
                    '.item-piles-weight'
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
    console.debug(`${MODULE_ID} | preCreateItem: Processing item creation`, { itemDoc, createData, options }); // NEW: Отладочный лог

    const parentActor = itemDoc.parent;
    const containerId = foundry.utils.getProperty(createData, 'system.container');
    if (!(parentActor instanceof Actor) || !containerId) {
        console.debug(`${MODULE_ID} | preCreateItem: No valid actor or containerId. Allowing creation.`);
        return true;
    }
    if (itemDoc.isTemporary) {
        console.debug(`${MODULE_ID} | preCreateItem: Item is temporary. Allowing creation.`);
        return true;
    }

    const actor = parentActor;
    const container = actor.items.get(containerId);
    if (!container || !isActualWeightContainer(container)) {
        console.debug(`${MODULE_ID} | preCreateItem: Invalid or non-weight container. Allowing creation.`, { container });
        return true;
    }

    const containerMaxWeight = Number(foundry.utils.getProperty(container, "system.capacity.weight.value") ?? 0);
    if (containerMaxWeight <= 0) {
        console.warn(`${MODULE_ID} | preCreateItem: Container max weight is invalid (${containerMaxWeight}). Allowing creation.`);
        return true;
    }

    let effectiveWeightToAdd = 0;
    try {
        const tempItemData = foundry.utils.mergeObject(itemDoc.toObject(false), createData ?? {}, { recursive: true }); // MODIFIED: Глубокое слияние
        const itemToAddQuantity = Math.max(1, Number(foundry.utils.getProperty(tempItemData, 'system.quantity') ?? 1)); // MODIFIED: quantity >= 1
        const tempItemDoc = new Item(tempItemData, { parent: actor, temporary: true }); // MODIFIED: Указываем parent для корректного контекста
        effectiveWeightToAdd = getEffectiveItemWeight(tempItemDoc, actor) * itemToAddQuantity;
    } catch (err) {
        console.error(`${MODULE_ID} | preCreateItem: Failed to calculate effective weight. Blocking creation.`, err);
        ui.notifications.error(game.i18n.localize("WEIGHTYCONTAINERS.ErrorCalculatingWeight"));
        return false;
    }

    if (isNaN(effectiveWeightToAdd) || effectiveWeightToAdd < 0) {
        console.error(`${MODULE_ID} | preCreateItem: effectiveWeightToAdd is invalid (${effectiveWeightToAdd}). Blocking creation.`);
        ui.notifications.error(game.i18n.localize("WEIGHTYCONTAINERS.ErrorCalculatingWeight"));
        return false;
    }

    const currentWeight = calculateCurrentContainerWeight(container, actor);
    if (isNaN(currentWeight) || currentWeight < 0) {
        console.error(`${MODULE_ID} | preCreateItem: currentWeight is invalid (${currentWeight}). Blocking creation.`);
        ui.notifications.error(game.i18n.localize("WEIGHTYCONTAINERS.ErrorCalculatingWeight"));
        return false;
    }

    const potentialTotalWeight = currentWeight + effectiveWeightToAdd;
    const tolerance = 0.001;

    console.debug(`${MODULE_ID} | preCreateItem: Checking weight: Current=${currentWeight}, Adding=${effectiveWeightToAdd}, Max=${containerMaxWeight}, Total=${potentialTotalWeight}`); // NEW: Отладочный лог

    if (potentialTotalWeight > containerMaxWeight + tolerance) {
        const customMessage = game.settings.get(MODULE_ID, 'capacityExceededMessage') || "Container capacity exceeded.";
        console.warn(`${MODULE_ID} | preCreateItem: Limit exceeded. Blocking creation.`, { potentialTotalWeight, containerMaxWeight });
        ui.notifications.warn(customMessage);
        return false;
    }

    console.debug(`${MODULE_ID} | preCreateItem: Weight check passed. Allowing creation.`);
    return true;
});

/**
 * Хук для проверки вместимости ПЕРЕД обновлением предмета.
 */
Hooks.on('preUpdateItem', (itemDoc, change, options, userId) => {
    console.debug(`${MODULE_ID} | preUpdateItem: Processing item update`, { itemDoc, change, options }); // NEW: Отладочный лог

    if (!(itemDoc.parent instanceof Actor)) {
        console.debug(`${MODULE_ID} | preUpdateItem: No valid actor. Allowing update.`);
        return true;
    }

    const actor = itemDoc.parent;
    const targetContainerId = foundry.utils.getProperty(change, 'system.container');
    const isChangingContainer = foundry.utils.hasProperty(change, 'system.container');
    const originalContainerId = foundry.utils.getProperty(itemDoc, "system.container");

    const oldQuantity = Number(foundry.utils.getProperty(itemDoc, "system.quantity") ?? 1);
    const newQuantity = Number(foundry.utils.getProperty(change, 'system.quantity') ?? oldQuantity);
    const isChangingQuantity = foundry.utils.hasProperty(change, 'system.quantity');

    let isMovingIntoContainer = false;
    let isQuantityIncreaseInContainer = false;
    let checkContainerId = null;

    if (isChangingContainer && targetContainerId && targetContainerId !== originalContainerId) {
        isMovingIntoContainer = true;
        checkContainerId = targetContainerId;
    } else if (isChangingContainer && !targetContainerId && originalContainerId) {
        console.debug(`${MODULE_ID} | preUpdateItem: Removing from container. Allowing update.`);
        return true;
    }

    const finalContainerId = isChangingContainer ? targetContainerId : originalContainerId;

    if (isChangingQuantity && newQuantity > oldQuantity && finalContainerId) {
        isQuantityIncreaseInContainer = true;
        if (!checkContainerId) checkContainerId = finalContainerId;
    } else if (isChangingQuantity && newQuantity <= oldQuantity) {
        console.debug(`${MODULE_ID} | preUpdateItem: Quantity decreased or unchanged. Allowing update.`);
        return true; // MODIFIED: Разрешать уменьшение количества
    }

    if (!checkContainerId) {
        console.debug(`${MODULE_ID} | preUpdateItem: No container to check. Allowing update.`);
        return true;
    }

    const container = actor.items.get(checkContainerId);
    if (!container || !isActualWeightContainer(container)) {
        console.debug(`${MODULE_ID} | preUpdateItem: Invalid or non-weight container. Allowing update.`, { container });
        return true;
    }

    const containerMaxWeight = Number(foundry.utils.getProperty(container, "system.capacity.weight.value") ?? 0);
    if (containerMaxWeight <= 0) {
        console.warn(`${MODULE_ID} | preUpdateItem: Container max weight is invalid (${containerMaxWeight}). Allowing update.`);
        return true;
    }

    let effectiveSingleItemWeight = 0;
    try {
        const changedItemData = foundry.utils.mergeObject(itemDoc.toObject(false), change ?? {}, { recursive: true }); // MODIFIED: Глубокое слияние
        const tempChangedItemDoc = new Item(changedItemData, { parent: actor, temporary: true }); // MODIFIED: Указываем parent
        effectiveSingleItemWeight = getEffectiveItemWeight(tempChangedItemDoc, actor);
    } catch (err) {
        console.error(`${MODULE_ID} | preUpdateItem: Failed to calculate effective weight. Blocking update.`, err);
        ui.notifications.error(game.i18n.localize("WEIGHTYCONTAINERS.ErrorCalculatingWeight"));
        return false;
    }

    if (isNaN(effectiveSingleItemWeight) || effectiveSingleItemWeight < 0) {
        console.error(`${MODULE_ID} | preUpdateItem: effectiveSingleItemWeight is invalid (${effectiveSingleItemWeight}). Blocking update.`);
        ui.notifications.error(game.i18n.localize("WEIGHTYCONTAINERS.ErrorCalculatingWeight"));
        return false;
    }

    let currentWeightInTargetContainer = calculateCurrentContainerWeight(container, actor);
    if (isNaN(currentWeightInTargetContainer) || currentWeightInTargetContainer < 0) {
        console.error(`${MODULE_ID} | preUpdateItem: currentWeightInTargetContainer is invalid (${currentWeightInTargetContainer}). Blocking update.`);
        ui.notifications.error(game.i18n.localize("WEIGHTYCONTAINERS.ErrorCalculatingWeight"));
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
        console.debug(`${MODULE_ID} | preUpdateItem: No relevant changes. Allowing update.`);
        return true;
    }

    if (isNaN(futureWeightInTargetContainer) || futureWeightInTargetContainer < 0) {
        console.error(`${MODULE_ID} | preUpdateItem: futureWeightInTargetContainer is invalid (${futureWeightInTargetContainer}). Blocking update. Reason: ${logReason}`);
        ui.notifications.error(game.i18n.localize("WEIGHTYCONTAINERS.ErrorCalculatingWeight"));
        return false;
    }

    const tolerance = 0.001;

    console.debug(`${MODULE_ID} | preUpdateItem: Checking weight: Current=${currentWeightInTargetContainer}, Adding=${effectiveSingleItemWeight * (isMovingIntoContainer ? newQuantity : (newQuantity - oldQuantity))}, Max=${containerMaxWeight}, Total=${futureWeightInTargetContainer}`); // NEW: Отладочный лог

    if (futureWeightInTargetContainer > containerMaxWeight + tolerance) {
        const customMessage = game.settings.get(MODULE_ID, 'capacityExceededMessage') || "Container capacity exceeded.";
        console.warn(`${MODULE_ID} | preUpdateItem: Limit exceeded. Blocking update.`, { futureWeightInTargetContainer, containerMaxWeight });
        ui.notifications.warn(customMessage);
        return false;
    }

    console.debug(`${MODULE_ID} | preUpdateItem: Weight check passed. Allowing update.`);
    return true;
});

/**
 * Добавляем отображение эффективного веса и прогресс-бара на листе актора
 */
Hooks.on('renderActorSheet', (app, html, data) => {
    if (!(app instanceof ActorSheet) || !app.actor || ['npc', 'vehicle'].includes(app.actor.type)) return;
    const actor = app.actor;

    html.find('.inventory-list .item[data-item-id]').each((index, element) => {
        const itemId = element.dataset.itemId;
        if (!itemId) return;
        const item = actor.items.get(itemId);
        const containerId = foundry.utils.getProperty(item, "system.container");
        const weightCell = $(element).find('.item-weight');
        const existingSpan = weightCell.find('.weighty-effective-weight');

        if (!containerId) { existingSpan.remove(); return; }
        const container = actor.items.get(containerId);
        if (!container || !isActualWeightContainer(container)) { existingSpan.remove(); return; }

        const reductionPercent = getWeightReductionPercent(container);
        if (reductionPercent <= 0) { existingSpan.remove(); return; }

        const effectiveWeight = getEffectiveItemWeight(item, actor);
        const weightSource = foundry.utils.getProperty(item, "system.weight");
        let baseWeight = 0;
        if (typeof weightSource === 'number') baseWeight = weightSource;
        else if (typeof weightSource === 'object' && weightSource !== null && typeof weightSource.value === 'number') baseWeight = weightSource.value;
        baseWeight = Number(baseWeight) || 0;

        if (Math.abs(effectiveWeight - baseWeight) < 0.001) { existingSpan.remove(); return; }

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

        if (item.type === 'container' && isActualWeightContainer(item)) {
            updateContainerProgressBar($(element), item, actor, {
                progressSelectors: [
                    '.container-progress',
                    '.progress-bar',
                    '.encumbrance-bar',
                    '.tidy5e-sheet .encumbrance-bar',
                    '.tidy5e .progress-bar',
                    '.item-piles-progress'
                ],
                valueSelectors: [
                    '.container-weight',
                    '.weight-value',
                    '.tidy5e-sheet .encumbrance-value',
                    '.tidy5e .weight-value',
                    '.item-piles-weight'
                ]
            });
        }
    });
});

/**
 * Обновление отображения веса на листе актора и листах контейнеров при изменении
 */
function refreshDependentSheets(item) {
    const actor = item.actor;
    if (!actor) return;

    if (actor.sheet instanceof ActorSheet && actor.sheet.rendered) {
        try { actor.sheet.render(false); } catch(e) { /* ignore */ }
    }

    const currentContainerId = foundry.utils.getProperty(item, "system.container");
    const originalContainerId = foundry.utils.getProperty(item, "_source.system.container");
    const containerIdsToRefresh = new Set();
    if (currentContainerId) containerIdsToRefresh.add(currentContainerId);
    if (originalContainerId && originalContainerId !== currentContainerId) containerIdsToRefresh.add(originalContainerId);

    if (item.type === 'container') {
         if (item.sheet instanceof ItemSheet && item.sheet.rendered) {
             try { item.sheet.render(false); } catch(e) { /* ignore */ }
         }
         Object.values(ui.windows).forEach(window => {
            if (window instanceof ActorSheet && window.actor?.items?.get(item.id) && window.rendered) {
                 try { window.render(false); } catch(e) { /* ignore */ }
            }
         });
    }

    containerIdsToRefresh.forEach(containerId => {
        if (typeof containerId === 'string') {
             const container = actor.items.get(containerId);
             if (container && container.sheet instanceof ItemSheet && container.sheet.rendered) {
                 try { container.sheet.render(false); } catch(e) { /* ignore */ }
             }
        }
    });
}

Hooks.on("updateItem", (item, change, options, userId) => {
    const flagPath = `flags.${MODULE_ID}.${FLAG_WEIGHT_REDUCTION}`;
    const relevantChange = foundry.utils.hasProperty(change, flagPath)
                       || foundry.utils.hasProperty(change, 'system.container')
                       || foundry.utils.hasProperty(change, 'system.quantity')
                       || foundry.utils.getProperty(change, 'system.weight');
    if (relevantChange) {
        setTimeout(() => refreshDependentSheets(item), 50);
    }
});

Hooks.on("deleteItem", (item, options, userId) => {
    if (item.actor && foundry.utils.getProperty(item, "system.container")) {
        setTimeout(() => refreshDependentSheets(item), 50);
    }
});

// --- КОНЕЦ ФАЙЛА main.js ---