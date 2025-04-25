// --- Изменения в начале ---
const MODULE_ID = 'weighty-containers';
const FLAG_REDUCTION_PERCENT = 'weightReductionPercent';
const FLAG_ORIGINAL_WEIGHT = 'originalWeight';
const INTERNAL_UPDATE_FLAG = 'WEIGHTY_CONTAINERS_INTERNAL'; // Flag for internal updates

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
    // Добавлена проверка на null/undefined actor
    if (!actor || !containerItem) return 0;

    return actor.items.reduce((acc, item) => {
        if (!item || item.system.container?.id !== containerItem.id) { // Added !item check
            return acc;
        }
        // Используем текущий вес предмета (который может быть уже снижен)
        const weight = item.system.weight ?? 0;
        const quantity = item.system.quantity ?? 1;
        return acc + (weight * quantity);
    }, 0);
}

/**
 * Применяет снижение веса к предмету, если он находится в соответствующем контейнере.
 * Сохраняет оригинальный вес во флаге.
 * @param {Item5e} item - Предмет, к которому применяется снижение.
 * @param {Item5e} containerItem - Контейнер, определяющий снижение.
 * @param {object} [context={}] - Контекст операции для предотвращения рекурсии.
 * @returns {Promise<void>}
 */
async function applyWeightReduction(item, containerItem, context = {}) {
    // Добавлена проверка на наличие item и containerItem
    if (!item || !containerItem) return;
    const reductionPercent = getReductionPercent(containerItem);
    console.log(`${MODULE_ID} | Attempting applyWeightReduction for ${item.name}. Reduction: ${reductionPercent}%`); // <--- Лог
    if (reductionPercent <= 0 || reductionPercent > 100) {
         console.log(`${MODULE_ID} | applyWeightReduction: Invalid reduction percent (${reductionPercent}). Skipping.`); // <--- Лог
        // If reduction is set to 0, ensure original weight is restored if flag exists
        if (reductionPercent === 0 && getOriginalWeight(item) !== null) {
            await restoreOriginalWeight(item, context);
        }
        return;
    }

    // Check if item already has the flag and matches the expected reduction
    const originalWeight = getOriginalWeight(item) ?? item.system.weight;
    const currentWeight = item.system.weight;
    const reductionFactor = 1 - (reductionPercent / 100);
    const expectedReducedWeight = Math.max(0, originalWeight * reductionFactor);

    console.log(`${MODULE_ID} | applyWeightReduction Calc: Original=${originalWeight}, Current=${currentWeight}, ExpectedReduced=${expectedReducedWeight}`); // <--- Лог

    let needsUpdate = false;
    let needsFlag = false;

    // Check if flag needs setting/updating
    // Set flag if it's missing OR if it's present but doesn't match the assumed original weight
    if (getOriginalWeight(item) === null || Math.abs(getOriginalWeight(item) - originalWeight) > 0.001) {
       needsFlag = true;
    }


    // Check if weight needs updating
    if (Math.abs(currentWeight - expectedReducedWeight) > 0.001) {
        needsUpdate = true;
    }

    if (!needsUpdate && !needsFlag) {
        console.log(`${MODULE_ID} | applyWeightReduction: No change needed for ${item.name}.`); // <--- Лог
        return; // Nothing to do
    }

    // Apply updates
    if(needsFlag) {
         console.log(`${MODULE_ID} | applyWeightReduction: Setting flag for ${item.name}. Original: ${originalWeight}`);
        await item.setFlag(MODULE_ID, FLAG_ORIGINAL_WEIGHT, originalWeight);
    }
    if (needsUpdate) {
        console.log(`${MODULE_ID} | applyWeightReduction: Updating weight for ${item.name}. New: ${expectedReducedWeight}`);
        const updateContext = foundry.utils.mergeObject(context, { [INTERNAL_UPDATE_FLAG]: true });
        await item.update({'system.weight': expectedReducedWeight}, updateContext);
        console.log(`${MODULE_ID} | applyWeightReduction: Weight update complete for ${item.name}.`); // <--- Лог
    } else if (needsFlag) { // Only log if only flag was updated
         console.log(`${MODULE_ID} | applyWeightReduction: Only flag update was needed for ${item.name}.`); // <--- Лог
    }
}

/**
 * Восстанавливает оригинальный вес предмета, если он покидает контейнер со снижением.
 * Удаляет флаг оригинального веса.
 * @param {Item5e} item - Предмет, для которого восстанавливается вес.
 * @param {object} [context={}] - Контекст операции для предотвращения рекурсии.
 * @returns {Promise<void>}
 */
async function restoreOriginalWeight(item, context = {}) {
    // Добавлена проверка на наличие item
    if (!item) return;
    const originalWeight = getOriginalWeight(item);
    console.log(`${MODULE_ID} | Attempting restoreOriginalWeight for ${item.name}. Flag value: ${originalWeight}`); // <--- Лог

    if (originalWeight === null) {
        console.log(`${MODULE_ID} | restoreOriginalWeight: No flag found for ${item.name}. Skipping.`);
        return; // Нет флага - нечего восстанавливать
    }

    // Удаляем флаг ДО обновления веса
    console.log(`${MODULE_ID} | restoreOriginalWeight: Removing flag for ${item.name}.`);
    await item.unsetFlag(MODULE_ID, FLAG_ORIGINAL_WEIGHT);

    // Обновляем вес только если он отличается от оригинального
    if (Math.abs(item.system.weight - originalWeight) > 0.001) {
        console.log(`${MODULE_ID} | restoreOriginalWeight: Restoring weight for ${item.name}. Original: ${originalWeight}, Current: ${item.system.weight}`);
        const updateContext = foundry.utils.mergeObject(context, { [INTERNAL_UPDATE_FLAG]: true });
        await item.update({'system.weight': originalWeight}, updateContext);
         console.log(`${MODULE_ID} | restoreOriginalWeight: Weight update complete for ${item.name}.`); // <--- Лог
    } else {
         console.log(`${MODULE_ID} | restoreOriginalWeight: No weight change needed for ${item.name}. Current weight matches flag.`); // <--- Лог
    }
}


// --- ХУКИ FOUNDRY VTT ---

Hooks.once('init', () => {
    console.log(`${MODULE_ID} | Initializing Weighty Containers - INIT Hook Fired`); // <--- Лог

    game.settings.register(MODULE_ID, 'gmOnlyButton', {
        name: game.i18n.localize("WEIGHTY_CONTAINERS.SETTINGS.gmOnlyButton"),
        hint: game.i18n.localize("WEIGHTY_CONTAINERS.SETTINGS.gmOnlyButtonHint"),
        scope: 'world',
        config: true,
        type: Boolean,
        default: true,
        requiresReload: false
    });

    if (game.modules.get('lib-wrapper')?.active) {
        console.log(`${MODULE_ID} | libWrapper detected. Registering wrappers.`); // <--- Лог
        try {
            libWrapper.register(MODULE_ID, 'CONFIG.Actor.documentClass.prototype.createEmbeddedDocuments', checkCapacityOnCreate, 'MIXED');
            libWrapper.register(MODULE_ID, 'CONFIG.Item.documentClass.prototype.update', combinedItemUpdateHandler, 'WRAPPER');
            console.log(`${MODULE_ID} | libWrapper registration successful.`); // <--- Лог
        } catch (e) {
            console.error(`${MODULE_ID} | Error during libWrapper registration:`, e); // <--- Лог ошибки
        }
    } else {
        console.log(`${MODULE_ID} | libWrapper not active. Using fallback hooks.`); // <--- Лог
        Hooks.on('preCreateItem', onItemPreCreate);
        Hooks.on('preUpdateItem', onItemPreUpdate);
        Hooks.on('updateItem', onItemUpdate);
    }
});

// Хук для добавления элементов на лист контейнера
Hooks.on('renderItemSheet5e', (app, html, data) => {
    console.log(`${MODULE_ID} | renderItemSheet5e Hook Fired. App ID: ${app.id}, Item Name: ${data.item?.name}, App class: ${app.constructor.name}`); // <--- Лог

    // Проверяем внимательнее условия
    const item = app.object;
    if (!item || !['container', 'backpack'].includes(item.type)) {
        // console.log(`${MODULE_ID} | Item is not a container/backpack or item is null. Skipping UI.`);
        return;
    }
    if (item.system?.capacity?.type !== 'weight') {
         console.log(`${MODULE_ID} | Item ${item.name} does not have weight capacity. Skipping UI.`); // <--- Лог
        return;
    }

    console.log(`${MODULE_ID} | Item ${item.name} is a valid container with weight capacity.`); // <--- Лог

    const currentReduction = getReductionPercent(item);
    const canConfigure = game.user.isGM || !game.settings.get(MODULE_ID, 'gmOnlyButton');
    console.log(`${MODULE_ID} | Current Reduction: ${currentReduction}%, Can Configure: ${canConfigure}`); // <--- Лог

    let rarityClass = 'cwm-reduction-common';
    if (currentReduction >= 95) rarityClass = 'cwm-reduction-artifact';
    else if (currentReduction >= 85) rarityClass = 'cwm-reduction-legendary';
    else if (currentReduction >= 70) rarityClass = 'cwm-reduction-veryrare';
    else if (currentReduction >= 50) rarityClass = 'cwm-reduction-rare';
    else if (currentReduction > 0) rarityClass = 'cwm-reduction-uncommon';

    const displayHtml = `
        <div class="cwm-weight-reduction-display ${rarityClass}" title="${game.i18n.format(`WEIGHTY_CONTAINERS.Rarity.${rarityClass.split('-')[2].charAt(0).toUpperCase() + rarityClass.split('-')[2].slice(1)}`)}">
            <span class="cwm-label">${game.i18n.localize("WEIGHTY_CONTAINERS.ContainerSheet.WeightReduction")}: </span>
            <span class="cwm-percentage">${currentReduction}%</span>
        </div>
    `;

    const buttonHtml = canConfigure ? `
        <button type="button" class="cwm-configure-button" title="${game.i18n.localize("WEIGHTY_CONTAINERS.ContainerSheet.ConfigureReduction")}">
            <i class="fas fa-cog"></i>
        </button>
    ` : '';

    const controlsContainerHtml = `
        <div class="cwm-controls-container">
            ${displayHtml}
            ${buttonHtml}
        </div>
    `;
    console.log(`${MODULE_ID} | Generated HTML:`, controlsContainerHtml); // <--- Лог

    // --- ИЗМЕНЕННАЯ ЛОГИКА ВНЕДРЕНИЯ HTML ---
    // Ищем div.form-group, который содержит label "Capacity Weight"
    const capacityLabelText = game.i18n.localize("DND5E.CapacityWeight");
    let capacityGroup = html.find(`label:contains("${capacityLabelText}")`).closest('.form-group');

    // Fallback если метка не найдена (может быть переведена или изменена)
    if (!capacityGroup.length) {
        console.log(`${MODULE_ID} | Capacity label "${capacityLabelText}" not found. Trying input name.`);
        capacityGroup = html.find('input[name="system.capacity.value"]').closest('.form-group');
    }

    // Fallback: Ищем секцию .item-properties, если другое не найдено
     if (!capacityGroup.length) {
        console.log(`${MODULE_ID} | Capacity group not found. Trying .item-properties.`);
        capacityGroup = html.find('.item-properties'); // Общая секция свойств
     }

    if (capacityGroup.length > 0) {
        const targetMethod = capacityGroup.hasClass('item-properties') ? 'prepend' : 'append'; // Prepend if it's the properties section
        console.log(`${MODULE_ID} | Found target element (${capacityGroup.prop("tagName")}.${capacityGroup.attr("class")}). Using method: ${targetMethod}.`); // <--- Лог
        // Удаляем старый блок, если он вдруг остался от предыдущего рендера
        html.find('.cwm-controls-container').remove(); // Ищем глобально на всякий случай
        // Добавляем новый
        capacityGroup[targetMethod](controlsContainerHtml);
    } else {
        // Совсем крайний случай: вкладка Details
        console.warn(`${MODULE_ID} | Target element not found. Trying details tab as last resort.`); // <--- Лог
        const detailsTab = html.find('.tab[data-tab="details"]');
        if (detailsTab.length > 0) {
            console.log(`${MODULE_ID} | Found details tab. Prepending controls.`); // <--- Лог
             // Удаляем старый блок
            detailsTab.find('.cwm-controls-container').remove();
            detailsTab.prepend(controlsContainerHtml);
        } else {
            console.error(`${MODULE_ID} | Could not find any suitable place to insert UI controls!`); // <--- Лог
        }
    }

    // --- Добавление обработчика для кнопки ---
    if (canConfigure) {
        const buttonElement = html.find('.cwm-configure-button'); // Ищем кнопку в обновленном HTML
        if (buttonElement.length > 0) {
            console.log(`${MODULE_ID} | Adding click listener to configure button.`); // <--- Лог
            buttonElement.off('click').on('click', async (event) => { // Ensure listener is attached correctly
                event.preventDefault();
                event.stopPropagation(); // Prevent triggering other listeners
                console.log(`${MODULE_ID} | Configure button clicked!`); // <--- Лог клика
                const currentItem = app.object;
                if (!currentItem) {
                     console.error(`${MODULE_ID} | Cannot find item object on button click.`);
                     return;
                }

                const currentVal = getReductionPercent(currentItem);

                new Dialog({
                    title: game.i18n.localize("WEIGHTY_CONTAINERS.Dialog.SetReductionTitle"),
                    content: `
                        <form>
                            <div class="form-group">
                                <label>${game.i18n.localize("WEIGHTY_CONTAINERS.Dialog.SetReductionLabel")}</label>
                                <div class="form-fields">
                                    <input type="number" name="reductionPercent" value="${currentVal}" min="0" max="100" step="1"/>
                                </div>
                                <p class="notes">${game.i18n.localize("WEIGHTY_CONTAINERS.Dialog.SetReductionHint")}</p>
                            </div>
                        </form>
                    `,
                    buttons: {
                        save: {
                            icon: '<i class="fas fa-save"></i>',
                            label: game.i18n.localize("Save"),
                            callback: async (html) => {
                                const itemToUpdate = app.object; // Re-fetch item
                                if (!itemToUpdate) return;

                                const inputVal = html.find('input[name="reductionPercent"]').val();
                                const newPercentage = parseInt(inputVal, 10);

                                if (isNaN(newPercentage) || newPercentage < 0 || newPercentage > 100) {
                                    ui.notifications.warn(game.i18n.localize("WEIGHTY_CONTAINERS.Notifications.InvalidPercentage"));
                                    return false;
                                }

                                console.log(`${MODULE_ID} | Dialog Save: Setting reduction for ${itemToUpdate.name} to ${newPercentage}%`); // <--- Лог
                                await itemToUpdate.setFlag(MODULE_ID, FLAG_REDUCTION_PERCENT, newPercentage);

                                if (itemToUpdate.actor) {
                                    console.log(`${MODULE_ID} | Dialog Save: Updating contained items weight for actor ${itemToUpdate.actor.name}.`); // <--- Лог
                                     await updateContainedItemsWeight(itemToUpdate.actor, itemToUpdate, newPercentage);
                                } else {
                                     console.log(`${MODULE_ID} | Dialog Save: Container item does not belong to an actor. Skipping contained items update.`); // <--- Лог
                                }
                                // No need for app.render(true); flag update should trigger it.
                            }
                        },
                        cancel: {
                            icon: '<i class="fas fa-times"></i>',
                            label: game.i18n.localize("Cancel")
                         }
                    },
                    default: 'save',
                    render: html => {
                        html.find('input[name="reductionPercent"]').focus().select();
                    }
                }).render(true);
            });
        } else {
             console.warn(`${MODULE_ID} | Configure button was expected but not found in the rendered HTML after insertion.`); // <--- Лог
        }
    }
});

// --- ЛОГИКА ПРОВЕРКИ ВМЕСТИМОСТИ И ИЗМЕНЕНИЯ ВЕСА ---

/**
 * Обновляет вес всех предметов внутри контейнера после изменения процента снижения.
 * @param {Actor5e} actor Владелец
 * @param {Item5e} containerItem Контейнер
 * @param {number} newReductionPercent Новый процент снижения
 */
async function updateContainedItemsWeight(actor, containerItem, newReductionPercent) {
    if (!actor || !containerItem) {
         console.log(`${MODULE_ID} | updateContainedItemsWeight: Skipping due to missing actor or containerItem.`);
        return;
    }
     console.log(`${MODULE_ID} | updateContainedItemsWeight: Updating items in ${containerItem.name} for actor ${actor.name} to ${newReductionPercent}% reduction.`); // <--- Лог

    // Filter items inside the container, excluding other containers/backpacks
    const containedItems = actor.items.filter(i => i && i.system.container?.id === containerItem.id && !['container', 'backpack'].includes(i.type));
    if (!containedItems.length) {
        console.log(`${MODULE_ID} | updateContainedItemsWeight: No relevant items found inside ${containerItem.name}.`);
        return;
    }

    const updates = [];
    const itemsToRestore = []; // Items needing restoreOriginalWeight called
    const internalContext = { [INTERNAL_UPDATE_FLAG]: true };

    for (const item of containedItems) {
        if (!item) continue;
        const originalWeight = getOriginalWeight(item);
        const baseWeightForCalc = originalWeight ?? item.system.weight;

        if (baseWeightForCalc === 0) { // Handle zero-weight items (set/unset flag)
            if (newReductionPercent === 0 && originalWeight !== null) {
                await item.unsetFlag(MODULE_ID, FLAG_ORIGINAL_WEIGHT);
            } else if (newReductionPercent > 0 && originalWeight === null) {
                await item.setFlag(MODULE_ID, FLAG_ORIGINAL_WEIGHT, 0);
            }
            continue;
        }

        // Determine action based on new percentage
        if (newReductionPercent > 0) {
            // Apply or re-apply reduction
            const reductionFactor = 1 - (newReductionPercent / 100);
            const expectedReducedWeight = Math.max(0, baseWeightForCalc * reductionFactor);

            // Set flag if needed (missing or different from base)
            if (originalWeight === null || Math.abs(originalWeight - baseWeightForCalc) > 0.001) {
                await item.setFlag(MODULE_ID, FLAG_ORIGINAL_WEIGHT, baseWeightForCalc);
            }
            // Queue weight update if needed
            if (Math.abs(item.system.weight - expectedReducedWeight) > 0.001) {
                 console.log(`${MODULE_ID} | updateContainedItemsWeight: Queuing weight update for ${item.name}. Expected: ${expectedReducedWeight}, Actual: ${item.system.weight}`);
                updates.push({ _id: item.id, 'system.weight': expectedReducedWeight });
            }
        } else { // newReductionPercent is 0
            // Restore original weight if flag exists
            if (originalWeight !== null) {
                console.log(`${MODULE_ID} | updateContainedItemsWeight: Reduction is 0%, queuing restore for ${item.name}.`);
                itemsToRestore.push(item); // Collect items to restore separately
            }
        }
    }

    // Apply batch weight updates first
    if (updates.length > 0) {
         console.log(`${MODULE_ID} | updateContainedItemsWeight: Applying batch weight updates for ${updates.length} items in ${containerItem.name}.`);
         try {
            await actor.updateEmbeddedDocuments("Item", updates, internalContext);
         } catch (err) {
              console.error(`${MODULE_ID} | Error applying batch updates in updateContainedItemsWeight for actor ${actor.name}:`, err);
         }
    } else {
         console.log(`${MODULE_ID} | updateContainedItemsWeight: No batch weight updates needed for items in ${containerItem.name}.`);
    }

    // Apply restores individually afterwards (restore handles its own update)
    if (itemsToRestore.length > 0) {
        console.log(`${MODULE_ID} | updateContainedItemsWeight: Restoring original weight for ${itemsToRestore.length} items.`);
        for (const itemToRestore of itemsToRestore) {
            await restoreOriginalWeight(itemToRestore, internalContext);
        }
    }
}


// --- Функции для проверки вместимости (libWrapper / Standard Hooks) ---

// --- Вариант с libWrapper ---

/**
 * Проверка вместимости при создании предметов (libWrapper).
 * @param {function} wrapped Оригинальный метод.
 * @param {string} embeddedName Тип документа ('Item').
 * @param {object[]} data Массив данных создаваемых предметов.
 * @param {object} context Опции создания.
 * @returns {Promise<Document[]>}
 */
async function checkCapacityOnCreate(wrapped, embeddedName, data, context) {
     console.log(`${MODULE_ID} | checkCapacityOnCreate fired. EmbeddedName: ${embeddedName}`); // <--- Лог
    if (embeddedName !== 'Item' || !Array.isArray(data) || data.length === 0) {
        return wrapped(embeddedName, data, context);
    }

    const actor = this;
    if (!actor || !(actor instanceof Actor)) {
         console.warn(`${MODULE_ID} | checkCapacityOnCreate called on non-actor context. Skipping.`);
         return wrapped(embeddedName, data, context);
    }
     console.log(`${MODULE_ID} | checkCapacityOnCreate for actor ${actor.name}`); // <--- Лог

    const itemsToCreate = [];
    let capacityBlocked = false;

    for (const itemData of data) {
        // Basic validation
        if (!itemData?.system || !itemData.name) {
             console.warn(`${MODULE_ID} | checkCapacityOnCreate: Skipping invalid item data.`, itemData);
            itemsToCreate.push(itemData); // Allow potentially broken items to be created by core
            continue;
        }
        // Skip check if the item being created is itself a container
        if(['container', 'backpack'].includes(itemData.type)) {
            console.log(`${MODULE_ID} | checkCapacityOnCreate: Skipping check for container item ${itemData.name}.`);
            itemsToCreate.push(itemData);
            continue;
        }

        const containerId = itemData.system.container;
        if (!containerId) { // Not being placed in a container
            itemsToCreate.push(itemData);
            continue;
        }

        const containerItem = actor.items.get(containerId);
        // Check if container exists and uses weight capacity
        if (!containerItem || containerItem.system?.capacity?.type !== 'weight') {
            itemsToCreate.push(itemData); // Allow adding to non-weight containers
            continue;
        }
         console.log(`${MODULE_ID} | checkCapacityOnCreate: Checking item ${itemData.name} against container ${containerItem.name}`); // <--- Лог

        const containerMaxWeight = containerItem.system.capacity.value ?? 0;
        const currentWeight = calculateContainerContentsWeight(containerItem, actor); // Weight before adding ANY of the new items

        let itemBaseWeight = itemData.system.weight ?? 0;
        const quantity = itemData.system.quantity ?? 1;
        const reductionPercent = getReductionPercent(containerItem);
        let reducedWeight = itemBaseWeight;

        if (reductionPercent > 0 && itemBaseWeight > 0) {
            reducedWeight = Math.max(0, itemBaseWeight * (1 - reductionPercent / 100));
        }
        const addedWeight = reducedWeight * quantity;
         console.log(`${MODULE_ID} | checkCapacityOnCreate: Container=${containerItem.name}, Item=${itemData.name}, CurrentWeight=${currentWeight}, AddedWeight=${addedWeight}, MaxWeight=${containerMaxWeight}`); // <--- Лог

        // Check capacity using the potentially reduced weight
        if (currentWeight + addedWeight > containerMaxWeight) {
            ui.notifications.warn(game.i18n.format("WEIGHTY_CONTAINERS.Notifications.CapacityExceeded", { containerName: containerItem.name }));
            capacityBlocked = true;
             console.log(`${MODULE_ID} | checkCapacityOnCreate: BLOCKED item ${itemData.name} due to capacity.`); // <--- Лог
        } else {
             // Modify data if reduction applies
             if (reductionPercent > 0 && itemBaseWeight > 0) {
                  console.log(`${MODULE_ID} | checkCapacityOnCreate: Applying reduction to creation data for ${itemData.name}. Reduced weight: ${reducedWeight}`); // <--- Лог
                 itemData.system.weight = reducedWeight;
                 // Ensure flags object exists
                 if (!itemData.flags) itemData.flags = {};
                 if (!itemData.flags[MODULE_ID]) itemData.flags[MODULE_ID] = {};
                 itemData.flags[MODULE_ID][FLAG_ORIGINAL_WEIGHT] = itemBaseWeight; // Store the original weight
             }
            itemsToCreate.push(itemData); // Add item to the list to be created
        }
    } // End loop through items data

    // Process creation based on blocking
    if (capacityBlocked) {
        if (itemsToCreate.length === 0) {
            console.log(`${MODULE_ID} | checkCapacityOnCreate: All items blocked, creating nothing.`);
            return []; // Return empty array if all items were blocked
        }
         console.log(`${MODULE_ID} | checkCapacityOnCreate: Some items blocked, creating allowed items:`, itemsToCreate.map(i=>i.name));
        // Call original method only with the allowed (and potentially modified) items
        return wrapped(embeddedName, itemsToCreate, context);
    } else {
         console.log(`${MODULE_ID} | checkCapacityOnCreate: All items allowed.`);
        // Call original method with all items (weights might have been modified)
        return wrapped(embeddedName, data, context);
    }
}

/**
 * Единый обработчик для Item.update (libWrapper).
 * @param {function} wrapped Оригинальный метод Item.update.
 * @param {object} changes Данные для обновления.
 * @param {object} context Опции обновления.
 * @returns {Promise<Item5e>}
 */
async function combinedItemUpdateHandler(wrapped, changes, context) {
    console.log(`${MODULE_ID} | combinedItemUpdateHandler fired for item: ${this?.name}, changes:`, foundry.utils.deepClone(changes)); // <--- Лог
    const item = this; // 'this' is the Item document being updated

    // Skip all logic if no actor, it's an internal update, or the item is a container itself
    if (!item.actor || context?.[INTERNAL_UPDATE_FLAG] || ['container', 'backpack'].includes(item.type)) {
        console.log(`${MODULE_ID} | combinedItemUpdateHandler: Skipping logic (No actor / Internal update / Is Container). Actor: ${!!item.actor}, Internal: ${!!context?.[INTERNAL_UPDATE_FLAG]}, Type: ${item.type}`);
        return wrapped(changes, context); // Pass through directly
    }

    const actor = item.actor; // We know actor exists now
    console.log(`${MODULE_ID} | combinedItemUpdateHandler: Processing for item ${item.name} on actor ${actor.name}`); // <--- Лог

    // --- 1. PRE-UPDATE: Capacity Check for Quantity Increase ---
    const quantityChange = changes.system?.quantity;
    const isQuantityIncrease = typeof quantityChange === 'number' && quantityChange > item.system.quantity;
    const containerId = item.system?.container?.id; // Container ID *before* update

    if (isQuantityIncrease && containerId) {
        const containerItem = actor.items.get(containerId);
        if (containerItem && containerItem.system?.capacity?.type === 'weight') {
             console.log(`${MODULE_ID} | combinedItemUpdateHandler: Checking capacity for quantity increase on ${item.name} in ${containerItem.name}.`); // <--- Лог
            const containerMaxWeight = containerItem.system.capacity.value ?? 0;
            // Calculate weight of OTHERS + weight of THIS item with NEW quantity
            const currentWeightOfOthers = calculateContainerContentsWeight(containerItem, actor) - (item.system.weight * item.system.quantity);
            const newWeightOfThisItem = item.system.weight * quantityChange; // Use current potentially reduced weight

             console.log(`${MODULE_ID} | combinedItemUpdateHandler: Capacity Check: Others=${currentWeightOfOthers}, NewWeight=${newWeightOfThisItem}, Max=${containerMaxWeight}`); // <--- Лог
            if (currentWeightOfOthers + newWeightOfThisItem > containerMaxWeight) {
                ui.notifications.warn(game.i18n.format("WEIGHTY_CONTAINERS.Notifications.CapacityExceeded", { containerName: containerItem.name }));
                 console.log(`${MODULE_ID} | combinedItemUpdateHandler: BLOCKED quantity update for ${item.name} due to capacity.`); // <--- Лог
                // Remove only the quantity change from the update data
                delete changes.system.quantity;
                if (foundry.utils.isEmpty(changes.system)) delete changes.system; // Clean up empty system object
                // If no other changes remain, prevent the update entirely
                if (foundry.utils.isEmpty(changes)) {
                    console.log(`${MODULE_ID} | combinedItemUpdateHandler: Update prevented as only quantity change was blocked.`);
                     return item; // Return the original item to signify no update occurred
                }
                 console.log(`${MODULE_ID} | combinedItemUpdateHandler: Quantity change removed, proceeding with other changes:`, foundry.utils.deepClone(changes));
            }
        }
    }

    // --- 2. WRAPPED CALL: Execute the Original Update ---
    const previousContainerId = item.system.container?.id; // Store state *before* wrapped call
    const previousContainer = previousContainerId ? actor.items.get(previousContainerId) : null;
    const wasInReducingContainer = previousContainer && getReductionPercent(previousContainer) > 0;
    const hadOriginalWeightFlag = getOriginalWeight(item) !== null;
    const originalChanges = foundry.utils.deepClone(changes); // Store original changes before they might be modified by core/other modules

    console.log(`${MODULE_ID} | combinedItemUpdateHandler: Calling wrapped update for ${item.name} with changes:`, foundry.utils.deepClone(changes)); // <--- Лог
    const updatedItem = await wrapped(changes, context); // Let the original update happen
    console.log(`${MODULE_ID} | combinedItemUpdateHandler: Wrapped update finished for ${updatedItem?.name}. Starting post-update logic.`); // <--- Лог

    // --- 3. POST-UPDATE LOGIC: Handle Consequences ---
    // Re-fetch actor and container info as they might have changed if item moved actor
    const currentActor = updatedItem.actor;
    if (!currentActor) {
        console.log(`${MODULE_ID} | combinedItemUpdateHandler: updatedItem has no actor after update. Exiting post-update logic.`);
        return updatedItem; // Should not happen if initial check passed, but safety first
    }

    const newContainerId = updatedItem.system.container?.id; // Container ID *after* update
    const newContainer = newContainerId ? currentActor.items.get(newContainerId) : null;
    const isInReducingContainer = newContainer && getReductionPercent(newContainer) > 0;
    // Check if weight/container actually changed by comparing with originalChanges passed to wrapped
    const weightChanged = originalChanges.system && 'weight' in originalChanges.system;
    const containerChanged = originalChanges.system && 'container' in originalChanges.system;
    const internalContext = { [INTERNAL_UPDATE_FLAG]: true }; // Context for our internal updates

    // --- 3.1 Container Change Logic ---
    if (containerChanged && previousContainerId !== newContainerId) {
        console.log(`${MODULE_ID} | combinedItemUpdateHandler: Container changed for ${updatedItem.name} from ${previousContainerId || 'root'} to ${newContainerId || 'root'}.`); // <--- Лог
        if (wasInReducingContainer && !isInReducingContainer) {
            // Moved FROM reducing TO non-reducing/root -> Restore weight
            await restoreOriginalWeight(updatedItem, internalContext);
        } else if (!wasInReducingContainer && isInReducingContainer) {
            // Moved FROM non-reducing/root TO reducing -> Apply reduction
            await applyWeightReduction(updatedItem, newContainer, internalContext);
        } else if (wasInReducingContainer && isInReducingContainer) {
            // Moved FROM reducing TO reducing -> Re-apply reduction based on NEW container
            await applyWeightReduction(updatedItem, newContainer, internalContext);
        }
        // else: Moved FROM non-reducing TO non-reducing -> No weight action needed
    }
    // --- 3.2 External Weight Change Logic (No container change in this update) ---
    else if (weightChanged && isInReducingContainer && previousContainerId === newContainerId) {
         console.log(`${MODULE_ID} | combinedItemUpdateHandler: External weight change detected for ${updatedItem.name} while in reducing container ${newContainer.name}.`); // <--- Лог
         // Assume the weight applied by the wrapped call IS the new ORIGINAL weight
         const newOriginalWeight = updatedItem.system.weight;
         const currentFlagWeight = getOriginalWeight(updatedItem); // Check flag AFTER wrapped call

         // If flag is missing or different from the new weight, update flag and re-apply reduction
         if (currentFlagWeight === null || Math.abs(currentFlagWeight - newOriginalWeight) > 0.001) {
            console.log(`${MODULE_ID} | combinedItemUpdateHandler: Updating flag and re-applying reduction for ${updatedItem.name}. New original: ${newOriginalWeight}`);
            await updatedItem.setFlag(MODULE_ID, FLAG_ORIGINAL_WEIGHT, newOriginalWeight); // Set flag first
            // Calculate reduced weight based on the new original weight
            const reductionFactor = 1 - (getReductionPercent(newContainer) / 100);
            const newReducedWeight = Math.max(0, newOriginalWeight * reductionFactor);
            // Apply the reduced weight if it differs from the current weight (which is newOriginalWeight at this point)
            if (Math.abs(updatedItem.system.weight - newReducedWeight) > 0.001) {
                 await updatedItem.update({'system.weight': newReducedWeight}, internalContext);
            }
         } else {
              console.log(`${MODULE_ID} | combinedItemUpdateHandler: External weight change matches existing flag for ${updatedItem.name}. No action needed.`);
         }
    }
    // --- 3.3 Flag Consistency Check (Item is NOT in reducing container, but HAS flag - Error case) ---
    else if (!isInReducingContainer && hadOriginalWeightFlag && !containerChanged) {
        // This case handles situations where the item *shouldn't* have the flag but does.
        // This could happen if e.g. the container's reduction was set to 0 but items weren't updated.
        console.warn(`${MODULE_ID} | combinedItemUpdateHandler: Item ${updatedItem.name} is not in a reducing container but had flag. Restoring weight for consistency.`);
        await restoreOriginalWeight(updatedItem, internalContext); // Restore original weight and remove flag
    } else {
         // Default case: no relevant change occurred that requires our action
         console.log(`${MODULE_ID} | combinedItemUpdateHandler: No relevant post-update action needed for ${updatedItem.name}.`); // <--- Лог
    }

    return updatedItem; // Return the potentially modified item
}


// --- Fallback Функции (с логами и проверками) ---

/** Fallback: PreCreate */
function onItemPreCreate(item, data, options, userId) {
    console.log(`${MODULE_ID} | Fallback: onItemPreCreate for ${data.name}`); // <--- Лог
    if (game.userId !== userId) return true;

    const actor = item.parent;
    if (!actor) return true; // Skip if no actor
     if (['container', 'backpack'].includes(data.type)) return true; // Skip if container itself

    const containerId = data.system?.container;
    if (!containerId) return true;

    const containerItem = actor.items.get(containerId);
    if (!containerItem || containerItem.system?.capacity?.type !== 'weight') return true;

    const containerMaxWeight = containerItem.system.capacity.value ?? 0;
    const currentWeight = calculateContainerContentsWeight(containerItem, actor);
    let itemBaseWeight = data.system?.weight ?? 0;
    const quantity = data.system?.quantity ?? 1;
    const reductionPercent = getReductionPercent(containerItem);
    let reducedWeight = itemBaseWeight;
    if (reductionPercent > 0 && itemBaseWeight > 0) {
        reducedWeight = Math.max(0, itemBaseWeight * (1 - reductionPercent / 100));
    }
    const addedWeight = reducedWeight * quantity;
    if (currentWeight + addedWeight > containerMaxWeight) {
        ui.notifications.warn(game.i18n.format("WEIGHTY_CONTAINERS.Notifications.CapacityExceeded", { containerName: containerItem.name }));
        return false; // Block creation
    }
    // Modify data before creation if reduction applies
    if (reductionPercent > 0 && itemBaseWeight > 0) {
        data.system.weight = reducedWeight;
        if (!data.flags) data.flags = {};
        if (!data.flags[MODULE_ID]) data.flags[MODULE_ID] = {};
        data.flags[MODULE_ID][FLAG_ORIGINAL_WEIGHT] = itemBaseWeight;
    }
    return true; // Allow creation
}

/** Fallback: PreUpdate */
function onItemPreUpdate(item, changes, options, userId) {
    console.log(`${MODULE_ID} | Fallback: onItemPreUpdate for ${item.name}, changes:`, foundry.utils.deepClone(changes)); // <--- Лог
    if (game.userId !== userId || options?.[INTERNAL_UPDATE_FLAG]) return true; // Skip internal or other user's updates

    const actor = item.actor;
    if (!actor) return true; // Skip if no actor
    if (['container', 'backpack'].includes(item.type)) return true; // Skip if container itself

    const quantityChange = changes.system?.quantity;
    const isQuantityIncrease = typeof quantityChange === 'number' && quantityChange > item.system.quantity;
    const containerId = item.system?.container?.id; // Check current container

    if (!isQuantityIncrease || !containerId) {
        return true; // Only check capacity on quantity increase within a container
    }

    const containerItem = actor.items.get(containerId);
     if (!containerItem || containerItem.system?.capacity?.type !== 'weight') {
        return true; // Not in a weight-limited container
    }

     const containerMaxWeight = containerItem.system.capacity.value ?? 0;
     // Use current (potentially reduced) weight for calculation
     const currentWeightOfOthers = calculateContainerContentsWeight(containerItem, actor) - (item.system.weight * item.system.quantity);
     const newWeightOfThisItem = item.system.weight * quantityChange; // Weight with the new quantity
    if (currentWeightOfOthers + newWeightOfThisItem > containerMaxWeight) {
        ui.notifications.warn(game.i18n.format("WEIGHTY_CONTAINERS.Notifications.CapacityExceeded", { containerName: containerItem.name }));
        // Block only the quantity change
        delete changes.system.quantity;
        if (foundry.utils.isEmpty(changes.system)) delete changes.system;
        if (foundry.utils.isEmpty(changes)) return false; // If only quantity changed, block the whole update
        return true; // Allow other changes to proceed
    }
    return true; // Allow update
}

/** Fallback: Update */
async function onItemUpdate(item, changes, options, userId) {
    console.log(`${MODULE_ID} | Fallback: onItemUpdate for ${item.name}, changes:`, foundry.utils.deepClone(changes)); // <--- Лог
    if (game.userId !== userId || options?.[INTERNAL_UPDATE_FLAG] ) return; // Skip internal or other user's updates

    const actor = item.actor;
    if (!actor) return; // Skip if no actor
    if (['container', 'backpack'].includes(item.type)) return; // Skip if container itself

    const internalContext = { [INTERNAL_UPDATE_FLAG]: true };
    const newContainerId = item.system.container?.id; // Container ID after update
    const newContainer = newContainerId ? actor.items.get(newContainerId) : null;
    const isInReducingContainer = newContainer && getReductionPercent(newContainer) > 0;
    const hadOriginalWeightFlag = getOriginalWeight(item) !== null; // Check flag on the updated item

    // Check if container changed
    if (changes.system && 'container' in changes.system) {
        const previousContainerId = changes.system.container; // Old container ID from changes object
        if (previousContainerId !== newContainerId) { // If container actually changed
             const previousContainer = previousContainerId ? actor.items.get(previousContainerId) : null;
             const wasInReducingContainer = previousContainer && getReductionPercent(previousContainer) > 0;
             // Apply logic based on transition
             if (wasInReducingContainer && !isInReducingContainer) {
                 await restoreOriginalWeight(item, internalContext);
             } else if (!wasInReducingContainer && isInReducingContainer) {
                 await applyWeightReduction(item, newContainer, internalContext);
             } else if (wasInReducingContainer && isInReducingContainer) {
                 await applyWeightReduction(item, newContainer, internalContext);
             }
        }
     }
    // Check if weight changed (less reliable detection of "external" change)
    else if (changes.system && 'weight' in changes.system) {
        if (isInReducingContainer) {
            // If weight changed while in reducing container, assume it was external
            // Treat the new weight as the original and re-apply reduction
            const newOriginalWeight = item.system.weight; // Weight after update
            const originalFlag = getOriginalWeight(item);
            // Update flag and re-apply if needed
            if(originalFlag === null || Math.abs(originalFlag - newOriginalWeight) > 0.001) {
                console.warn(`${MODULE_ID} | Fallback: External weight change assumed for ${item.name}. Re-applying reduction.`);
                await item.setFlag(MODULE_ID, FLAG_ORIGINAL_WEIGHT, newOriginalWeight);
                const reductionFactor = 1 - (getReductionPercent(newContainer) / 100);
                const expectedReducedWeight = Math.max(0, newOriginalWeight * reductionFactor);
                if (Math.abs(item.system.weight - expectedReducedWeight) > 0.001) {
                    await item.update({'system.weight': expectedReducedWeight}, internalContext);
                }
            }
        } else { // Not in reducing container
             // If weight changed and it has a flag, restore (removes flag)
             if (hadOriginalWeightFlag) {
                 await restoreOriginalWeight(item, internalContext);
             }
        }
    }
     // Check consistency even if no obvious change occurred
     else {
         // If not in reducing container but has flag -> restore
         if (!isInReducingContainer && hadOriginalWeightFlag) {
             console.warn(`${MODULE_ID} | Fallback: Consistency check triggered restore for ${item.name}.`);
             await restoreOriginalWeight(item, internalContext);
         }
         // If in reducing container but NO flag -> apply reduction
         // This helps fix items added before module activation or if flag was lost
         else if (isInReducingContainer && !hadOriginalWeightFlag && item.system.weight > 0) {
              console.warn(`${MODULE_ID} | Fallback: Consistency check triggered apply reduction for ${item.name}.`);
              await applyWeightReduction(item, newContainer, internalContext);
         }
     }
}

// --- Ready Hook ---
Hooks.on('ready', async () => {
    console.log(`${MODULE_ID} | Ready Hook Fired. Checking item weights inside containers.`);
    const actorsToCheck = new Set();
    game.users.filter(u => u.character && u.active).forEach(u => actorsToCheck.add(u.character));
    game.scenes.filter(s => s.active).flatMap(s => s.tokens).filter(t => t.actor).forEach(t => actorsToCheck.add(t.actor));

    for (const actor of actorsToCheck) {
        if (!actor?.items) continue; // Skip actors without items collection
        console.log(`${MODULE_ID} | Ready Check: Processing actor ${actor.name}`);
        const updates = [];
        const itemsToProcess = actor.items.contents; // Get a stable array
        const internalContext = { [INTERNAL_UPDATE_FLAG]: true }; // Context for updates

        for (const item of itemsToProcess) {
             // Skip invalid items or containers themselves
             if (!item || ['container', 'backpack'].includes(item.type)) continue;

            const containerId = item.system.container?.id;
            const originalWeight = getOriginalWeight(item); // Check flag status

            // Case 1: Item NOT in a container
            if (!containerId) {
                // If it has a flag, it shouldn't -> Restore
                if (originalWeight !== null) {
                    console.log(`${MODULE_ID} | Ready Check: Restoring weight for ${item.name} (not in container but has flag). Actor: ${actor.name}`);
                    await restoreOriginalWeight(item, internalContext); // Restore handles its own update
                }
                continue; // Move to next item
            }

            // Case 2: Item IS in a container
            const container = actor.items.get(containerId);
            // Check if container is valid and uses weight capacity
            if (!container || container.system?.capacity?.type !== 'weight') {
                 // If in invalid container but has flag -> Restore
                 if (originalWeight !== null) {
                    console.log(`${MODULE_ID} | Ready Check: Restoring weight for ${item.name} (invalid container but has flag). Actor: ${actor.name}`);
                     await restoreOriginalWeight(item, internalContext);
                 }
                 continue; // Move to next item
            }

            // Case 3: Item in a valid, weight-capacity container
            const reductionPercent = getReductionPercent(container);

            if (reductionPercent > 0) { // Container provides reduction
                const baseWeight = originalWeight ?? item.system.weight; // Use flag or current weight as base

                if (baseWeight === 0) { // Handle zero-weight items separately (just ensure flag consistency)
                     if(originalWeight === null) await item.setFlag(MODULE_ID, FLAG_ORIGINAL_WEIGHT, 0);
                    continue;
                }

                // Calculate expected reduced weight
                const reductionFactor = 1 - (reductionPercent / 100);
                const expectedReducedWeight = Math.max(0, baseWeight * reductionFactor);
                let needsFlagUpdate = false;
                let needsWeightUpdate = false;

                // Check if flag needs setting/correction
                if (originalWeight === null || Math.abs(originalWeight - baseWeight) > 0.001) {
                    needsFlagUpdate = true;
                }
                // Check if weight needs correction
                if (Math.abs(item.system.weight - expectedReducedWeight) > 0.001) {
                    needsWeightUpdate = true;
                }

                // Apply corrections
                if (needsFlagUpdate) {
                    await item.setFlag(MODULE_ID, FLAG_ORIGINAL_WEIGHT, baseWeight);
                }
                if (needsWeightUpdate) {
                     console.log(`${MODULE_ID} | Ready Check: Correcting weight for ${item.name} in ${container.name}. Expected: ${expectedReducedWeight}, Actual: ${item.system.weight}. Actor: ${actor.name}`);
                    updates.push({ _id: item.id, 'system.weight': expectedReducedWeight }); // Queue update
                }

            } else { // Container provides NO reduction (0%)
                // If item has a flag, it shouldn't -> Restore
                if (originalWeight !== null) {
                    console.log(`${MODULE_ID} | Ready Check: Restoring weight for ${item.name} (container has 0% reduction but flag exists). Actor: ${actor.name}`);
                    await restoreOriginalWeight(item, internalContext);
                }
            }
        } // End loop through actor's items

        // Apply batch updates for this actor if any were queued
        if (updates.length > 0) {
            console.log(`${MODULE_ID} | Ready Check: Applying ${updates.length} weight corrections for actor ${actor.name}`);
            try {
                await actor.updateEmbeddedDocuments("Item", updates, internalContext);
            } catch (err) {
                 console.error(`${MODULE_ID} | Error applying batch updates during ready check for actor ${actor.name}:`, err);
            }
        }
    } // End loop through actors
     console.log(`${MODULE_ID} | Initial weight check complete.`);
});