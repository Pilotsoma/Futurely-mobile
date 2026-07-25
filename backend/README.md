# Futurely Backend

Express, TypeScript, Prisma, and PostgreSQL/Neon API for the Futurely mobile and
web clients.

## Setup

From this directory:

```bash
npm ci
```

Copy `.env.example` to `.env` and configure a PostgreSQL `DATABASE_URL`, a
strong `JWT_SECRET`, and a 64-character hex `CREDENTIAL_ENCRYPTION_KEY`. Then:

```bash
npm run db:migrate
npm run dev
```

The development server listens on `0.0.0.0:3001`, making it reachable by Expo
Go on the same LAN. `GET /health` reports both process and database readiness.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Fast transpile-only development server with reload |
| `npm run build` | Generate Prisma Client and compile TypeScript |
| `npm test -- --runInBand` | Run the backend test suite |
| `npm run db:migrate` | Apply/create development migrations |
| `npm run db:seed` | Seed configured development data |
| `npm start` | Apply deployed migrations and run compiled output |

Type safety is enforced separately by `npm run build`; the development watcher
uses transpile-only mode so a cold start does not block the Expo workflow.

## Mobile OAuth

Google and Microsoft provider callbacks must point to:

```text
{OAUTH_CALLBACK_BASE_URL}/api/auth/oauth/google/callback
{OAUTH_CALLBACK_BASE_URL}/api/auth/oauth/microsoft/callback
```

Mobile redirects are restricted to the `futurely://` scheme or Expo Go URLs on
private/loopback addresses. Tokens return in the URL fragment rather than the
query string.
