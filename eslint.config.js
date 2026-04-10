import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import eslintConfigPrettier from 'eslint-config-prettier'
import nodePlugin from 'eslint-plugin-n'

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  nodePlugin.configs['flat/recommended-module'],
  eslintConfigPrettier,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    rules: {
      'n/no-missing-import': 'off',
      'n/no-unpublished-import': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  {
    files: [
      'packages/backend/src/db/migrate.ts',
      'packages/backend/src/db/seed.ts',
      'packages/backend/src/db/migrate-users.ts',
      'packages/backend/src/db/migrate-writing-buddy.ts',
      'packages/backend/src/server.ts',
    ],
    rules: {
      'n/no-process-exit': 'off',
    },
  },
  {
    files: [
      'packages/backend/src/services/google-auth-service.ts',
      'packages/backend/src/services/turnstile-service.ts',
      'packages/backend/src/routes/hub-auth.ts',
      'packages/backend/src/oidc/bcl-retry.ts',
    ],
    rules: {
      'n/no-unsupported-features/node-builtins': ['error', { ignores: ['fetch'] }],
    },
  },
  {
    files: ['packages/backend/src/**/*.test.ts'],
    rules: {
      'n/no-unsupported-features/node-builtins': ['error', { ignores: ['Response'] }],
    },
  },
  {
    files: ['packages/frontend/**/*.ts', 'packages/frontend/**/*.tsx'],
    rules: {
      'n/no-unsupported-features/node-builtins': 'off',
      'n/no-unsupported-features/es-syntax': 'off',
    },
  },
  {
    ignores: [
      '**/dist/',
      '**/node_modules/',
      '**/coverage/',
      '*.config.js',
      '*.config.ts',
      '**/*.d.ts',
    ],
  },
)
