// This file is loaded by Jest's setupFiles before any test module is evaluated.
// Setting environment variables here ensures they are in place before app.ts
// is required (so dotenv.config() and top-level branch conditions inside
// app.ts see the correct test-time values).
//
// dotenv does not overwrite variables that are already set, so these assignments
// take precedence over anything in a local .env file.

// Never run the dev auth bypass in tests — it would silently inject userId=1
// for every unauthenticated request, breaking the 401 assertions.
process.env.ENABLE_DEV_INTEGRATION_AUTH_BYPASS = 'false'

// Prevent dotenv from crashing on a missing DATABASE_URL by providing a
// syntactically valid placeholder.  All Prisma calls are mocked in tests,
// so this value is never used to open a real connection.
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test_db'
}
