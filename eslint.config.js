import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
  },
  {
    // Fichiers d'infrastructure exportant PAR CONCEPTION des hooks,
    // constantes ou variantes à côté des composants (provider i18n,
    // provider tRPC, composants shadcn/ui). La règle
    // react-refresh/only-export-components ne s'y applique pas :
    // elle existe pour le rechargement à chaud des écrans métier.
    files: [
      'src/i18n/**',
      'src/providers/**',
      'src/components/ui/**',
    ],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
])
