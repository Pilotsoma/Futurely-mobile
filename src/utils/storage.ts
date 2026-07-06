// Typed wrappers around AsyncStorage.
// All token persistence goes through here — not directly in AuthContext —
// so storage logic can be replaced or tested independently.
//
// Security: only the JWT (accessToken) and refreshToken are stored.
// Portal passwords (HAC/PowerSchool) are NEVER written here per security policy;
// they are sent once to the backend and encrypted server-side.

import AsyncStorage from '@react-native-async-storage/async-storage'

const KEYS = {
  ACCESS_TOKEN:  'futurely_access_token',
  REFRESH_TOKEN: 'futurely_refresh_token',
} as const

export async function storeTokens(
  accessToken: string,
  refreshToken: string,
): Promise<void> {
  await AsyncStorage.multiSet([
    [KEYS.ACCESS_TOKEN,  accessToken],
    [KEYS.REFRESH_TOKEN, refreshToken],
  ])
}

export async function loadTokens(): Promise<{
  accessToken: string | null
  refreshToken: string | null
}> {
  const pairs = await AsyncStorage.multiGet([KEYS.ACCESS_TOKEN, KEYS.REFRESH_TOKEN])
  return {
    accessToken:  pairs[0][1] ?? null,
    refreshToken: pairs[1][1] ?? null,
  }
}

export async function clearTokens(): Promise<void> {
  await AsyncStorage.multiRemove([KEYS.ACCESS_TOKEN, KEYS.REFRESH_TOKEN])
}
