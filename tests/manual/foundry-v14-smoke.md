# Foundry V14 release smoke test

Run this checklist in Foundry `14.367` with D&D5e `5.3.3`. libWrapper is no longer
required. Run steps 12–15 with a second browser signed in as a **player** who
owns the test character — a lot of the module's behaviour only differs there.

## Rules dialog

1. Open a container item and choose **Container Rules**.
2. Confirm the window opens above the sheet, centered in the viewport, at a usable size.
3. Confirm the weight preview reads **Current contents** and shows the container's
   real load with a unit, e.g. `13.5 → 6.75 lb`. Dragging the slider updates it live.
4. Apply the **Quiver** preset: item types and categories change, the reduction does
   not. Apply **Clear all**: everything resets, slider and number field included.
5. Select and remove item types, subtypes, required properties, and forbidden properties.
6. Search inside each multiselect and use Arrow keys, Enter, Space, Escape, Home, and End.
7. Create a required/forbidden property conflict and confirm Save is disabled until resolved.
8. Save the rules, close the item, reopen it, and confirm every selection persists.

## Weight parity — the numbers must agree with dnd5e's own

Do this once with **Metric Weight Units off** and once with it **on**.

9. With a 50% reduction, confirm all three of these show the same load:
   - the capacity bar at the bottom of the container sheet;
   - `game.modules.get("weighty-containers").api.getContainerLoad(actor, containerId).loadLbs`;
   - `container.system.contentsWeight`.
10. Put a container inside a container, give both a reduction, and confirm the outer
    reduction also applies to what is in the inner one (they compound).
11. Tick dnd5e's `weightlessContents` property on a container: its contents must stop
    counting entirely, on the sheet and in the actor's encumbrance. Put coins in a
    container and confirm they count toward its load and are reduced with it.

## Enforcement and multi-user behaviour

12. Move an allowed item into the container and confirm its adjusted weight is displayed.
13. Try a forbidden item and a capacity overflow in both `block` and `warn` enforcement
    modes. Repeat with a container limited by **item count** instead of weight.
14. Give a container rules that its current contents do **not** satisfy, then equip,
    rename and change the quantity of an item already inside. All must succeed with no
    notification; only moving an item *into* the container is rejected.
15. As a player, overfill your own bag. Confirm the warning reaches you and the GM but
    **not** the other players (setting: *Who sees rejections*). As that player, open a
    container sheet: the header shows an eye icon, and the rules open read-only — banner
    shown, no presets, no Save.

Expected result: no console errors from `weighty-containers`, the rules window remains
floating, saved flags survive reopening the item, and no number the module renders
disagrees with the number dnd5e renders beside it.
