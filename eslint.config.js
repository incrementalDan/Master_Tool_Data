// ESLint flat config — intentionally minimal.
//
// Goal: catch the "forgot to import a symbol / used an undefined variable" class
// of bug (e.g. using <X> without importing X), which the Vite build does NOT
// catch (it's a runtime ReferenceError → blank screen). We deliberately do NOT
// enable the full recommended rule sets — only the targeted no-undef rules — so
// linting stays a safety net for real breakage, not a style gate.

import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

const sharedGlobals = { ...globals.browser, ...globals.node };

export default [
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**'] },

  // JS / JSX (app code + Node scripts)
  {
    files: ['**/*.{js,jsx,mjs}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: sharedGlobals,
    },
    // exhaustive-deps is off, so the existing disable comments are unused —
    // don't report them (they're harmless and document intent).
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    plugins: { react, 'react-hooks': reactHooks },
    settings: { react: { version: 'detect' } },
    rules: {
      'no-undef': 'error',
      'react/jsx-no-undef': 'error',
      // Real-bug rules, kept tight. exhaustive-deps is left OFF (too opinionated
      // for this codebase); registering the plugin also makes the existing
      // `eslint-disable react-hooks/exhaustive-deps` comments valid.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'off',
    },
  },

  // TSX (tool-extractor.tsx) — TS-aware parser so JSX + TS syntax parse.
  // no-undef is disabled for TS files (TypeScript itself checks references and
  // no-undef produces false positives on type names); jsx-no-undef still applies.
  {
    files: ['**/*.tsx'],
    languageOptions: {
      parser: tseslint.parser,
      ecmaVersion: 2023,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: sharedGlobals,
    },
    plugins: { react },
    settings: { react: { version: 'detect' } },
    rules: {
      'no-undef': 'off',
      'react/jsx-no-undef': 'error',
    },
  },
];
