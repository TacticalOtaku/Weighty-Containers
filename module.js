// --- Изменения в начале ---
const MODULE_ID = 'weighty-containers';
const FLAG_REDUCTION_PERCENT = 'weightReductionPercent';
const FLAG_ORIGINAL_WEIGHT = 'originalWeight';
const INTERNAL_UPDATE_FLAG = 'WEIGHTY_CONTAINERS_INTERNAL';

// --- ФУНКЦИИ ХЕЛПЕРЫ (Без изменений в этой итерации, кроме добавления логов при необходимости) ---
function getReductionPercent(containerItem) { /* ... */ }
function getOriginalWeight(item) { /* ... */ }
function calculateContainerContentsWeight(containerItem, actor) { /* ... */ }
async function applyWeightReduction(item, containerItem, context = {}) { /* ... */ } // Логи добавлены ниже
async function restoreOriginalWeight(item, context = {}) { /* ... */ } // Логи добавлены ниже

// --- ХУКИ FOUNDRY VTT ---

Hooks.once('init', () => {
    console.log(`${MODULE_ID} | Initializing Weighty Containers - INIT Hook Fired`);
    game.settings.register(MODULE_ID, 'gmOnlyButton', { /* ... */ });
    if (game.modules.get('lib-wrapper')?.active) {
        console.log(`${MODULE_ID} | libWrapper detected. Registering wrappers.`);
        try {
            libWrapper.register(MODULE_ID, 'CONFIG.Actor.documentClass.prototype.createEmbeddedDocuments', checkCapacityOnCreate, 'MIXED');
            libWrapper.register(MODULE_ID, 'CONFIG.Item.documentClass.prototype.update', combinedItemUpdateHandler, 'WRAPPER');
            console.log(`${MODULE_ID} | libWrapper registration successful.`);
        } catch (e) { console.error(`${MODULE_ID} | Error during libWrapper registration:`, e); }
    } else { /* ... fallback hooks ... */ }
});

// Хук для добавления элементов на лист контейнера
Hooks.on('renderItemSheet5e', (app, html, data) => {
    console.log(`${MODULE_ID} | renderItemSheet5e Hook Fired. App ID: ${app.id}, Item Name: ${data.item?.name}, App class: ${app.constructor.name}`);

    const item = app.object;
    if (!item || !['container', 'backpack'].includes(item.type)) { return; }

    // Проверка вместимости (оставляем улучшенную проверку)
    const weightCapacityValue = item.system?.capacity?.weight?.value;
    const hasWeightCapacity = weightCapacityValue !== null && weightCapacityValue !== undefined && weightCapacityValue !== "" && Number.isFinite(Number(weightCapacityValue));

    // Логирование проверки
    // console.log(`${MODULE_ID} | Checking Item: ${item.name}`);
    // console.log(`${MODULE_ID} |   > system.capacity.weight.value: ${weightCapacityValue} (Type: ${typeof weightCapacityValue})`);
    // console.log(`${MODULE_ID} |   > Final hasWeightCapacity check result: ${hasWeightCapacity}`);

    if (!hasWeightCapacity) {
        console.log(`${MODULE_ID} | Item ${item.name} does not appear to have a valid finite number for weight capacity. Skipping UI.`);
        return;
    }
    console.log(`${MODULE_ID} | Item ${item.name} IS a valid container with weight capacity defined. Value: ${weightCapacityValue}`);

    const currentReduction = getReductionPercent(item);
    const canConfigure = game.user.isGM || !game.settings.get(MODULE_ID, 'gmOnlyButton');
    console.log(`${MODULE_ID} | Current Reduction: ${currentReduction}%, Can Configure: ${canConfigure}`);

    let rarityClass = 'cwm-reduction-common';
    if (currentReduction >= 95) rarityClass = 'cwm-reduction-artifact';
    else if (currentReduction >= 85) rarityClass = 'cwm-reduction-legendary';
    else if (currentReduction >= 70) rarityClass = 'cwm-reduction-veryrare';
    else if (currentReduction >= 50) rarityClass = 'cwm-reduction-rare';
    else if (currentReduction > 0) rarityClass = 'cwm-reduction-uncommon';

    // --- СОЗДАНИЕ HTML ЭЛЕМЕНТОВ ---
    // Отображение процента (теперь в span, чтобы быть в .form-fields)
    const displayHtml = `
        <span class="cwm-weight-reduction-display ${rarityClass}" title="${game.i18n.format(`WEIGHTY_CONTAINERS.Rarity.${rarityClass.split('-')[2].charAt(0).toUpperCase() + rarityClass.split('-')[2].slice(1)}`)}">
            <span class="cwm-percentage">${currentReduction}%</span>
        </span>
    `;
    // Кнопка (без изменений)
    const buttonHtml = canConfigure ? `
        <button type="button" class="cwm-configure-button flex0" title="${game.i18n.localize("WEIGHTY_CONTAINERS.ContainerSheet.ConfigureReduction")}">
            <i class="fas fa-cog"></i>
        </button>
    ` : '';

    // Новый контейнер в стиле form-group
    const controlsContainerHtml = `
        <div class="form-group cwm-reduction-controls">
            <label>${game.i18n.localize("WEIGHTY_CONTAINERS.ContainerSheet.WeightReduction")}</label>
            <div class="form-fields">
                ${displayHtml}
                ${buttonHtml}
            </div>
        </div>
    `;
    console.log(`${MODULE_ID} | Generated HTML:`, controlsContainerHtml);

    // --- НОВАЯ ЛОГИКА ВНЕДРЕНИЯ HTML (В Container Details) ---
    const containerDetailsHeaderText = game.i18n.localize("DND5E.ContainerDetails"); // Ключ для "Container Details"
    // Ищем fieldset с нужной легендой
    const containerDetailsFieldset = html.find(`legend:contains("${containerDetailsHeaderText}")`).closest('fieldset');

    if (containerDetailsFieldset.length > 0) {
        console.log(`${MODULE_ID} | Found 'Container Details' fieldset. Appending controls inside.`);
        // Удаляем старый блок, если он где-то остался
        html.find('.cwm-reduction-controls').remove(); // Ищем по новому классу
        // Добавляем новый блок в конец fieldset
        containerDetailsFieldset.append(controlsContainerHtml);
    } else {
         // Fallback: если не нашли fieldset, попробуем просто в таб Details
        console.warn(`${MODULE_ID} | 'Container Details' fieldset not found. Trying details tab as fallback.`);
        const detailsTab = html.find('.tab[data-tab="details"]');
        if (detailsTab.length > 0) {
            console.log(`${MODULE_ID} | Found details tab. Appending controls to the end of the tab.`);
            html.find('.cwm-reduction-controls').remove();
            // Добавляем в конец таба, после всех fieldset
            detailsTab.append(controlsContainerHtml);
        } else {
            console.error(`${MODULE_ID} | Could not find 'Container Details' fieldset or 'details' tab to insert UI controls!`);
        }
    }

    // --- Добавление обработчика для кнопки --- (без изменений в логике)
    if (canConfigure) {
        const buttonElement = html.find('.cwm-configure-button');
        if (buttonElement.length > 0) { /* ... (логика обработчика как раньше) ... */ }
        else { /* ... */ }
    }
});

// --- ЛОГИКА ПРОВЕРКИ ВМЕСТИМОСТИ И ИЗМЕНЕНИЯ ВЕСА ---

/** Обновление веса содержимого */
async function updateContainedItemsWeight(actor, containerItem, newReductionPercent) { /* ... (без изменений) ... */ }

/** LibWrapper: Check capacity on create */
async function checkCapacityOnCreate(wrapped, embeddedName, data, context) {
    if (embeddedName !== 'Item' || !Array.isArray(data) || data.length === 0) { return wrapped(embeddedName, data, context); }
    const actor = this; if (!actor || !(actor instanceof Actor)) { return wrapped(embeddedName, data, context); }
    console.log(`${MODULE_ID} | checkCapacityOnCreate for actor ${actor.name}`);
    const itemsToCreate = []; let capacityBlocked = false;
    for (const itemData of data) {
        if (!itemData?.system || !itemData.name || ['container', 'backpack'].includes(itemData.type)) { itemsToCreate.push(itemData); continue; }
        const containerId = itemData.system.container; if (!containerId) { itemsToCreate.push(itemData); continue; }
        const containerItem = actor.items.get(containerId);
        const weightCapacityValue = containerItem?.system?.capacity?.weight?.value;
        const containerHasWeightCapacity = weightCapacityValue !== null && weightCapacityValue !== undefined && weightCapacityValue !== "" && Number.isFinite(Number(weightCapacityValue));
        if (!containerHasWeightCapacity) { itemsToCreate.push(itemData); continue; }
        console.log(`${MODULE_ID} | checkCapacityOnCreate: Checking item ${itemData.name} against container ${containerItem.name}`);
        const containerMaxWeight = Number(weightCapacityValue) ?? 0; const currentWeight = calculateContainerContentsWeight(containerItem, actor);
        let itemBaseWeight = itemData.system.weight ?? 0; const quantity = itemData.system.quantity ?? 1; const reductionPercent = getReductionPercent(containerItem); let reducedWeight = itemBaseWeight;
        if (reductionPercent > 0 && itemBaseWeight > 0) { reducedWeight = Math.max(0, itemBaseWeight * (1 - reductionPercent / 100)); }
        const addedWeight = reducedWeight * quantity;
        console.log(`${MODULE_ID} | checkCapacityOnCreate: Container=${containerItem.name}, Item=${itemData.name}, CurrentWeight=${currentWeight.toFixed(2)}, AddedWeight=${addedWeight.toFixed(2)}, MaxWeight=${containerMaxWeight}`);
        if (currentWeight + addedWeight > containerMaxWeight + 0.001) {
            ui.notifications.warn(game.i18n.format("WEIGHTY_CONTAINERS.Notifications.CapacityExceeded", { containerName: containerItem.name })); capacityBlocked = true; console.log(`${MODULE_ID} | checkCapacityOnCreate: BLOCKED item ${itemData.name} due to capacity.`);
        } else {
             // *** ВАЖНО: Устанавливаем флаг и вес ПЕРЕД добавлением в itemsToCreate ***
             if (reductionPercent > 0 && itemBaseWeight > 0) {
                 console.log(`${MODULE_ID} | checkCapacityOnCreate: Applying reduction to creation data for ${itemData.name}. Reduced weight: ${reducedWeight}, Base: ${itemBaseWeight}`);
                 itemData.system.weight = reducedWeight; // Устанавливаем сниженный вес
                 // Устанавливаем флаг оригинального веса
                 if (!itemData.flags) itemData.flags = {};
                 if (!itemData.flags[MODULE_ID]) itemData.flags[MODULE_ID] = {};
                 itemData.flags[MODULE_ID][FLAG_ORIGINAL_WEIGHT] = itemBaseWeight;
             }
            itemsToCreate.push(itemData);
        }
    }
    if (capacityBlocked) { if (itemsToCreate.length === 0) { console.log(`${MODULE_ID} | checkCapacityOnCreate: All items blocked.`); return []; } console.log(`${MODULE_ID} | checkCapacityOnCreate: Some items blocked, creating allowed.`); return wrapped(embeddedName, itemsToCreate, context); }
    else { console.log(`${MODULE_ID} | checkCapacityOnCreate: All items allowed.`); return wrapped(embeddedName, data, context); } // Передаем потенциально измененные data
}

/** LibWrapper: Combined handler for Item.update */
async function combinedItemUpdateHandler(wrapped, changes, context) {
    const item = this;
    if (!item.actor || context?.[INTERNAL_UPDATE_FLAG] || ['container', 'backpack'].includes(item.type)) { return wrapped(changes, context); }
    const actor = item.actor;
    // --- 1. PRE-UPDATE: Capacity Check ---
    const quantityChange = changes.system?.quantity; const isQuantityIncrease = typeof quantityChange === 'number' && quantityChange > item.system.quantity; const containerId = item.system?.container?.id;
    if (isQuantityIncrease && containerId) { /* ... (проверка вместимости без изменений) ... */ }
    // --- 2. WRAPPED CALL ---
    const previousContainerId = item.system.container?.id; const previousContainer = previousContainerId ? actor.items.get(previousContainerId) : null;
    const prevWeightCapacityValue = previousContainer?.system?.capacity?.weight?.value; const prevContainerHasWeightCap = prevWeightCapacityValue !== null && prevWeightCapacityValue !== undefined && prevWeightCapacityValue !== "" && Number.isFinite(Number(prevWeightCapacityValue));
    const wasInReducingContainer = previousContainer && getReductionPercent(previousContainer) > 0 && prevContainerHasWeightCap;
    const hadOriginalWeightFlag = getOriginalWeight(item) !== null; const originalChanges = foundry.utils.deepClone(changes);
    const updatedItem = await wrapped(changes, context);
    // --- 3. POST-UPDATE LOGIC ---
    const currentActor = updatedItem.actor; if (!currentActor) { return updatedItem; }
    const newContainerId = updatedItem.system.container?.id; const newContainer = newContainerId ? currentActor.items.get(newContainerId) : null;
    const newWeightCapacityValue = newContainer?.system?.capacity?.weight?.value; const newContainerHasWeightCap = newWeightCapacityValue !== null && newWeightCapacityValue !== undefined && newWeightCapacityValue !== "" && Number.isFinite(Number(newWeightCapacityValue));
    // *** ВАЖНО: Логика снижения/восстановления должна учитывать, что контейнер ВООБЩЕ имеет лимит по весу ***
    const isInReducingContainer = newContainer && getReductionPercent(newContainer) > 0 && newContainerHasWeightCap;
    const weightChanged = originalChanges.system && 'weight' in originalChanges.system; const containerChanged = originalChanges.system && 'container' in originalChanges.system; const internalContext = { [INTERNAL_UPDATE_FLAG]: true };
    // --- 3.1 Container Change ---
    if (containerChanged && previousContainerId !== newContainerId) {
        console.log(`${MODULE_ID} | combinedItemUpdateHandler: Container changed for ${updatedItem.name} from ${previousContainerId || 'root'} to ${newContainerId || 'root'}.`);
        // Если ПРЕДЫДУЩИЙ контейнер имел редукцию и лимит веса
        if (wasInReducingContainer) {
             // Если НОВЫЙ НЕ имеет редукции или лимита веса -> Восстановить
             if (!isInReducingContainer) {
                 console.log(`${MODULE_ID} | Moved FROM reducing container. Restoring weight.`);
                 await restoreOriginalWeight(updatedItem, internalContext);
             } else { // Если НОВЫЙ ТОЖЕ имеет редукцию и лимит веса -> Пересчитать
                 console.log(`${MODULE_ID} | Moved FROM reducing TO reducing container. Re-applying reduction.`);
                 await applyWeightReduction(updatedItem, newContainer, internalContext);
             }
        }
        // Если ПРЕДЫДУЩИЙ НЕ имел редукции/лимита
        else {
             // Если НОВЫЙ имеет редукцию и лимит веса -> Применить
             if (isInReducingContainer) {
                  console.log(`${MODULE_ID} | Moved TO reducing container. Applying reduction.`);
                 await applyWeightReduction(updatedItem, newContainer, internalContext);
             }
             // Иначе (перемещение между нередуцирующими) -> Ничего не делать
        }
    }
    // --- 3.2 External Weight Change --- (только если контейнер не менялся И новый контейнер редуцирующий)
    else if (weightChanged && isInReducingContainer && previousContainerId === newContainerId) {
        /* ... (логика без изменений) ... */
    }
    // --- 3.3 Flag Consistency Check --- (только если контейнер не менялся И он НЕ редуцирующий)
    else if (!isInReducingContainer && hadOriginalWeightFlag && !containerChanged) {
        /* ... (логика без изменений) ... */
    }
    return updatedItem;
}


// --- Fallback Функции (оставляем как есть, основные правки в LibWrapper) ---
function onItemPreCreate(item, data, options, userId) { /* ... */ }
function onItemPreUpdate(item, changes, options, userId) { /* ... */ }
async function onItemUpdate(item, changes, options, userId) { /* ... */ }

// --- Ready Hook (оставляем как есть) ---
Hooks.on('ready', async () => { /* ... */ });

// --- Вспомогательные функции с логами ---
// getReductionPercent, getOriginalWeight без изменений

async function applyWeightReduction(item, containerItem, context = {}) {
    if (!item || !containerItem) return;
    const reductionPercent = getReductionPercent(containerItem);
    console.log(`${MODULE_ID} | >>> Attempting applyWeightReduction for ${item.name} (${item.id}). Reduction: ${reductionPercent}% <<<`);
    // Убедимся, что применяем только если контейнер действительно редуцирующий (на всякий случай)
    const weightCapacityValue = containerItem?.system?.capacity?.weight?.value;
    const containerIsReducing = weightCapacityValue !== null && weightCapacityValue !== undefined && weightCapacityValue !== "" && Number.isFinite(Number(weightCapacityValue)) && reductionPercent > 0;

    if (!containerIsReducing) {
        console.log(`${MODULE_ID} | applyWeightReduction: Target container ${containerItem.name} is not valid for reduction. Checking if restore needed.`);
        // Если контейнер перестал быть редуцирующим, а флаг есть - восстановить
        if(getOriginalWeight(item) !== null) {
            await restoreOriginalWeight(item, context);
        }
        return;
    }

    // --- Основная логика применения ---
    const currentWeight = item.system.weight; // Текущий вес предмета
    const flagWeight = getOriginalWeight(item); // Вес из флага (может быть null)
    // Базовый вес для расчета: если есть флаг - берем его, иначе - текущий вес предмета
    const baseWeightForCalc = flagWeight ?? currentWeight;
    console.log(`${MODULE_ID} | applyWeightReduction: Item=${item.name}, CurrentW=${currentWeight}, FlagW=${flagWeight}, BaseW=${baseWeightForCalc}`);

    if (baseWeightForCalc === 0) { // Не трогаем предметы с нулевым весом, кроме флага
        if (flagWeight === null) { await item.setFlag(MODULE_ID, FLAG_ORIGINAL_WEIGHT, 0); }
        return;
    }

    const reductionFactor = 1 - (reductionPercent / 100);
    const expectedReducedWeight = Math.max(0, baseWeightForCalc * reductionFactor);
    console.log(`${MODULE_ID} | applyWeightReduction: Expected Reduced Weight = ${expectedReducedWeight}`);

    let needsUpdate = false;
    let needsFlag = false;

    // Флаг нужен, если его нет ИЛИ если он не совпадает с базовым весом (на случай внешних изменений)
    if (flagWeight === null || Math.abs(flagWeight - baseWeightForCalc) > 0.001) {
        needsFlag = true;
    }
    // Вес нужно обновить, если текущий вес отличается от ожидаемого
    if (Math.abs(currentWeight - expectedReducedWeight) > 0.001) {
        needsUpdate = true;
    }

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
async function restoreOriginalWeight(item, context = {}) { /* ... (без изменений, но с логами) ... */ }