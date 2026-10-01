import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // promo/ is a separate package for the listing graphics, with its own browser and script code.
  { ignores: ['dist', 'node_modules', 'data', 'logs', 'promo'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': ['error', { allow: ['error'] }],
    },
  },
);
