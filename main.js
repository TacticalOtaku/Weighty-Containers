const MODULE_ID = 'weighty-containers';
const FLAG_WEIGHT_REDUCTION = 'weightReduction';
const SOCKET_NAME = `module.${MODULE_ID}`;
let libWrapper; // Переменная для libWrapper

// --- Helper Functions ---

/**
 * Проверяет, является ли предмет контейнером с ограничением по весу.
 * @param {Item | null | undefined} item - Документ предмета.
 * @returns {boolean}
 */
function isActualWeightContainer(item) {
    if (!item || item.type !== 'container' || !item.system) return false;
    const hasWeightValue = typeof item.system.capacity?.weight?.value === 'number' && item.system.capacity.weight.value >= 0;
    const typeIsWeight = item.system.capacity?.type === 'weight';
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
 * Возвращает настройки отображения веса на основе конфигурации D&D 5e.
 * @returns {{ multiplier: number, units: string, currencyWeight: boolean }}
 */
function getWeightDisplaySettings() {
    const isMetric = game.settings.get("dnd5e", "metricWeightUnits") ?? false;
    const multiplier = isMetric ? 0.5 : 1; // 1 фунт ≈ 0.5 кг
    const units = isMetric ? (game.settings.get("dnd5e", "metricWeightLabel") ?? "kg") : game.i18n.localize("DND5E.AbbreviationLbs");
    const currencyWeight = game.settings.get("dnd5e", "currencyWeight") ?? true;
    return { multiplier, units, currencyWeight };
}

/**
 * Вычисляет эффективный вес предмета, учитывая снижение веса в контейнере и метрическую систему.
 * @param {Item | null | undefined} item - Предмет для проверки.
 * @param {Actor | null | undefined} [actor=item?.actor] - Актер, которому принадлежит предмет.
 * @param {boolean} [applyMetric=true] - Применять ли метрический множитель.
 * @returns {number} Эффективный вес предмета.
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

    const multiplier = Math.max(0, 1 - reductionPercent / 100);
    const effectiveWeight = baseWeight * multiplier;

    if (isNaN(effectiveWeight)) {
        console.error(`%c${MODULE_ID} | ERROR getEffectiveItemWeight: Calculation resulted in NaN! Item: ${item?.name}, BaseW: ${baseWeight}, Multiplier: ${multiplier}. Returning 0.`, "color: red; font-weight: bold;");
        return 0;
    }
    return applyMetric ? effectiveWeight * getWeightDisplaySettings().multiplier : effectiveWeight;
}

/**
 * Вычисляет общий текущий вес предметов внутри контейнера.
 * @param {Item | null | undefined} containerItem - Документ предмета-контейнера.
 * @param {Actor | null | undefined} actor - Актер, которому принадлежит контейнер.
 * @param {boolean} [applyMetric=true] - Применять ли метрический множитель.
 * @returns {number} Суммарный эффективный вес содержимого.
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
        currentWeight += getEffectiveItemWeight(item, actor, applyMetric) * quantity;
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

    const { multiplier, units } = getWeightDisplaySettings();
    const effectiveCurrentWeight = calculateCurrentContainerWeight(containerItem, actor, true);
    const containerMaxWeight = Number(foundry.utils.getProperty(containerItem, "system.capacity.weight.value") ?? 0) * multiplier;
    if (containerMaxWeight <= 0) return;

    const progressSelectors = options.progressSelectors || [
        '.encumbrance .meter.progress',
        '.progress-bar.encumbrance',
        '.container-capacity-bar'
    ];
    const valueSelectors = options.valueSelectors || [
        '.encumbrance .meter .label .value',
        '.encumbrance-value',
        '.container-weight-value'
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
            valueElement.text(`${effectiveCurrentWeight.toFixed(2)} ${units}`);
        }
    });
}

// --- Socket Handlers for Multiplayer Sync ---

/**
 * Регистрирует сокет для синхронизации изменений.
 */
function registerSocket() {
    game.socket.on(SOCKET_NAME, ({ type, data }) => {
        if (type === 'updateContainer') {
            const { itemId, actorId } = data;
            const actor = game.actors.get(actorId);
            const item = actor?.items.get(itemId);
            if (item && item.sheet?.rendered) {
                item.sheet.render(false);
            }
            if (actor && actor.sheet?.rendered) {
                actor.sheet.render(false);
            }
        }
    });
}

/**
 * Транслирует обновление контейнера всем клиентам.
 * @param {string} itemId - ID контейнера.
 * @param {string} actorId - ID актера.
 */
function broadcastContainerUpdate(itemId, actorId) {
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
    registerSocket();
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

    const { multiplier, currencyWeight } = getWeightDisplaySettings();
    let effectiveTotalWeight = 0;
    for (const item of actor.items) {
        if (!item.system) continue;
        let countItemWeight = false;
        const containerId = foundry.utils.getProperty(item, "system.container");
        let isWeightyContainerItem = false;
        if (containerId) {
             const container = actor.items.get(containerId);
             if (container && isActualWeightContainer(container)) {
                 isWeightyContainerItem = true; countItemWeight = true;
             } else if (foundry.utils.getProperty(item, "system.equipped") ?? false) {
                  countItemWeight = true;
             }
        } else { countItemWeight = true; }
        if (foundry.utils.getProperty(item, "system.weightless")) { countItemWeight = false; }

        if (countItemWeight) {
             const quantity = Number(foundry.utils.getProperty(item, "system.quantity")) || 1;
             let weightPerUnit = 0;
             if (isWeightyContainerItem) {
                 weightPerUnit = getEffectiveItemWeight(item, actor, false); // Не применяем метрический множитель здесь
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

    // Добавляем вес валюты, если включено
    if (currencyWeight) {
        const currency = foundry.utils.getProperty(actor, "system.currency") || {};
        const currencyWeightValue = Object.values(currency).reduce((total, amount) => total + (Number(amount) || 0), 0) / 50; // 50 монет = 1 фунт
        effectiveTotalWeight += currencyWeightValue;
    }

    const finalEffectiveWeight = Number((effectiveTotalWeight * multiplier).toPrecision(5));
    actor.system.attributes.encumbrance.value = finalEffectiveWeight;

    // Блок пересчета уровней v2
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

        const baseMax = enc.max * multiplier;
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
        broadcastContainerUpdate(null, actor.id);
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
                                broadcastContainerUpdate(item.id, item.actor?.id);
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

    // Обновление прогресс-бара с использованием новой функции
    if (isWeightContainer && app.actor) {
        try {
            updateContainerProgressBar(html, item, app.actor, {
                progressSelectors: [
                    '.tab.contents[data-tab="contents"] .encumbrance .meter.progress',
                    '.tab.contents .progress-bar.encumbrance',
                    '.container-capacity-bar'
                ],
                valueSelectors: [
                    '.tab.contents[data-tab="contents"] .encumbrance .meter .label .value',
                    '.tab.contents .encumbrance-value',
                    '.container-weight-value'
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

    const { multiplier } = getWeightDisplaySettings();
    const containerMaxWeight = Number(foundry.utils.getProperty(container, "system.capacity.weight.value") ?? 0) * multiplier;
    if (containerMaxWeight <= 0) return true;

    let effectiveWeightToAdd = 0;
    try {
        const tempItemData = foundry.utils.mergeObject(itemDoc.toObject(false), createData ?? {});
        const itemToAddQuantity = Number(foundry.utils.getProperty(tempItemData, 'system.quantity') ?? 1);
        const tempItemDoc = new Item(tempItemData, { temporary: true });
        effectiveWeightToAdd = getEffectiveItemWeight(tempItemDoc, actor, true) * itemToAddQuantity;
    } catch (err) {
        console.error(`${MODULE_ID} | ERROR preCreateItem: Failed to calculate effective weight.`, err);
        return false;
    }

    if (isNaN(effectiveWeightToAdd)) {
        console.error(`${MODULE_ID} | ERROR preCreateItem: effectiveWeightToAdd is NaN.`);
        return false;
    }

    const currentWeight = calculateCurrentContainerWeight(container, actor, true);
     if (isNaN(currentWeight)) {
        console.error(`${MODULE_ID} | ERROR preCreateItem: currentWeight is NaN.`);
        return false;
    }

    const potentialTotalWeight = currentWeight + effectiveWeightToAdd;
    const tolerance = 0.001;

    if (potentialTotalWeight > containerMaxWeight + tolerance) {
        const customMessage = game.settings.get(MODULE_ID, 'capacityExceededMessage') || "Container capacity exceeded.";
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
        isMovingIntoContainer = true; checkContainerId = targetContainerId;
    } else if (isChangingContainer && !targetContainerId && originalContainerId) {
        return true;
    }

    const finalContainerId = isChangingContainer ? targetContainerId : originalContainerId;

    if (isChangingQuantity && newQuantity > oldQuantity && finalContainerId) {
        isQuantityIncreaseInContainer = true; if (!checkContainerId) checkContainerId = finalContainerId;
    } else if (isChangingQuantity && newQuantity < oldQuantity && isMovingIntoContainer) {
        if (!checkContainerId) checkContainerId = targetContainerId;
    } else if (isChangingQuantity && newQuantity < oldQuantity && !isMovingIntoContainer) {
        return true;
    }

    if (!checkContainerId) return true;

    const container = actor.items.get(checkContainerId);
    if (!container || !isActualWeightContainer(container)) return true;

    const { multiplier } = getWeightDisplaySettings();
    const containerMaxWeight = Number(foundry.utils.getProperty(container, "system.capacity.weight.value") ?? 0) * multiplier;
    if (containerMaxWeight <= 0) return true;

    let effectiveSingleItemWeight = 0;
    try {
        const changedItemData = foundry.utils.mergeObject(itemDoc.toObject(false), change ?? {});
        const tempChangedItemDoc = new Item(changedItemData, { temporary: true });
        effectiveSingleItemWeight = getEffectiveItemWeight(tempChangedItemDoc, actor, true);
    } catch (err) {
        console.error(`${MODULE_ID} | ERROR preUpdateItem: Failed to calculate effective weight.`, err);
        return false;
    }

    if (isNaN(effectiveSingleItemWeight)) {
        console.error(`${MODULE_ID} | ERROR preUpdateItem: effectiveSingleItemWeight is NaN.`);
        return false;
    }

    let currentWeightInTargetContainer = calculateCurrentContainerWeight(container, actor, true);
     if (isNaN(currentWeightInTargetContainer)) {
        console.error(`${MODULE_ID} | ERROR preUpdateItem: currentWeightInTargetContainer is NaN.`);
        return false;
    }

    let futureWeightInTargetContainer = 0;
    let logReason = "";

    if (isMovingIntoContainer) {
        const weightOfMovedStack = effectiveSingleItemWeight * newQuantity;
        if (isNaN(weightOfMovedStack)) { logReason = "NaN Error: weightOfMovedStack"; futureWeightInTargetContainer = NaN; }
        else { futureWeightInTargetContainer = currentWeightInTargetContainer + weightOfMovedStack; logReason = `Move ${newQuantity} items`; }
    } else if (isQuantityIncreaseInContainer && checkContainerId === finalContainerId) {
        const quantityChange = newQuantity - oldQuantity;
        const addedWeight = effectiveSingleItemWeight * quantityChange;
         if (isNaN(addedWeight)) { logReason = "NaN Error: addedWeight"; futureWeightInTargetContainer = NaN; }
        else { futureWeightInTargetContainer = currentWeightInTargetContainer + addedWeight; logReason = `Increase by ${quantityChange}`; }
    } else {
        return true; // Другие случаи не проверяем
    }

    if (isNaN(futureWeightInTargetContainer)) {
        console.error(`${MODULE_ID} | ERROR preUpdateItem: futureWeightInTargetContainer is NaN. Reason: ${logReason}`);
        return false;
    }

    const tolerance = 0.001;

    if (futureWeightInTargetContainer > containerMaxWeight + tolerance) {
        const customMessage = game.settings.get(MODULE_ID, 'capacityExceededMessage') || "Container capacity exceeded.";
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

    const { units, multiplier } = getWeightDisplaySettings();
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

        const effectiveWeight = getEffectiveItemWeight(item, actor, true);
        const weightSource = foundry.utils.getProperty(item, "system.weight");
        let baseWeight = 0;
        if (typeof weightSource === 'number') baseWeight = weightSource;
        else if (typeof weightSource === 'object' && weightSource !== null && typeof weightSource.value === 'number') baseWeight = weightSource.value;
        baseWeight = Number(baseWeight) || 0;

        if (Math.abs(effectiveWeight - (baseWeight * multiplier)) < 0.001) { existingSpan.remove(); return; }

        if (weightCell.length > 0) {
            const displayWeight = effectiveWeight.toFixed(2);
            const effectiveWeightText = `(${game.i18n.localize('WEIGHTYCONTAINERS.ItemWeightLabel')}: ${displayWeight} ${units})`;

            if (existingSpan.length) {
               existingSpan.text(effectiveWeightText);
            } else {
               weightCell.append(`<span class="weighty-effective-weight">${effectiveWeightText}</span>`);
            }
        }

        // Обновляем прогресс-бар для контейнеров в инвентаре актора
        if (item.type === 'container' && isActualWeightContainer(item)) {
            updateContainerProgressBar($(element), item, actor, {
                progressSelectors: ['.container-progress', '.progress-bar', '.encumbrance-bar'],
                valueSelectors: ['.container-weight', '.weight-value']
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

    broadcastContainerUpdate(item.id, actor.id);
}

Hooks.on("updateItem", (item, change, options, userId) => {
    const flagPath = `flags.${MODULE_ID}.${FLAG_WEIGHT_REDUCTION}`;
    const relevantChange = foundry.utils.hasProperty(change, flagPath)
                       || foundry.utils.hasProperty(change, 'system.container')
                       || foundry.utils.hasProperty(change, 'system.quantity')
                       || foundry.utils.hasProperty(change, 'system.weight');
    if (relevantChange) {
        foundry.utils.debounce(() => refreshDependentSheets(item), 50)();
    }
});

Hooks.on("deleteItem", (item, options, userId) => {
    if (item.actor && foundry.utils.getProperty(item, "system.container")) {
        foundry.utils.debounce(() => refreshDependentSheets(item), 50)();
    }
});

// --- КОНЕЦ ФАЙЛА main.js ---