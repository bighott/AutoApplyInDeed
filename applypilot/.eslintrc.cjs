/* ESLint config for ApplyPilot (TypeScript, browser + extension globals). */
module.exports = {
  root: true,
  env: {
    browser: true,
    es2022: true,
    webextensions: true,
    serviceworker: true,
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
  ],
  rules: {
    '@typescript-eslint/no-unused-vars': [
      'warn',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
    '@typescript-eslint/no-explicit-any': 'off',
    'no-empty': ['warn', { allowEmptyCatch: true }],
  },
  ignorePatterns: ['dist/', 'node_modules/', '*.config.ts'],
};
