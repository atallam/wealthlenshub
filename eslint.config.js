// ESLint flat config (ESLint 9+). Two environments: Node for the server/lib/routes,
// browser + React for src/. Kept intentionally light — errors on real bugs
// (undefined vars, unused vars), warns on style, so it can be adopted without a
// giant one-time churn.
import js from "@eslint/js";
import globals from "globals";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";

export default [
  { ignores: ["dist/**", "node_modules/**", "public/**", "*.min.js"] },

  js.configs.recommended,

  // Backend (Node, ESM)
  {
    files: ["server.js", "lib/**/*.js", "routes/**/*.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.node },
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-console": "off",
    },
  },

  // Frontend (browser + React)
  {
    files: ["src/**/*.{js,jsx}"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { react, "react-hooks": reactHooks },
    settings: { react: { version: "detect" } },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^[A-Z_]" }],
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "react/jsx-uses-react": "off",
      "react/react-in-jsx-scope": "off",
    },
  },

  // Tests
  {
    files: ["tests/**/*.{js,jsx}", "**/*.test.{js,jsx}"],
    languageOptions: { globals: { ...globals.node } },
  },
];
