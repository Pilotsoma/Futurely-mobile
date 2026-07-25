const { defineConfig, globalIgnores } = require('eslint/config')
const expoConfig = require('eslint-config-expo/flat')

module.exports = defineConfig([
  globalIgnores([
    'backend/**',
    'coverage/**',
    'dist/**',
    '.expo/**',
  ]),
  expoConfig,
])
