// ─────────────────────────────────────────────────────────
// Item Piles (with or without its "Item Piles: D&D 5e" bridge).
//
// Item Piles moves items by removing them from the source before it creates
// them on the target. A rule that refused the second step would lose the
// items, so its operations are checked whole in its own pre-hooks, which
// cancel the operation before anything is written.
// ─────────────────────────────────────────────────────────

export const ITEM_PILES_ID = "item-piles";
export const ITEM_PILES_DND5E_ID = "itempilesdnd5e";

const target = (source, sourceUpdates, actor, updates) => [{ actor, ...updates }];

/**
 * Item Piles pre-hooks that put items on an actor, mapped to the
 * `{ actor, itemsToCreate, itemsToUpdate }` each receiving actor gets.
 */
const PRE_HOOKS = {
  "item-piles-preAddItems": (actor, itemsToCreate, itemsToUpdate) => [{ actor, itemsToCreate, itemsToUpdate }],
  "item-piles-preTransferItems": target,
  "item-piles-preTransferAllItems": target,
  // Also fired for combining piles; the source there is a list, the target is not.
  "item-piles-preTransferEverything": target,
  "item-piles-preTradeItems": (seller, sellerUpdates, buyer, buyerUpdates) => [
    { actor: seller, ...sellerUpdates },
    { actor: buyer, ...buyerUpdates }
  ]
};

export function isModuleActive(id) {
  return globalThis.game?.modules?.get?.(id)?.active === true;
}

/**
 * Check every Item Piles operation that puts items on an actor.
 *
 * @param {(change: {actor: Object, itemsToCreate?: Object[], itemsToUpdate?: Object[]}) => boolean} check
 *   Returns false to cancel the operation.
 * @returns {boolean} whether Item Piles is active and the guards were installed
 */
export function registerItemPilesGuards(check) {
  if (!isModuleActive(ITEM_PILES_ID)) return false;
  for (const [hook, receivers] of Object.entries(PRE_HOOKS)) {
    Hooks.on(hook, (...args) => (receivers(...args).every(check) ? undefined : false));
  }
  return true;
}
