import AsyncStorage from '@react-native-async-storage/async-storage'

const TOKEN_KEY = 'auth_token'
const REFRESH_TOKEN_KEY = 'refresh_token'

export async function getToken(): Promise<string | null> {
  return AsyncStorage.getItem(TOKEN_KEY)
}

export async function setToken(token: string): Promise<void> {
  await AsyncStorage.setItem(TOKEN_KEY, token)
}

export async function clearToken(): Promise<void> {
  await AsyncStorage.removeItem(TOKEN_KEY)
}

export async function getRefreshToken(): Promise<string | null> {
  return AsyncStorage.getItem(REFRESH_TOKEN_KEY)
}

export async function setRefreshToken(token: string): Promise<void> {
  await AsyncStorage.setItem(REFRESH_TOKEN_KEY, token)
}

export async function clearRefreshToken(): Promise<void> {
  await AsyncStorage.removeItem(REFRESH_TOKEN_KEY)
}

export async function clearAllTokens(): Promise<void> {
  await AsyncStorage.multiRemove([TOKEN_KEY, REFRESH_TOKEN_KEY])
}
