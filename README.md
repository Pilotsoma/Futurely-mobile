# Futurely Mobile

Standalone Expo SDK 54 mobile client plus the Express/Prisma API it develops
against. The mobile and web applications remain separate; this repository does
not contain the web frontend.

## Prerequisites

- Node.js 20.19 or newer
- npm
- Expo Go on a physical phone
- A PostgreSQL/Neon database URL for a fully functional local API

## First-time setup

```bash
npm ci
npm run backend:install
```

Copy `backend/.env.example` to `backend/.env`, then set at minimum:

- `DATABASE_URL` to a PostgreSQL connection string
- `JWT_SECRET` to a random 32-byte secret
- `CREDENTIAL_ENCRYPTION_KEY` to a random 32-byte hex key

The backend deliberately refuses insecure production secrets. In local
development only, credential encryption can derive a stable key from
`JWT_SECRET` when `CREDENTIAL_ENCRYPTION_KEY` is absent.

## Run on Expo Go

Open two terminals at the repository root:

```bash
# Terminal 1: API on port 3001
npm run dev

# Terminal 2: Metro on the LAN
npm run app
```

Scan Metro's QR code in Expo Go. The phone and computer must be on the same
network, and the firewall must allow Node.js on private networks.

The app reads Metro's manifest hostname and automatically calls the same
computer on port 3001. There is no per-developer IP address to edit. To use a
deployed API instead, set `EXPO_PUBLIC_API_URL` before starting Expo:

```powershell
$env:EXPO_PUBLIC_API_URL = 'https://myfuturely.ai/api'
npm run app
```

`npm run app` is the intended command; `npx expo start --lan` is equivalent.

## Useful commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the local backend with reload |
| `npm run app` | Start Expo/Metro in LAN mode |
| `npm run typecheck` | Strict-check the mobile client |
| `npm run lint` | Run Expo's ESLint configuration |
| `npm test` | Run mobile Jest tests |
| `npm run backend:test` | Run all backend Jest tests |
| `npm run backend:build` | Generate Prisma Client and compile the API |
| `npm run check` | Run the complete local verification suite |

The API health endpoint is `http://localhost:3001/health`. A `503` with
`"db":"unreachable"` means the server is running but `DATABASE_URL` is missing,
obsolete, or unreachable.

## Repository layout

```text
App.tsx, index.ts       Expo entrypoints
src/                    Mobile screens, navigation, state, API client, and UI
backend/                Express API, Prisma schema/migrations, and backend tests
assets/                 Mobile application assets
```

`EXPO_PUBLIC_*` values are embedded in the client bundle and must never contain
secrets. Database, JWT, OAuth-client-secret, email, and AI credentials belong
only in `backend/.env` or the deployment's secret store.
