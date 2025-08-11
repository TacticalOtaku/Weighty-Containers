class WeightyContainersModule {
    static MODULE_ID = 'weighty-containers';
    static FLAG_WEIGHT_REDUCTION = 'weightReduction';

    constructor() {
        this.libWrapper = undefined;
        this.registerHooks();
    }

    // --- Вспомогательные функции ---

    _getItemBaseWeight(item) {
        if (!item?.system) return 0;
        const weightProperty = item.system.weight;
        if (typeof weightProperty === 'number') return weightProperty;
        if (typeof weightProperty === 'object' && weightProperty !== null && typeof weightProperty.value === 'number') {
            return weightProperty.value;
        }
        if (typeof weightProperty === 'string') return parseFloat(weightProperty) || 0;
        return 0;
    }

    isActualWeightContainer(item) {
        if (!item || item.type !== 'container' || !item.system) return false;
        const hasWeightValue = typeof item.system.capacity?.weight?.value === 'number';
        const typeIsWeight = item.system.capacity?.type === 'weight';
        return hasWeightValue || typeIsWeight;
    }

    getWeightReductionPercent(containerItem) {
        if (!containerItem) return 0;
        return Number(containerItem.getFlag(WeightyContainersModule.MODULE_ID, WeightyContainersModule.FLAG_WEIGHT_REDUCTION)) || 0;
    }

    getWeightDisplaySettings() {
        const isMetric = game.settings.get("dnd5e", "metricWeightUnits") ?? false;
        const multiplier = isMetric ? 0.5 : 1;
        const units = isMetric ? game.i18n.localize("DND5E.AbbreviationKg") : game.i18n.localize("DND5E.AbbreviationLbs");
        return { multiplier, units };
    }

    getEffectiveItemWeight(item, actor, applyMetric = false) {
        const baseWeight = this._getItemBaseWeight(item);
        const containerId = foundry.utils.getProperty(item, "system.container");
        if (!actor || !containerId) return baseWeight;

        const container = actor.items.get(containerId);
        if (!container || !this.isActualWeightContainer(container)) return baseWeight;

        const reductionPercent = this.getWeightReductionPercent(container);
        const reductionMultiplier = (reductionPercent > 0) ? Math.max(0, 1 - reductionPercent / 100) : 1;
        
        return Number((baseWeight * reductionMultiplier).toPrecision(5));
    }

    calculateCurrentContainerWeight(containerItem, actor, applyMetric = true) {
        if (!actor || !containerItem || !this.isActualWeightContainer(containerItem)) return 0;
        const contents = actor.items.filter(i => foundry.utils.getProperty(i, "system.container") === containerItem.id);
        let currentWeight = 0;
        for (const item of contents) {
            const quantity = Number(foundry.utils.getProperty(item, "system.quantity")) || 1;
            currentWeight += this.getEffectiveItemWeight(item, actor, false) * quantity;
        }
        const { multiplier } = this.getWeightDisplaySettings();
        return Number((applyMetric ? currentWeight * multiplier : currentWeight).toPrecision(5));
    }

    getRarityClassForReduction(reductionPercent) {
        if (reductionPercent >= 95) return 'rarity-artifact';
        if (reductionPercent >= 75) return 'rarity-legendary';
        if (reductionPercent >= 50) return 'rarity-very-rare';
        if (reductionPercent >= 25) return 'rarity-rare';
        if (reductionPercent > 0) return 'rarity-uncommon';
        return 'rarity-common';
    }

    // --- Основная логика ---

    recalculateEncumbrance(actor) {
        if (!actor.items || !actor.system?.attributes?.encumbrance) return;

        let totalWeight = 0;

        if (game.settings.get("dnd5e", "currencyWeight")) {
            const currency = actor.system.currency || {};
            const numCoins = Object.values(currency).reduce((acc, val) => acc + (Number(val) || 0), 0);
            const currencyDivisor = game.settings.get(WeightyContainersModule.MODULE_ID, "currencyDivisor") || 50;
            totalWeight += numCoins / currencyDivisor;
        }

        for (const item of actor.items) {
            if (foundry.utils.getProperty(item, "system.weightless")) continue;
            const effectiveWeightPerUnit = this.getEffectiveItemWeight(item, actor);
            const quantity = Number(foundry.utils.getProperty(item, "system.quantity")) || 1;
            totalWeight += effectiveWeightPerUnit * quantity;
        }
        
        actor.system.attributes.encumbrance.value = Number(totalWeight.toPrecision(5));
    }

    // --- Хуки и инициализация ---
    
    initialize() {
        if (game.modules.get('lib-wrapper')?.active) this.libWrapper = globalThis.libWrapper;
        
        game.settings.register(WeightyContainersModule.MODULE_ID, 'gmOnlyConfig', { name: "WEIGHTYCONTAINERS.SettingGMOnlyConfig", hint: "WEIGHTYCONTAINERS.SettingGMOnlyConfigHint", scope: 'world', config: true, type: Boolean, default: true });
        game.settings.register(WeightyContainersModule.MODULE_ID, 'capacityExceededMessage', { name: "WEIGHTYCONTAINERS.SettingCapacityMessageName", hint: "WEIGHTYCONTAINERS.SettingCapacityMessageHint", scope: 'world', config: true, type: String, default: "" });
        game.settings.register(WeightyContainersModule.MODULE_ID, 'currencyDivisor', {
            name: "WEIGHTYCONTAINERS.SettingCurrencyDivisorName",
            hint: "WEIGHTYCONTAINERS.SettingCurrencyDivisorHint",
            scope: 'world',
            config: true,
            type: Number,
            default: 50
        });
    }

    registerHooks() {
        Hooks.once('ready', this.onReady.bind(this));
        Hooks.on('renderItemSheet', this.onRenderItemSheet.bind(this));
        Hooks.on('preCreateItem', this.onPreCreateItem.bind(this));
        Hooks.on('preUpdateItem', this.onPreUpdateItem.bind(this));
        Hooks.on("updateItem", (item) => foundry.utils.debounce(() => this.refreshActorSheet(item.actor), 200)());
        Hooks.on("deleteItem", (item) => foundry.utils.debounce(() => this.refreshActorSheet(item.actor), 200)());
        Hooks.on('renderActorSheet', this.onFirstSheetRender.bind(this));
    }

    onReady() {
        if (this.libWrapper) {
            this.libWrapper.register('weighty-containers', 'CONFIG.Actor.documentClass.prototype.prepareDerivedData', function(wrapped, ...args) {
                wrapped(...args);
                try {
                    if (this.system?.attributes?.encumbrance) {
                        game.modules.get('weighty-containers').object.recalculateEncumbrance(this);
                    }
                } catch (e) {
                    console.error("Weighty Containers | Error during recalculateEncumbrance:", e);
                }
            }, 'WRAPPER', { priority: 200 });
            console.log("Weighty Containers | Patched Actor.prepareDerivedData with LOW priority.");
            
            // Оборачиваем методы изменения количества для разных листов персонажей
            const sheetPaths = [
                'dnd5e.ActorSheet5eCharacter',
                'dnd5e.ActorSheet5eNPC'
            ];
            
            // Также поддерживаем популярный модуль Tidy5e Sheet
            if (game.modules.get('tidy5e-sheet')?.active) {
                sheetPaths.push('Tidy5eSheet', 'Tidy5eNPC');
            }

            for (const path of sheetPaths) {
                try {
                    // Путь к классу может отличаться в зависимости от версии Foundry/dnd5e
                    const sheetClass = getProperty(CONFIG.Actor.sheetClasses.character, `${path}.cls`) 
                                    || getProperty(CONFIG.Actor.sheetClasses.npc, `${path}.cls`) 
                                    || getProperty(dnd5e.applications.actor, path);

                    if (sheetClass) {
                        this.libWrapper.register('weighty-containers', `${sheetClass.prototype.constructor.name}.prototype._onChangeInputDelta`, function(wrapped, event) {
                            const actorSheet = this;
                            const module = game.modules.get('weighty-containers').object;
                            const input = event.currentTarget;
                            const itemId = input.closest(".item")?.dataset.itemId;
                            if (!itemId) return wrapped(event);
    
                            const item = actorSheet.actor.items.get(itemId);
                            const containerId = item?.system.container;
                            if (!containerId) return wrapped(event);
                            
                            const container = actorSheet.actor.items.get(containerId);
                            if (!module.isActualWeightContainer(container)) return wrapped(event);
    
                            const { multiplier } = module.getWeightDisplaySettings();
                            const maxWeight = (Number(foundry.utils.getProperty(container, "system.capacity.weight.value")) || 0) * multiplier;
                            if (maxWeight <= 0) return wrapped(event);
    
                            const originalQty = item.system.quantity ?? 1;
                            const newQty = Number(input.value) + Number(input.dataset.delta);
                            if (newQty < originalQty) return wrapped(event); 
    
                            const currentWeight = module.calculateCurrentContainerWeight(container, actorSheet.actor, true);
                            const effectiveRawWeightPerUnit = module.getEffectiveItemWeight(item, actorSheet.actor, false);
                            const weightDelta = (newQty - originalQty) * effectiveRawWeightPerUnit * multiplier;
                            const finalContainerWeight = currentWeight + weightDelta;
                            
                            if (finalContainerWeight > maxWeight + 0.001) {
                                const message = game.settings.get('weighty-containers', 'capacityExceededMessage') || game.i18n.format("WEIGHTYCONTAINERS.CapacityWouldExceed", { containerName: container.name });
                                ui.notifications.warn(message.replace('{containerName}', container.name));
                                input.value = originalQty; 
                                return; 
                            }
                            
                            return wrapped(event);
    
                        }, 'MIXED');
                        console.log(`Weighty Containers | Patched ${path}._onChangeInputDelta.`);
                    }
                } catch (e) {
                    // Игнорируем ошибки
                }
            }
        } else {
            console.error("Weighty Containers | libWrapper is not active.");
        }
    }

    onRenderItemSheet(app, html, data) {
        const item = app.object;
        if (!this.isActualWeightContainer(item)) return;
        const targetBlock = html.find('header.sheet-header .middle.identity-info');
        if (!targetBlock.length) return;
        targetBlock.find('.weighty-container-ui-wrapper').remove();
        const reductionPercent = this.getWeightReductionPercent(item);
        const canConfigure = game.user.isGM || !game.settings.get(WeightyContainersModule.MODULE_ID, 'gmOnlyConfig');
        const rarityClass = this.getRarityClassForReduction(reductionPercent);
        const uiWrapper = $(`<div class="weighty-container-ui-wrapper"><div class="weighty-container-reduction-display ${rarityClass}" title="${game.i18n.localize('WEIGHTYCONTAINERS.WeightReductionLabel')}"><i class="fas fa-weight-hanging"></i> ${reductionPercent}%</div></div>`);
        if (canConfigure) {
            const configButton = $(`<button type="button" class="weighty-container-config-btn" title="${game.i18n.localize('WEIGHTYCONTAINERS.ConfigButtonTooltip')}"><i class="fas fa-cogs"></i></button>`);
            configButton.on('click', (ev) => this._onConfigButtonClick(ev, item));
            uiWrapper.append(configButton);
        }
        targetBlock.append(uiWrapper);
        if (app.actor) {
            setTimeout(() => {
                this.updateContainerProgressBar(html, item, app.actor);
            }, 0);
        }
    }

    _onConfigButtonClick(event, item) {
        event.preventDefault();
        new Dialog({
            title: game.i18n.localize("WEIGHTYCONTAINERS.ConfigWindowTitle"),
            content: `<form><div class="form-group"><label>${game.i18n.localize("WEIGHTYCONTAINERS.ConfigPrompt")}</label><input type="number" name="reductionPercent" value="${this.getWeightReductionPercent(item)}" min="0" max="100" step="1"/></div></form>`,
            buttons: {
                save: {
                    icon: '<i class="fas fa-save"></i>', label: game.i18n.localize("WEIGHTYCONTAINERS.ConfigSave"),
                    callback: async (html) => {
                        const newPercentage = parseInt(html.find('[name="reductionPercent"]').val(), 10);
                        if (isNaN(newPercentage) || newPercentage < 0 || newPercentage > 100) return ui.notifications.warn(game.i18n.localize("WEIGHTYCONTAINERS.InvalidPercentage"));
                        await item.setFlag(this.constructor.MODULE_ID, 'weightReduction', newPercentage);
                        if (item.actor) this.refreshActorSheet(item.actor);
                    }
                },
                cancel: { icon: '<i class="fas fa-times"></i>', label: game.i18n.localize("WEIGHTYCONTAINERS.ConfigCancel") }
            },
            default: 'save'
        }).render(true);
    }
    
    updateContainerProgressBar(html, containerItem, actor) {
        const { multiplier, units } = this.getWeightDisplaySettings();
        const currentWeight = this.calculateCurrentContainerWeight(containerItem, actor, true);
        const maxWeight = (Number(foundry.utils.getProperty(containerItem, "system.capacity.weight.value")) || 0) * multiplier;
        if (maxWeight <= 0) return;
        const percentage = Math.min(100, Math.round((currentWeight / maxWeight) * 100));
        const newText = `${currentWeight.toFixed(1)} / ${maxWeight.toFixed(1)}`;
        const barSelectors = [
            '.tab[data-tab="contents"] .encumbrance .meter.progress',
            '.tab[data-tab="contents"] .encumbrance-bar'
        ];
        const barElement = html.find(barSelectors.join(', '));
        if (barElement.length > 0) {
            barElement.css('--bar-percentage', `${percentage}%`);
            const textContainerSelectors = [
                '.tab[data-tab="contents"] .encumbrance .label',
                '.tab[data-tab="contents"] .encumbrance-label'
            ];
            const textContainer = html.find(textContainerSelectors.join(', '));
            if (textContainer.length > 0) {
                textContainer.text(newText);
            }
        }
    }

    onPreCreateItem(itemDoc, createData, options, userId) {
        const actor = itemDoc.parent;
        const containerId = foundry.utils.getProperty(createData, 'system.container');
        if (!actor || !containerId || !(actor instanceof Actor)) return true;
        const container = actor.items.get(containerId);
        if (!this.isActualWeightContainer(container)) return true;
        const { multiplier } = this.getWeightDisplaySettings();
        const maxWeight = (Number(foundry.utils.getProperty(container, "system.capacity.weight.value")) || 0) * multiplier;
        if (maxWeight <= 0) return true;
        const currentWeight = this.calculateCurrentContainerWeight(container, actor, true);
        const tempItem = new Item(foundry.utils.mergeObject(itemDoc.toObject(false), createData), { temporary: true });
        const rawWeightPerUnit = this.getEffectiveItemWeight(tempItem, actor, false);
        const quantity = Number(foundry.utils.getProperty(tempItem, "system.quantity")) || 1;
        const weightToAdd = (rawWeightPerUnit * quantity) * multiplier;
        if (currentWeight + weightToAdd > maxWeight + 0.001) {
            const message = game.settings.get(this.constructor.MODULE_ID, 'capacityExceededMessage') || game.i18n.format("WEIGHTYCONTAINERS.CapacityWouldExceed", { containerName: container.name });
            ui.notifications.warn(message.replace('{containerName}', container.name));
            return false;
        }
        return true;
    }
    
    onPreUpdateItem(itemDoc, change, options, userId) {
        const actor = itemDoc.parent;
        if (!actor || !(actor instanceof Actor) || options.weighyContainerChecked) return true;
        const targetContainerId = foundry.utils.getProperty(change, 'system.container') ?? itemDoc.system.container;
        if (!targetContainerId) return true;
        const container = actor.items.get(targetContainerId);
        if (!this.isActualWeightContainer(container)) return true;
        const { multiplier } = this.getWeightDisplaySettings();
        const maxWeight = (Number(foundry.utils.getProperty(container, "system.capacity.weight.value")) || 0) * multiplier;
        if (maxWeight <= 0) return true;
        const isMoving = foundry.utils.hasProperty(change, 'system.container') && targetContainerId !== itemDoc.system.container;
        if (isMoving) {
            const currentWeightInNewContainer = this.calculateCurrentContainerWeight(container, actor, true);
            const tempChangedItemData = foundry.utils.mergeObject(itemDoc.toObject(false), change);
            const tempChangedItemDoc = new Item(tempChangedItemData, { temporary: true });
            const rawWeightPerUnit = this.getEffectiveItemWeight(tempChangedItemDoc, actor, false);
            const quantity = Number(foundry.utils.getProperty(tempChangedItemDoc, "system.quantity")) || 1;
            const weightToAdd = (rawWeightPerUnit * quantity) * multiplier;
            if (currentWeightInNewContainer + weightToAdd > maxWeight + 0.001) {
                const message = game.settings.get(this.constructor.MODULE_ID, 'capacityExceededMessage') || game.i18n.format("WEIGHTYCONTAINERS.CapacityWouldExceed", { containerName: container.name });
                ui.notifications.warn(message.replace('{containerName}', container.name));
                return false;
            }
        } else if (foundry.utils.hasProperty(change, "system.quantity")) {
            const currentWeight = this.calculateCurrentContainerWeight(container, actor, true);
            const originalQty = itemDoc.system.quantity ?? 1;
            const newQty = foundry.utils.getProperty(change, 'system.quantity') ?? originalQty;
            if (newQty <= originalQty) return true;
            const effectiveRawWeightPerUnit = this.getEffectiveItemWeight(itemDoc, actor, false);
            const weightDelta = (newQty - originalQty) * effectiveRawWeightPerUnit * multiplier;
            const finalContainerWeight = currentWeight + weightDelta;
            if (finalContainerWeight > maxWeight + 0.001) {
                const message = game.settings.get(this.constructor.MODULE_ID, 'capacityExceededMessage') || game.i18n.format("WEIGHTYCONTAINERS.CapacityWouldExceed", { containerName: container.name });
                ui.notifications.warn(message.replace('{containerName}', container.name));
                return false;
            }
        }
        return true;
    }

    refreshActorSheet(actor) {
        if (actor?.sheet?.rendered) {
            actor.sheet.render(false);
        }
    }
    
    onFirstSheetRender(app) {
        if (!(app.object instanceof Actor) || app._weightyContainersCorrected) {
            return;
        }
        const actor = app.object;
        if (!actor.system?.attributes?.encumbrance) {
            return;
        }
        app._weightyContainersCorrected = true;
        setTimeout(() => {
            if (!app.rendered) return;
            console.log(`Weighty Containers | Triggering data recalculation for ${actor.name} to correct initial weight.`);
            actor.update({ [`flags.${this.constructor.MODULE_ID}.refresh`]: Math.random() });
        }, 100);
    }
}

// >>> ИСПРАВЛЕНИЕ v9: Вся инициализация модуля перенесена в хук 'init'
Hooks.once('init', () => {
    const module = new WeightyContainersModule();
    module.initialize();
    game.modules.set('weighty-containers', {
        object: module
    });
});