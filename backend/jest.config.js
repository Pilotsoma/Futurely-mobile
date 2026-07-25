/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // Only look in src/ — don't accidentally pick up dist/ or node_modules/
  roots: ['<rootDir>/src'],
  // Only run files inside __tests__/ directories to exclude the legacy
  // assignments.test.ts which requires a live seeded database.
  testMatch: ['**/__tests__/**/*.test.ts'],
  // Run before any test module is evaluated — used to pre-set env vars that
  // control branch logic inside app.ts (e.g. ENABLE_DEV_INTEGRATION_AUTH_BYPASS).
  // dotenv respects already-set variables and will not overwrite these.
  setupFiles: ['<rootDir>/src/__test-setup__/env.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      tsconfig: './tsconfig.test.json',
    }],
  },
}
