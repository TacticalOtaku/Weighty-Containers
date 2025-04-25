// --- Изменения в начале ---
const MODULE_ID = 'weighty-containers';
const FLAG_REDUCTION_PERCENT = 'weightReductionPercent';
const FLAG_ORIGINAL_WEIGHT = 'originalWeight';
const INTERNAL_UPDATE_FLAG = 'WEIGHTY_CONTAINERS_INTERNAL';

// --- ФУНКЦИИ ХЕЛПЕРЫ ---

/**
 * Получает процент снижения веса для контейнера.
 * @param {Item5e} containerItem - Объект предмета-контейнера.
 * @returns {number} Процент снижения (0-100).
 */
function getReductionPercent(containerItem) {
    const percent = containerItem?.getFlag(MODULE_ID, FLAG_REDUCTION_PERCENT) ?? 0;
    // console.log(`${MODULE_ID} | getReductionPercent for ${containerItem?.name}: ${percent}`); // Uncomment for deep debug
    return percent;
}

/**
 * Получает оригинальный вес предмета, если он был изменен модулем.
 * @param {Item5e} item - Предмет для проверки.
 * @returns {number | null} Оригинальный вес или null.
 */
function getOriginalWeight(item) {
    const weight = item?.getFlag(MODULE_ID, FLAG_ORIGINAL_WEIGHT) ?? null;
    // console.log(`${MODULE_ID} | getOriginalWeight for ${item?.name}: ${weight}`); // Uncomment for deep debug
    return weight;
}

/**
 * Рассчитывает текущий вес содержимого контейнера, учитывая снижение веса.
 * @param {Item5e} containerItem - Предмет-контейнер.
 * @param {Actor5e} actor - Владелец контейнера.
 * @returns {number} Текущий вес содержимого.
 */
function calculateContainerContentsWeight(containerItem, actor) {
    if (!actor || !containerItem) return 0;
    return actor.items.reduce((acc, i) => {
        const item = actor.items.get(i.id);
        if (!item || item.system.container?.id !== containerItem.id || ['container', 'backpack'].includes(item.type)) {
            return acc;
        }
        const weight = item.system.weight ?? 0;
        const quantity = item.system.quantity ?? 1;
        return acc + (weight * quantity);
    }, 0);
}

/**
 * Применяет снижение веса к предмету. (С ЛОГАМИ)
 * @param {Item5e} item - Предмет.
 * @param {Item5e} containerItem - Контейнер.
 * @param {object} [context={}] - Контекст.
 * @returns {Promise<void>}
 */
async function applyWeightReduction(item, containerItem, context = {}) {
    if (!item || !containerItem) return;
    const reductionPercent = getReductionPercent(containerItem);
    console.log(`${MODULE_ID} | >>> Attempting applyWeightReduction for ${item.name} (${item.id}). Reduction: ${reductionPercent}% <<<`);
    const weightCapacityValue = containerItem?.system?.capacity?.weight?.value;
    const containerIsReducing = weightCapacityValue !== null && weightCapacityValue !== undefined && weightCapacityValue !== "" && Number.isFinite(Number(weightCapacityValue)) && reductionPercent > 0;

    if (!containerIsReducing) {
        console.log(`${MODULE_ID} | applyWeightReduction: Target container ${containerItem.name} is not valid for reduction. Checking if restore needed.`);
        if(getOriginalWeight(item) !== null) { await restoreOriginalWeight(item, context); }
        return;
    }

    const currentWeight = item.system.weight;
    const flagWeight = getOriginalWeight(item);
    const baseWeightForCalc = flagWeight ?? currentWeight;
    console.log(`${MODULE_ID} | applyWeightReduction: Item=${item.name}, CurrentW=${currentWeight}, FlagW=${flagWeight}, BaseW=${baseWeightForCalc}`);

    if (baseWeightForCalc === 0) { if (flagWeight === null) { await item.setFlag(MODULE_ID, FLAG_ORIGINAL_WEIGHT, 0); } return; }

    const reductionFactor = 1 - (reductionPercent / 100);
    const expectedReducedWeight = Math.max(0, baseWeightForCalc * reductionFactor);
    console.log(`${MODULE_ID} | applyWeightReduction: Expected Reduced Weight = ${expectedReducedWeight}`);

    let needsUpdate = false; let needsFlag = false;
    if (flagWeight === null || Math.abs(flagWeight - baseWeightForCalc) > 0.001) { needsFlag = true; }
    if (Math.abs(currentWeight - expectedReducedWeight) > 0.001) { needsUpdate = true; }
    if (!needsUpdate && !needsFlag) { console.log(`${MODULE_ID} | applyWeightReduction: No change needed for ${item.name}.`); return; }

    if(needsFlag) {
         console.log(`${MODULE_ID} | applyWeightReduction: Setting flag for ${item.name}. Original: ${baseWeightForCalc}`);
        await item.setFlag(MODULE_ID, FLAG_ORIGINAL_WEIGHT, baseWeightForCalc);
    }
    if (needsUpdate) {
        console.log(`${MODULE_ID} | applyWeightReduction: Updating weight for ${item.name}. New: ${expectedReducedWeight}`);
        const updateContext = foundry.utils.mergeObject(context, { [INTERNAL_UPDATE_FLAG]: true });
        await item.update({'system.weight': expectedReducedWeight}, updateContext);
        console.log(`${MODULE_ID} | applyWeightReduction: Weight update complete for ${item.name}.`);
    } else if (needsFlag) { console.log(`${MODULE_ID} | applyWeightReduction: Only flag update was needed for ${item.name}.`); }
}

/**
 * Восстанавливает оригинальный вес предмета. (С ЛОГАМИ)
 * @param {Item5e} item - Предмет.
 * @param {object} [context={}] - Контекст.
 * @returns {Promise<void>}
 */
async function restoreOriginalWeight(item, context = {}) {
    if (!item) return;
    const originalWeight = getOriginalWeight(item);
    console.log(`${MODULE_ID} | >>> Attempting restoreOriginalWeight for ${item.name} (${item.id}). Flag value: ${originalWeight} <<<`);
    if (originalWeight === null) { console.log(`${MODULE_ID} | restoreOriginalWeight: No flag found for ${item.name}. Skipping.`); return; }
    console.log(`${MODULE_ID} | restoreOriginalWeight: Removing flag for ${item.name}.`);
    await item.unsetFlag(MODULE_ID, FLAG_ORIGINAL_WEIGHT);
    if (Math.abs(item.system.weight - originalWeight) > 0.001) {
        console.log(`${MODULE_ID} | restoreOriginalWeight: Restoring weight for ${item.name}. Original: ${originalWeight}, Current: ${item.system.weight}`);
        const updateContext = foundry.utils.mergeObject(context, { [INTERNAL_UPDATE_FLAG]: true });
        await item.update({'system.weight': originalWeight}, updateContext);
        console.log(`${MODULE_ID} | restoreOriginalWeight: Weight update complete for ${item.name}.`);
    } else { console.log(`${MODULE_ID} | restoreOriginalWeight: No weight change needed for ${item.name}. Current weight matches flag.`); }
}

// --- ХУКИ FOUNDRY VTT ---

Hooks.once('init', () => {
    console.log(`${MODULE_ID} | Initializing Weighty Containers - INIT Hook Fired`);
    game.settings.register(MODULE_ID, 'gmOnlyButton', {
        name: game.i18n.localize("WEIGHTY_CONTAINERS.SETTINGS.gmOnlyButton"),
        hint: game.i18n.localize("WEIGHTY_CONTAINERS.SETTINGS.gmOnlyButtonHint"),
        scope: 'world', config: true, type: Boolean, default: true, requiresReload: false
    });
    if (game.modules.get('lib-wrapper')?.active) {
        console.log(`${MODULE_ID} | libWrapper detected. Registering wrappers.`);
        try {
            libWrapper.register(MODULE_ID, 'CONFIG.Actor.documentClass.prototype.createEmbeddedDocuments', checkCapacityOnCreate, 'MIXED');
            libWrapper.register(MODULE_ID, 'CONFIG.Item.documentClass.prototype.update', combinedItemUpdateHandler, 'WRAPPER');
            console.log(`${MODULE_ID} | libWrapper registration successful.`);
        } catch (e) { console.error(`${MODULE_ID} | Error during libWrapper registration:`, e); }
    } else {
        console.log(`${MODULE_ID} | libWrapper not active. Using fallback hooks.`);
        Hooks.on('preCreateItem', onItemPreCreate);
        Hooks.on('preUpdateItem', onItemPreUpdate);
        Hooks.on('updateItem', onItemUpdate);
    }
});

// Хук для добавления элементов на лист контейнера
Hooks.on('renderItemSheet5e', (app, html, data) => {
    console.log(`${MODULE_ID} | renderItemSheet5e Hook Fired. App ID: ${app.id}, Item Name: ${data.item?.name}, App class: ${app.constructor.name}`);
    const item = app.object;
    if (!item || !['container', 'backpack'].includes(item.type)) { return; }
    const weightCapacityValue = item.system?.capacity?.weight?.value;
    const hasWeightCapacity = weightCapacityValue !== null && weightCapacityValue !== undefined && weightCapacityValue !== "" && Number.isFinite(Number(weightCapacityValue));
    // console.log(`${MODULE_ID} | Checking Item: ${item.name}`);
    // console.log(`${MODULE_ID} |   > system.capacity.weight.value: ${weightCapacityValue} (Type: ${typeof weightCapacityValue})`);
    // console.log(`${MODULE_ID} |   > Final hasWeightCapacity check result: ${hasWeightCapacity}`);
    if (!hasWeightCapacity) { console.log(`${MODULE_ID} | Item ${item.name} does not appear to have a valid finite number for weight capacity. Skipping UI.`); return; }
    console.log(`${MODULE_ID} | Item ${item.name} IS a valid container with weight capacity defined. Value: ${weightCapacityValue}`);
    const currentReduction = getReductionPercent(item);
    const canConfigure = game.user.isGM || !game.settings.get(MODULE_ID, 'gmOnlyButton');
    console.log(`${MODULE_ID} | Current Reduction: ${currentReduction}%, Can Configure: ${canConfigure}`);
    let rarityClass = 'cwm-reduction-common';
    if (currentReduction >= 95) rarityClass = 'cwm-reduction-artifact'; else if (currentReduction >= 85) rarityClass = 'cwm-reduction-legendary'; else if (currentReduction >= 70) rarityClass = 'cwm-reduction-veryrare'; else if (currentReduction >= 50) rarityClass = 'cwm-reduction-rare'; else if (currentReduction > 0) rarityClass = 'cwm-reduction-uncommon';
    const displayHtml = `<span class="cwm-weight-reduction-display ${rarityClass}" title="${game.i18n.format(`WEIGHTY_CONTAINERS.Rarity.${rarityClass.split('-')[2].charAt(0).toUpperCase() + rarityClass.split('-')[2].slice(1)}`)}"><span class="cwm-percentage">${currentReduction}%</span></span>`;
    const buttonHtml = canConfigure ? `<button type="button" class="cwm-configure-button flex0" title="${game.i18n.localize("WEIGHTY_CONTAINERS.ContainerSheet.ConfigureReduction")}"><i class="fas fa-cog"></i></button>` : '';
    const controlsContainerHtml = `<div class="form-group cwm-reduction-controls"><label>${game.i18n.localize("WEIGHTY_CONTAINERS.ContainerSheet.WeightReduction")}</label><div class="form-fields">${displayHtml}${buttonHtml}</div></div>`;
    console.log(`${MODULE_ID} | Generated HTML:`, controlsContainerHtml);
    const containerDetailsHeaderText = game.i18n.localize("DND5E.ContainerDetails");
    const containerDetailsFieldset = html.find(`legend:contains("${containerDetailsHeaderText}")`).closest('fieldset');
    if (containerDetailsFieldset.length > 0) {
        console.log(`${MODULE_ID} | Found 'Container Details' fieldset. Appending controls inside.`); html.find('.cwm-reduction-controls').remove(); containerDetailsFieldset.append(controlsContainerHtml);
    } else {
        console.warn(`${MODULE_ID} | 'Container Details' fieldset not found. Trying details tab as fallback.`); const detailsTab = html.find('.tab[data-tab="details"]');
        if (detailsTab.length > 0) { console.log(`${MODULE_ID} | Found details tab. Appending controls to the end of the tab.`); html.find('.cwm-reduction-controls').remove(); detailsTab.append(controlsContainerHtml); }
        else { console.error(`${MODULE_ID} | Could not find 'Container Details' fieldset or 'details' tab to insert UI controls!`); }
    }
    if (canConfigure) {
        const buttonElement = html.find('.cwm-configure-button');
        if (buttonElement.length > 0) {
            console.log(`${MODULE_ID} | Adding click listener to configure button.`); buttonElement.off('click').on('click', async (event) => {
                event.preventDefault(); event.stopPropagation(); console.log(`${MODULE_ID} | Configure button clicked!`); const currentItem = app.object; if (!currentItem) { console.error(`${MODULE_ID} | Cannot find item object on button click.`); return; } const currentVal = getReductionPercent(currentItem);
                new Dialog({ title: game.i18n.localize("WEIGHTY_CONTAINERS.Dialog.SetReductionTitle"), content: `<form><div class="form-group"><label>${game.i18n.localize("WEIGHTY_CONTAINERS.Dialog.SetReductionLabel")}</label><div class="form-fields"><input type="number" name="reductionPercent" value="${currentVal}" min="0" max="100" step="1"/></div><p class="notes">${game.i18n.localize("WEIGHTY_CONTAINERS.Dialog.SetReductionHint")}</p></div></form>`,
                    buttons: { save: { icon: '<i class="fas fa-save"></i>', label: game.i18n.localize("Save"), callback: async (html) => { const itemToUpdate = app.object; if (!itemToUpdate) return; const inputVal = html.find('input[name="reductionPercent"]').val(); const newPercentage = parseInt(inputVal, 10); if (isNaN(newPercentage) || newPercentage < 0 || newPercentage > 100) { ui.notifications.warn(game.i18n.localize("WEIGHTY_CONTAINERS.Notifications.InvalidPercentage")); return false; } console.log(`${MODULE_ID} | Dialog Save: Setting reduction for ${itemToUpdate.name} to ${newPercentage}%`); await itemToUpdate.setFlag(MODULE_ID, FLAG_REDUCTION_PERCENT, newPercentage); if (itemToUpdate.actor) { console.log(`${MODULE_ID} | Dialog Save: Updating contained items weight for actor ${itemToUpdate.actor.name}.`); await updateContainedItemsWeight(itemToUpdate.actor, itemToUpdate, newPercentage); } else { console.log(`${MODULE_ID} | Dialog Save: Container item does not belong to an actor. Skipping contained items update.`); } } }, cancel: { icon: '<i class="fas fa-times"></i>', label: game.i18n.localize("Cancel") } }, default: 'save', render: html => { html.find('input[name="reductionPercent"]').focus().select(); }
                }).render(true);
            });
        } else { console.warn(`${MODULE_ID} | Configure button was expected but not found in the rendered HTML after insertion.`); }
    }
});

// --- ЛОГИКА ПРОВЕРКИ ВМЕСТИМОСТИ И ИЗМЕНЕНИЯ ВЕСА ---

/** Обновление веса содержимого */
async function updateContainedItemsWeight(actor, containerItem, newReductionPercent) {
    if (!actor || !containerItem) return; console.log(`${MODULE_ID} | updateContainedItemsWeight: Updating items in ${containerItem.name} for actor ${actor.name} to ${newReductionPercent}% reduction.`); const containedItems = actor.items.filter(i => i && i.system.container?.id === containerItem.id && !['container', 'backpack'].includes(i.type)); if (!containedItems.length) { console.log(`${MODULE_ID} | updateContainedItemsWeight: No relevant items found inside ${containerItem.name}.`); return; } const updates = []; const itemsToRestore = []; const internalContext = { [INTERNAL_UPDATE_FLAG]: true };
    for (const item of containedItems) { if (!item) continue; const originalWeight = getOriginalWeight(item); const baseWeightForCalc = originalWeight ?? item.system.weight; if (baseWeightForCalc === 0) { if (newReductionPercent === 0 && originalWeight !== null) { await item.unsetFlag(MODULE_ID, FLAG_ORIGINAL_WEIGHT); } else if (newReductionPercent > 0 && originalWeight === null) { await item.setFlag(MODULE_ID, FLAG_ORIGINAL_WEIGHT, 0); } continue; } if (newReductionPercent > 0) { const reductionFactor = 1 - (newReductionPercent / 100); const expectedReducedWeight = Math.max(0, baseWeightForCalc * reductionFactor); if (originalWeight === null || Math.abs(originalWeight - baseWeightForCalc) > 0.001) { await item.setFlag(MODULE_ID, FLAG_ORIGINAL_WEIGHT, baseWeightForCalc); } if (Math.abs(item.system.weight - expectedReducedWeight) > 0.001) { console.log(`${MODULE_ID} | updateContainedItemsWeight: Queuing weight update for ${item.name}. Expected: ${expectedReducedWeight}, Actual: ${item.system.weight}`); updates.push({ _id: item.id, 'system.weight': expectedReducedWeight }); } } else { if (originalWeight !== null) { console.log(`${MODULE_ID} | updateContainedItemsWeight: Reduction is 0%, queuing restore for ${item.name}.`); itemsToRestore.push(item); } } }
    if (updates.length > 0) { console.log(`${MODULE_ID} | updateContainedItemsWeight: Applying batch weight updates for ${updates.length} items in ${containerItem.name}.`); try { await actor.updateEmbeddedDocuments("Item", updates, internalContext); } catch (err) { console.error(`${MODULE_ID} | Error applying batch updates in updateContainedItemsWeight for actor ${actor.name}:`, err); } } else { console.log(`${MODULE_ID} | updateContainedItemsWeight: No batch weight updates needed for items in ${containerItem.name}.`); }
    if (itemsToRestore.length > 0) { console.log(`${MODULE_ID} | updateContainedItemsWeight: Restoring original weight for ${itemsToRestore.length} items.`); for (const itemToRestore of itemsToRestore) { await restoreOriginalWeight(itemToRestore, internalContext); } }
}

/** LibWrapper: Check capacity on create */
async function checkCapacityOnCreate(wrapped, embeddedName, data, context) {
    if (embeddedName !== 'Item' || !Array.isArray(data) || data.length === 0) { return wrapped(embeddedName, data, context); } const actor = this; if (!actor || !(actor instanceof Actor)) { return wrapped(embeddedName, data, context); } /* console.log(`${MODULE_ID} | checkCapacityOnCreate for actor ${actor.name}`); */ const itemsToCreate = []; let capacityBlocked = false;
    for (const itemData of data) { if (!itemData?.system || !itemData.name || ['container', 'backpack'].includes(itemData.type)) { itemsToCreate.push(itemData); continue; } const containerId = itemData.system.container; if (!containerId) { itemsToCreate.push(itemData); continue; } const containerItem = actor.items.get(containerId); const weightCapacityValue = containerItem?.system?.capacity?.weight?.value; const containerHasWeightCapacity = weightCapacityValue !== null && weightCapacityValue !== undefined && weightCapacityValue !== "" && Number.isFinite(Number(weightCapacityValue)); if (!containerHasWeightCapacity) { itemsToCreate.push(itemData); continue; } /* console.log(`${MODULE_ID} | checkCapacityOnCreate: Checking item ${itemData.name} against container ${containerItem.name}`); */ const containerMaxWeight = Number(weightCapacityValue) ?? 0; const currentWeight = calculateContainerContentsWeight(containerItem, actor); let itemBaseWeight = itemData.system.weight ?? 0; const quantity = itemData.system.quantity ?? 1; const reductionPercent = getReductionPercent(containerItem); let reducedWeight = itemBaseWeight; if (reductionPercent > 0 && itemBaseWeight > 0) { reducedWeight = Math.max(0, itemBaseWeight * (1 - reductionPercent / 100)); } const addedWeight = reducedWeight * quantity; /* console.log(`${MODULE_ID} | checkCapacityOnCreate: Container=${containerItem.name}, Item=${itemData.name}, CurrentWeight=${currentWeight.toFixed(2)}, AddedWeight=${addedWeight.toFixed(2)}, MaxWeight=${containerMaxWeight}`); */ if (currentWeight + addedWeight > containerMaxWeight + 0.001) { ui.notifications.warn(game.i18n.format("WEIGHTY_CONTAINERS.Notifications.CapacityExceeded", { containerName: containerItem.name })); capacityBlocked = true; console.log(`${MODULE_ID} | checkCapacityOnCreate: BLOCKED item ${itemData.name} due to capacity.`); } else { if (reductionPercent > 0 && itemBaseWeight > 0) { console.log(`${MODULE_ID} | checkCapacityOnCreate: Applying reduction to creation data for ${itemData.name}. Reduced weight: ${reducedWeight}, Base: ${itemBaseWeight}`); itemData.system.weight = reducedWeight; if (!itemData.flags) itemData.flags = {}; if (!itemData.flags[MODULE_ID]) itemData.flags[MODULE_ID] = {}; itemData.flags[MODULE_ID][FLAG_ORIGINAL_WEIGHT] = itemBaseWeight; } itemsToCreate.push(itemData); } }
    if (capacityBlocked) { if (itemsToCreate.length === 0) { console.log(`${MODULE_ID} | checkCapacityOnCreate: All items blocked.`); return []; } console.log(`${MODULE_ID} | checkCapacityOnCreate: Some items blocked, creating allowed.`); return wrapped(embeddedName, itemsToCreate, context); } else { console.log(`${MODULE_ID} | checkCapacityOnCreate: All items allowed.`); return wrapped(embeddedName, data, context); }
}

/** LibWrapper: Combined handler for Item.update */
async function combinedItemUpdateHandler(wrapped, changes, context) {
    const item = this; if (!item.actor || context?.[INTERNAL_UPDATE_FLAG] || ['container', 'backpack'].includes(item.type)) { return wrapped(changes, context); } const actor = item.actor; /* console.log(`${MODULE_ID} | combinedItemUpdateHandler: Processing for item ${item.name} on actor ${actor.name}`); */ const quantityChange = changes.system?.quantity; const isQuantityIncrease = typeof quantityChange === 'number' && quantityChange > item.system.quantity; const containerId = item.system?.container?.id;
    if (isQuantityIncrease && containerId) { const containerItem = actor.items.get(containerId); const weightCapacityValue = containerItem?.system?.capacity?.weight?.value; const containerHasWeightCapacity = weightCapacityValue !== null && weightCapacityValue !== undefined && weightCapacityValue !== "" && Number.isFinite(Number(weightCapacityValue)); if (containerHasWeightCapacity) { const containerMaxWeight = Number(weightCapacityValue) ?? 0; const currentWeightOfOthers = calculateContainerContentsWeight(containerItem, actor) - (item.system.weight * item.system.quantity); const newWeightOfThisItem = item.system.weight * quantityChange; if (currentWeightOfOthers + newWeightOfThisItem > containerMaxWeight + 0.001) { ui.notifications.warn(game.i18n.format("WEIGHTY_CONTAINERS.Notifications.CapacityExceeded", { containerName: containerItem.name })); console.log(`${MODULE_ID} | combinedItemUpdateHandler: BLOCKED quantity update for ${item.name} due to capacity.`); delete changes.system.quantity; if (foundry.utils.isEmpty(changes.system)) delete changes.system; if (foundry.utils.isEmpty(changes)) { return item; } } } }
    const previousContainerId = item.system.container?.id; const previousContainer = previousContainerId ? actor.items.get(previousContainerId) : null; const prevWeightCapacityValue = previousContainer?.system?.capacity?.weight?.value; const prevContainerHasWeightCap = prevWeightCapacityValue !== null && prevWeightCapacityValue !== undefined && prevWeightCapacityValue !== "" && Number.isFinite(Number(prevWeightCapacityValue)); const wasInReducingContainer = previousContainer && getReductionPercent(previousContainer) > 0 && prevContainerHasWeightCap; const hadOriginalWeightFlag = getOriginalWeight(item) !== null; const originalChanges = foundry.utils.deepClone(changes); const updatedItem = await wrapped(changes, context); const currentActor = updatedItem.actor; if (!currentActor) { return updatedItem; } const newContainerId = updatedItem.system.container?.id; const newContainer = newContainerId ? currentActor.items.get(newContainerId) : null; const newWeightCapacityValue = newContainer?.system?.capacity?.weight?.value; const newContainerHasWeightCap = newWeightCapacityValue !== null && newWeightCapacityValue !== undefined && newWeightCapacityValue !== "" && Number.isFinite(Number(newWeightCapacityValue)); const isInReducingContainer = newContainer && getReductionPercent(newContainer) > 0 && newContainerHasWeightCap; const weightChanged = originalChanges.system && 'weight' in originalChanges.system; const containerChanged = originalChanges.system && 'container' in originalChanges.system; const internalContext = { [INTERNAL_UPDATE_FLAG]: true };
    if (containerChanged && previousContainerId !== newContainerId) { console.log(`${MODULE_ID} | combinedItemUpdateHandler: Container changed for ${updatedItem.name} from ${previousContainerId || 'root'} to ${newContainerId || 'root'}.`); if (wasInReducingContainer) { if (!isInReducingContainer) { console.log(`${MODULE_ID} | Moved FROM reducing container. Restoring weight.`); await restoreOriginalWeight(updatedItem, internalContext); } else { console.log(`${MODULE_ID} | Moved FROM reducing TO reducing container. Re-applying reduction.`); await applyWeightReduction(updatedItem, newContainer, internalContext); } } else { if (isInReducingContainer) { console.log(`${MODULE_ID} | Moved TO reducing container. Applying reduction.`); await applyWeightReduction(updatedItem, newContainer, internalContext); } } }
    else if (weightChanged && isInReducingContainer && previousContainerId === newContainerId) { console.log(`${MODULE_ID} | combinedItemUpdateHandler: External weight change detected for ${updatedItem.name} while in reducing container ${newContainer.name}.`); const newOriginalWeight = updatedItem.system.weight; const currentFlagWeight = getOriginalWeight(updatedItem); if (currentFlagWeight === null || Math.abs(currentFlagWeight - newOriginalWeight) > 0.001) { console.log(`${MODULE_ID} | combinedItemUpdateHandler: Updating flag and re-applying reduction for ${updatedItem.name}. New original: ${newOriginalWeight}`); await updatedItem.setFlag(MODULE_ID, FLAG_ORIGINAL_WEIGHT, newOriginalWeight); const reductionFactor = 1 - (getReductionPercent(newContainer) / 100); const newReducedWeight = Math.max(0, newOriginalWeight * reductionFactor); if (Math.abs(updatedItem.system.weight - newReducedWeight) > 0.001) { await updatedItem.update({'system.weight': newReducedWeight}, internalContext); } } else { console.log(`${MODULE_ID} | combinedItemUpdateHandler: External weight change matches existing flag for ${updatedItem.name}. No action needed.`); } }
    else if (!isInReducingContainer && hadOriginalWeightFlag && !containerChanged) { console.warn(`${MODULE_ID} | combinedItemUpdateHandler: Item ${updatedItem.name} is not in a reducing container but had flag. Restoring weight for consistency.`); await restoreOriginalWeight(updatedItem, internalContext); }
    return updatedItem;
}

// --- Fallback Функции (Оставляем с исправленными проверками, но не меняем дальше) ---
function onItemPreCreate(item, data, options, userId) {
    if (game.userId !== userId) return true; const actor = item.parent; if (!actor || ['container', 'backpack'].includes(data.type)) return true; const containerId = data.system?.container; if (!containerId) return true; const containerItem = actor.items.get(containerId); const weightCapacityValue = containerItem?.system?.capacity?.weight?.value; const containerHasWeightCapacity = weightCapacityValue !== null && weightCapacityValue !== undefined && weightCapacityValue !== "" && Number.isFinite(Number(weightCapacityValue)); if (!containerHasWeightCapacity) return true; const containerMaxWeight = Number(weightCapacityValue) ?? 0; const currentWeight = calculateContainerContentsWeight(containerItem, actor); let itemBaseWeight = data.system?.weight ?? 0; const quantity = data.system?.quantity ?? 1; const reductionPercent = getReductionPercent(containerItem); let reducedWeight = itemBaseWeight; if (reductionPercent > 0 && itemBaseWeight > 0) { reducedWeight = Math.max(0, itemBaseWeight * (1 - reductionPercent / 100)); } const addedWeight = reducedWeight * quantity; if (currentWeight + addedWeight > containerMaxWeight + 0.001) { ui.notifications.warn(game.i18n.format("WEIGHTY_CONTAINERS.Notifications.CapacityExceeded", { containerName: containerItem.name })); return false; } if (reductionPercent > 0 && itemBaseWeight > 0) { data.system.weight = reducedWeight; if (!data.flags) data.flags = {}; if (!data.flags[MODULE_ID]) data.flags[MODULE_ID] = {}; data.flags[MODULE_ID][FLAG_ORIGINAL_WEIGHT] = itemBaseWeight; } return true;
}
function onItemPreUpdate(item, changes, options, userId) {
    if (game.userId !== userId || options?.[INTERNAL_UPDATE_FLAG]) return true; const actor = item.actor; if (!actor || ['container', 'backpack'].includes(item.type)) return true; const quantityChange = changes.system?.quantity; const isQuantityIncrease = typeof quantityChange === 'number' && quantityChange > item.system.quantity; const containerId = item.system?.container?.id; if (!isQuantityIncrease || !containerId) return true; const containerItem = actor.items.get(containerId); const weightCapacityValue = containerItem?.system?.capacity?.weight?.value; const containerHasWeightCapacity = weightCapacityValue !== null && weightCapacityValue !== undefined && weightCapacityValue !== "" && Number.isFinite(Number(weightCapacityValue)); if (!containerHasWeightCapacity) return true; const containerMaxWeight = Number(weightCapacityValue) ?? 0; const currentWeightOfOthers = calculateContainerContentsWeight(containerItem, actor) - (item.system.weight * item.system.quantity); const newWeightOfThisItem = item.system.weight * quantityChange; if (currentWeightOfOthers + newWeightOfThisItem > containerMaxWeight + 0.001) { ui.notifications.warn(game.i18n.format("WEIGHTY_CONTAINERS.Notifications.CapacityExceeded", { containerName: containerItem.name })); delete changes.system.quantity; if (foundry.utils.isEmpty(changes.system)) delete changes.system; if (foundry.utils.isEmpty(changes)) return false; return true; } return true;
}
async function onItemUpdate(item, changes, options, userId) {
    if (game.userId !== userId || options?.[INTERNAL_UPDATE_FLAG] ) return; const actor = item.actor; if (!actor || ['container', 'backpack'].includes(item.type)) return; const internalContext = { [INTERNAL_UPDATE_FLAG]: true }; const newContainerId = item.system.container?.id; const newContainer = newContainerId ? actor.items.get(newContainerId) : null; const newWeightCapacityValue = newContainer?.system?.capacity?.weight?.value; const newContainerHasWeightCap = newWeightCapacityValue !== null && newWeightCapacityValue !== undefined && newWeightCapacityValue !== "" && Number.isFinite(Number(newWeightCapacityValue)); const isInReducingContainer = newContainer && getReductionPercent(newContainer) > 0 && newContainerHasWeightCap; const hadOriginalWeightFlag = getOriginalWeight(item) !== null;
    if (changes.system && 'container' in changes.system) { const previousContainerId = changes.system.container; if (previousContainerId !== newContainerId) { const previousContainer = previousContainerId ? actor.items.get(previousContainerId) : null; const prevWeightCapacityValue = previousContainer?.system?.capacity?.weight?.value; const prevContainerHasWeightCap = prevWeightCapacityValue !== null && prevWeightCapacityValue !== undefined && prevWeightCapacityValue !== "" && Number.isFinite(Number(prevWeightCapacityValue)); const wasInReducingContainer = previousContainer && getReductionPercent(previousContainer) > 0 && prevContainerHasWeightCap; if (wasInReducingContainer && !isInReducingContainer) { await restoreOriginalWeight(item, internalContext); } else if (!wasInReducingContainer && isInReducingContainer) { await applyWeightReduction(item, newContainer, internalContext); } else if (wasInReducingContainer && isInReducingContainer) { await applyWeightReduction(item, newContainer, internalContext); } } }
    else if (changes.system && 'weight' in changes.system) { if (isInReducingContainer) { const newOriginalWeight = item.system.weight; const originalFlag = getOriginalWeight(item); if(originalFlag === null || Math.abs(originalFlag - newOriginalWeight) > 0.001) { console.warn(`${MODULE_ID} | Fallback: External weight change assumed for ${item.name}. Re-applying reduction.`); await item.setFlag(MODULE_ID, FLAG_ORIGINAL_WEIGHT, newOriginalWeight); const reductionFactor = 1 - (getReductionPercent(newContainer) / 100); const expectedReducedWeight = Math.max(0, newOriginalWeight * reductionFactor); if (Math.abs(item.system.weight - expectedReducedWeight) > 0.001) { await item.update({'system.weight': expectedReducedWeight}, internalContext); } } } else { if (hadOriginalWeightFlag) { await restoreOriginalWeight(item, internalContext); } } }
    else { if (!isInReducingContainer && hadOriginalWeightFlag) { console.warn(`${MODULE_ID} | Fallback: Consistency check triggered restore for ${item.name}.`); await restoreOriginalWeight(item, internalContext); } else if (isInReducingContainer && !hadOriginalWeightFlag && item.system.weight > 0) { console.warn(`${MODULE_ID} | Fallback: Consistency check triggered apply reduction for ${item.name}.`); await applyWeightReduction(item, newContainer, internalContext); } }
}

// --- Ready Hook ---
Hooks.on('ready', async () => {
    console.log(`${MODULE_ID} | Ready Hook Fired. Checking item weights inside containers.`); const actorsToCheck = new Set(); game.users.filter(u => u.character && u.active).forEach(u => actorsToCheck.add(u.character)); game.scenes.filter(s => s.active).flatMap(s => s.tokens).filter(t => t.actor).forEach(t => actorsToCheck.add(t.actor));
    for (const actor of actorsToCheck) { if (!actor?.items) continue; /* console.log(`${MODULE_ID} | Ready Check: Processing actor ${actor.name}`); */ const updates = []; const itemsToProcess = actor.items.contents; const internalContext = { [INTERNAL_UPDATE_FLAG]: true };
        for (const item of itemsToProcess) { if (!item || ['container', 'backpack'].includes(item.type)) continue; const containerId = item.system.container?.id; const originalWeight = getOriginalWeight(item); if (!containerId) { if (originalWeight !== null) { /* console.log(`${MODULE_ID} | Ready Check: Restoring weight for ${item.name} (not in container but has flag). Actor: ${actor.name}`); */ await restoreOriginalWeight(item, internalContext); } continue; } const container = actor.items.get(containerId); const weightCapacityValue = container?.system?.capacity?.weight?.value; const containerHasWeightCapacity = weightCapacityValue !== null && weightCapacityValue !== undefined && weightCapacityValue !== "" && Number.isFinite(Number(weightCapacityValue)); if (!containerHasWeightCapacity) { if (originalWeight !== null) { /* console.log(`${MODULE_ID} | Ready Check: Restoring weight for ${item.name} (invalid container but has flag). Actor: ${actor.name}`); */ await restoreOriginalWeight(item, internalContext); } continue; } const reductionPercent = getReductionPercent(container);
             if (reductionPercent > 0) { const baseWeight = originalWeight ?? item.system.weight; if (baseWeight === 0) { if(originalWeight === null) await item.setFlag(MODULE_ID, FLAG_ORIGINAL_WEIGHT, 0); continue; } const reductionFactor = 1 - (reductionPercent / 100); const expectedReducedWeight = Math.max(0, baseWeight * reductionFactor); let needsFlagUpdate = false; let needsWeightUpdate = false; if (originalWeight === null || Math.abs(originalWeight - baseWeight) > 0.001) { needsFlagUpdate = true; } if (Math.abs(item.system.weight - expectedReducedWeight) > 0.001) { needsWeightUpdate = true; } if (needsFlagUpdate) { await item.setFlag(MODULE_ID, FLAG_ORIGINAL_WEIGHT, baseWeight); } if (needsWeightUpdate) { /* console.log(`${MODULE_ID} | Ready Check: Correcting weight for ${item.name} in ${container.name}. Expected: ${expectedReducedWeight}, Actual: ${item.system.weight}. Actor: ${actor.name}`); */ updates.push({ _id: item.id, 'system.weight': expectedReducedWeight }); } }
             else { if (originalWeight !== null) { /* console.log(`${MODULE_ID} | Ready Check: Restoring weight for ${item.name} (container has 0% reduction but flag exists). Actor: ${actor.name}`); */ await restoreOriginalWeight(item, internalContext); } }
        } // End item loop
        if (updates.length > 0) { console.log(`${MODULE_ID} | Ready Check: Applying ${updates.length} weight corrections for actor ${actor.name}`); try { await actor.updateEmbeddedDocuments("Item", updates, internalContext); } catch (err) { console.error(`${MODULE_ID} | Error applying batch updates during ready check for actor ${actor.name}:`, err); } }
    } // End actor loop
    console.log(`${MODULE_ID} | Initial weight check complete.`);
});

// --- КОНЕЦ ФАЙЛА module.js ---