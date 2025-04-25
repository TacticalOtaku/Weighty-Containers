// --- Изменения в начале ---
const MODULE_ID = 'weighty-containers'; // <--- Изменено
const FLAG_REDUCTION_PERCENT = 'weightReductionPercent';
const FLAG_ORIGINAL_WEIGHT = 'originalWeight';

// --- ФУНКЦИИ ХЕЛПЕРЫ (без изменений в логике, только MODULE_ID) ---

/**
 * Получает процент снижения веса для контейнера.
 * @param {Item5e} containerItem - Объект предмета-контейнера.
 * @returns {number} Процент снижения (0-100).
 */
function getReductionPercent(containerItem) {
    // Используем обновленный MODULE_ID для получения флага
    return containerItem?.getFlag(MODULE_ID, FLAG_REDUCTION_PERCENT) ?? 0;
}

/**
 * Получает оригинальный вес предмета, если он был изменен модулем.
 * @param {Item5e} item - Предмет для проверки.
 * @returns {number | null} Оригинальный вес или null.
 */
function getOriginalWeight(item) {
    // Используем обновленный MODULE_ID для получения флага
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
             // Используем обновленный MODULE_ID для установки флага
             await item.setFlag(MODULE_ID, FLAG_ORIGINAL_WEIGHT, 0);
         }
        return;
    }

    console.log(`${MODULE_ID} | Applying reduction (${reductionPercent}%) to ${item.name}. Original: ${originalWeight}, New: ${reducedWeight}`);
    // Сначала устанавливаем флаг, потом обновляем вес
    // Используем обновленный MODULE_ID для установки флага
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
            // Используем обновленный MODULE_ID для удаления флага
            await item.unsetFlag(MODULE_ID, FLAG_ORIGINAL_WEIGHT);
        }
        return;
    }

    console.log(`${MODULE_ID} | Restoring original weight for ${item.name}. Original: ${originalWeight}`);
    // Сначала обновляем вес, потом удаляем флаг
    await item.update({'system.weight': originalWeight});
    // Используем обновленный MODULE_ID для удаления флага
    await item.unsetFlag(MODULE_ID, FLAG_ORIGINAL_WEIGHT);
}


// --- ХУКИ FOUNDRY VTT ---

Hooks.once('init', () => {
    // Используем обновленный MODULE_ID
    console.log(`${MODULE_ID} | Initializing Weighty Containers`);

    // Регистрация настроек с обновленным MODULE_ID и ключами локализации
    game.settings.register(MODULE_ID, 'gmOnlyButton', {
        // Используем обновленный ключ локализации
        name: game.i18n.localize("WEIGHTY_CONTAINERS.SETTINGS.gmOnlyButton"),
        hint: game.i18n.localize("WEIGHTY_CONTAINERS.SETTINGS.gmOnlyButtonHint"),
        scope: 'world',     // Настройка на уровне мира
        config: true,       // Показывать в меню настроек модуля
        type: Boolean,
        default: true,      // По умолчанию кнопка только для GM
        requiresReload: false // Не требует перезагрузки для применения визуально
    });

    // --- Перехват методов для управления весом ---
    // Используем libWrapper, если он активен, для лучшей совместимости
    if (game.modules.get('lib-wrapper')?.active) {
        // Используем обновленный MODULE_ID для регистрации libWrapper
        libWrapper.register(MODULE_ID, 'CONFIG.Actor.documentClass.prototype.createEmbeddedDocuments', checkCapacityOnCreate, 'MIXED');
        libWrapper.register(MODULE_ID, 'CONFIG.Item.documentClass.prototype.update', checkCapacityOnUpdate, 'MIXED');
        libWrapper.register(MODULE_ID, 'CONFIG.Item.documentClass.prototype.update', handleItemContainerChange, 'WRAPPER');

    } else {
         // Fallback на стандартные хуки, если libWrapper не активен
         // Стандартные хуки не требуют регистрации с ID модуля
        Hooks.on('preCreateItem', onItemPreCreate); // Проверка перед созданием
        Hooks.on('preUpdateItem', onItemPreUpdate); // Проверка перед обновлением
        Hooks.on('updateItem', onItemUpdate);       // Действия после обновления (смена контейнера)
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
    // Используем обновленный MODULE_ID для получения настройки
    const canConfigure = game.user.isGM || !game.settings.get(MODULE_ID, 'gmOnlyButton');

    // Определение класса редкости для цвета
    // Оставляем CSS классы прежними ('cwm-...') для простоты, чтобы не менять CSS файл
    let rarityClass = 'cwm-reduction-common';
    if (currentReduction >= 95) rarityClass = 'cwm-reduction-artifact';
    else if (currentReduction >= 85) rarityClass = 'cwm-reduction-legendary';
    else if (currentReduction >= 70) rarityClass = 'cwm-reduction-veryrare';
    else if (currentReduction >= 50) rarityClass = 'cwm-reduction-rare';
    else if (currentReduction > 0) rarityClass = 'cwm-reduction-uncommon';

    // HTML для отображения процента (с обновленными ключами локализации)
    const displayHtml = `
        <div class="cwm-weight-reduction-display ${rarityClass}" title="${game.i18n.format(`WEIGHTY_CONTAINERS.Rarity.${rarityClass.split('-')[2].charAt(0).toUpperCase() + rarityClass.split('-')[2].slice(1)}`)}">
            <span class="cwm-label">${game.i18n.localize("WEIGHTY_CONTAINERS.ContainerSheet.WeightReduction")}: </span>
            <span class="cwm-percentage">${currentReduction}%</span>
        </div>
    `;

    // HTML для кнопки (с обновленными ключами локализации)
    const buttonHtml = canConfigure ? `
        <button type="button" class="cwm-configure-button" title="${game.i18n.localize("WEIGHTY_CONTAINERS.ContainerSheet.ConfigureReduction")}">
            <i class="fas fa-cog"></i>
        </button>
    ` : '';

     // Обертка для выравнивания (используем старые CSS классы)
    const controlsContainerHtml = `
        <div class="cwm-controls-container">
            ${displayHtml}
            ${buttonHtml}
        </div>
    `;

    // --- Внедрение HTML на лист ---
    // Логика поиска места остается прежней
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
        // Используем старый CSS класс для поиска кнопки
        html.find('.cwm-configure-button').on('click', async (event) => {
            event.preventDefault();
            const currentVal = getReductionPercent(item);

            // Используем обновленные ключи локализации для диалога
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
                        label: game.i18n.localize("Save"), // Стандартный ключ Foundry
                        callback: async (html) => {
                            const inputVal = html.find('input[name="reductionPercent"]').val();
                            const newPercentage = parseInt(inputVal, 10);

                            if (isNaN(newPercentage) || newPercentage < 0 || newPercentage > 100) {
                                // Используем обновленный ключ локализации
                                ui.notifications.warn(game.i18n.localize("WEIGHTY_CONTAINERS.Notifications.InvalidPercentage"));
                                return false; // Предотвратить закрытие диалога
                            }

                            console.log(`${MODULE_ID} | Setting reduction for ${item.name} to ${newPercentage}%`);
                            // Используем обновленный MODULE_ID для установки флага
                            await item.setFlag(MODULE_ID, FLAG_REDUCTION_PERCENT, newPercentage);
                            // Пересчитать вес всех предметов ВНУТРИ контейнера после изменения процента
                             await updateContainedItemsWeight(item.actor, item, newPercentage);
                            // Не обязательно перерисовывать лист, если обновление флага само вызывает ререндер
                             // app.render(true); // Можно раскомментировать, если авто-ререндер не сработает
                        }
                    },
                    cancel: {
                        icon: '<i class="fas fa-times"></i>',
                        label: game.i18n.localize("Cancel") // Стандартный ключ Foundry
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
        // Пытаемся получить оригинальный вес из флага
        const originalWeight = getOriginalWeight(item); // Может быть null

        // Если флага нет, но редукция применяется (newReductionPercent > 0),
        // значит, этот предмет был добавлен до установки редукции или флаг потерялся.
        // В этом случае считаем текущий вес оригинальным для применения новой редукции.
        const baseWeightForCalc = originalWeight ?? item.system.weight;

        // Если базвый вес 0, предмет ничего не весит в любом случае
        if (baseWeightForCalc === 0) {
            // Если редукция снимается, и флаг был, удалим его
             if (newReductionPercent === 0 && originalWeight !== null) {
                 await item.unsetFlag(MODULE_ID, FLAG_ORIGINAL_WEIGHT);
             }
             // Если редукция применяется к предмету с нулевым весом, поставим флаг для консистентности
             else if (newReductionPercent > 0 && originalWeight === null) {
                  await item.setFlag(MODULE_ID, FLAG_ORIGINAL_WEIGHT, 0);
             }
            continue;
        }

        // Рассчитываем новый вес на основе базового
        const newWeight = Math.max(0, baseWeightForCalc * reductionFactor);

        // Сохраняем/обновляем флаг с оригинальным весом, если редукция > 0
        if (newReductionPercent > 0) {
             await item.setFlag(MODULE_ID, FLAG_ORIGINAL_WEIGHT, baseWeightForCalc);
        }

        // Если вес реально нужно изменить
        if (Math.abs(item.system.weight - newWeight) > 0.001) {
            updates.push({ _id: item.id, 'system.weight': newWeight });
        }
        // Если редукция стала 0, а вес и так был оригинальным (или стал им после расчета), удалим флаг
        else if (newReductionPercent === 0 && originalWeight !== null) {
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
        // Расчет текущего веса ДО добавления новых предметов
        const currentWeight = calculateContainerContentsWeight(containerItem, actor);

        // Рассчитываем вес добавляемого предмета (с учетом возможного снижения в этом контейнере)
        let itemWeight = itemData.system?.weight ?? 0;
        const quantity = itemData.system?.quantity ?? 1;
        const reductionPercent = getReductionPercent(containerItem);
        if (reductionPercent > 0) {
            // Применяем редукцию к БАЗОВОМУ весу из itemData
            itemWeight = Math.max(0, itemWeight * (1 - reductionPercent / 100));
        }
        const addedWeight = itemWeight * quantity;

        if (currentWeight + addedWeight > containerMaxWeight) {
            // Используем обновленный ключ локализации
            ui.notifications.warn(game.i18n.format("WEIGHTY_CONTAINERS.Notifications.CapacityExceeded", { containerName: containerItem.name }));
            capacityBlocked = true;
             // Не добавляем этот itemData в itemsToCreate
        } else {
             // Перед добавлением в itemsToCreate, модифицируем вес в данных, если он был снижен
             // Это гарантирует, что предмет создастся сразу со сниженным весом
             if (reductionPercent > 0) {
                 itemData.system.weight = itemWeight;
                 // Устанавливаем флаг оригинального веса прямо в данных для создания
                 // Используем пространство имен нашего модуля
                 foundry.utils.setProperty(itemData, `flags.${MODULE_ID}.${FLAG_ORIGINAL_WEIGHT}`, itemData.system.weight / (1 - reductionPercent / 100)); // Сохраняем оригинальный вес
             }
            itemsToCreate.push(itemData); // Проверка пройдена, добавляем к созданию
        }
    }

    // Если хотя бы один предмет был заблокирован, нужно вернуть результат только для разрешенных
    if (capacityBlocked) {
        if (itemsToCreate.length === 0) return []; // Ничего не создаем
        // Вызываем оригинальный метод только с разрешенными предметами
        return wrapped(embeddedName, itemsToCreate, context);
    } else {
        // Все предметы прошли проверку, вызываем оригинальный метод без изменений (но вес в data мог быть изменен)
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

    // Проверяем только если изменяется количество И предмет находится в контейнере с весовым лимитом
    const quantityChange = changes.system?.quantity;
    const container = item.system?.container; // Текущий контейнер

    // Пропускаем проверку, если:
    // - нет актора
    // - количество не меняется или не является числом
    // - предмет не в контейнере
    // - количество УМЕНЬШАЕТСЯ (не может превысить лимит)
    // - это внутреннее обновление модуля (чтобы избежать зацикливания при смене контейнера)
    if (!actor || typeof quantityChange !== 'number' || !container || quantityChange <= item.system.quantity || context?.WEIGHTY_CONTAINERS_INTERNAL) {
        return wrapped(changes, context);
    }

    const containerItem = actor.items.get(container.id);
    if (!containerItem || containerItem.system?.capacity?.type !== 'weight') {
        return wrapped(changes, context); // Не тот контейнер
    }

    const containerMaxWeight = containerItem.system.capacity.value ?? 0;
    // Рассчитываем ТЕКУЩИЙ вес БЕЗ этого предмета
    // Используем текущий (возможно, сниженный) вес предмета и текущее количество
    const currentWeightWithoutItem = calculateContainerContentsWeight(containerItem, actor) - (item.system.weight * item.system.quantity);

    // Рассчитываем вес этого предмета с НОВЫМ количеством
    // Используем ТЕКУЩИЙ (возможно, сниженный) вес предмета
    const newItemTotalWeight = item.system.weight * quantityChange;

    if (currentWeightWithoutItem + newItemTotalWeight > containerMaxWeight) {
        // Используем обновленный ключ локализации
        ui.notifications.warn(game.i18n.format("WEIGHTY_CONTAINERS.Notifications.CapacityExceeded", { containerName: containerItem.name }));
        // Предотвращаем обновление, возвращая сам объект item без изменений
        // Важно: просто вернуть item может быть недостаточно, лучше выбросить ошибку или изменить changes
        delete changes.system.quantity; // Удаляем изменение количества из запроса
        if (Object.keys(changes.system).length === 0) delete changes.system;
        if (Object.keys(changes).length === 0) return item; // Если больше нет изменений, просто выходим

        // Если остались другие изменения, продолжаем с ними
        // Это предотвратит отмену других правок, если они были в том же запросе
        return wrapped(changes, context);
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
     // Проверяем, меняется ли контейнер ДО вызова wrapped, т.к. нам нужен previousContainerId
    const isContainerChange = changes.system && 'container' in changes.system;
    const previousContainerId = isContainerChange ? this.system.container?.id : null; // Контейнер ДО обновления (this = item)

     // Сначала выполняем оригинальное обновление
     const updatedItem = await wrapped(changes, context);

    // Теперь обрабатываем смену контейнера, если она была
    if (isContainerChange && updatedItem?.actor) {
        const actor = updatedItem.actor;
        const newContainerId = updatedItem.system.container?.id; // Контейнер ПОСЛЕ обновления

        if (previousContainerId !== newContainerId) {
            const previousContainer = actor.items.get(previousContainerId);
            const newContainer = actor.items.get(newContainerId);

            const hadReduction = previousContainer && getReductionPercent(previousContainer) > 0;
            const hasReduction = newContainer && getReductionPercent(newContainer) > 0;

            // Используем context флаг, чтобы внутренние update не вызывали рекурсию
            const internalContext = { WEIGHTY_CONTAINERS_INTERNAL: true };

            if (hadReduction && !hasReduction) {
                // Переместили ИЗ контейнера с редукцией -> Восстановить вес
                await restoreOriginalWeight(updatedItem); // restoreOriginalWeight сам делает update
            } else if (!hadReduction && hasReduction) {
                // Переместили В контейнер с редукцией -> Применить редукцию
                await applyWeightReduction(updatedItem, newContainer); // applyWeightReduction сам делает update
            } else if (hadReduction && hasReduction) {
                // Переместили ИЗ одного с редукцией В другой с редукцией -> Пересчитать редукцию
                // Сначала восстановим оригинальный вес (на случай если флаг неверный)
                const originalWeight = getOriginalWeight(updatedItem) ?? updatedItem.system.weight; // Берем из флага или текущий
                await updatedItem.unsetFlag(MODULE_ID, FLAG_ORIGINAL_WEIGHT); // Удаляем старый флаг
                // Обновляем вес до оригинального (если он отличается) перед применением новой редукции
                if (Math.abs(updatedItem.system.weight - originalWeight) > 0.001) {
                    await updatedItem.update({'system.weight': originalWeight}, internalContext);
                }
                 // Теперь применяем новую редукцию (она сохранит новый флаг и обновит вес)
                await applyWeightReduction(updatedItem, newContainer);
            }
            // Случай !hadReduction && !hasReduction не требует действий с весом
        }
    } else if (changes.system && 'weight' in changes.system && !context?.WEIGHTY_CONTAINERS_INTERNAL && updatedItem?.actor && updatedItem.system.container) {
        // Обработка изменения веса предмета ИЗВНЕ (не нашим модулем), когда он УЖЕ В КОНТЕЙНЕРЕ с редукцией
        const actor = updatedItem.actor;
        const container = actor.items.get(updatedItem.system.container.id);
        if (container && getReductionPercent(container) > 0) {
            // Предполагаем, что changes.system.weight - это НОВЫЙ ОРИГИНАЛЬНЫЙ вес
            const newOriginalWeight = changes.system.weight;
            // Сохраняем новый оригинальный вес во флаг
            await updatedItem.setFlag(MODULE_ID, FLAG_ORIGINAL_WEIGHT, newOriginalWeight);
            // Пересчитываем и применяем редуцированный вес
            const reductionFactor = 1 - (getReductionPercent(container) / 100);
            const newReducedWeight = Math.max(0, newOriginalWeight * reductionFactor);
            // Обновляем вес предмета на редуцированный, если он отличается от того, что уже есть
            // (важно: updatedItem.system.weight может уже содержать newOriginalWeight из-за wrapped выше)
            if (Math.abs(updatedItem.system.weight - newReducedWeight) > 0.001) {
                 await updatedItem.update({'system.weight': newReducedWeight}, { WEIGHTY_CONTAINERS_INTERNAL: true });
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
    let originalWeight = itemWeight; // Запоминаем оригинальный вес из данных
    if (reductionPercent > 0) {
        itemWeight = Math.max(0, itemWeight * (1 - reductionPercent / 100));
    }
    const addedWeight = itemWeight * quantity;

    if (currentWeight + addedWeight > containerMaxWeight) {
        // Используем обновленный ключ локализации
        ui.notifications.warn(game.i18n.format("WEIGHTY_CONTAINERS.Notifications.CapacityExceeded", { containerName: containerItem.name }));
        return false; // Отменить создание
    }

    // Если создание разрешено и есть редукция, модифицируем данные ПЕРЕД созданием
    if (reductionPercent > 0) {
        data.system.weight = itemWeight; // Устанавливаем сниженный вес
        // Добавляем флаг в данные для создания
        if (!data.flags) data.flags = {};
        if (!data.flags[MODULE_ID]) data.flags[MODULE_ID] = {};
        data.flags[MODULE_ID][FLAG_ORIGINAL_WEIGHT] = originalWeight;
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
    // Пропускаем, если это внутреннее обновление или не от текущего юзера
    if (game.userId !== userId || options?.WEIGHTY_CONTAINERS_INTERNAL) return true;

    const actor = item.actor;
    const quantityChange = changes.system?.quantity;
    const container = item.system?.container;

    // Пропускаем, если не меняется кол-во, нет актора/контейнера, или кол-во уменьшается
    if (!actor || typeof quantityChange !== 'number' || !container || quantityChange <= item.system.quantity) {
        return true;
    }

    const containerItem = actor.items.get(container.id);
     if (!containerItem || containerItem.system?.capacity?.type !== 'weight') {
        return true; // Не тот контейнер
    }

     const containerMaxWeight = containerItem.system.capacity.value ?? 0;
     // Используем текущий (сниженный) вес и текущее кол-во
     const currentWeightWithoutItem = calculateContainerContentsWeight(containerItem, actor) - (item.system.weight * item.system.quantity);
     // Используем текущий (сниженный) вес и новое кол-во
     const newItemTotalWeight = item.system.weight * quantityChange;

    if (currentWeightWithoutItem + newItemTotalWeight > containerMaxWeight) {
        // Используем обновленный ключ локализации
        ui.notifications.warn(game.i18n.format("WEIGHTY_CONTAINERS.Notifications.CapacityExceeded", { containerName: containerItem.name }));
        // Отменяем ТОЛЬКО изменение количества
        delete changes.system.quantity;
        if (Object.keys(changes.system).length === 0) delete changes.system;
        // Если больше нет изменений, полностью отменяем обновление
        if (Object.keys(changes).length === 0) return false;
        // Иначе позволяем другим изменениям пройти
        return true;
    }

    return true; // Разрешить обновление
}

/**
 * Fallback: Обработка изменений после обновления предмета (смена контейнера или веса).
 * @param {Item} item - Обновленный предмет.
 * @param {object} changes - Примененные изменения (содержат старые значения для некоторых полей).
 * @param {object} options - Опции.
 * @param {string} userId - ID пользователя.
 */
async function onItemUpdate(item, changes, options, userId) {
     // Игнорировать внутренние обновления и чужие действия
     if (game.userId !== userId || options?.WEIGHTY_CONTAINERS_INTERNAL ) return;

    const actor = item.actor;
    if (!actor) return; // Нужен актор для работы с контейнерами

    const internalContext = { WEIGHTY_CONTAINERS_INTERNAL: true };

    // 1. Проверка смены контейнера
     if (changes.system && 'container' in changes.system) {
        // 'changes.system.container' содержит ID *предыдущего* контейнера (или null)
        // 'item.system.container' содержит ID *нового* контейнера (или null)
        const previousContainerId = changes.system.container;
        const newContainerId = item.system.container?.id;

        if (previousContainerId !== newContainerId) {
             const previousContainer = previousContainerId ? actor.items.get(previousContainerId) : null;
             const newContainer = newContainerId ? actor.items.get(newContainerId) : null;

             const hadReduction = previousContainer && getReductionPercent(previousContainer) > 0;
             const hasReduction = newContainer && getReductionPercent(newContainer) > 0;

             if (hadReduction && !hasReduction) {
                 await restoreOriginalWeight(item); // Восстанавливаем вес
             } else if (!hadReduction && hasReduction) {
                 await applyWeightReduction(item, newContainer); // Применяем редукцию
             } else if (hadReduction && hasReduction) {
                 // Пересчитываем редукцию
                 const originalWeight = getOriginalWeight(item) ?? item.system.weight;
                 await item.unsetFlag(MODULE_ID, FLAG_ORIGINAL_WEIGHT);
                 // Обновляем до оригинального веса перед применением новой редукции
                 if (Math.abs(item.system.weight - originalWeight) > 0.001) {
                     await item.update({'system.weight': originalWeight}, internalContext);
                 }
                 await applyWeightReduction(item, newContainer);
             }
        }
     }
    // 2. Проверка изменения веса предмета извне, когда он в контейнере с редукцией
    else if (changes.system && 'weight' in changes.system && item.system.container) {
        const container = actor.items.get(item.system.container.id);
        // Если контейнер с редукцией И изменение веса пришло не от нашего модуля
        if (container && getReductionPercent(container) > 0) {
            // 'changes.system.weight' - это старый вес до обновления
            // 'item.system.weight' - это новый вес после обновления
            const newOriginalWeight = item.system.weight; // Считаем, что внешний источник обновил до нового ОРИГИНАЛЬНОГО веса

            // Сохраняем новый оригинальный вес во флаг
            await item.setFlag(MODULE_ID, FLAG_ORIGINAL_WEIGHT, newOriginalWeight);
            // Пересчитываем и применяем редуцированный вес
            const reductionFactor = 1 - (getReductionPercent(container) / 100);
            const newReducedWeight = Math.max(0, newOriginalWeight * reductionFactor);
            // Обновляем вес предмета на редуцированный, если он отличается
            if (Math.abs(item.system.weight - newReducedWeight) > 0.001) {
                 await item.update({'system.weight': newReducedWeight}, internalContext);
            }
        }
    }
}

// Хук готовности - проверяем предметы при загрузке (опционально, но полезно)
Hooks.on('ready', async () => {
    console.log(`${MODULE_ID} | Ready. Checking item weights inside containers.`);
    // Пройдем по всем акторам игроков и их токенам на активных сценах
    const actorsToCheck = new Set();
    game.users.filter(u => u.character).forEach(u => actorsToCheck.add(u.character));
    game.scenes.filter(s => s.active).flatMap(s => s.tokens).filter(t => t.actor).forEach(t => actorsToCheck.add(t.actor));

    for (const actor of actorsToCheck) {
        const updates = [];
        const itemsToProcess = actor.items.contents; // Копируем массив для безопасной итерации

        for (const item of itemsToProcess) {
            const containerId = item.system.container?.id;
            if (!containerId) {
                // Если предмет НЕ в контейнере, но имеет флаг -> восстановить вес
                if (getOriginalWeight(item) !== null) {
                    await restoreOriginalWeight(item); // Делает update сам
                }
                continue;
            }

            const container = actor.items.get(containerId);
            if (!container || container.system?.capacity?.type !== 'weight') {
                 // Если контейнер невалидный, но есть флаг -> восстановить вес
                 if (getOriginalWeight(item) !== null) {
                     await restoreOriginalWeight(item);
                 }
                 continue;
            }

            const reductionPercent = getReductionPercent(container);
            const originalWeight = getOriginalWeight(item);

            if (reductionPercent > 0) {
                // Контейнер с редукцией
                const baseWeight = originalWeight ?? item.system.weight; // Берем из флага или текущий
                const reductionFactor = 1 - (reductionPercent / 100);
                const expectedReducedWeight = Math.max(0, baseWeight * reductionFactor);

                let needsUpdate = false;
                let weightUpdate = {};

                // Обновляем флаг, если его не было или он неверен
                if (originalWeight === null || Math.abs(originalWeight - baseWeight) > 0.001) {
                     await item.setFlag(MODULE_ID, FLAG_ORIGINAL_WEIGHT, baseWeight); // Устанавливаем флаг отдельно
                }

                // Обновляем вес, если он не соответствует ожидаемому
                if (Math.abs(item.system.weight - expectedReducedWeight) > 0.001) {
                    weightUpdate = { 'system.weight': expectedReducedWeight };
                    needsUpdate = true;
                }

                if (needsUpdate) {
                    updates.push({ _id: item.id, ...weightUpdate });
                }

            } else {
                // Контейнер БЕЗ редукции
                // Если есть флаг -> восстановить вес
                if (originalWeight !== null) {
                    // Не добавляем в updates, т.к. restoreOriginalWeight сам обновляет
                    await restoreOriginalWeight(item);
                }
            }
        } // конец цикла по предметам актора

        if (updates.length > 0) {
            console.log(`${MODULE_ID} | Applying ${updates.length} weight corrections for actor ${actor.name}`);
            await actor.updateEmbeddedDocuments("Item", updates, { WEIGHTY_CONTAINERS_INTERNAL: true });
        }
    } // конец цикла по акторам
     console.log(`${MODULE_ID} | Initial weight check complete.`);
});