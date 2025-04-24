// weighty-containers/main.js

const MODULE_ID = 'weighty-containers';
const FLAG_WEIGHT_REDUCTION = 'weightReduction';
const FLAG_REDUCES_CURRENCY = 'reducesCurrencyWeight';
let libWrapper;

// --- Helper Functions ---

/**
 * Проверяет, является ли предмет контейнером с ограничением по весу.
 * @param {Item | null | undefined} item - Документ предмета.
 * @returns {boolean}
 */
function isActualWeightContainer(item) {
    // ... (без изменений) ...
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
    // ... (без изменений) ...
    if (!containerItem || typeof containerItem !== 'object' || containerItem.type !== 'container') return 0;
    let flagValue = undefined;
    try {
        flagValue = containerItem.getFlag(MODULE_ID, FLAG_WEIGHT_REDUCTION);
    } catch (e) {
        console.error(`${MODULE_ID} | Error calling getFlag for ${containerItem?.name}:`, e);
        flagValue = foundry.utils.getProperty(containerItem, `flags.${MODULE_ID}.${FLAG_WEIGHT_REDUCTION}`);
    }
    return Number(flagValue) || 0;
}

/**
 * Вычисляет эффективный вес предмета, учитывая снижение веса в КОНКРЕТНОМ контейнере.
 * @param {Item | object | null | undefined} itemOrData - Предмет (документ или объект с system данными).
 * @param {Actor | null | undefined} targetActor - Актер, на котором находится ЦЕЛЕВОЙ КОНТЕЙНЕР.
 * @param {Item | null | undefined} targetContainer - Целевой контейнер.
 * @returns {number} Эффективный вес предмета В ЭТОМ КОНТЕЙНЕРЕ.
 */
function getEffectiveItemWeightInContainer(itemOrData, targetActor, targetContainer) {
    // ... (без изменений) ...
     if (!itemOrData) return 0;
    const weightSource = foundry.utils.getProperty(itemOrData, "system.weight");
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

    // Если нет целевого контейнера или он не наш весовой, возвращаем базовый вес
    if (!targetContainer || !isActualWeightContainer(targetContainer)) {
        return baseWeight;
    }

    const reductionPercent = getWeightReductionPercent(targetContainer);
    if (reductionPercent <= 0) {
        return baseWeight; // Нет скидки
    }

    const multiplier = Math.max(0, 1 - reductionPercent / 100);
    const effectiveWeight = baseWeight * multiplier;

    if (isNaN(effectiveWeight)) {
        console.error(`%c${MODULE_ID} | ERROR getEffectiveItemWeightInContainer: Calculation resulted in NaN! Item: ${itemOrData?.name}, BaseW: ${baseWeight}, Multiplier: ${multiplier}. Returning 0.`, "color: red; font-weight: bold;");
        return 0;
    }
    return effectiveWeight;
}

/**
 * Вычисляет эффективный вес предмета (учитывая контейнер, в котором он ЛЕЖИТ).
 * @param {Item | null | undefined} item - Предмет для проверки.
 * @param {Actor | null | undefined} [actor=item?.actor] - Актер, которому принадлежит предмет.
 * @returns {number} Эффективный вес предмета.
 */
function getEffectiveItemWeight(item, actor = item?.actor) {
    // ... (без изменений) ...
      if (!item) return 0;
    const containerId = foundry.utils.getProperty(item, "system.container");
    let container = null;
    if (actor && containerId) {
        container = actor.items.get(containerId);
    }
    // Передаем найденный контейнер (или null) в функцию расчета
    return getEffectiveItemWeightInContainer(item, actor, container);
}

/**
 * НОВАЯ ЛОГИКА: Вычисляет общий текущий вес содержимого контейнера,
 * ВКЛЮЧАЯ эффективный вес ВСЕЙ валюты актора.
 * @param {Item | null | undefined} containerItem - Документ предмета-контейнера.
 * @param {Actor | null | undefined} actor - Актер, которому принадлежит контейнер.
 * @returns {number} Суммарный вес (эфф. предметы + эфф. валюта).
 */
function calculateCurrentContainerWeight(containerItem, actor) {
    if (!actor || !containerItem || !isActualWeightContainer(containerItem)) return 0;

    // Считаем вес ПРЕДМЕТОВ внутри этого контейнера
    let currentItemWeight = 0;
    if (actor.items && typeof actor.items.filter === 'function') {
        const contents = actor.items.filter(i => foundry.utils.getProperty(i, "system.container") === containerItem.id);
        for (const item of contents) {
            const quantity = Number(foundry.utils.getProperty(item, "system.quantity")) || 1;
            currentItemWeight += getEffectiveItemWeightInContainer(item, actor, containerItem) * quantity;
        }
    } else {
         console.error(`${MODULE_ID} | calculateCurrentContainerWeight: actor.items is not valid for actor:`, actor.name);
    }
    if (isNaN(currentItemWeight)) {
        console.error(`${MODULE_ID} | calculateCurrentContainerWeight: Item weight sum is NaN for container:`, containerItem.name);
        currentItemWeight = 0; // Считаем 0 если ошибка
    }

    // Считаем эффективный вес ВСЕЙ валюты актора
    let effectiveCurrencyWeight = 0;
    let bestCurrencyReductionPercent = 0;
    let hasCurrencyReducingContainer = false;
     if (actor.items && typeof actor.items.forEach === 'function') {
        actor.items.forEach(it => {
            if (it.type === 'container' && isActualWeightContainer(it) && it.getFlag(MODULE_ID, FLAG_REDUCES_CURRENCY)) {
                hasCurrencyReducingContainer = true;
                const reduction = getWeightReductionPercent(it);
                if (reduction > bestCurrencyReductionPercent) {
                    bestCurrencyReductionPercent = reduction;
                }
            }
        });
     }

     const currency = actor.system?.currency ?? {};
     const totalCoins = Object.values(currency).reduce((acc, v) => acc + Number(v || 0), 0);
     const coinsPerPound = game.settings.get("dnd5e", "currencyWeight") ?? 50;
     if (coinsPerPound > 0 && totalCoins > 0) {
         const baseCurrencyWeight = totalCoins / coinsPerPound;
         const currencyMultiplier = hasCurrencyReducingContainer ? Math.max(0, 1 - bestCurrencyReductionPercent / 100) : 1;
         effectiveCurrencyWeight = baseCurrencyWeight * currencyMultiplier;
     }
     if (isNaN(effectiveCurrencyWeight)) {
         console.error(`${MODULE_ID} | calculateCurrentContainerWeight: Currency weight is NaN for actor:`, actor.name);
         effectiveCurrencyWeight = 0; // Считаем 0 если ошибка
     }

    // Суммируем вес предметов и вес валюты
    const totalWeight = currentItemWeight + effectiveCurrencyWeight;
    // console.log(`%c${MODULE_ID} | >>> DEBUG calculateCurrentContainerWeight: ItemW: ${currentItemWeight.toFixed(2)}, CurrW: ${effectiveCurrencyWeight.toFixed(2)}, Total: ${totalWeight.toFixed(2)} for container ${containerItem.name}`, "color: purple;");
    return Number(totalWeight.toPrecision(5));
}


/**
 * Получает CSS класс редкости на основе процента снижения веса.
 * @param {number} reductionPercent - Процент снижения (0-100).
 * @returns {string} CSS класс.
 */
function getRarityClassForReduction(reductionPercent) {
    // ... (без изменений) ...
    if (reductionPercent >= 95) return 'rarity-artifact';
    if (reductionPercent >= 75) return 'rarity-legendary';
    if (reductionPercent >= 50) return 'rarity-very-rare';
    if (reductionPercent >= 25) return 'rarity-rare';
    if (reductionPercent > 0) return 'rarity-uncommon';
    return 'rarity-common';
}

// --- Hooks ---

Hooks.once('init', () => {
    // ... (код init без изменений) ...
     console.log(`${MODULE_ID} | HOOK: init`);
    console.log(`${MODULE_ID} | Checking for libWrapper...`);
    if (game.modules.get('lib-wrapper')?.active) { libWrapper = globalThis.libWrapper; console.log(`${MODULE_ID} | libWrapper found and active.`); }
    else { console.log(`${MODULE_ID} | libWrapper not found. Using manual patching.`); }
    try {
        game.settings.register(MODULE_ID, 'gmOnlyConfig', { name: game.i18n.localize("WEIGHTYCONTAINERS.SettingGMOnlyConfig"), hint: game.i18n.localize("WEIGHTYCONTAINERS.SettingGMOnlyConfigHint"), scope: 'world', config: true, type: Boolean, default: true, requiresReload: false });
        game.settings.register(MODULE_ID, 'capacityExceededMessage', { name: "WEIGHTYCONTAINERS.SettingCapacityMessageName", hint: "WEIGHTYCONTAINERS.SettingCapacityMessageHint", scope: 'world', config: true, type: String, default: "Больно ты дохуя взял", requiresReload: false });
        console.log(`${MODULE_ID} | Settings Initialized`);
    } catch (e) { console.error(`${MODULE_ID} | Failed to register settings:`, e); }
});

Hooks.once('setup', () => {
    console.log(`${MODULE_ID} | HOOK: setup`);
});

// --- Патчинг данных актора ---

/**
 * Логика модификации данных загрузки актора ПОСЛЕ оригинального расчета.
 * @param {Actor} actor - Документ актора.
 */
function modifyEncumbranceData(actor) {
    // ... (код modifyEncumbranceData БЕЗ ИЗМЕНЕНИЙ) ...
    if (!actor || !actor.items || !actor.system?.attributes?.encumbrance) return;
    const originalCalculatedValue = actor.system.attributes.encumbrance.value;
    const baseMax = actor.system.attributes.encumbrance.max;
    let totalItemWeightSavings = 0;
    let bestCurrencyReductionPercent = 0;
    let hasCurrencyReducingContainer = false;
    let baseCurrencyWeight = 0;
    const currency = actor.system.currency ?? {};
    const totalCoins = Object.values(currency).reduce((acc, v) => acc + Number(v || 0), 0);
    const coinsPerPound = game.settings.get("dnd5e", "currencyWeight") ?? 50;
    if (coinsPerPound > 0 && totalCoins > 0) baseCurrencyWeight = totalCoins / coinsPerPound;
    for (const item of actor.items) {
        if (!item.system) continue;
        let reductionPercent = 0;
        let container = null;
        const containerId = foundry.utils.getProperty(item, "system.container");
        if (containerId) {
            container = actor.items.get(containerId);
            if (container && isActualWeightContainer(container)) {
                reductionPercent = getWeightReductionPercent(container);
                if (!!container.getFlag(MODULE_ID, FLAG_REDUCES_CURRENCY)) {
                     hasCurrencyReducingContainer = true;
                     if (reductionPercent > bestCurrencyReductionPercent) bestCurrencyReductionPercent = reductionPercent;
                 }
            }
        }
        if (item.type === 'container' && isActualWeightContainer(item)) {
             if (!!item.getFlag(MODULE_ID, FLAG_REDUCES_CURRENCY)) {
                 hasCurrencyReducingContainer = true;
                 const selfReduction = getWeightReductionPercent(item);
                 if (selfReduction > bestCurrencyReductionPercent) bestCurrencyReductionPercent = selfReduction;
             }
         }
        if (reductionPercent > 0 && !foundry.utils.getProperty(item, "system.weightless") && item.type !== 'container' && container && isActualWeightContainer(container)) {
             const quantity = Number(foundry.utils.getProperty(item, "system.quantity")) || 1;
             const weightSource = foundry.utils.getProperty(item, "system.weight");
             let baseWeightPerUnit = 0;
             if (typeof weightSource === 'number') baseWeightPerUnit = weightSource;
             else if (typeof weightSource === 'object' && weightSource !== null && typeof weightSource.value === 'number') baseWeightPerUnit = weightSource.value;
             baseWeightPerUnit = Number(baseWeightPerUnit) || 0;
             const effectiveWeightPerUnit = getEffectiveItemWeightInContainer(item, actor, container);
             if (!isNaN(baseWeightPerUnit) && !isNaN(effectiveWeightPerUnit)) {
                 const savingPerUnit = baseWeightPerUnit - effectiveWeightPerUnit;
                 if (savingPerUnit > 0) totalItemWeightSavings += savingPerUnit * quantity;
             }
        }
    }
    let currencyWeightSavings = 0;
    if (hasCurrencyReducingContainer && bestCurrencyReductionPercent > 0) {
        const currencyMultiplier = Math.max(0, 1 - bestCurrencyReductionPercent / 100);
        const effectiveCurrencyWeight = baseCurrencyWeight * currencyMultiplier;
        if (!isNaN(baseCurrencyWeight) && !isNaN(effectiveCurrencyWeight)) currencyWeightSavings = baseCurrencyWeight - effectiveCurrencyWeight;
    }
    const finalEffectiveWeight = originalCalculatedValue - totalItemWeightSavings - currencyWeightSavings;
    actor.system.attributes.encumbrance.value = Math.max(0, Number(finalEffectiveWeight.toPrecision(5)));
    const enc = actor.system.attributes.encumbrance;
    enc.encumbered = false;
    enc.heavilyEncumbered = false;
    enc.thresholds = { light: 0, medium: 0, heavy: 0, maximum: baseMax ?? 0 };
    if (enc.units !== "%" && typeof baseMax === 'number' && baseMax > 0) {
        let thresholdsConfig = null;
        if (CONFIG.DND5E?.encumbrance?.threshold) thresholdsConfig = CONFIG.DND5E.encumbrance.threshold[actor.type] ?? CONFIG.DND5E.encumbrance.threshold.default;
        if (!thresholdsConfig) thresholdsConfig = { light: 1/3, medium: 2/3, heavy: 1 };
        if (typeof thresholdsConfig === 'object' && thresholdsConfig !== null) {
            enc.thresholds = { light: baseMax * (thresholdsConfig.light ?? 1/3), medium: baseMax * (thresholdsConfig.medium ?? 2/3), heavy: baseMax * (thresholdsConfig.heavy ?? 1), maximum: baseMax };
            enc.encumbered = enc.value > enc.thresholds.medium;
            enc.heavilyEncumbered = enc.value > enc.thresholds.heavy;
        } else { console.warn(`${MODULE_ID} | Invalid thresholdsConfig for ${actor.name}.`); }
    } else if (enc.units !== "%") { /* console.warn(`${MODULE_ID} | Invalid baseMax for ${actor.name}.`); */ }
}


/**
 * Патчит метод prepareDerivedData актора.
 */
function patchActorDerivedData() {
    // ... (код patchActorDerivedData без изменений) ...
    console.log(`${MODULE_ID} | Attempting to patch Actor prepareDerivedData...`);
    try {
        const targetMethod = "CONFIG.Actor.documentClass.prototype.prepareDerivedData";
        if (libWrapper) {
            libWrapper.register(MODULE_ID, targetMethod, function(wrapped, ...args) { wrapped(...args); if (this.system?.attributes?.encumbrance) modifyEncumbranceData(this); }, "WRAPPER");
            console.log(`${MODULE_ID} | Successfully wrapped ${targetMethod} with libWrapper.`);
        } else {
            console.warn(`${MODULE_ID} | Attempting manual patch for ${targetMethod}...`);
            const originalMethod = CONFIG.Actor.documentClass.prototype.prepareDerivedData;
            if (typeof originalMethod !== 'function') { console.error(`${MODULE_ID} | Failed to find original method ${targetMethod} for manual patching!`); return; }
            CONFIG.Actor.documentClass.prototype.prepareDerivedData = function(...args) { originalMethod.apply(this, args); if (this.system?.attributes?.encumbrance) modifyEncumbranceData(this); };
            console.log(`${MODULE_ID} | Manually patched ${targetMethod}.`);
        }
    } catch (e) { console.error(`${MODULE_ID} | Failed to patch Actor prepareDerivedData:`, e); }
}

// --- КОНЕЦ ПАТЧИНГА ---

// --- ИНТЕГРАЦИЯ ITEM PILES (Удалена) ---

Hooks.once('ready', () => {
    console.log(`${MODULE_ID} | HOOK: ready`);
    patchActorDerivedData();
    console.log(`${MODULE_ID} | Module Ready`);
});


/**
 * Добавляем UI элементы на лист контейнера.
 */
Hooks.on('renderItemSheet', (app, html, data) => {
    // ... (код добавления UI шапки и чекбокса без изменений) ...
     if (!(app instanceof ItemSheet) || !app.object) return;
    const item = app.object;

    const isWeightContainer = isActualWeightContainer(item);
    const targetBlock = html.find('header.sheet-header .middle.identity-info');

    if (targetBlock.length === 0) return;

    targetBlock.find('.weighty-container-ui-wrapper').remove(); // Удаляем старый UI шапки

    // Удаляем старый чекбокс валюты из вкладки Details
    const detailsTab = html.find('.tab.details[data-tab="details"]');
    if (detailsTab.length > 0) {
        detailsTab.find('.form-group.reduces-currency').remove();
    }

    if (!isWeightContainer) return; // Выходим, если это не весовой контейнер

    // Добавляем основной UI (процент и кнопку) в шапку
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

    // Добавляем чекбокс валюты во вкладку Details
     if (detailsTab.length > 0) {
        const reducesCurrency = !!item.getFlag(MODULE_ID, FLAG_REDUCES_CURRENCY);
        const currencyCheckboxId = `weighty-reduces-currency-${item.id || foundry.utils.randomID()}`;
        const currencyCheckboxHTML = `
            <div class="form-group reduces-currency" style="margin-top: 5px; flex-basis: 100%; border-top: 1px solid #CCC; padding-top: 5px;">
                <label for="${currencyCheckboxId}" style="flex: 1; padding-left: 5px;">${game.i18n.localize('WEIGHTYCONTAINERS.ReducesCurrencyLabel')}</label>
                <div class="form-fields" style="flex: 0 0 30px;">
                    <input type="checkbox" id="${currencyCheckboxId}" name="flags.${MODULE_ID}.${FLAG_REDUCES_CURRENCY}" ${reducesCurrency ? 'checked' : ''} />
                </div>
            </div>
        `;
        const currencyCheckbox = $(currencyCheckboxHTML);
        currencyCheckbox.find('input[type="checkbox"]').on('change', async (ev) => {
            const isChecked = $(ev.currentTarget).is(':checked');
            await item.setFlag(MODULE_ID, FLAG_REDUCES_CURRENCY, isChecked);
        });

        const targetFieldset = detailsTab.find('fieldset:has(input[name="system.capacity.weight.value"])');
        if(targetFieldset.length > 0) {
            targetFieldset.append(currencyCheckbox);
        } else {
            detailsTab.append(currencyCheckbox);
        }
    }

    targetBlock.append(uiWrapper); // Добавляем основной UI в шапку

    try { if (app.rendered) app.setPosition({ height: "auto" }); } catch (e) { /* Игнорируем */ }

    // --- ИЗМЕНЕНО: Обновление отображаемого веса содержимого ---
    if (isWeightContainer && app.actor) {
        try {
            const actor = app.actor;
            const containerItem = item;
            // Используем НОВУЮ calculateCurrentContainerWeight, которая включает валюту
            const displayTotalWeight = calculateCurrentContainerWeight(containerItem, actor);
            const containerMaxWeight = Number(foundry.utils.getProperty(containerItem, "system.capacity.weight.value") ?? 0);

            const contentsTab = html.find('.tab.contents[data-tab="contents"]');
            if (contentsTab.length > 0) {
                const valueElement = contentsTab.find('.encumbrance .meter .label .value');
                const meterElement = contentsTab.find('.encumbrance .meter.progress');

                if (valueElement.length > 0) {
                    valueElement.text(Math.round(displayTotalWeight * 100) / 100); // Показываем общий вес
                }
                if (meterElement.length > 0 && containerMaxWeight > 0) {
                    // Полоску тоже считаем от общего веса (предметы + валюта)
                    const percentage = Math.min(100, Math.round((displayTotalWeight / containerMaxWeight) * 100));
                    meterElement.css('--bar-percentage', `${percentage}%`);
                    meterElement.attr('aria-valuenow', displayTotalWeight.toFixed(2));
                }
            }
        } catch(e) {
            console.error(`${MODULE_ID} | Error updating container sheet weight display:`, e);
        }
    }
    // --- КОНЕЦ ИЗМЕНЕНИЯ ---
});

/**
 * Хук для проверки вместимости ПЕРЕД созданием предмета.
 */
Hooks.on('preCreateItem', (itemDoc, createData, options, userId) => {
    // ... (код preCreateItem без изменений, использует НОВУЮ calculateCurrentContainerWeight) ...
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
        // Вес ДОБАВЛЯЕМОГО ПРЕДМЕТА считаем в контексте контейнера
        effectiveWeightToAdd = getEffectiveItemWeightInContainer(tempItemDoc, actor, container) * itemToAddQuantity;
    } catch (err) {
        console.error(`${MODULE_ID} | ERROR preCreateItem: Failed to calculate effective weight.`, err);
        return false;
    }

    if (isNaN(effectiveWeightToAdd)) {
        console.error(`${MODULE_ID} | ERROR preCreateItem: effectiveWeightToAdd is NaN.`);
        return false;
    }

    // Используем НОВУЮ функцию для текущего веса (предметы+валюта)
    const currentWeight = calculateCurrentContainerWeight(container, actor);
     if (isNaN(currentWeight)) {
        console.error(`${MODULE_ID} | ERROR preCreateItem: currentWeight is NaN.`);
        return false;
    }

    const potentialTotalWeight = currentWeight + effectiveWeightToAdd; // Суммируем текущий (предметы+валюта) и добавляемый (предмет)
    const tolerance = 0.001;
    // console.log(`${MODULE_ID} | DEBUG: preCreateItem: Current(Items+Currency): ${currentWeight.toFixed(5)}, Adding Item: ${effectiveWeightToAdd.toFixed(5)}, Potential: ${potentialTotalWeight.toFixed(5)}, Max: ${containerMaxWeight}`);

    if (potentialTotalWeight > containerMaxWeight + tolerance) {
        const customMessage = game.settings.get(MODULE_ID, 'capacityExceededMessage') || "Container capacity exceeded.";
        console.warn(`${MODULE_ID} | BLOCKED preCreateItem: Limit exceeded.`);
        ui.notifications.warn(customMessage);
        return false;
    }

    // console.log(`${MODULE_ID} | ALLOWED preCreateItem: Within limit.`);
    return true;
});

/**
 * Хук для проверки вместимости ПЕРЕД обновлением предмета.
 */
Hooks.on('preUpdateItem', (itemDoc, change, options, userId) => {
    // ... (код preUpdateItem без изменений, использует НОВУЮ calculateCurrentContainerWeight) ...
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

    const containerMaxWeight = Number(foundry.utils.getProperty(container, "system.capacity.weight.value") ?? 0);
    if (containerMaxWeight <= 0) return true;

    let effectiveSingleItemWeight = 0;
    try {
        const changedItemData = foundry.utils.mergeObject(itemDoc.toObject(false), change ?? {});
        const tempChangedItemDoc = new Item(changedItemData, { temporary: true });
        effectiveSingleItemWeight = getEffectiveItemWeightInContainer(tempChangedItemDoc, actor, container);
    } catch (err) {
        console.error(`${MODULE_ID} | ERROR preUpdateItem: Failed to calculate effective weight.`, err);
        return false;
    }

    if (isNaN(effectiveSingleItemWeight)) {
        console.error(`${MODULE_ID} | ERROR preUpdateItem: effectiveSingleItemWeight is NaN.`);
        return false;
    }

    // Используем НОВУЮ функцию для текущего веса (предметы+валюта)
    let currentWeightInTargetContainer = calculateCurrentContainerWeight(container, actor);
     if (isNaN(currentWeightInTargetContainer)) {
        console.error(`${MODULE_ID} | ERROR preUpdateItem: currentWeightInTargetContainer is NaN.`);
        return false;
    }

    let futureWeightInTargetContainer = 0;
    let logReason = "";

    // Важно: calculateCurrentContainerWeight УЖЕ включает вес валюты.
    // Нам нужно добавить ТОЛЬКО изменение веса от ПРЕДМЕТА.
    if (isMovingIntoContainer) {
        // Вес всего перемещаемого стака предмета
        const weightOfMovedStack = effectiveSingleItemWeight * newQuantity;
        if (isNaN(weightOfMovedStack)) { logReason = "NaN Error: weightOfMovedStack"; futureWeightInTargetContainer = NaN; }
        else {
            // Так как currentWeight УЖЕ включает валюту, просто добавляем вес предмета
            futureWeightInTargetContainer = currentWeightInTargetContainer + weightOfMovedStack;
            logReason = `Move ${newQuantity} items`;
        }
    } else if (isQuantityIncreaseInContainer && checkContainerId === finalContainerId) {
        // Вес только ДОБАВЛЕННЫХ единиц предмета
        const quantityChange = newQuantity - oldQuantity;
        const addedWeight = effectiveSingleItemWeight * quantityChange;
         if (isNaN(addedWeight)) { logReason = "NaN Error: addedWeight"; futureWeightInTargetContainer = NaN; }
        else {
            // Так как currentWeight УЖЕ включает валюту и старый вес предмета, добавляем только дельту
            futureWeightInTargetContainer = currentWeightInTargetContainer + addedWeight;
            logReason = `Increase by ${quantityChange}`;
        }
    } else {
        return true; // Другие случаи не проверяем (уменьшение и т.д.)
    }


    if (isNaN(futureWeightInTargetContainer)) {
        console.error(`${MODULE_ID} | ERROR preUpdateItem: futureWeightInTargetContainer is NaN. Reason: ${logReason}`);
        return false;
    }

    const tolerance = 0.001;
    // console.log(`${MODULE_ID} | DEBUG: preUpdateItem: Current(Items+Currency): ${currentWeightInTargetContainer.toFixed(5)}, Future: ${futureWeightInTargetContainer.toFixed(5)}, Max: ${containerMaxWeight}. Reason: ${logReason}`);

    if (futureWeightInTargetContainer > containerMaxWeight + tolerance) {
        const customMessage = game.settings.get(MODULE_ID, 'capacityExceededMessage') || "Container capacity exceeded.";
        console.warn(`${MODULE_ID} | BLOCKED preUpdateItem: Limit exceeded.`);
        ui.notifications.warn(customMessage);
        return false;
    }

    // console.log(`${MODULE_ID} | ALLOWED preUpdateItem: Within limit.`);
    return true;
});


/**
 * Добавляем отображение эффективного веса на листе актора
 */
Hooks.on('renderActorSheet', (app, html, data) => {
    // ... (код renderActorSheet без изменений) ...
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

        const effectiveWeight = getEffectiveItemWeight(item, actor); // Стандартный вызов
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
    });
});

/**
 * Обновление отображения веса на листе актора и листах контейнеров при изменении
 */
function refreshDependentSheets(item) {
    // ... (код refreshDependentSheets без изменений) ...
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
    // ... (код updateItem без изменений) ...
     const flagPath = `flags.${MODULE_ID}.${FLAG_WEIGHT_REDUCTION}`;
     const relevantChange = foundry.utils.hasProperty(change, flagPath)
                       || foundry.utils.hasProperty(change, 'system.container')
                       || foundry.utils.hasProperty(change, 'system.quantity')
                       || foundry.utils.hasProperty(change, 'system.weight')
                       || foundry.utils.hasProperty(change, `flags.${MODULE_ID}.${FLAG_REDUCES_CURRENCY}`); // Добавили проверку флага валюты
    if (relevantChange) {
        setTimeout(() => refreshDependentSheets(item), 50);
    }
});

Hooks.on("deleteItem", (item, options, userId) => {
    // ... (код deleteItem без изменений) ...
     if (item.actor && foundry.utils.getProperty(item, "system.container")) {
        setTimeout(() => refreshDependentSheets(item), 50);
    }
});

// --- КОНЕЦ ФАЙЛА main.js ---