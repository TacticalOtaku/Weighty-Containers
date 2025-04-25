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
    // Добавляем флаг в контекст при обновлении
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
    const originalWeight = getOriginalWeight(item);

    if (originalWeight === null) return; // Нет флага - нечего восстанавливать

    // Удаляем флаг ДО обновления веса
    await item.unsetFlag(MODULE_ID, FLAG_ORIGINAL_WEIGHT);

    // Обновляем вес только если он отличается от оригинального
    if (Math.abs(item.system.weight - originalWeight) > 0.001) {
        console.log(`${MODULE_ID} | Restoring original weight for ${item.name}. Original: ${originalWeight}`);
        // Добавляем флаг в контекст при обновлении
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
        // *** ОДНА регистрация для Item.update ***
        libWrapper.register(MODULE_ID, 'CONFIG.Item.documentClass.prototype.update', combinedItemUpdateHandler, 'WRAPPER');
    } else {
        Hooks.on('preCreateItem', onItemPreCreate);
        Hooks.on('preUpdateItem', onItemPreUpdate);
        Hooks.on('updateItem', onItemUpdate); // Fallback обработчик после обновления
    }
});

// Хук для добавления элементов на лист контейнера
Hooks.on('renderItemSheet5e', (app, html, data) => {
    if (!['container', 'backpack'].includes(data.item?.type) || data.item?.system?.capacity?.type !== 'weight') {
        return;
    }

    const item = app.object;
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
            const currentVal = getReductionPercent(item);

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
                            const inputVal = html.find('input[name="reductionPercent"]').val();
                            const newPercentage = parseInt(inputVal, 10);

                            if (isNaN(newPercentage) || newPercentage < 0 || newPercentage > 100) {
                                ui.notifications.warn(game.i18n.localize("WEIGHTY_CONTAINERS.Notifications.InvalidPercentage"));
                                return false;
                            }

                            console.log(`${MODULE_ID} | Setting reduction for ${item.name} to ${newPercentage}%`);
                            await item.setFlag(MODULE_ID, FLAG_REDUCTION_PERCENT, newPercentage);
                             await updateContainedItemsWeight(item.actor, item, newPercentage);
                             // Лист должен перерисоваться сам из-за изменения флага
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
    if (!actor) return;
    const containedItems = actor.items.filter(i => i.system.container?.id === containerItem.id);
    const updates = [];
    const reductionFactor = 1 - (newReductionPercent / 100);
    const internalContext = { [INTERNAL_UPDATE_FLAG]: true }; // Контекст для обновлений

    for (const item of containedItems) {
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

        // Сохраняем/обновляем/удаляем флаг
        if (newReductionPercent > 0) {
            // Устанавливаем флаг, если он еще не установлен или неверен
            if(originalWeight === null || Math.abs(originalWeight - baseWeightForCalc) > 0.001) {
                 await item.setFlag(MODULE_ID, FLAG_ORIGINAL_WEIGHT, baseWeightForCalc);
            }
        } else if (originalWeight !== null) {
             // Удаляем флаг, если редукция 0%
             await item.unsetFlag(MODULE_ID, FLAG_ORIGINAL_WEIGHT);
        }

        // Готовим обновление веса, если он изменился
        if (Math.abs(item.system.weight - newWeight) > 0.001) {
            updates.push({ _id: item.id, 'system.weight': newWeight });
        }
    }

    if (updates.length > 0) {
        // Применяем все обновления веса разом с внутренним флагом
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

    const actor = this;
    const itemsToCreate = [];
    let capacityBlocked = false;

    for (const itemData of data) {
        const containerId = itemData.system?.container;
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

        let itemBaseWeight = itemData.system?.weight ?? 0; // Оригинальный вес из данных
        const quantity = itemData.system?.quantity ?? 1;
        const reductionPercent = getReductionPercent(containerItem);
        let reducedWeight = itemBaseWeight; // По умолчанию вес равен базовому

        if (reductionPercent > 0 && itemBaseWeight > 0) {
            reducedWeight = Math.max(0, itemBaseWeight * (1 - reductionPercent / 100));
        }
        const addedWeight = reducedWeight * quantity;

        if (currentWeight + addedWeight > containerMaxWeight) {
            ui.notifications.warn(game.i18n.format("WEIGHTY_CONTAINERS.Notifications.CapacityExceeded", { containerName: containerItem.name }));
            capacityBlocked = true;
        } else {
             // Модифицируем данные перед добавлением к созданию
             if (reductionPercent > 0 && itemBaseWeight > 0) {
                 itemData.system.weight = reducedWeight; // Устанавливаем сниженный вес
                 // Устанавливаем флаг оригинального веса
                 foundry.utils.setProperty(itemData, `flags.${MODULE_ID}.${FLAG_ORIGINAL_WEIGHT}`, itemBaseWeight);
             }
            itemsToCreate.push(itemData);
        }
    }

    if (capacityBlocked) {
        if (itemsToCreate.length === 0) return [];
        // Вызываем оригинал только с разрешенными и модифицированными данными
        return wrapped(embeddedName, itemsToCreate, context);
    } else {
        // Все разрешены, вызываем оригинал (данные могли быть модифицированы)
        return wrapped(embeddedName, data, context);
    }
}

/**
 * Единый обработчик для Item.update (libWrapper).
 * Выполняет проверку вместимости ДО обновления и обработку смены контейнера/веса ПОСЛЕ.
 * @param {function} wrapped Оригинальный метод Item.update.
 * @param {object} changes Данные для обновления.
 * @param {object} context Опции обновления.
 * @returns {Promise<Item5e>}
 */
async function combinedItemUpdateHandler(wrapped, changes, context) {
    // --- 1. Логика ПРОВЕРКИ ВМЕСТИМОСТИ (ДО вызова wrapped) ---
    const item = this; // this === Item до обновления
    const actor = item.actor;

    // Проверяем только если:
    // - изменяется количество НА УВЕЛИЧЕНИЕ
    // - предмет в контейнере с весовым лимитом
    // - это НЕ внутреннее обновление модуля
    const quantityChange = changes.system?.quantity;
    const isQuantityIncrease = typeof quantityChange === 'number' && quantityChange > item.system.quantity;
    const containerId = item.system?.container?.id;

    if (actor && isQuantityIncrease && containerId && !context?.[INTERNAL_UPDATE_FLAG]) {
        const containerItem = actor.items.get(containerId);
        if (containerItem && containerItem.system?.capacity?.type === 'weight') {
            const containerMaxWeight = containerItem.system.capacity.value ?? 0;
            // Используем текущий (сниженный) вес
            const currentWeightWithoutItem = calculateContainerContentsWeight(containerItem, actor) - (item.system.weight * item.system.quantity);
            const newItemTotalWeight = item.system.weight * quantityChange; // Вес с новым количеством

            if (currentWeightWithoutItem + newItemTotalWeight > containerMaxWeight) {
                ui.notifications.warn(game.i18n.format("WEIGHTY_CONTAINERS.Notifications.CapacityExceeded", { containerName: containerItem.name }));
                // Отменяем ТОЛЬКО изменение количества, чтобы не сломать другие изменения
                delete changes.system.quantity;
                if (foundry.utils.isEmpty(changes.system)) delete changes.system;
                // Если не осталось изменений, просто возвращаем исходный предмет
                if (foundry.utils.isEmpty(changes)) return item;
                // Иначе продолжаем с оставшимися изменениями ниже
            }
        }
    }

    // --- 2. Вызов оригинального метода update ---
    // Запоминаем состояние ДО обновления для сравнения ПОСЛЕ
    const previousContainerId = item.system.container?.id;
    const previousWeight = item.system.weight;
    const wasInReducingContainer = previousContainerId && getReductionPercent(actor?.items?.get(previousContainerId)) > 0;
    const hadOriginalWeightFlag = getOriginalWeight(item) !== null;

    // Выполняем обновление
    const updatedItem = await wrapped(changes, context);

    // --- 3. Логика ПОСЛЕ обновления (с использованием updatedItem) ---
    const currentActor = updatedItem.actor; // Actor может измениться при переносе между персонажами
    if (!currentActor || context?.[INTERNAL_UPDATE_FLAG]) {
        // Если нет актора или это внутреннее обновление, выходим
        return updatedItem;
    }

    const newContainerId = updatedItem.system.container?.id;
    const newContainer = newContainerId ? currentActor.items.get(newContainerId) : null;
    const isInReducingContainer = newContainer && getReductionPercent(newContainer) > 0;
    const weightChanged = changes.system && 'weight' in changes.system;
    const containerChanged = changes.system && 'container' in changes.system;

    // --- 3.1 Обработка смены контейнера ---
    if (containerChanged && previousContainerId !== newContainerId) {
        const internalContext = { [INTERNAL_UPDATE_FLAG]: true };

        if (wasInReducingContainer && !isInReducingContainer) {
            // Переместили ИЗ редукции -> Восстановить вес
            await restoreOriginalWeight(updatedItem, internalContext);
        } else if (!wasInReducingContainer && isInReducingContainer) {
            // Переместили В редукцию -> Применить редукцию
            await applyWeightReduction(updatedItem, newContainer, internalContext);
        } else if (wasInReducingContainer && isInReducingContainer) {
            // Переместили ИЗ редукции В редукцию -> Пересчитать редукцию
            // Важно: applyWeightReduction берет вес из флага или ТЕКУЩИЙ вес updatedItem
            // Если вес не менялся внешне, то текущий вес - это старый редуцированный.
            // Нужно убедиться, что applyWeightReduction использует оригинальный вес из флага.
            await applyWeightReduction(updatedItem, newContainer, internalContext);
        }
        // else: !wasInReducingContainer && !isInReducingContainer -> ничего не делаем
    }
    // --- 3.2 Обработка внешнего изменения веса предмета, когда он УЖЕ в контейнере с редукцией ---
    // Срабатывает, только если контейнер НЕ менялся в этом же обновлении
    else if (weightChanged && isInReducingContainer && previousContainerId === newContainerId) {
         // Внешнее изменение веса (не нашим модулем). Считаем, что новый вес - это новый ОРИГИНАЛЬНЫЙ вес.
         const newOriginalWeight = updatedItem.system.weight; // Вес после wrapped()
         const currentFlagWeight = getOriginalWeight(updatedItem);

         // Только если новый вес отличается от сохраненного во флаге (или флага нет)
         if (currentFlagWeight === null || Math.abs(currentFlagWeight - newOriginalWeight) > 0.001) {
            console.log(`${MODULE_ID} | External weight change detected for ${updatedItem.name} inside container. Recalculating reduced weight.`);
            const internalContext = { [INTERNAL_UPDATE_FLAG]: true };
            // Сначала установим флаг с новым оригинальным весом
            await updatedItem.setFlag(MODULE_ID, FLAG_ORIGINAL_WEIGHT, newOriginalWeight);
            // Теперь пересчитаем и применим редуцированный вес
            const reductionFactor = 1 - (getReductionPercent(newContainer) / 100);
            const newReducedWeight = Math.max(0, newOriginalWeight * reductionFactor);
            // Обновляем вес, если он отличается от только что установленного
            if (Math.abs(updatedItem.system.weight - newReducedWeight) > 0.001) {
                 await updatedItem.update({'system.weight': newReducedWeight}, internalContext);
            }
         }
    }
    // --- 3.3 Обработка случая, когда предмет БЕЗ редукции, но у него остался флаг ---
    // (например, баг или предыдущее состояние)
    else if (!isInReducingContainer && hadOriginalWeightFlag && !containerChanged) {
        // Предмет не в редуцирующем контейнере, но флаг есть. Восстановим вес.
        console.warn(`${MODULE_ID} | Item ${updatedItem.name} is not in a reducing container but had a weight reduction flag. Restoring original weight.`);
        await restoreOriginalWeight(updatedItem, { [INTERNAL_UPDATE_FLAG]: true });
    }


    return updatedItem; // Возвращаем обновленный предмет
}


// --- Fallback Функции для стандартных хуков (если нет libWrapper) ---

/**
 * Fallback: Проверка вместимости перед созданием предмета.
 */
function onItemPreCreate(item, data, options, userId) {
    if (game.userId !== userId) return true;

    const actor = item.parent;
    const containerId = data.system?.container;
    if (!actor || !containerId) return true;

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
        return false; // Отменить создание
    }

    // Модифицируем данные ПЕРЕД созданием
    if (reductionPercent > 0 && itemBaseWeight > 0) {
        data.system.weight = reducedWeight; // Устанавливаем сниженный вес
        foundry.utils.setProperty(data, `flags.${MODULE_ID}.${FLAG_ORIGINAL_WEIGHT}`, itemBaseWeight);
    }

    return true;
}

/**
 * Fallback: Проверка вместимости перед обновлением (изменение количества).
 */
function onItemPreUpdate(item, changes, options, userId) {
    if (game.userId !== userId || options?.[INTERNAL_UPDATE_FLAG]) return true;

    const actor = item.actor;
    const quantityChange = changes.system?.quantity;
    const isQuantityIncrease = typeof quantityChange === 'number' && quantityChange > item.system.quantity;
    const containerId = item.system?.container?.id;

    if (!actor || !isQuantityIncrease || !containerId) {
        return true;
    }

    const containerItem = actor.items.get(containerId);
     if (!containerItem || containerItem.system?.capacity?.type !== 'weight') {
        return true;
    }

     const containerMaxWeight = containerItem.system.capacity.value ?? 0;
     const currentWeightWithoutItem = calculateContainerContentsWeight(containerItem, actor) - (item.system.weight * item.system.quantity);
     const newItemTotalWeight = item.system.weight * quantityChange;

    if (currentWeightWithoutItem + newItemTotalWeight > containerMaxWeight) {
        ui.notifications.warn(game.i18n.format("WEIGHTY_CONTAINERS.Notifications.CapacityExceeded", { containerName: containerItem.name }));
        // Отменяем ТОЛЬКО изменение количества
        delete changes.system.quantity;
        if (foundry.utils.isEmpty(changes.system)) delete changes.system;
        if (foundry.utils.isEmpty(changes)) return false; // Полностью отменяем, если не осталось изменений
        return true; // Иначе позволяем другим изменениям пройти
    }

    return true;
}

/**
 * Fallback: Обработка изменений после обновления предмета (смена контейнера или веса).
 * Этот хук менее надежен, чем libWrapper, особенно для внешних изменений веса.
 */
async function onItemUpdate(item, changes, options, userId) {
     if (game.userId !== userId || options?.[INTERNAL_UPDATE_FLAG] ) return;

    const actor = item.actor;
    if (!actor) return;

    const internalContext = { [INTERNAL_UPDATE_FLAG]: true };
    const newContainerId = item.system.container?.id;
    const newContainer = newContainerId ? actor.items.get(newContainerId) : null;
    const isInReducingContainer = newContainer && getReductionPercent(newContainer) > 0;
    const hadOriginalWeightFlag = getOriginalWeight(item) !== null; // Проверяем флаг на уже обновленном item

    // 1. Проверка смены контейнера
     if (changes.system && 'container' in changes.system) {
        const previousContainerId = changes.system.container; // ID старого контейнера

        if (previousContainerId !== newContainerId) {
             const previousContainer = previousContainerId ? actor.items.get(previousContainerId) : null;
             const wasInReducingContainer = previousContainer && getReductionPercent(previousContainer) > 0;

             if (wasInReducingContainer && !isInReducingContainer) {
                 await restoreOriginalWeight(item, internalContext);
             } else if (!wasInReducingContainer && isInReducingContainer) {
                 await applyWeightReduction(item, newContainer, internalContext);
             } else if (wasInReducingContainer && isInReducingContainer) {
                 // Пересчитываем редукцию
                 await applyWeightReduction(item, newContainer, internalContext);
             }
        }
     }
    // 2. Проверка изменения веса (менее надежно без libWrapper)
    // Мы не можем точно знать, было ли это внешнее изменение или наше собственное
    // Просто проверяем консистентность: если в редукции, вес должен быть снижен, иначе - оригинальным
    else if (changes.system && 'weight' in changes.system) {
        if (isInReducingContainer) {
            // Если вес изменился и он не равен ожидаемому редуцированному весу -> пересчитать
            const originalWeight = getOriginalWeight(item) ?? item.system.weight; // Берем из флага или новый вес как базу
            const reductionFactor = 1 - (getReductionPercent(newContainer) / 100);
            const expectedReducedWeight = Math.max(0, originalWeight * reductionFactor);

            if (Math.abs(item.system.weight - expectedReducedWeight) > 0.001) {
                 console.warn(`${MODULE_ID} | Fallback: Weight inconsistency detected for ${item.name}. Re-applying reduction.`);
                 // Установим флаг на всякий случай
                 await item.setFlag(MODULE_ID, FLAG_ORIGINAL_WEIGHT, originalWeight);
                 await item.update({'system.weight': expectedReducedWeight}, internalContext);
            }
        } else {
             // Если не в редукции, но флаг есть -> восстановить
             if (hadOriginalWeightFlag) {
                 await restoreOriginalWeight(item, internalContext);
             }
        }
    }
     // 3. Проверка консистентности флага вне смены контейнера/веса
     else {
         if (!isInReducingContainer && hadOriginalWeightFlag) {
             await restoreOriginalWeight(item, internalContext);
         }
         // Случай isInReducingContainer без флага сложнее обработать в fallback
     }
}

// Хук готовности - проверяем предметы при загрузке
Hooks.on('ready', async () => {
    console.log(`${MODULE_ID} | Ready. Checking item weights inside containers.`);
    const actorsToCheck = new Set();
    game.users.filter(u => u.character && u.active).forEach(u => actorsToCheck.add(u.character));
    game.scenes.filter(s => s.active).flatMap(s => s.tokens).filter(t => t.actor).forEach(t => actorsToCheck.add(t.actor));

    for (const actor of actorsToCheck) {
        if (!actor.items) continue; // Пропускаем, если у актора нет предметов (например, неинициализированный)
        const updates = [];
        const itemsToProcess = actor.items.contents;
        const internalContext = { [INTERNAL_UPDATE_FLAG]: true };

        for (const item of itemsToProcess) {
            const containerId = item.system.container?.id;
            const originalWeight = getOriginalWeight(item); // null or number

            if (!containerId) {
                // НЕ в контейнере, но флаг есть -> восстановить
                if (originalWeight !== null) {
                    console.log(`${MODULE_ID} | Ready Check: Restoring weight for ${item.name} (not in container but has flag).`);
                    await restoreOriginalWeight(item, internalContext); // Делает update сам
                }
                continue;
            }

            const container = actor.items.get(containerId);
            if (!container || container.system?.capacity?.type !== 'weight') {
                 // В невалидном контейнере, но флаг есть -> восстановить
                 if (originalWeight !== null) {
                    console.log(`${MODULE_ID} | Ready Check: Restoring weight for ${item.name} (invalid container but has flag).`);
                     await restoreOriginalWeight(item, internalContext);
                 }
                 continue;
            }

            // В валидном контейнере с весовым лимитом
            const reductionPercent = getReductionPercent(container);

            if (reductionPercent > 0) {
                // Контейнер С редукцией
                const baseWeight = originalWeight ?? item.system.weight; // Берем из флага или текущий
                if (baseWeight === 0) { // Не обрабатываем предметы с нулевым весом, кроме установки флага
                     if(originalWeight === null) await item.setFlag(MODULE_ID, FLAG_ORIGINAL_WEIGHT, 0);
                    continue;
                }

                const reductionFactor = 1 - (reductionPercent / 100);
                const expectedReducedWeight = Math.max(0, baseWeight * reductionFactor);

                let needsFlagUpdate = false;
                let needsWeightUpdate = false;

                // Проверяем флаг
                if (originalWeight === null || Math.abs(originalWeight - baseWeight) > 0.001) {
                    needsFlagUpdate = true;
                }
                // Проверяем вес
                if (Math.abs(item.system.weight - expectedReducedWeight) > 0.001) {
                    needsWeightUpdate = true;
                }

                // Применяем обновления, если нужны
                if (needsFlagUpdate) {
                    await item.setFlag(MODULE_ID, FLAG_ORIGINAL_WEIGHT, baseWeight);
                }
                if (needsWeightUpdate) {
                     console.log(`${MODULE_ID} | Ready Check: Correcting weight for ${item.name} in container ${container.name}. Expected: ${expectedReducedWeight}, Actual: ${item.system.weight}`);
                    updates.push({ _id: item.id, 'system.weight': expectedReducedWeight });
                }

            } else {
                // Контейнер БЕЗ редукции
                // Если есть флаг -> восстановить вес
                if (originalWeight !== null) {
                    console.log(`${MODULE_ID} | Ready Check: Restoring weight for ${item.name} (container has no reduction but flag exists).`);
                    await restoreOriginalWeight(item, internalContext);
                }
            }
        } // конец цикла по предметам актора

        if (updates.length > 0) {
            console.log(`${MODULE_ID} | Applying ${updates.length} weight corrections for actor ${actor.name}`);
            await actor.updateEmbeddedDocuments("Item", updates, internalContext);
        }
    } // конец цикла по акторам
     console.log(`${MODULE_ID} | Initial weight check complete.`);
});