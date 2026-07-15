import { Platform } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as SecureStore from 'expo-secure-store'

// Single source of truth for auth token storage keys. Portal (HAC/PowerSchool)
// credentials are never stored client-side — they're submitted directly to the
// backend login endpoints, same as web, and the backend encrypts them at rest.
//
// Tokens live in expo-secure-store (iOS Keychain / Android Keystore) on native —
// AsyncStorage is unencrypted on-device storage, readable on a rooted/jailbroken
// device or from an unencrypted backup. expo-secure-store has no functional web
// implementation (its web module has no native backing, so every call throws), and
// a browser has no keychain-equivalent primitive anyway — the web target here is
// only the local `expo start --web` dev-preview loop, never a deployed surface (see
// ARCHITECTURE.md), so it falls back to AsyncStorage rather than losing web preview
// entirely.

const ACCESS_TOKEN_KEY = 'futurely.accessToken'
const REFRESH_TOKEN_KEY = 'futurely.refreshToken'

export interface StoredTokens {
  accessToken: string
  refreshToken: string
}

export async function storeTokens(tokens: StoredTokens): Promise<void> {
  if (Platform.OS === 'web') {
    await AsyncStorage.multiSet([
      [ACCESS_TOKEN_KEY, tokens.accessToken],
      [REFRESH_TOKEN_KEY, tokens.refreshToken],
    ])
    return
  }
  await Promise.all([
    SecureStore.setItemAsync(ACCESS_TOKEN_KEY, tokens.accessToken),
    SecureStore.setItemAsync(REFRESH_TOKEN_KEY, tokens.refreshToken),
  ])
}

export async function loadTokens(): Promise<StoredTokens | null> {
  const [accessToken, refreshToken] =
    Platform.OS === 'web'
      ? (await AsyncStorage.multiGet([ACCESS_TOKEN_KEY, REFRESH_TOKEN_KEY])).map((pair) => pair[1])
      : await Promise.all([
          SecureStore.getItemAsync(ACCESS_TOKEN_KEY),
          SecureStore.getItemAsync(REFRESH_TOKEN_KEY),
        ])
  if (!accessToken || !refreshToken) return null
  return { accessToken, refreshToken }
}

export async function clearTokens(): Promise<void> {
  if (Platform.OS === 'web') {
    await AsyncStorage.multiRemove([ACCESS_TOKEN_KEY, REFRESH_TOKEN_KEY])
    return
  }
  await Promise.all([
    SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY),
    SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY),
  ])
}
