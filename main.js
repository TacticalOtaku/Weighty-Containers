// weighty-containers/main.js

const MODULE_ID = 'weighty-containers';
const FLAG_WEIGHT_REDUCTION = 'weightReduction';
const FLAG_REDUCES_CURRENCY = 'reducesCurrencyWeight'; // Новый флаг
let libWrapper;

// --- Helper Functions ---
// isActualWeightContainer, getWeightReductionPercent, getEffectiveItemWeight,
// calculateCurrentContainerWeight, getRarityClassForReduction
// --- ОСТАЮТСЯ БЕЗ ИЗМЕНЕНИЙ из предыдущей версии ---
// ... (скопируйте их сюда) ...
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
 * Вычисляет эффективный вес предмета, учитывая снижение веса в контейнере.
 * @param {Item | object | null | undefined} item - Предмет (документ или данные).
 * @param {Actor | null | undefined} [targetActor=item?.actor] - Актер целевого контейнера.
 * @param {Item | null | undefined} [targetContainer=null] - Целевой контейнер.
 * @returns {number} Эффективный вес предмета.
 */
function getEffectiveItemWeight(item, targetActor = item?.actor, targetContainer = null) {
    if (!item) return 0;
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

    // Определяем контейнер: либо переданный явно, либо (если есть actor) из ID в предмете
    const containerToUse = targetContainer ?? (targetActor?.items?.get(foundry.utils.getProperty(item, "system.container")) || null);

    if (!containerToUse || !isActualWeightContainer(containerToUse)) {
        return baseWeight;
    }

    const reductionPercent = getWeightReductionPercent(containerToUse);
    if (reductionPercent <= 0) {
        return baseWeight;
    }

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
        console.error(`${MODULE_ID} | calculateCurrentContainerWeight: actor.items is not valid for actor:`, actor.name);
        return 0;
    }
    const contents = actor.items.filter(i => foundry.utils.getProperty(i, "system.container") === containerItem.id);

    for (const item of contents) {
        const quantity = Number(foundry.utils.getProperty(item, "system.quantity")) || 1;
        currentWeight += getEffectiveItemWeight(item, actor, containerItem) * quantity;
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

// --- Hooks ---

Hooks.once('init', () => {
    // ... (код регистрации настроек без изменений) ...
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
    // ... (код modifyEncumbranceData без изменений, включая исправление v2 для порогов) ...
    if (!actor || !actor.items || !actor.system?.attributes?.encumbrance) {
        return;
    }

    // --- Шаг 1: Рассчитать базовый вес валюты ---
    let baseCurrencyWeight = 0;
    const currency = actor.system.currency ?? {};
    const totalCoins = Object.values(currency).reduce((acc, v) => acc + Number(v || 0), 0);
    const coinsPerPound = game.settings.get("dnd5e", "currencyWeight") ?? 50;
    if (coinsPerPound > 0 && totalCoins > 0) {
        baseCurrencyWeight = totalCoins / coinsPerPound;
    }

    // --- Шаг 2: Рассчитать эффективный вес ПРЕДМЕТОВ и найти лучшую скидку для валюты ---
    let effectiveItemWeight = 0;
    let bestCurrencyReductionPercent = 0;
    let hasCurrencyReducingContainer = false;

    for (const item of actor.items) {
        if (!item.system) continue;

        let containerReducesCurrency = false; // Перенес внутрь цикла
        if (item.type === 'container' && isActualWeightContainer(item)) {
            if (!!item.getFlag(MODULE_ID, FLAG_REDUCES_CURRENCY)) {
                containerReducesCurrency = true;
                hasCurrencyReducingContainer = true;
                const reduction = getWeightReductionPercent(item);
                if (reduction > bestCurrencyReductionPercent) {
                    bestCurrencyReductionPercent = reduction;
                }
            }
        }

        // --- Расчет веса предмета для общей загрузки ---
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
        if (foundry.utils.getProperty(item, "system.weightless") || item.type === 'container') {
             countItemWeight = false;
        }

        if (countItemWeight) {
             const quantity = Number(foundry.utils.getProperty(item, "system.quantity")) || 1;
             const weightPerUnit = getEffectiveItemWeight(item, actor);

             if (!isNaN(weightPerUnit)) {
                 effectiveItemWeight += (weightPerUnit * quantity);
             } else {
                 console.warn(`${MODULE_ID} | Calculated NaN weight for item ${item.name}`);
             }
        }
    } // Конец цикла по предметам

    // --- Шаг 3: Рассчитать эффективный вес валюты ---
    const currencyMultiplier = hasCurrencyReducingContainer ? Math.max(0, 1 - bestCurrencyReductionPercent / 100) : 1;
    const effectiveCurrencyWeight = baseCurrencyWeight * currencyMultiplier;

    // --- Шаг 4: Суммировать и установить итоговый вес ---
    const finalEffectiveWeight = Number((effectiveItemWeight + effectiveCurrencyWeight).toPrecision(5));
    actor.system.attributes.encumbrance.value = finalEffectiveWeight;

    // --- Шаг 5: Пересчитать уровни загрузки ---
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
            // console.warn(`${MODULE_ID} | Threshold config not found for actor type '${actor.type}'. Using fallback ratios (1/3, 2/3, 1) for encumbrance levels.`);
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
    } else if (enc.units !== "%") {
         // console.warn(`${MODULE_ID} | Could not calculate encumbrance levels for ${actor.name}: Invalid baseMax value.`);
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

// --- КОНЕЦ ПАТЧИНГА ---

// --- ИНТЕГРАЦИЯ ITEM PILES ---

/**
 * Обработчик хука ItemPiles.API.hookPreDropItem
 * @param {Actor} pileActor - Актер, представляющий кучу/контейнер.
 * @param {object} itemData - Данные перетаскиваемого предмета.
 * @param {number} quantity - Количество перетаскиваемых предметов.
 * @returns {boolean} - Вернуть false, чтобы отменить добавление.
 */
function onPreDropItem_ItemPiles(pileActor, itemData, quantity) {
    console.log(`${MODULE_ID} | Item Piles Hook: onPreDropItem triggered for pile ${pileActor?.name}.`);

    // Пытаемся найти "основной" контейнер на акторе-куче.
    // Это может потребовать доработки в зависимости от того, как Item Piles структурирует контейнеры.
    const container = pileActor?.items?.find(i => i.type === 'container' && isActualWeightContainer(i));

    if (!container) {
        // console.log(`${MODULE_ID} | Item Piles Hook: Target pile actor ${pileActor?.name} has no weighty container item.`);
        return true; // Нет нашего контейнера, разрешаем
    }

    // console.log(`${MODULE_ID} | Item Piles Hook: Checking capacity for container ${container.name} on pile ${pileActor.name}`);
    const containerMaxWeight = Number(foundry.utils.getProperty(container, "system.capacity.weight.value") ?? 0);
    if (containerMaxWeight <= 0) {
        return true; // Нет лимита
    }

    let effectiveWeightToAdd = 0;
    try {
        // Создаем временный объект Item из itemData (может быть не полным!)
        const tempItemDoc = new Item(itemData, { temporary: true });
        // Передаем целевой контейнер явно
        effectiveWeightToAdd = getEffectiveItemWeight(tempItemDoc, pileActor, container) * quantity;
    } catch (err) {
        console.error(`${MODULE_ID} | Item Piles Hook: Error calculating effective weight.`, err);
        return false;
    }

    if (isNaN(effectiveWeightToAdd)) {
        console.error(`${MODULE_ID} | Item Piles Hook: effectiveWeightToAdd is NaN.`);
        return false;
    }

    const currentWeight = calculateCurrentContainerWeight(container, pileActor);
     if (isNaN(currentWeight)) {
        console.error(`${MODULE_ID} | Item Piles Hook: currentWeight is NaN.`);
        return false;
    }

    const potentialTotalWeight = currentWeight + effectiveWeightToAdd;
    const tolerance = 0.001;
    // console.log(`${MODULE_ID} | Item Piles Hook: Current: ${currentWeight.toFixed(5)}, Adding: ${effectiveWeightToAdd.toFixed(5)}, Potential: ${potentialTotalWeight.toFixed(5)}, Max: ${containerMaxWeight}`);

    if (potentialTotalWeight > containerMaxWeight + tolerance) {
        const customMessage = game.settings.get(MODULE_ID, 'capacityExceededMessage') || "Container capacity exceeded.";
        console.warn(`${MODULE_ID} | Item Piles Hook: BLOCKED - Limit exceeded.`);
        ui.notifications.warn(customMessage);
        return false;
    }

    // console.log(`${MODULE_ID} | Item Piles Hook: ALLOWED - Within limit.`);
    return true;
}

// --- КОНЕЦ ИНТЕГРАЦИИ ITEM PILES ---


Hooks.once('ready', () => {
    console.log(`${MODULE_ID} | HOOK: ready`);
    patchActorDerivedData(); // Патчим загрузку

    // --- ИЗМЕНЕННАЯ РЕГИСТРАЦИЯ ХУКА ITEM PILES ---
    // Используем setTimeout для небольшой задержки
    setTimeout(() => {
        if (game.modules.get('item-piles')?.active) {
            console.log(`${MODULE_ID} | Item Piles active, attempting to register hook (delayed)...`);
            // Улучшенная проверка API
            if (globalThis.ItemPiles?.API?.hookPreDropItem && typeof globalThis.ItemPiles.API.hookPreDropItem === 'function') {
                try {
                    ItemPiles.API.hookPreDropItem(onPreDropItem_ItemPiles);
                    console.log(`${MODULE_ID} | Successfully registered Item Piles hookPreDropItem.`);
                } catch(e) {
                    console.error(`${MODULE_ID} | Error registering Item Piles hook:`, e);
                }
            } else {
                console.warn(`${MODULE_ID} | Item Piles API (ItemPiles.API.hookPreDropItem) not found or not a function! Item Piles compatibility might be limited.`);
            }
        }
    }, 200); // Задержка 200 мс
    // --- КОНЕЦ ИЗМЕНЕННОЙ РЕГИСТРАЦИИ ХУКА ---

    console.log(`${MODULE_ID} | Module Ready`);
});


/**
 * Добавляем UI элементы на лист контейнера.
 */
Hooks.on('renderItemSheet', (app, html, data) => {
    // ... (код renderItemSheet без изменений, включая чекбокс валюты) ...
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
    targetBlock.append(uiWrapper); // Добавляем основной UI в шапку

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

    try { if (app.rendered) app.setPosition({ height: "auto" }); } catch (e) { /* Игнорируем */ }

    // Обновление отображаемого веса содержимого на листе контейнера
    if (app.actor) {
        try {
            const actor = app.actor;
            const containerItem = item;
            const effectiveCurrentWeight = calculateCurrentContainerWeight(containerItem, actor);
            const containerMaxWeight = Number(foundry.utils.getProperty(containerItem, "system.capacity.weight.value") ?? 0);
            const contentsTab = html.find('.tab.contents[data-tab="contents"]');
            if (contentsTab.length > 0) {
                const valueElement = contentsTab.find('.encumbrance .meter .label .value');
                const meterElement = contentsTab.find('.encumbrance .meter.progress');
                if (valueElement.length > 0) {
                    valueElement.text(Math.round(effectiveCurrentWeight * 100) / 100);
                }
                if (meterElement.length > 0 && containerMaxWeight > 0) {
                    const percentage = Math.min(100, Math.round((effectiveCurrentWeight / containerMaxWeight) * 100));
                    meterElement.css('--bar-percentage', `${percentage}%`);
                    meterElement.attr('aria-valuenow', effectiveCurrentWeight.toFixed(2));
                }
            }
        } catch(e) {
            console.error(`${MODULE_ID} | Error updating container sheet weight display:`, e);
        }
    }
});

/**
 * Хук для проверки вместимости ПЕРЕД созданием предмета.
 */
Hooks.on('preCreateItem', (itemDoc, createData, options, userId) => {
    // ... (код preCreateItem без изменений) ...
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
        effectiveWeightToAdd = getEffectiveItemWeight(tempItemDoc, actor, container) * itemToAddQuantity;
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
    // console.log(`${MODULE_ID} | DEBUG: preCreateItem: Current: ${currentWeight.toFixed(5)}, Adding: ${effectiveWeightToAdd.toFixed(5)}, Potential: ${potentialTotalWeight.toFixed(5)}, Max: ${containerMaxWeight}`);

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
    // ... (код preUpdateItem без изменений) ...
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
        effectiveSingleItemWeight = getEffectiveItemWeight(tempChangedItemDoc, actor, container);
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
    // console.log(`${MODULE_ID} | DEBUG: preUpdateItem: Current: ${currentWeightInTargetContainer.toFixed(5)}, Future: ${futureWeightInTargetContainer.toFixed(5)}, Max: ${containerMaxWeight}. Reason: ${logReason}`);

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
                       || foundry.utils.hasProperty(change, 'system.weight');
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