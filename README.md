# Futurely Mobile

Expo / React Native mobile client for Futurely — an AI-powered academic companion for high
school students. This app covers the 7 screens in web's visible student navigation
(Dashboard, Grades, Planner, Study Feed, Colleges, AI Chat, Settings) plus auth/connect-school.

This repo was split out of the main [`Futurely`](https://github.com/Pilotsoma/Futurely)
monorepo on 2026-07-17 so mobile work could proceed independently. **It has no backend of
its own** — it's a pure client that calls the Futurely API over HTTP. See
`.claude/context/ARCHITECTURE.md` for details.

## Prerequisites
- Node.js 18+
- Expo Go app on your phone (or an iOS Simulator / Android Emulator)
- The [main `Futurely` repo](https://github.com/Pilotsoma/Futurely)'s backend running
  somewhere reachable — this app has nothing to talk to without it.

## Quick Start

### 1. Start the backend (from the main repo)
```bash
git clone https://github.com/Pilotsoma/Futurely
cd Futurely/backend
npm install
npm run dev
```
Server runs at http://localhost:3001 by default.

### 2. Start this app
```bash
npm install
npx expo start
```
Scan the QR code with Expo Go on your phone.

Update `src/constants/api.ts`'s `API_BASE_URL` to point at a host your device/simulator can
actually reach:
- iOS Simulator / `expo start --web` → `http://localhost:3001` (default)
- Physical device via Expo Go → your computer's LAN IP
- Android Emulator → `http://10.0.2.2:3001`

This is hardcoded per-developer and the most common reason the app can't reach the backend.

## Project structure

See `.claude/context/ARCHITECTURE.md` for the full layout, navigation structure, state
management approach, and API client details.

## Not part of this product

`Futurely/` (nested inside this repo) is an unrelated Expo starter template with its own
`node_modules`, excluded from `tsconfig.json`. Don't edit it or treat it as part of this app.
