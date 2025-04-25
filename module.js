const MODULE_ID = 'weighty-containers';
const FLAG_REDUCTION_PERCENT = 'weightReductionPercent'; // Флаг для процента снижения
const FLAG_ORIGINAL_WEIGHT = 'originalWeight'; // Флаг для хранения оригинального веса предмета

// --- ФУНКЦИИ ХЕЛПЕРЫ ---

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
        // Предмет находится внутри нужного контейнера?
        if (item.system.container?.id !== containerItem.id) {
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
 * @returns {Promise<void>}
 */
async function applyWeightReduction(item, containerItem) {
    const reductionPercent = getReductionPercent(containerItem);
    if (reductionPercent <= 0 || reductionPercent > 100) return; // Нет снижения или некорректный процент

    const originalWeight = getOriginalWeight(item) ?? item.system.weight; // Берем из флага, если есть, иначе текущий
    const currentWeight = item.system.weight;
    const reductionFactor = 1 - (reductionPercent / 100);
    const reducedWeight = Math.max(0, originalWeight * reductionFactor); // Вес не может быть отрицательным

    // Не обновляем, если вес уже снижен и не изменился (или если оригинальный вес 0)
    if (originalWeight === 0 || Math.abs(currentWeight - reducedWeight) < 0.001) {
        // Если оригинальный вес был 0, но флаг не стоял, поставим его для консистентности
         if (originalWeight === 0 && getOriginalWeight(item) === null) {
             await item.setFlag(MODULE_ID, FLAG_ORIGINAL_WEIGHT, 0);
         }
        return;
    }

    console.log(`${MODULE_ID} | Applying reduction (${reductionPercent}%) to ${item.name}. Original: ${originalWeight}, New: ${reducedWeight}`);
    // Сначала устанавливаем флаг, потом обновляем вес
    await item.setFlag(MODULE_ID, FLAG_ORIGINAL_WEIGHT, originalWeight);
    await item.update({'system.weight': reducedWeight});
}

/**
 * Восстанавливает оригинальный вес предмета, если он покидает контейнер со снижением.
 * Удаляет флаг оригинального веса.
 * @param {Item5e} item - Предмет, для которого восстанавливается вес.
 * @returns {Promise<void>}
 */
async function restoreOriginalWeight(item) {
    const originalWeight = getOriginalWeight(item);

    // Если флага нет или вес уже совпадает с оригинальным, ничего не делаем
    if (originalWeight === null || Math.abs(item.system.weight - originalWeight) < 0.001) {
        // На всякий случай удалим флаг, если он есть, но вес совпадает
        if (originalWeight !== null) {
            await item.unsetFlag(MODULE_ID, FLAG_ORIGINAL_WEIGHT);
        }
        return;
    }

    console.log(`${MODULE_ID} | Restoring original weight for ${item.name}. Original: ${originalWeight}`);
    // Сначала обновляем вес, потом удаляем флаг
    await item.update({'system.weight': originalWeight});
    await item.unsetFlag(MODULE_ID, FLAG_ORIGINAL_WEIGHT);
}


// --- ХУКИ FOUNDRY VTT ---

Hooks.once('init', () => {
    console.log(`${MODULE_ID} | Initializing Container Weight Manager`);

    // Регистрация настроек
    game.settings.register(MODULE_ID, 'gmOnlyButton', {
        name: game.i18n.localize("CWM.SETTINGS.gmOnlyButton"),
        hint: game.i18n.localize("CWM.SETTINGS.gmOnlyButtonHint"),
        scope: 'world',     // Настройка на уровне мира
        config: true,       // Показывать в меню настроек модуля
        type: Boolean,
        default: true,      // По умолчанию кнопка только для GM
        requiresReload: false // Не требует перезагрузки для применения визуально
    });

    // --- Перехват методов для управления весом ---
    // Используем libWrapper, если он активен, для лучшей совместимости
    if (game.modules.get('lib-wrapper')?.active) {
        // Переопределение метода расчета веса инвентаря актора (если понадобится)
        // Пока не будем этого делать, т.к. изменение system.weight должно сработать
        // Если возникнут проблемы с отображением общего веса, нужно будет добавить:
        // libWrapper.register(MODULE_ID, 'CONFIG.Actor.documentClass.prototype._prepareInventoryWeight', function(wrapped, items) { ... });

        // Перехват создания и обновления для проверки вместимости
        libWrapper.register(MODULE_ID, 'CONFIG.Actor.documentClass.prototype.createEmbeddedDocuments', checkCapacityOnCreate, 'MIXED');
        libWrapper.register(MODULE_ID, 'CONFIG.Item.documentClass.prototype.update', checkCapacityOnUpdate, 'MIXED');

        // Перехват для применения/снятия редукции при изменении контейнера
        libWrapper.register(MODULE_ID, 'CONFIG.Item.documentClass.prototype.update', handleItemContainerChange, 'WRAPPER');

    } else {
         // Fallback на стандартные хуки, если libWrapper не активен
        Hooks.on('preCreateItem', onItemPreCreate); // Проверка перед созданием
        Hooks.on('preUpdateItem', onItemPreUpdate); // Проверка перед обновлением
        Hooks.on('updateItem', onItemUpdate);       // Действия после обновления (смена контейнера)
        // Hooks.on('createItem', onItemCreate); // Можно использовать для первоначального применения редукции, но updateItem надежнее
    }
});

// Хук для добавления элементов на лист контейнера
Hooks.on('renderItemSheet5e', (app, html, data) => {
    // Интересуют только листы КОНТЕЙНЕРОВ (тип 'container' или 'backpack')
    // И только те, у которых есть ВЕСОВАЯ вместимость
    if (!['container', 'backpack'].includes(data.item?.type) || data.item?.system?.capacity?.type !== 'weight') {
        return;
    }

    const item = app.object; // Получаем объект Item из приложения листа
    const currentReduction = getReductionPercent(item);
    const canConfigure = game.user.isGM || !game.settings.get(MODULE_ID, 'gmOnlyButton');

    // Определение класса редкости для цвета
    let rarityClass = 'cwm-reduction-common';
    if (currentReduction >= 95) rarityClass = 'cwm-reduction-artifact';
    else if (currentReduction >= 85) rarityClass = 'cwm-reduction-legendary';
    else if (currentReduction >= 70) rarityClass = 'cwm-reduction-veryrare';
    else if (currentReduction >= 50) rarityClass = 'cwm-reduction-rare';
    else if (currentReduction > 0) rarityClass = 'cwm-reduction-uncommon';

    // HTML для отображения процента
    const displayHtml = `
        <div class="cwm-weight-reduction-display ${rarityClass}" title="${game.i18n.format(`CWM.Rarity.${rarityClass.split('-')[2].charAt(0).toUpperCase() + rarityClass.split('-')[2].slice(1)}`)}">
            <span class="cwm-label">${game.i18n.localize("CWM.ContainerSheet.WeightReduction")}: </span>
            <span class="cwm-percentage">${currentReduction}%</span>
        </div>
    `;

    // HTML для кнопки (если разрешено)
    const buttonHtml = canConfigure ? `
        <button type="button" class="cwm-configure-button" title="${game.i18n.localize("CWM.ContainerSheet.ConfigureReduction")}">
            <i class="fas fa-cog"></i>
        </button>
    ` : '';

     // Обертка для выравнивания
    const controlsContainerHtml = `
        <div class="cwm-controls-container">
            ${displayHtml}
            ${buttonHtml}
        </div>
    `;

    // --- Внедрение HTML на лист ---
    // Ищем подходящее место. Попробуем вставить после поля "Capacity Weight"
    // Селекторы могут измениться в будущих версиях dnd5e, нужно быть осторожным
    const capacityWeightInput = html.find('input[name="system.capacity.value"]');
    let targetElement = capacityWeightInput.closest('.form-group'); // Родительская группа формы

    // Если не нашли стандартное поле веса (может быть кастомный лист?), попробуем найти заголовок Details
    if (!targetElement.length) {
         targetElement = html.find('.tab[data-tab="details"]'); // Вкладка Details
         if (targetElement.length) {
             targetElement.prepend(controlsContainerHtml); // Вставить в начало вкладки
         } else {
             // Крайний случай: вставить в начало формы
              html.find('form').first().prepend(controlsContainerHtml);
         }
    } else {
         // Вставляем ПОСЛЕ группы с весом
        targetElement.after(controlsContainerHtml);
    }


    // --- Добавление обработчика для кнопки ---
    if (canConfigure) {
        html.find('.cwm-configure-button').on('click', async (event) => {
            event.preventDefault();
            const currentVal = getReductionPercent(item);

            // Используем Dialog для ввода значения
            new Dialog({
                title: game.i18n.localize("CWM.Dialog.SetReductionTitle"),
                content: `
                    <form>
                        <div class="form-group">
                            <label>${game.i18n.localize("CWM.Dialog.SetReductionLabel")}</label>
                            <div class="form-fields">
                                <input type="number" name="reductionPercent" value="${currentVal}" min="0" max="100" step="1"/>
                            </div>
                            <p class="notes">${game.i18n.localize("CWM.Dialog.SetReductionHint")}</p>
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
                                ui.notifications.warn(game.i18n.localize("CWM.Notifications.InvalidPercentage"));
                                return false; // Предотвратить закрытие диалога
                            }

                            console.log(`${MODULE_ID} | Setting reduction for ${item.name} to ${newPercentage}%`);
                            await item.setFlag(MODULE_ID, FLAG_REDUCTION_PERCENT, newPercentage);
                            // Пересчитать вес всех предметов ВНУТРИ контейнера после изменения процента
                             await updateContainedItemsWeight(item.actor, item, newPercentage);
                            // Не обязательно перерисовывать лист, если обновление флага само вызывает ререндер
                             // app.render(true); // Можно раскомментировать, если авто-ререндер не сработает
                        }
                    },
                    cancel: {
                        icon: '<i class="fas fa-times"></i>',
                        label: game.i18n.localize("Cancel")
                    }
                },
                default: 'save',
                render: html => {
                     // Фокус на поле ввода при открытии диалога
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

    for (const item of containedItems) {
        const originalWeight = getOriginalWeight(item) ?? item.system.weight; // Берем оригинал, если есть, иначе текущий
        if (originalWeight === null) continue; // Не трогаем предметы без флага (значит, они не были под редукцией ранее)

        const newWeight = Math.max(0, originalWeight * reductionFactor);

        // Сохраняем оригинальный вес (даже если он не изменился)
        await item.setFlag(MODULE_ID, FLAG_ORIGINAL_WEIGHT, originalWeight);

        // Если вес реально нужно изменить
        if (Math.abs(item.system.weight - newWeight) > 0.001) {
            updates.push({ _id: item.id, 'system.weight': newWeight });
        } else if (newReductionPercent === 0) {
             // Если редукция стала 0, а вес и так был оригинальным, просто удалим флаг
             await item.unsetFlag(MODULE_ID, FLAG_ORIGINAL_WEIGHT);
        }
    }

    if (updates.length > 0) {
        await actor.updateEmbeddedDocuments("Item", updates);
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
        return wrapped(embeddedName, data, context); // Пропускаем, если не предметы
    }

    const actor = this; // this === Actor
    const itemsToCreate = [];
    let capacityBlocked = false;

    for (const itemData of data) {
        const containerId = itemData.system?.container;
        if (!containerId) {
            itemsToCreate.push(itemData); // Предмет не в контейнере, пропускаем проверку
            continue;
        }

        const containerItem = actor.items.get(containerId);
        if (!containerItem || containerItem.system?.capacity?.type !== 'weight') {
            itemsToCreate.push(itemData); // Нет контейнера или не весовая вместимость
            continue;
        }

        const containerMaxWeight = containerItem.system.capacity.value ?? 0;
        const currentWeight = calculateContainerContentsWeight(containerItem, actor);

        // Рассчитываем вес добавляемого предмета (с учетом возможного снижения в этом контейнере)
        let itemWeight = itemData.system?.weight ?? 0;
        const quantity = itemData.system?.quantity ?? 1;
        const reductionPercent = getReductionPercent(containerItem);
        if (reductionPercent > 0) {
            itemWeight = Math.max(0, itemWeight * (1 - reductionPercent / 100));
        }
        const addedWeight = itemWeight * quantity;

        if (currentWeight + addedWeight > containerMaxWeight) {
            ui.notifications.warn(game.i18n.format("CWM.Notifications.CapacityExceeded", { containerName: containerItem.name }));
            capacityBlocked = true;
             // Не добавляем этот itemData в itemsToCreate
        } else {
            itemsToCreate.push(itemData); // Проверка пройдена, добавляем к созданию
        }
    }

    // Если хотя бы один предмет был заблокирован, нужно вернуть результат только для разрешенных
    if (capacityBlocked) {
        if (itemsToCreate.length === 0) return []; // Ничего не создаем
        // Вызываем оригинальный метод только с разрешенными предметами
        return wrapped(embeddedName, itemsToCreate, context);
    } else {
        // Все предметы прошли проверку, вызываем оригинальный метод без изменений
        return wrapped(embeddedName, data, context);
    }
}

/**
 * Проверка вместимости при обновлении предмета (изменение количества) (libWrapper).
 * @param {function} wrapped Оригинальный метод.
 * @param {object} changes Данные для обновления.
 * @param {object} context Опции обновления.
 * @returns {Promise<Item5e>}
 */
async function checkCapacityOnUpdate(wrapped, changes, context) {
    const item = this; // this === Item
    const actor = item.actor;

    // Проверяем только если изменяется количество и предмет находится в контейнере с весовым лимитом
    const quantityChange = changes.system?.quantity;
    const container = item.system?.container; // Текущий контейнер

    if (!actor || typeof quantityChange !== 'number' || !container || quantityChange <= item.system.quantity) {
         // Если кол-во не меняется, или уменьшается, или нет актора/контейнера - пропускаем проверку
        return wrapped(changes, context);
    }

    const containerItem = actor.items.get(container.id);
    if (!containerItem || containerItem.system?.capacity?.type !== 'weight') {
        return wrapped(changes, context); // Не тот контейнер
    }

    const containerMaxWeight = containerItem.system.capacity.value ?? 0;
    // Рассчитываем ТЕКУЩИЙ вес БЕЗ этого предмета
    const currentWeightWithoutItem = calculateContainerContentsWeight(containerItem, actor) - (item.system.weight * item.system.quantity);

    // Рассчитываем вес этого предмета с НОВЫМ количеством
    // Используем ТЕКУЩИЙ (возможно, сниженный) вес предмета
    const newItemTotalWeight = item.system.weight * quantityChange;

    if (currentWeightWithoutItem + newItemTotalWeight > containerMaxWeight) {
        ui.notifications.warn(game.i18n.format("CWM.Notifications.CapacityExceeded", { containerName: containerItem.name }));
        // Предотвращаем обновление, возвращая сам объект item без изменений
        // Или можно выбросить ошибку, но это может быть жестко
         // throw new Error("Capacity Exceeded"); // Вариант с ошибкой
         return item; // Просто не применяем изменения (более мягкий вариант)
    }

    // Вместимость позволяет, продолжаем обновление
    return wrapped(changes, context);
}

/**
 * Обработка смены контейнера предмета (libWrapper).
 * Применяет/снимает редукцию веса.
 * @param {function} wrapped Оригинальный метод.
 * @param {object} changes Данные для обновления.
 * @param {object} context Опции обновления.
 * @returns {Promise<Item5e>}
 */
async function handleItemContainerChange(wrapped, changes, context) {
     // Сначала выполняем оригинальное обновление
     const updatedItem = await wrapped(changes, context);

    // Проверяем, изменился ли контейнер
    if (changes.system && 'container' in changes.system && updatedItem?.actor) {
        const actor = updatedItem.actor;
        const previousContainerId = this.system.container?.id; // Контейнер ДО обновления
        const newContainerId = updatedItem.system.container?.id; // Контейнер ПОСЛЕ обновления

        if (previousContainerId !== newContainerId) {
            const previousContainer = actor.items.get(previousContainerId);
            const newContainer = actor.items.get(newContainerId);

            const hadReduction = previousContainer && getReductionPercent(previousContainer) > 0;
            const hasReduction = newContainer && getReductionPercent(newContainer) > 0;

            if (hadReduction && !hasReduction) {
                // Переместили ИЗ контейнера с редукцией -> Восстановить вес
                await restoreOriginalWeight(updatedItem);
            } else if (!hadReduction && hasReduction) {
                // Переместили В контейнер с редукцией -> Применить редукцию
                await applyWeightReduction(updatedItem, newContainer);
            } else if (hadReduction && hasReduction) {
                // Переместили ИЗ одного с редукцией В другой с редукцией -> Пересчитать редукцию
                // Сначала восстановим (на случай если оригинал не сохранен или сохранен неверно)
                const originalWeight = getOriginalWeight(updatedItem) ?? updatedItem.system.weight;
                // Сбросим флаг и вес на оригинальный перед применением новой редукции
                await updatedItem.unsetFlag(MODULE_ID, FLAG_ORIGINAL_WEIGHT);
                await updatedItem.update({'system.weight': originalWeight}, { CWM_INTERNAL: true }); // Используем временный флаг, чтобы избежать рекурсии в хуках
                 // Теперь применяем новую редукцию
                await applyWeightReduction(updatedItem, newContainer);
            }
        }
    }
     return updatedItem;
}


// --- Fallback Функции для стандартных хуков (если нет libWrapper) ---

/**
 * Fallback: Проверка вместимости перед созданием предмета.
 * @param {Item} item - Документ создаваемого предмета.
 * @param {object} data - Данные для создания.
 * @param {object} options - Опции.
 * @param {string} userId - ID пользователя.
 * @returns {boolean} Возвращает false, чтобы отменить создание.
 */
function onItemPreCreate(item, data, options, userId) {
    if (game.userId !== userId) return true; // Только для пользователя, инициировавшего действие

    const actor = item.parent; // Actor
    const containerId = data.system?.container;
    if (!actor || !containerId) return true; // Не в контейнере

    const containerItem = actor.items.get(containerId);
    if (!containerItem || containerItem.system?.capacity?.type !== 'weight') return true; // Не тот контейнер

    const containerMaxWeight = containerItem.system.capacity.value ?? 0;
    const currentWeight = calculateContainerContentsWeight(containerItem, actor);

    let itemWeight = data.system?.weight ?? 0;
    const quantity = data.system?.quantity ?? 1;
    const reductionPercent = getReductionPercent(containerItem);
    if (reductionPercent > 0) {
        itemWeight = Math.max(0, itemWeight * (1 - reductionPercent / 100));
    }
    const addedWeight = itemWeight * quantity;

    if (currentWeight + addedWeight > containerMaxWeight) {
        ui.notifications.warn(game.i18n.format("CWM.Notifications.CapacityExceeded", { containerName: containerItem.name }));
        return false; // Отменить создание
    }

    return true; // Разрешить создание
}

/**
 * Fallback: Проверка вместимости перед обновлением (изменение количества).
 * @param {Item} item - Документ обновляемого предмета.
 * @param {object} changes - Изменения.
 * @param {object} options - Опции.
 * @param {string} userId - ID пользователя.
 * @returns {boolean} Возвращает false, чтобы отменить обновление.
 */
function onItemPreUpdate(item, changes, options, userId) {
    if (game.userId !== userId) return true; // Только для пользователя

    const actor = item.actor;
    const quantityChange = changes.system?.quantity;
    const container = item.system?.container;

    if (!actor || typeof quantityChange !== 'number' || !container || quantityChange <= item.system.quantity) {
        return true; // Не та ситуация
    }

    const containerItem = actor.items.get(container.id);
     if (!containerItem || containerItem.system?.capacity?.type !== 'weight') {
        return true; // Не тот контейнер
    }

     const containerMaxWeight = containerItem.system.capacity.value ?? 0;
     const currentWeightWithoutItem = calculateContainerContentsWeight(containerItem, actor) - (item.system.weight * item.system.quantity);
     const newItemTotalWeight = item.system.weight * quantityChange;

    if (currentWeightWithoutItem + newItemTotalWeight > containerMaxWeight) {
        ui.notifications.warn(game.i18n.format("CWM.Notifications.CapacityExceeded", { containerName: containerItem.name }));
        return false; // Отменить обновление
    }

    return true; // Разрешить обновление
}

/**
 * Fallback: Обработка изменений после обновления предмета (смена контейнера).
 * @param {Item} item - Обновленный предмет.
 * @param {object} changes - Примененные изменения.
 * @param {object} options - Опции.
 * @param {string} userId - ID пользователя.
 */
async function onItemUpdate(item, changes, options, userId) {
     if (game.userId !== userId || options.CWM_INTERNAL ) return; // Игнорировать внутренние обновления и чужие действия

    // Проверяем, изменился ли контейнер
     if (changes.system && 'container' in changes.system && item?.actor) {
        const actor = item.actor;
        // В стандартном хуке `item` уже обновлен, но `changes` содержит старое значение container ID, если он был.
        // Нам нужно получить ID *предыдущего* контейнера. Это сложно без libWrapper.
        // Простой способ: посмотрим на флаг. Если флаг ЕСТЬ, значит был в контейнере с редукцией.
        // Если флаг есть, а нового контейнера нет ИЛИ новый контейнер без редукции -> восстановить вес.
        // Если флага нет, а новый контейнер ЕСТЬ и с редукцией -> применить редукцию.

        const newContainerId = item.system.container?.id;
        const newContainer = newContainerId ? actor.items.get(newContainerId) : null;
        const hasNewReduction = newContainer && getReductionPercent(newContainer) > 0;
        const hadOldReduction = getOriginalWeight(item) !== null; // Был ли флаг до обновления?

        if (hadOldReduction && (!newContainer || !hasNewReduction)) {
            // Был флаг, но теперь либо нет контейнера, либо в нем нет редукции
            await restoreOriginalWeight(item);
        } else if (!hadOldReduction && newContainer && hasNewReduction) {
            // Флага не было, но переместили в контейнер с редукцией
             await applyWeightReduction(item, newContainer);
        } else if (hadOldReduction && newContainer && hasNewReduction) {
             // Был флаг и новый контейнер тоже с редукцией -> пересчитать
            const originalWeight = getOriginalWeight(item); // Получаем сохраненный оригинальный вес
            await item.unsetFlag(MODULE_ID, FLAG_ORIGINAL_WEIGHT); // Удаляем старый флаг
            await item.update({'system.weight': originalWeight}, { CWM_INTERNAL: true }); // Восстанавливаем временно
            await applyWeightReduction(item, newContainer); // Применяем новую редукцию
        }
     }
    // Проверка, не изменился ли вес самого предмета (например, через DAE)
    else if (changes.system && 'weight' in changes.system && item?.actor && item.system.container) {
        const container = actor.items.get(item.system.container.id);
        // Если предмет в контейнере с редукцией, а его базовый вес изменили извне,
        // нужно пересчитать редуцированный вес.
        if (container && getReductionPercent(container) > 0) {
            // Предполагаем, что 'changes.system.weight' - это новый *оригинальный* вес.
             const newOriginalWeight = changes.system.weight;
             // Сначала обновим флаг
             await item.setFlag(MODULE_ID, FLAG_ORIGINAL_WEIGHT, newOriginalWeight);
             // Теперь применим редукцию к новому оригинальному весу
             const reductionFactor = 1 - (getReductionPercent(container) / 100);
             const newReducedWeight = Math.max(0, newOriginalWeight * reductionFactor);
             // Обновим вес, если он отличается
             if (Math.abs(item.system.weight - newReducedWeight) > 0.001) {
                 await item.update({'system.weight': newReducedWeight}, { CWM_INTERNAL: true });
             }
        }
    }
}

// Небольшой хак, чтобы применить редукцию к предметам, которые *уже* были в контейнере при загрузке мира
// или при изменении процента редукции контейнера
Hooks.on('ready', () => {
    // Можно добавить логику, которая пройдет по всем акторам и предметам
    // и применит редукцию там, где нужно, если флаги еще не установлены.
    // Но это может быть медленно при большом количестве акторов/предметов.
    // Пока оставим так - редукция применится при первом изменении предмета или контейнера.
    // Или можно сделать это по кнопке в настройках модуля.
    console.log(`${MODULE_ID} | Ready.`);
});