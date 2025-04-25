// weighty-containers/main.js - Стабильная версия (только предметы)

const MODULE_ID = 'weighty-containers';
const FLAG_WEIGHT_REDUCTION = 'weightReduction';
const FLAG_REDUCES_CURRENCY = 'reducesCurrencyWeight'; // Флаг оставляем, но он не используется в расчетах веса/лимита
let libWrapper; // Оставляем, но не используем для патчинга

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
 * Получает процент снижения веса для КОНКРЕТНОГО контейнера.
 * @param {Item | null | undefined} containerItem - Документ предмета-контейнера.
 * @returns {number} Процент снижения (0-100).
 */
function getWeightReductionPercent(containerItem) {
    if (!containerItem || typeof containerItem !== 'object' || !isActualWeightContainer(containerItem)) return 0;
    let flagValue = undefined;
    try { flagValue = containerItem.getFlag(MODULE_ID, FLAG_WEIGHT_REDUCTION); }
    catch (e) { console.error(`${MODULE_ID} | Error calling getFlag for ${containerItem?.name}:`, e); flagValue = foundry.utils.getProperty(containerItem, `flags.${MODULE_ID}.${FLAG_WEIGHT_REDUCTION}`); }
    return Number(flagValue) || 0;
}

/**
 * Вычисляет БАЗОВЫЙ вес предмета (извлекает число).
 * @param {Item | object | null | undefined} itemOrData - Предмет (документ или объект).
 * @returns {number} Базовый вес.
 */
function getBaseItemWeight(itemOrData) {
    if (!itemOrData) return 0;
    const weightSource = foundry.utils.getProperty(itemOrData, "system.weight");
    let baseWeight = 0;
    if (typeof weightSource === 'number' && !isNaN(weightSource)) baseWeight = weightSource;
    else if (typeof weightSource === 'string') baseWeight = parseFloat(weightSource) || 0;
    else if (typeof weightSource === 'object' && weightSource !== null && typeof weightSource.value === 'number') baseWeight = Number(weightSource.value) || 0;
    else baseWeight = 0;
    if (isNaN(baseWeight)) { return 0; }
    return baseWeight;
}

/**
 * Вычисляет ЭФФЕКТИВНЫЙ вес предмета в КОНКРЕТНОМ контейнере.
 * @param {Item | object | null | undefined} itemOrData - Предмет.
 * @param {Actor | null | undefined} targetActor - Актер контейнера.
 * @param {Item | null | undefined} targetContainer - Контейнер.
 * @returns {number} Эффективный вес.
 */
function getEffectiveItemWeightInContainer(itemOrData, targetActor, targetContainer) {
     if (!itemOrData) return 0;
    const baseWeight = getBaseItemWeight(itemOrData);
    if (!targetContainer || !isActualWeightContainer(targetContainer)) return baseWeight;
    const reductionPercent = getWeightReductionPercent(targetContainer);
    if (reductionPercent <= 0) return baseWeight;
    const multiplier = Math.max(0, 1 - reductionPercent / 100);
    const effectiveWeight = baseWeight * multiplier;
    if (isNaN(effectiveWeight)) { console.error(`%c${MODULE_ID} | ERROR getEffectiveItemWeightInContainer: NaN! Ret 0.`, "color: red;"); return 0; }
    return effectiveWeight;
}

/**
 * Вычисляет ЭФФЕКТИВНЫЙ вес предмета (учитывая контейнер, в котором он ЛЕЖИТ).
 * @param {Item | null | undefined} item - Предмет для проверки.
 * @param {Actor | null | undefined} [actor=item?.actor] - Актер предмета.
 * @returns {number} Эффективный вес.
 */
function getEffectiveItemWeight(item, actor = item?.actor) {
      if (!item) return 0;
    const containerId = foundry.utils.getProperty(item, "system.container");
    let container = null;
    if (actor && containerId) {
        container = actor.items.get(containerId);
    }
    return getEffectiveItemWeightInContainer(item, actor, container);
}


/**
 * Вычисляет общий ТЕКУЩИЙ ЭФФЕКТИВНЫЙ вес ТОЛЬКО ПРЕДМЕТОВ внутри КОНКРЕТНОГО контейнера.
 * @param {Item | null | undefined} containerItem - Документ предмета-контейнера.
 * @param {Actor | null | undefined} actor - Актер, которому принадлежит контейнер.
 * @returns {number} Суммарный эффективный вес ПРЕДМЕТОВ.
 */
function calculateCurrentContainerItemWeight(containerItem, actor) {
    if (!actor || !containerItem || !isActualWeightContainer(containerItem)) return 0;
    let currentItemWeight = 0;
    if (!actor.items || typeof actor.items.filter !== 'function') { console.error(`${MODULE_ID} | calculateCurrentContainerItemWeight: actor.items is not valid`); return 0; }
    const contents = actor.items.filter(i => foundry.utils.getProperty(i, "system.container") === containerItem.id);
    for (const item of contents) {
        const quantity = Number(foundry.utils.getProperty(item, "system.quantity")) || 1;
        currentItemWeight += getEffectiveItemWeightInContainer(item, actor, containerItem) * quantity; // Считаем вес со скидкой этого контейнера
    }
    if (isNaN(currentItemWeight)) { console.error(`${MODULE_ID} | calculateCurrentContainerItemWeight: Item weight sum is NaN.`); currentItemWeight = 0; }
    return Number(currentItemWeight.toPrecision(5));
}

/**
 * Получает CSS класс редкости.
 * @param {number} reductionPercent
 * @returns {string}
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
    console.log(`${MODULE_ID} | HOOK: init`);
    // Не проверяем libWrapper, так как не используем его для патчинга
    try {
        game.settings.register(MODULE_ID, 'gmOnlyConfig', { name: game.i18n.localize("WEIGHTYCONTAINERS.SettingGMOnlyConfig"), hint: game.i18n.localize("WEIGHTYCONTAINERS.SettingGMOnlyConfigHint"), scope: 'world', config: true, type: Boolean, default: true, requiresReload: false });
        game.settings.register(MODULE_ID, 'capacityExceededMessage', { name: "WEIGHTYCONTAINERS.SettingCapacityMessageName", hint: "WEIGHTYCONTAINERS.SettingCapacityMessageHint", scope: 'world', config: true, type: String, default: "Больно ты дохуя взял", requiresReload: false });
        console.log(`${MODULE_ID} | Settings Initialized`);
    } catch (e) { console.error(`${MODULE_ID} | Failed to register settings:`, e); }
});

Hooks.once('setup', () => {
    console.log(`${MODULE_ID} | HOOK: setup`);
});

// --- Патчинг УДАЛЕН ---

Hooks.once('ready', () => {
    console.log(`${MODULE_ID} | HOOK: ready`);
    // Никакого патчинга здесь
    console.log(`${MODULE_ID} | Module Ready`);
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
    const detailsTab = html.find('.tab.details[data-tab="details"]');
    if (detailsTab.length > 0) detailsTab.find('.form-group.reduces-currency').remove(); // Удаляем чекбокс, если он остался

    if (!isWeightContainer) return;

    const reductionPercent = getWeightReductionPercent(item);
    const canConfigure = game.user?.isGM || !game.settings.get(MODULE_ID, 'gmOnlyConfig');
    const rarityClass = getRarityClassForReduction(reductionPercent);
    const uiWrapper = $('<div class="weighty-container-ui-wrapper" style="display: flex; align-items: center; gap: 5px; margin-top: 3px;"></div>');
    const reductionDisplayHTML = `<div class="weighty-container-reduction-display ${rarityClass}" title="${game.i18n.localize('WEIGHTYCONTAINERS.WeightReductionLabel')}"><i class="fas fa-weight-hanging"></i> ${reductionPercent}%</div>`;
    uiWrapper.append(reductionDisplayHTML);
    if (canConfigure) {
        const configButtonHTML = `<button type="button" class="weighty-container-config-btn" title="${game.i18n.localize('WEIGHTYCONTAINERS.ConfigButtonTooltip')}"><i class="fas fa-cogs"></i></button>`;
        const configButton = $(configButtonHTML);
        configButton.on('click', async (ev) => {
            ev.preventDefault();
            const currentReduction = getWeightReductionPercent(item);
            const dialogContent = '<form><div class="form-group"><label>'+ game.i18n.localize("WEIGHTYCONTAINERS.ConfigPrompt") +'</label><input type="number" name="reductionPercent" value="'+ currentReduction +'" min="0" max="100" step="1"/></div></form>';
            const dialogData = { title: game.i18n.localize("WEIGHTYCONTAINERS.ConfigWindowTitle"), content: dialogContent, buttons: { save: { icon: '<i class="fas fa-save"></i>', label: game.i18n.localize("WEIGHTYCONTAINERS.ConfigSave"), callback: async (jqHtml) => { try { const inputVal = jqHtml.find('input[name="reductionPercent"]').val(); const newPercentage = parseInt(inputVal || "0", 10); if (isNaN(newPercentage) || newPercentage < 0 || newPercentage > 100) { ui.notifications.warn(game.i18n.localize("WEIGHTYCONTAINERS.InvalidPercentage")); return false; } await item.setFlag(MODULE_ID, FLAG_WEIGHT_REDUCTION, newPercentage); ui.notifications.info(`Set ${item.name} weight reduction to ${newPercentage}%`); } catch (e) { console.error(`${MODULE_ID} | Error setting flag:`, e); ui.notifications.error("Error saving weight reduction setting."); } } }, cancel: { icon: '<i class="fas fa-times"></i>', label: game.i18n.localize("WEIGHTYCONTAINERS.ConfigCancel") } }, default: 'save' };
            new Dialog(dialogData).render(true);
        });
        uiWrapper.append(configButton);
    }
    // Чекбокс для валюты НЕ добавляем
    targetBlock.append(uiWrapper);
    try { if (app.rendered) app.setPosition({ height: "auto" }); } catch (e) { /* Игнорируем */ }

    // Отображение веса на листе контейнера (только предметы)
    if (isWeightContainer && app.actor) {
        try {
            const displayItemWeight = calculateCurrentContainerItemWeight(item, app.actor); // Вес только предметов
            const containerMaxWeight = Number(foundry.utils.getProperty(item, "system.capacity.weight.value") ?? 0);
            const contentsTab = html.find('.tab.contents[data-tab="contents"]');
            if (contentsTab.length > 0) {
                const valueElement = contentsTab.find('.encumbrance .meter .label .value');
                const meterElement = contentsTab.find('.encumbrance .meter.progress');
                if (valueElement.length > 0) valueElement.text(Math.round(displayItemWeight * 100) / 100);
                if (meterElement.length > 0 && containerMaxWeight > 0) {
                    const percentage = Math.min(100, Math.round((displayItemWeight / containerMaxWeight) * 100));
                    meterElement.css('--bar-percentage', `${percentage}%`);
                    meterElement.attr('aria-valuenow', displayItemWeight.toFixed(2));
                }
            }
        } catch(e) { console.error(`${MODULE_ID} | Error updating container sheet weight display:`, e); }
    }
});

/**
 * Хук для проверки вместимости ПЕРЕД созданием предмета (только предметы).
 */
Hooks.on('preCreateItem', (itemDoc, createData, options, userId) => {
    // Использует calculateCurrentContainerItemWeight для проверки
    // ... (код preCreateItem без изменений) ...
    const parentActor = itemDoc.parent; const containerId = foundry.utils.getProperty(createData, 'system.container'); if (!(parentActor instanceof Actor) || !containerId) return true; if (itemDoc.isTemporary) return true; const actor = parentActor; const container = actor.items.get(containerId); if (!container || !isActualWeightContainer(container)) return true; const containerMaxWeight = Number(foundry.utils.getProperty(container, "system.capacity.weight.value") ?? 0); if (containerMaxWeight <= 0) return true; let effectiveWeightToAdd = 0; try { const tempItemData = foundry.utils.mergeObject(itemDoc.toObject(false), createData ?? {}); const itemToAddQuantity = Number(foundry.utils.getProperty(tempItemData, 'system.quantity') ?? 1); const tempItemDoc = new Item(tempItemData, { temporary: true }); effectiveWeightToAdd = getEffectiveItemWeightInContainer(tempItemDoc, actor, container) * itemToAddQuantity; } catch (err) { console.error(`${MODULE_ID} | ERROR preCreateItem: Failed calc weight.`, err); return false; } if (isNaN(effectiveWeightToAdd)) { console.error(`${MODULE_ID} | ERROR preCreateItem: effectiveWeightToAdd is NaN.`); return false; } const currentItemWeight = calculateCurrentContainerItemWeight(container, actor); if (isNaN(currentItemWeight)) { console.error(`${MODULE_ID} | ERROR preCreateItem: currentItemWeight is NaN.`); return false; } const potentialTotalWeight = currentItemWeight + effectiveWeightToAdd; const tolerance = 0.001; if (potentialTotalWeight > containerMaxWeight + tolerance) { const customMessage = game.settings.get(MODULE_ID, 'capacityExceededMessage') || "Container capacity exceeded."; console.warn(`${MODULE_ID} | BLOCKED preCreateItem: Limit exceeded.`); ui.notifications.warn(customMessage); return false; } return true;
});

/**
 * Хук для проверки вместимости ПЕРЕД обновлением предмета (только предметы).
 */
Hooks.on('preUpdateItem', (itemDoc, change, options, userId) => {
    // Использует calculateCurrentContainerItemWeight для проверки
    // ... (код preUpdateItem без изменений) ...
    if (!(itemDoc.parent instanceof Actor)) return true; const actor = itemDoc.parent; const targetContainerId = foundry.utils.getProperty(change, 'system.container'); const isChangingContainer = foundry.utils.hasProperty(change, 'system.container'); const originalContainerId = foundry.utils.getProperty(itemDoc, "system.container"); const oldQuantity = foundry.utils.getProperty(itemDoc, "system.quantity") ?? 1; const newQuantity = foundry.utils.getProperty(change, 'system.quantity') ?? oldQuantity; const isChangingQuantity = foundry.utils.hasProperty(change, 'system.quantity'); let isMovingIntoContainer = false; let isQuantityIncreaseInContainer = false; let checkContainerId = null; if (isChangingContainer && targetContainerId && targetContainerId !== originalContainerId) { isMovingIntoContainer = true; checkContainerId = targetContainerId; } else if (isChangingContainer && !targetContainerId && originalContainerId) return true; const finalContainerId = isChangingContainer ? targetContainerId : originalContainerId; if (isChangingQuantity && newQuantity > oldQuantity && finalContainerId) { isQuantityIncreaseInContainer = true; if (!checkContainerId) checkContainerId = finalContainerId; } else if (isChangingQuantity && newQuantity < oldQuantity && isMovingIntoContainer) { if (!checkContainerId) checkContainerId = targetContainerId; } else if (isChangingQuantity && newQuantity < oldQuantity && !isMovingIntoContainer) return true; if (!checkContainerId) return true; const container = actor.items.get(checkContainerId); if (!container || !isActualWeightContainer(container)) return true; const containerMaxWeight = Number(foundry.utils.getProperty(container, "system.capacity.weight.value") ?? 0); if (containerMaxWeight <= 0) return true; let effectiveSingleItemWeight = 0; try { const changedItemData = foundry.utils.mergeObject(itemDoc.toObject(false), change ?? {}); const tempChangedItemDoc = new Item(changedItemData, { temporary: true }); effectiveSingleItemWeight = getEffectiveItemWeightInContainer(tempChangedItemDoc, actor, container); } catch (err) { console.error(`${MODULE_ID} | ERROR preUpdateItem: Failed calc weight.`, err); return false; } if (isNaN(effectiveSingleItemWeight)) { console.error(`${MODULE_ID} | ERROR preUpdateItem: effectiveSingleItemWeight is NaN.`); return false; } const currentItemWeight = calculateCurrentContainerItemWeight(container, actor); if (isNaN(currentItemWeight)) { console.error(`${MODULE_ID} | ERROR preUpdateItem: currentItemWeight is NaN.`); return false; } let futureItemWeight = 0; let logReason = ""; if (isMovingIntoContainer) { const weightOfMovedStack = effectiveSingleItemWeight * newQuantity; if (isNaN(weightOfMovedStack)) { logReason = "NaN Error: weightOfMovedStack"; futureItemWeight = NaN; } else { futureItemWeight = currentItemWeight + weightOfMovedStack; logReason = `Move ${newQuantity} items`; } } else if (isQuantityIncreaseInContainer && checkContainerId === finalContainerId) { const quantityChange = newQuantity - oldQuantity; const addedWeight = effectiveSingleItemWeight * quantityChange; if (isNaN(addedWeight)) { logReason = "NaN Error: addedWeight"; futureItemWeight = NaN; } else { futureItemWeight = currentItemWeight + addedWeight; logReason = `Increase by ${quantityChange}`; } } else { return true; } if (isNaN(futureItemWeight)) { console.error(`${MODULE_ID} | ERROR preUpdateItem: futureItemWeight is NaN. Reason: ${logReason}`); return false; } const tolerance = 0.001; if (futureItemWeight > containerMaxWeight + tolerance) { const customMessage = game.settings.get(MODULE_ID, 'capacityExceededMessage') || "Container capacity exceeded."; console.warn(`${MODULE_ID} | BLOCKED preUpdateItem: Limit exceeded.`); ui.notifications.warn(customMessage); return false; } return true;
});


/**
 * Добавляем отображение эффективного веса на листе актора
 */
Hooks.on('renderActorSheet', (app, html, data) => {
    // ... (код renderActorSheet без изменений) ...
    if (!(app instanceof ActorSheet) || !app.actor || ['npc', 'vehicle'].includes(app.actor.type)) return; const actor = app.actor; html.find('.inventory-list .item[data-item-id]').each((index, element) => { const itemId = element.dataset.itemId; if (!itemId) return; const item = actor.items.get(itemId); const containerId = foundry.utils.getProperty(item, "system.container"); const weightCell = $(element).find('.item-weight'); const existingSpan = weightCell.find('.weighty-effective-weight'); if (!containerId) { existingSpan.remove(); return; } const container = actor.items.get(containerId); if (!container || !isActualWeightContainer(container)) { existingSpan.remove(); return; } const reductionPercent = getWeightReductionPercent(container); if (reductionPercent <= 0) { existingSpan.remove(); return; } const effectiveWeight = getEffectiveItemWeight(item, actor); const baseWeight = getBaseItemWeight(item); if (Math.abs(effectiveWeight - baseWeight) < 0.001) { existingSpan.remove(); return; } if (weightCell.length > 0) { const displayWeight = game.settings.get("dnd5e", "metricWeightUnits") ? (effectiveWeight * (game.settings.get("dnd5e", "metricWeightMultiplier") ?? 1)).toFixed(2) : effectiveWeight.toFixed(2); const weightUnits = game.settings.get("dnd5e", "metricWeightUnits") ? game.settings.get("dnd5e", "metricWeightLabel") : game.i18n.localize("DND5E.AbbreviationLbs"); const effectiveWeightText = `(${game.i18n.localize('WEIGHTYCONTAINERS.ItemWeightLabel')}: ${displayWeight} ${weightUnits})`; if (existingSpan.length) { existingSpan.text(effectiveWeightText); } else { weightCell.append(`<span class="weighty-effective-weight">${effectiveWeightText}</span>`); } } });
});

/**
 * Обновление отображения веса на листе актора и листах контейнеров при изменении
 */
function refreshDependentSheets(item) {
    // ... (код refreshDependentSheets без изменений) ...
    const actor = item.actor; if (!actor) return; if (actor.sheet instanceof ActorSheet && actor.sheet.rendered) { try { actor.sheet.render(false); } catch(e) {} } const currentContainerId = foundry.utils.getProperty(item, "system.container"); const originalContainerId = foundry.utils.getProperty(item, "_source.system.container"); const containerIdsToRefresh = new Set(); if (currentContainerId) containerIdsToRefresh.add(currentContainerId); if (originalContainerId && originalContainerId !== currentContainerId) containerIdsToRefresh.add(originalContainerId); if (item.type === 'container') { if (item.sheet instanceof ItemSheet && item.sheet.rendered) { try { item.sheet.render(false); } catch(e) {} } Object.values(ui.windows).forEach(window => { if (window instanceof ActorSheet && window.actor?.items?.get(item.id) && window.rendered) { try { window.render(false); } catch(e) {} } }); } containerIdsToRefresh.forEach(containerId => { if (typeof containerId === 'string') { const container = actor.items.get(containerId); if (container && container.sheet instanceof ItemSheet && container.sheet.rendered) { try { container.sheet.render(false); } catch(e) {} } } });
}

Hooks.on("updateItem", (item, change, options, userId) => {
    // ... (код updateItem без изменений) ...
    const flagPath = `flags.${MODULE_ID}.${FLAG_WEIGHT_REDUCTION}`; const relevantChange = foundry.utils.hasProperty(change, flagPath) || foundry.utils.hasProperty(change, 'system.container') || foundry.utils.hasProperty(change, 'system.quantity') || foundry.utils.hasProperty(change, 'system.weight') || foundry.utils.hasProperty(change, `flags.${MODULE_ID}.${FLAG_REDUCES_CURRENCY}`); if (relevantChange) { setTimeout(() => refreshDependentSheets(item), 50); }
});

Hooks.on("deleteItem", (item, options, userId) => {
    // ... (код deleteItem без изменений) ...
    if (item.actor && foundry.utils.getProperty(item, "system.container")) { setTimeout(() => refreshDependentSheets(item), 50); }
});

// --- КОНЕЦ ФАЙЛА main.js ---