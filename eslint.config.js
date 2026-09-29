import js from "@eslint/js";
import globals from "globals";

/** Globals Foundry VTT and the dnd5e system put on window; modules read them, never assign them. */
const foundryGlobals = Object.fromEntries(
  [
    "foundry",
    "game",
    "ui",
    "canvas",
    "Hooks",
    "CONFIG",
    "CONST",
    "Handlebars",
    "fromUuid",
    "fromUuidSync",
    "ChatMessage",
    "Roll",
    "Actor",
    "Item",
    "socketlib",
    "dnd5e",
    "JournalEntry",
  ].map((name) => [name, "readonly"]),
);

export default [
  { ignores: ["dist/", "node_modules/", "docs/"] },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.browser, ...foundryGlobals },
    },
    rules: {
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
      "no-script-url": "error",
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", caughtErrors: "none", ignoreRestSiblings: true }],
    },
  },
  {
    files: ["tests/**", "tools/**", "*.config.js"],
    languageOptions: { globals: { ...globals.node } },
  },
];
