import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import agentFirst from './packages/eslint-plugin-agent-first/index.mjs';

export default [
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      'dist/**',
      'coverage/**',
      'app/**',
      'assets/**',
      'config/**',
      'db/**',
      'docs/**',
      'e2e/**',
      'frontend/**',
      'lib/**',
      'script/**',
      'test/**',
      'test-results/**',
      'website/**',
      'verification/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['layers/**/*.{ts,tsx,js,jsx}', 'contracts/**/*.{ts,tsx,js,jsx}'],
    linterOptions: {
      noInlineConfig: true,
    },
    plugins: {
      'agent-first': agentFirst,
    },
    rules: {
      'agent-first/no-banned-apis': 'error',
      'agent-first/no-product-comments': 'error',
      'agent-first/no-suppression-directives': 'error',
    },
  },
  {
    files: ['packages/framework-core/**/*.{ts,tsx,js,jsx}'],
    plugins: {
      'agent-first': agentFirst,
    },
    rules: {
      'agent-first/no-banned-apis': 'off',
      'agent-first/no-product-comments': 'off',
      'agent-first/no-suppression-directives': 'off',
    },
  },
  {
    files: ['*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        module: 'readonly',
        require: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        process: 'readonly',
        console: 'readonly',
      },
    },
  },
  {
    files: ['*.mjs', 'packages/eslint-plugin-agent-first/**/*.mjs'],
    languageOptions: {
      sourceType: 'module',
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        URL: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['tests/**/*.ts', 'tests/**/*.mjs'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
];
