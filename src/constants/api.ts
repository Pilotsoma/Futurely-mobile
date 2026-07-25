import Constants from 'expo-constants'
import { Platform } from 'react-native'

const DEFAULT_API_PORT = 3001
const LOCAL_API_URL = `http://localhost:${DEFAULT_API_PORT}`

interface ApiUrlEnvironment {
  explicitUrl?: string
  platform?: string
  expoHostUri?: string | null
}

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '')
  const parsed = new URL(trimmed)

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('EXPO_PUBLIC_API_URL must use http:// or https://')
  }

  return parsed.toString().replace(/\/+$/, '')
}

function hostFromExpoUri(hostUri: string): string | null {
  try {
    const parsed = new URL(`http://${hostUri}`)
    const hostname = parsed.hostname
    return hostname.includes(':') && !hostname.startsWith('[')
      ? `[${hostname}]`
      : hostname
  } catch {
    return null
  }
}

/**
 * Expo Go receives the Metro host in its manifest. Reusing that hostname for
 * port 3001 means a physical phone automatically calls the computer whose QR
 * code it scanned. Production builds should set EXPO_PUBLIC_API_URL.
 */
export function resolveApiBaseUrl(environment: ApiUrlEnvironment = {}): string {
  const explicitUrl = environment.explicitUrl?.trim()
  if (explicitUrl) return normalizeBaseUrl(explicitUrl)

  const platform = environment.platform ?? Platform.OS
  if (platform === 'web') return LOCAL_API_URL

  const expoHost = hostFromExpoUri(
    environment.expoHostUri ?? Constants.expoConfig?.hostUri ?? '',
  )
  return expoHost
    ? `http://${expoHost}:${DEFAULT_API_PORT}`
    : LOCAL_API_URL
}

export const API_BASE_URL = resolveApiBaseUrl({
  explicitUrl: process.env.EXPO_PUBLIC_API_URL,
})

export const CRUD_TIMEOUT_MS = 10_000
// Covers both HAC/PowerSchool scraping (backend's own scrape timeouts are 20-45s) and
// LLM-backed generation (college insights measured at ~26s server-side in live testing;
// AI chat has a smaller max_tokens but shares the tier rather than risking a third value).
export const LONG_RUNNING_TIMEOUT_MS = 45_000

export function isLongRunningEndpoint(path: string): boolean {
  return (
    path.startsWith('/integrations/grades/') ||
    path.startsWith('/ai/') ||
    /^\/colleges\/\d+\/insights$/.test(path)
  )
}
