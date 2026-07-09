// API_BASE_URL must point at a host reachable from wherever this app is running.
// There is no env var mechanism for mobile (see ARCHITECTURE.md) — this is the
// one place to edit, per developer / per run target:
//   - `expo start --web` (browser preview): http://localhost:3001 (shares a host with backend)
//   - iOS Simulator:                        http://localhost:3001
//   - Android Emulator:                     http://10.0.2.2:3001
//   - Physical device via Expo Go:          http://<your-computer's-LAN-IP>:3001
export const API_BASE_URL = 'http://localhost:3001'

export const CRUD_TIMEOUT_MS = 10_000
export const SCRAPE_TIMEOUT_MS = 45_000

export function isScrapingEndpoint(path: string): boolean {
  return path.startsWith('/integrations/grades/')
}
