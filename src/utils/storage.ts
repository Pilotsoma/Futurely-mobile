import AsyncStorage from '@react-native-async-storage/async-storage'

// Single source of truth for auth token storage keys. Portal (HAC/PowerSchool)
// credentials are never stored client-side — they're submitted directly to the
// backend login endpoints, same as web, and the backend encrypts them at rest.

const ACCESS_TOKEN_KEY = 'futurely.accessToken'
const REFRESH_TOKEN_KEY = 'futurely.refreshToken'

export interface StoredTokens {
  accessToken: string
  refreshToken: string
}

export async function storeTokens(tokens: StoredTokens): Promise<void> {
  await AsyncStorage.multiSet([
    [ACCESS_TOKEN_KEY, tokens.accessToken],
    [REFRESH_TOKEN_KEY, tokens.refreshToken],
  ])
}

export async function loadTokens(): Promise<StoredTokens | null> {
  const pairs = await AsyncStorage.multiGet([ACCESS_TOKEN_KEY, REFRESH_TOKEN_KEY])
  const accessToken = pairs[0][1]
  const refreshToken = pairs[1][1]
  if (!accessToken || !refreshToken) return null
  return { accessToken, refreshToken }
}

export async function clearTokens(): Promise<void> {
  await AsyncStorage.multiRemove([ACCESS_TOKEN_KEY, REFRESH_TOKEN_KEY])
}
