// --- Изменения в начале ---
const MODULE_ID = 'weighty-containers';
const FLAG_REDUCTION_PERCENT = 'weightReductionPercent';
const FLAG_ORIGINAL_WEIGHT = 'originalWeight';
const INTERNAL_UPDATE_FLAG = 'WEIGHTY_CONTAINERS_INTERNAL'; // Flag for internal updates

// --- ФУНКЦИИ ХЕЛПЕРЫ (без изменений в логике, только MODULE_ID) ---

/**
 * Получает процент снижения веса для контейнера.
 * @param {Item5e} containerItem - Объект предмета-контейнера.
 * @returns {number} Процент снижения (0-100).
 */
function getReductionPercent(containerItem) {
    return containerItem?.getFlag(MODULE_ID, FLAG_REDUCTION_PERCENT) ?? 0;
}

/**
 * Получает оригинальный вес предмета, если он был изменен модулем.
 * @param {Item5e} item - Предмет для проверки.
 * @returns {number | null} Оригинальный вес или null.
 */
function getOriginalWeight(item) {
    return item?.getFlag(MODULE_ID, FLAG_ORIGINAL_WEIGHT) ?? null;
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
        if (item.system.container?.id !== containerItem.id) {
            return acc;
        }
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
    // Добавлена проверка на наличие item
    if (!item) return;
    const reductionPercent = getReductionPercent(containerItem);
    if (reductionPercent <= 0 || reductionPercent > 100) return;

    const originalWeight = getOriginalWeight(item) ?? item.system.weight;
    const currentWeight = item.system.weight;
    const reductionFactor = 1 - (reductionPercent / 100);
    const reducedWeight = Math.max(0, originalWeight * reductionFactor);

    if (originalWeight === 0 || Math.abs(currentWeight - reducedWeight) < 0.001) {
        if (originalWeight === 0 && getOriginalWeight(item) === null) {
            await item.setFlag(MODULE_ID, FLAG_ORIGINAL_WEIGHT, 0);
        }
        return;
    }

    console.log(`${MODULE_ID} | Applying reduction (${reductionPercent}%) to ${item.name}. Original: ${originalWeight}, New: ${reducedWeight}`);
    await item.setFlag(MODULE_ID, FLAG_ORIGINAL_WEIGHT, originalWeight);
    const updateContext = foundry.utils.mergeObject(context, { [INTERNAL_UPDATE_FLAG]: true });
    await item.update({'system.weight': reducedWeight}, updateContext);
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

    if (originalWeight === null) return;

    await item.unsetFlag(MODULE_ID, FLAG_ORIGINAL_WEIGHT);

    if (Math.abs(item.system.weight - originalWeight) > 0.001) {
        console.log(`${MODULE_ID} | Restoring original weight for ${item.name}. Original: ${originalWeight}`);
        const updateContext = foundry.utils.mergeObject(context, { [INTERNAL_UPDATE_FLAG]: true });
        await item.update({'system.weight': originalWeight}, updateContext);
    }
}


// --- ХУКИ FOUNDRY VTT ---

Hooks.once('init', () => {
    console.log(`${MODULE_ID} | Initializing Weighty Containers`);

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
        libWrapper.register(MODULE_ID, 'CONFIG.Actor.documentClass.prototype.createEmbeddedDocuments', checkCapacityOnCreate, 'MIXED');
        libWrapper.register(MODULE_ID, 'CONFIG.Item.documentClass.prototype.update', combinedItemUpdateHandler, 'WRAPPER');
    } else {
        Hooks.on('preCreateItem', onItemPreCreate);
        Hooks.on('preUpdateItem', onItemPreUpdate);
        Hooks.on('updateItem', onItemUpdate);
    }
});

// Хук для добавления элементов на лист контейнера
Hooks.on('renderItemSheet5e', (app, html, data) => {
    // Проверка что data.item существует
    if (!data.item || !['container', 'backpack'].includes(data.item.type) || data.item.system?.capacity?.type !== 'weight') {
        return;
    }

    const item = app.object;
    // Дополнительная проверка item, хотя app.object обычно надежен
    if (!item) return;

    const currentReduction = getReductionPercent(item);
    const canConfigure = game.user.isGM || !game.settings.get(MODULE_ID, 'gmOnlyButton');

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

    const capacityWeightInput = html.find('input[name="system.capacity.value"]');
    let targetElement = capacityWeightInput.closest('.form-group');

    if (!targetElement.length) {
         targetElement = html.find('.tab[data-tab="details"]');
         if (targetElement.length) {
             targetElement.prepend(controlsContainerHtml);
         } else {
              html.find('form').first().prepend(controlsContainerHtml);
         }
    } else {
        targetElement.after(controlsContainerHtml);
    }

    if (canConfigure) {
        html.find('.cwm-configure-button').on('click', async (event) => {
            event.preventDefault();
            // Убедимся что item все еще доступен
            const currentItem = app.object;
            if (!currentItem) return;

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
                            // Перепроверяем currentItem и его actor
                            const itemToUpdate = app.object;
                            if (!itemToUpdate) return;

                            const inputVal = html.find('input[name="reductionPercent"]').val();
                            const newPercentage = parseInt(inputVal, 10);

                            if (isNaN(newPercentage) || newPercentage < 0 || newPercentage > 100) {
                                ui.notifications.warn(game.i18n.localize("WEIGHTY_CONTAINERS.Notifications.InvalidPercentage"));
                                return false;
                            }

                            console.log(`${MODULE_ID} | Setting reduction for ${itemToUpdate.name} to ${newPercentage}%`);
                            await itemToUpdate.setFlag(MODULE_ID, FLAG_REDUCTION_PERCENT, newPercentage);
                            // Обновляем вес только если контейнер принадлежит актору
                            if (itemToUpdate.actor) {
                                 await updateContainedItemsWeight(itemToUpdate.actor, itemToUpdate, newPercentage);
                            }
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
    // Добавлена проверка actor и containerItem
    if (!actor || !containerItem) return;
    const containedItems = actor.items.filter(i => i.system.container?.id === containerItem.id);
    if (!containedItems.length) return; // Нет предметов для обновления

    const updates = [];
    const reductionFactor = 1 - (newReductionPercent / 100);
    const internalContext = { [INTERNAL_UPDATE_FLAG]: true };

    for (const item of containedItems) {
        if (!item) continue; // Доп. проверка
        const originalWeight = getOriginalWeight(item);
        const baseWeightForCalc = originalWeight ?? item.system.weight;

        if (baseWeightForCalc === 0) {
             if (newReductionPercent === 0 && originalWeight !== null) {
                 await item.unsetFlag(MODULE_ID, FLAG_ORIGINAL_WEIGHT);
             }
             else if (newReductionPercent > 0 && originalWeight === null) {
                  await item.setFlag(MODULE_ID, FLAG_ORIGINAL_WEIGHT, 0);
             }
            continue;
        }

        const newWeight = Math.max(0, baseWeightForCalc * reductionFactor);

        if (newReductionPercent > 0) {
            if(originalWeight === null || Math.abs(originalWeight - baseWeightForCalc) > 0.001) {
                 await item.setFlag(MODULE_ID, FLAG_ORIGINAL_WEIGHT, baseWeightForCalc);
            }
        } else if (originalWeight !== null) {
             await item.unsetFlag(MODULE_ID, FLAG_ORIGINAL_WEIGHT);
        }

        if (Math.abs(item.system.weight - newWeight) > 0.001) {
            updates.push({ _id: item.id, 'system.weight': newWeight });
        }
    }

    if (updates.length > 0) {
        await actor.updateEmbeddedDocuments("Item", updates, internalContext);
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
    if (embeddedName !== 'Item' || !Array.isArray(data) || data.length === 0) {
        return wrapped(embeddedName, data, context);
    }

    const actor = this; // this === Actor
    // Если вызывается не на акторе, пропускаем нашу логику
    if (!actor || !(actor instanceof Actor)) {
         console.warn(`${MODULE_ID} | checkCapacityOnCreate called on non-actor context. Skipping.`);
         return wrapped(embeddedName, data, context);
    }

    const itemsToCreate = [];
    let capacityBlocked = false;

    for (const itemData of data) {
        // Проверка на случай некорректных данных
        if (!itemData?.system) {
            itemsToCreate.push(itemData);
            continue;
        }
        const containerId = itemData.system.container;
        if (!containerId) {
            itemsToCreate.push(itemData);
            continue;
        }

        const containerItem = actor.items.get(containerId);
        if (!containerItem || containerItem.system?.capacity?.type !== 'weight') {
            itemsToCreate.push(itemData);
            continue;
        }

        const containerMaxWeight = containerItem.system.capacity.value ?? 0;
        const currentWeight = calculateContainerContentsWeight(containerItem, actor);

        let itemBaseWeight = itemData.system.weight ?? 0;
        const quantity = itemData.system.quantity ?? 1;
        const reductionPercent = getReductionPercent(containerItem);
        let reducedWeight = itemBaseWeight;

        if (reductionPercent > 0 && itemBaseWeight > 0) {
            reducedWeight = Math.max(0, itemBaseWeight * (1 - reductionPercent / 100));
        }
        const addedWeight = reducedWeight * quantity;

        if (currentWeight + addedWeight > containerMaxWeight) {
            ui.notifications.warn(game.i18n.format("WEIGHTY_CONTAINERS.Notifications.CapacityExceeded", { containerName: containerItem.name }));
            capacityBlocked = true;
        } else {
             if (reductionPercent > 0 && itemBaseWeight > 0) {
                 itemData.system.weight = reducedWeight;
                 foundry.utils.setProperty(itemData, `flags.${MODULE_ID}.${FLAG_ORIGINAL_WEIGHT}`, itemBaseWeight);
             }
            itemsToCreate.push(itemData);
        }
    }

    if (capacityBlocked) {
        if (itemsToCreate.length === 0) return [];
        return wrapped(embeddedName, itemsToCreate, context);
    } else {
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
    const item = this; // this === Item до обновления

    // *** ГЛАВНОЕ ИЗМЕНЕНИЕ: Проверяем наличие актора ***
    // Если актора нет (например, обновляем предмет в директории),
    // или предмет сам по себе контейнер (не может быть ВНУТРИ другого для нашей логики),
    // пропускаем всю нашу логику и просто вызываем оригинальный метод.
    // Мы также пропускаем внутренние обновления.
    if (!item.actor || context?.[INTERNAL_UPDATE_FLAG] || ['container', 'backpack'].includes(item.type)) {
        return wrapped(changes, context);
    }
    // *** КОНЕЦ ГЛАВНОГО ИЗМЕНЕНИЯ ***

    const actor = item.actor; // Теперь мы уверены, что actor есть

    // --- 1. Логика ПРОВЕРКИ ВМЕСТИМОСТИ (ДО вызова wrapped) ---
    const quantityChange = changes.system?.quantity;
    const isQuantityIncrease = typeof quantityChange === 'number' && quantityChange > item.system.quantity;
    const containerId = item.system?.container?.id;

    if (isQuantityIncrease && containerId) { // actor уже проверен выше
        const containerItem = actor.items.get(containerId);
        if (containerItem && containerItem.system?.capacity?.type === 'weight') {
            const containerMaxWeight = containerItem.system.capacity.value ?? 0;
            const currentWeightWithoutItem = calculateContainerContentsWeight(containerItem, actor) - (item.system.weight * item.system.quantity);
            const newItemTotalWeight = item.system.weight * quantityChange;

            if (currentWeightWithoutItem + newItemTotalWeight > containerMaxWeight) {
                ui.notifications.warn(game.i18n.format("WEIGHTY_CONTAINERS.Notifications.CapacityExceeded", { containerName: containerItem.name }));
                delete changes.system.quantity;
                if (foundry.utils.isEmpty(changes.system)) delete changes.system;
                if (foundry.utils.isEmpty(changes)) return item;
            }
        }
    }

    // --- 2. Вызов оригинального метода update ---
    const previousContainerId = item.system.container?.id;
    const wasInReducingContainer = previousContainerId && getReductionPercent(actor.items.get(previousContainerId)) > 0; // actor есть
    const hadOriginalWeightFlag = getOriginalWeight(item) !== null;

    const updatedItem = await wrapped(changes, context);

    // --- 3. Логика ПОСЛЕ обновления (с использованием updatedItem) ---
    const currentActor = updatedItem.actor; // Может измениться теоретически, но unlikely в этом сценарии
    // Перепроверяем currentActor на всякий случай, хотя он должен быть тем же, что и actor выше
    if (!currentActor) {
        return updatedItem;
    }

    const newContainerId = updatedItem.system.container?.id;
    const newContainer = newContainerId ? currentActor.items.get(newContainerId) : null;
    const isInReducingContainer = newContainer && getReductionPercent(newContainer) > 0;
    const weightChanged = changes.system && 'weight' in changes.system;
    const containerChanged = changes.system && 'container' in changes.system;
    const internalContext = { [INTERNAL_UPDATE_FLAG]: true };

    // --- 3.1 Обработка смены контейнера ---
    if (containerChanged && previousContainerId !== newContainerId) {
        if (wasInReducingContainer && !isInReducingContainer) {
            await restoreOriginalWeight(updatedItem, internalContext);
        } else if (!wasInReducingContainer && isInReducingContainer) {
            await applyWeightReduction(updatedItem, newContainer, internalContext);
        } else if (wasInReducingContainer && isInReducingContainer) {
            await applyWeightReduction(updatedItem, newContainer, internalContext);
        }
    }
    // --- 3.2 Обработка внешнего изменения веса ---
    else if (weightChanged && isInReducingContainer && previousContainerId === newContainerId) {
         const newOriginalWeight = updatedItem.system.weight;
         const currentFlagWeight = getOriginalWeight(updatedItem);

         if (currentFlagWeight === null || Math.abs(currentFlagWeight - newOriginalWeight) > 0.001) {
            console.log(`${MODULE_ID} | External weight change detected for ${updatedItem.name}. Recalculating.`);
            await updatedItem.setFlag(MODULE_ID, FLAG_ORIGINAL_WEIGHT, newOriginalWeight);
            const reductionFactor = 1 - (getReductionPercent(newContainer) / 100);
            const newReducedWeight = Math.max(0, newOriginalWeight * reductionFactor);
            if (Math.abs(updatedItem.system.weight - newReducedWeight) > 0.001) {
                 await updatedItem.update({'system.weight': newReducedWeight}, internalContext);
            }
         }
    }
    // --- 3.3 Обработка консистентности флага ---
    else if (!isInReducingContainer && hadOriginalWeightFlag && !containerChanged) {
        console.warn(`${MODULE_ID} | Item ${updatedItem.name} is not in a reducing container but had flag. Restoring.`);
        await restoreOriginalWeight(updatedItem, internalContext);
    }

    return updatedItem;
}


// --- Fallback Функции для стандартных хуков (если нет libWrapper) ---

/** Fallback: PreCreate */
function onItemPreCreate(item, data, options, userId) {
    if (game.userId !== userId) return true;

    const actor = item.parent; // Actor or null
    // *** CHECK: Skip if no actor ***
    if (!actor) return true;

    const containerId = data.system?.container;
    if (!containerId) return true;

    const containerItem = actor.items.get(containerId);
    if (!containerItem || containerItem.system?.capacity?.type !== 'weight') return true;

    // ... (rest of the logic remains the same)
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
        return false;
    }
    if (reductionPercent > 0 && itemBaseWeight > 0) {
        data.system.weight = reducedWeight;
        foundry.utils.setProperty(data, `flags.${MODULE_ID}.${FLAG_ORIGINAL_WEIGHT}`, itemBaseWeight);
    }
    return true;
}

/** Fallback: PreUpdate */
function onItemPreUpdate(item, changes, options, userId) {
    if (game.userId !== userId || options?.[INTERNAL_UPDATE_FLAG]) return true;

    const actor = item.actor;
    // *** CHECK: Skip if no actor ***
    if (!actor) return true;

    // *** CHECK: Skip if item is a container itself ***
    if (['container', 'backpack'].includes(item.type)) return true;

    const quantityChange = changes.system?.quantity;
    const isQuantityIncrease = typeof quantityChange === 'number' && quantityChange > item.system.quantity;
    const containerId = item.system?.container?.id;

    if (!isQuantityIncrease || !containerId) {
        return true;
    }

    const containerItem = actor.items.get(containerId);
     if (!containerItem || containerItem.system?.capacity?.type !== 'weight') {
        return true;
    }

    // ... (rest of the logic remains the same)
     const containerMaxWeight = containerItem.system.capacity.value ?? 0;
     const currentWeightWithoutItem = calculateContainerContentsWeight(containerItem, actor) - (item.system.weight * item.system.quantity);
     const newItemTotalWeight = item.system.weight * quantityChange;
    if (currentWeightWithoutItem + newItemTotalWeight > containerMaxWeight) {
        ui.notifications.warn(game.i18n.format("WEIGHTY_CONTAINERS.Notifications.CapacityExceeded", { containerName: containerItem.name }));
        delete changes.system.quantity;
        if (foundry.utils.isEmpty(changes.system)) delete changes.system;
        if (foundry.utils.isEmpty(changes)) return false;
        return true;
    }
    return true;
}

/** Fallback: Update */
async function onItemUpdate(item, changes, options, userId) {
     if (game.userId !== userId || options?.[INTERNAL_UPDATE_FLAG] ) return;

    const actor = item.actor;
    // *** CHECK: Skip if no actor ***
    if (!actor) return;

    // *** CHECK: Skip if item is a container itself ***
     if (['container', 'backpack'].includes(item.type)) return;

    const internalContext = { [INTERNAL_UPDATE_FLAG]: true };
    const newContainerId = item.system.container?.id;
    const newContainer = newContainerId ? actor.items.get(newContainerId) : null;
    const isInReducingContainer = newContainer && getReductionPercent(newContainer) > 0;
    const hadOriginalWeightFlag = getOriginalWeight(item) !== null;

    // ... (rest of the logic remains largely the same, relying on actor being present)
     if (changes.system && 'container' in changes.system) {
        const previousContainerId = changes.system.container;
        if (previousContainerId !== newContainerId) {
             const previousContainer = previousContainerId ? actor.items.get(previousContainerId) : null;
             const wasInReducingContainer = previousContainer && getReductionPercent(previousContainer) > 0;
             if (wasInReducingContainer && !isInReducingContainer) {
                 await restoreOriginalWeight(item, internalContext);
             } else if (!wasInReducingContainer && isInReducingContainer) {
                 await applyWeightReduction(item, newContainer, internalContext);
             } else if (wasInReducingContainer && isInReducingContainer) {
                 await applyWeightReduction(item, newContainer, internalContext);
             }
        }
     }
    else if (changes.system && 'weight' in changes.system) {
        if (isInReducingContainer) {
            const originalWeight = getOriginalWeight(item) ?? item.system.weight;
            const reductionFactor = 1 - (getReductionPercent(newContainer) / 100);
            const expectedReducedWeight = Math.max(0, originalWeight * reductionFactor);
            if (Math.abs(item.system.weight - expectedReducedWeight) > 0.001) {
                 console.warn(`${MODULE_ID} | Fallback: Weight inconsistency detected. Re-applying reduction.`);
                 await item.setFlag(MODULE_ID, FLAG_ORIGINAL_WEIGHT, originalWeight);
                 await item.update({'system.weight': expectedReducedWeight}, internalContext);
            }
        } else {
             if (hadOriginalWeightFlag) {
                 await restoreOriginalWeight(item, internalContext);
             }
        }
    }
     else {
         if (!isInReducingContainer && hadOriginalWeightFlag) {
             await restoreOriginalWeight(item, internalContext);
         }
     }
}

// Хук готовности - проверяем предметы при загрузке
Hooks.on('ready', async () => {
    console.log(`${MODULE_ID} | Ready. Checking item weights inside containers.`);
    const actorsToCheck = new Set();
    // Добавлена проверка u.active
    game.users.filter(u => u.character && u.active).forEach(u => actorsToCheck.add(u.character));
    game.scenes.filter(s => s.active).flatMap(s => s.tokens).filter(t => t.actor).forEach(t => actorsToCheck.add(t.actor));

    for (const actor of actorsToCheck) {
        // Добавлена проверка actor.items
        if (!actor?.items) continue;
        const updates = [];
        const itemsToProcess = actor.items.contents; // Get copy
        const internalContext = { [INTERNAL_UPDATE_FLAG]: true };

        for (const item of itemsToProcess) {
             // *** CHECK: Skip if item is a container itself ***
             if (!item || ['container', 'backpack'].includes(item.type)) continue;

            const containerId = item.system.container?.id;
            const originalWeight = getOriginalWeight(item);

            if (!containerId) {
                if (originalWeight !== null) {
                    console.log(`${MODULE_ID} | Ready Check: Restoring weight for ${item.name} (not in container but has flag). Actor: ${actor.name}`);
                    await restoreOriginalWeight(item, internalContext);
                }
                continue;
            }

            const container = actor.items.get(containerId);
            if (!container || container.system?.capacity?.type !== 'weight') {
                 if (originalWeight !== null) {
                    console.log(`${MODULE_ID} | Ready Check: Restoring weight for ${item.name} (invalid container but has flag). Actor: ${actor.name}`);
                     await restoreOriginalWeight(item, internalContext);
                 }
                 continue;
            }

            const reductionPercent = getReductionPercent(container);

            if (reductionPercent > 0) {
                const baseWeight = originalWeight ?? item.system.weight;
                if (baseWeight === 0) {
                     if(originalWeight === null) await item.setFlag(MODULE_ID, FLAG_ORIGINAL_WEIGHT, 0);
                    continue;
                }

                const reductionFactor = 1 - (reductionPercent / 100);
                const expectedReducedWeight = Math.max(0, baseWeight * reductionFactor);
                let needsFlagUpdate = false;
                let needsWeightUpdate = false;

                if (originalWeight === null || Math.abs(originalWeight - baseWeight) > 0.001) {
                    needsFlagUpdate = true;
                }
                if (Math.abs(item.system.weight - expectedReducedWeight) > 0.001) {
                    needsWeightUpdate = true;
                }

                if (needsFlagUpdate) {
                    await item.setFlag(MODULE_ID, FLAG_ORIGINAL_WEIGHT, baseWeight);
                }
                if (needsWeightUpdate) {
                     console.log(`${MODULE_ID} | Ready Check: Correcting weight for ${item.name} in ${container.name}. Expected: ${expectedReducedWeight}, Actual: ${item.system.weight}. Actor: ${actor.name}`);
                    updates.push({ _id: item.id, 'system.weight': expectedReducedWeight });
                }

            } else {
                if (originalWeight !== null) {
                    console.log(`${MODULE_ID} | Ready Check: Restoring weight for ${item.name} (no reduction but flag exists). Actor: ${actor.name}`);
                    await restoreOriginalWeight(item, internalContext);
                }
            }
        } // конец цикла по предметам актора

        if (updates.length > 0) {
            console.log(`${MODULE_ID} | Applying ${updates.length} weight corrections for actor ${actor.name}`);
            try {
                await actor.updateEmbeddedDocuments("Item", updates, internalContext);
            } catch (err) {
                 console.error(`${MODULE_ID} | Error applying batch updates for actor ${actor.name}:`, err);
            }
        }
    } // конец цикла по акторам
     console.log(`${MODULE_ID} | Initial weight check complete.`);
});