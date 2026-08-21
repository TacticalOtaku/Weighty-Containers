# Foundry V14 release smoke test

Run this checklist in Foundry `14.367` with D&D5e `5.3.3` and libWrapper enabled.

1. Open a container item and choose **Container Rules**.
2. Confirm the window opens above the sheet, centered in the viewport, at a usable size.
3. Select and remove item types, subtypes, required properties, and forbidden properties.
4. Search inside each multiselect and use Arrow keys, Enter, Space, Escape, Home, and End.
5. Create a required/forbidden property conflict and confirm Save is disabled until resolved.
6. Save the rules, close the item, reopen it, and confirm every selection persists.
7. Move an allowed item into the container and confirm its adjusted weight is displayed.
8. Try a forbidden item and a capacity overflow in both `block` and `warn` enforcement modes.

Expected result: no console errors from `weighty-containers`, the rules window remains floating,
and saved flags survive reopening the item.
