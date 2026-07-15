import { useCallback, useEffect, useState } from 'react'
import { DeviceEventEmitter } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'

export interface DisplayPreferences {
  reduceMotion: boolean
  hideGpa: boolean
}

export const DISPLAY_PREFERENCE_KEYS = {
  reduceMotion: 'myfuturely.settings.reduce-motion',
  hideGpa: 'myfuturely.settings.hide-gpa',
} as const

const CHANGE_EVENT = 'myfuturely.display-preferences.changed'

const DEFAULT_PREFERENCES: DisplayPreferences = {
  reduceMotion: false,
  hideGpa: false,
}

let cachedPreferences: DisplayPreferences = DEFAULT_PREFERENCES

function parseStoredBoolean(value: string | null): boolean {
  return value === '1' || value === 'true'
}

export async function getDisplayPreferences(): Promise<DisplayPreferences> {
  const entries = await AsyncStorage.multiGet([
    DISPLAY_PREFERENCE_KEYS.reduceMotion,
    DISPLAY_PREFERENCE_KEYS.hideGpa,
  ])

  const values = new Map(entries)
  cachedPreferences = {
    reduceMotion: parseStoredBoolean(
      values.get(DISPLAY_PREFERENCE_KEYS.reduceMotion) ?? null,
    ),
    hideGpa: parseStoredBoolean(
      values.get(DISPLAY_PREFERENCE_KEYS.hideGpa) ?? null,
    ),
  }

  return cachedPreferences
}

async function persistPreference(
  key: keyof DisplayPreferences,
  value: boolean,
): Promise<void> {
  cachedPreferences = {
    ...cachedPreferences,
    [key]: value,
  }

  DeviceEventEmitter.emit(CHANGE_EVENT, cachedPreferences)

  await AsyncStorage.setItem(
    DISPLAY_PREFERENCE_KEYS[key],
    value ? '1' : '0',
  )
}

export async function setReduceMotionPreference(
  value: boolean,
): Promise<void> {
  await persistPreference('reduceMotion', value)
}

export async function setHideGpaPreference(value: boolean): Promise<void> {
  await persistPreference('hideGpa', value)
}

export function useDisplayPreferences(): DisplayPreferences & {
  loaded: boolean
  setReduceMotion: (value: boolean) => Promise<void>
  setHideGpa: (value: boolean) => Promise<void>
  refresh: () => Promise<void>
} {
  const [preferences, setPreferences] =
    useState<DisplayPreferences>(cachedPreferences)
  const [loaded, setLoaded] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const stored = await getDisplayPreferences()
      setPreferences(stored)
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => {
    let active = true

    void getDisplayPreferences()
      .then((stored) => {
        if (active) setPreferences(stored)
      })
      .finally(() => {
        if (active) setLoaded(true)
      })

    const subscription = DeviceEventEmitter.addListener(
      CHANGE_EVENT,
      (next: DisplayPreferences) => {
        if (active) setPreferences(next)
      },
    )

    return () => {
      active = false
      subscription.remove()
    }
  }, [])

  const setReduceMotion = useCallback(async (value: boolean) => {
    setPreferences((current) => ({ ...current, reduceMotion: value }))
    await setReduceMotionPreference(value)
  }, [])

  const setHideGpa = useCallback(async (value: boolean) => {
    setPreferences((current) => ({ ...current, hideGpa: value }))
    await setHideGpaPreference(value)
  }, [])

  return {
    ...preferences,
    loaded,
    setReduceMotion,
    setHideGpa,
    refresh,
  }
}