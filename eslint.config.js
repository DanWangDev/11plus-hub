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
    files: ['src/db/migrate.ts', 'src/db/seed.ts', 'src/db/migrate-users.ts', 'src/db/migrate-writing-buddy.ts', 'src/server.ts'],
    rules: {
      'n/no-process-exit': 'off',
    },
  },
  {
    files: [
      'src/services/google-auth-service.ts',
      'src/services/turnstile-service.ts',
      'src/routes/hub-auth.ts',
    ],
    rules: {
      'n/no-unsupported-features/node-builtins': ['error', { ignores: ['fetch'] }],
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
      'dist/',
      'node_modules/',
      'coverage/',
      '*.config.js',
      '*.config.ts',
      '**/*.d.ts',
      'packages/frontend/dist/',
    ],
  },
)
