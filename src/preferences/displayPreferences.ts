import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { DeviceEventEmitter } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useAuth } from '../context/AuthContext'

export type GradeLetter = 'A' | 'B' | 'C' | 'D' | 'F'
export type GradeColorPreferences = Record<GradeLetter, string>

export interface DisplayPreferences {
  reduceMotion: boolean
  hideGpa: boolean
  gradeColors: GradeColorPreferences
}

export const DEFAULT_GRADE_COLORS: GradeColorPreferences = {
  A: '#22C55E',
  B: '#10B981',
  C: '#F59E0B',
  D: '#F97316',
  F: '#EF4444',
}

export const DISPLAY_PREFERENCE_KEYS = {
  reduceMotion: 'myfuturely.settings.reduce-motion',
  hideGpa: 'myfuturely.settings.hide-gpa',
  gradeColors: 'myfuturely.settings.grade-colors',
} as const

const CHANGE_EVENT = 'myfuturely.display-preferences.changed'
const GRADE_LETTERS: GradeLetter[] = ['A', 'B', 'C', 'D', 'F']

const DEFAULT_PREFERENCES: DisplayPreferences = {
  reduceMotion: false,
  hideGpa: false,
  gradeColors: DEFAULT_GRADE_COLORS,
}

interface PreferenceChangeEvent {
  scope: string
  preferences: DisplayPreferences
}

const cachedPreferences = new Map<string, DisplayPreferences>()

function preferenceScope(userId?: number): string {
  return userId === undefined ? 'device' : `user-${userId}`
}

export function getScopedPreferenceKey(
  key: keyof DisplayPreferences,
  userId?: number,
): string {
  const baseKey = DISPLAY_PREFERENCE_KEYS[key]
  return userId === undefined ? baseKey : `${baseKey}.user-${userId}`
}

function parseStoredBoolean(value: string | null): boolean {
  return value === '1' || value === 'true'
}

function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9A-F]{6}$/i.test(value)
}

export function parseGradeColors(value: string | null): GradeColorPreferences {
  if (!value) return DEFAULT_GRADE_COLORS

  try {
    const parsed = JSON.parse(value) as Record<string, unknown>
    const valid = GRADE_LETTERS.every((letter) => isHexColor(parsed[letter]))
    if (!valid) return DEFAULT_GRADE_COLORS

    return {
      A: parsed.A as string,
      B: parsed.B as string,
      C: parsed.C as string,
      D: parsed.D as string,
      F: parsed.F as string,
    }
  } catch {
    return DEFAULT_GRADE_COLORS
  }
}

function preferencesFromEntries(entries: ReadonlyMap<string, string | null>): DisplayPreferences {
  return {
    reduceMotion: parseStoredBoolean(entries.get(DISPLAY_PREFERENCE_KEYS.reduceMotion) ?? null),
    hideGpa: parseStoredBoolean(entries.get(DISPLAY_PREFERENCE_KEYS.hideGpa) ?? null),
    gradeColors: parseGradeColors(entries.get(DISPLAY_PREFERENCE_KEYS.gradeColors) ?? null),
  }
}

function scopedPreferencesFromEntries(
  entries: ReadonlyMap<string, string | null>,
  userId?: number,
): DisplayPreferences {
  return {
    reduceMotion: parseStoredBoolean(entries.get(getScopedPreferenceKey('reduceMotion', userId)) ?? null),
    hideGpa: parseStoredBoolean(entries.get(getScopedPreferenceKey('hideGpa', userId)) ?? null),
    gradeColors: parseGradeColors(entries.get(getScopedPreferenceKey('gradeColors', userId)) ?? null),
  }
}

function serializePreference(
  key: keyof DisplayPreferences,
  value: DisplayPreferences[keyof DisplayPreferences],
): string {
  if (key === 'gradeColors') return JSON.stringify(value)
  return value ? '1' : '0'
}

export async function getDisplayPreferences(userId?: number): Promise<DisplayPreferences> {
  const scope = preferenceScope(userId)
  const scopedKeys = (Object.keys(DISPLAY_PREFERENCE_KEYS) as (keyof DisplayPreferences)[])
    .map((key) => getScopedPreferenceKey(key, userId))
  const entries = new Map(await AsyncStorage.multiGet(scopedKeys))

  const hasScopedValue = scopedKeys.some((key) => entries.get(key) !== null)
  let preferences = scopedPreferencesFromEntries(entries, userId)

  if (userId !== undefined && !hasScopedValue) {
    const legacyKeys = Object.values(DISPLAY_PREFERENCE_KEYS)
    const legacyEntries = new Map(await AsyncStorage.multiGet(legacyKeys))
    const hasLegacyValue = legacyKeys.some((key) => legacyEntries.get(key) !== null)

    if (hasLegacyValue) {
      preferences = preferencesFromEntries(legacyEntries)
      await AsyncStorage.multiSet([
        [getScopedPreferenceKey('reduceMotion', userId), serializePreference('reduceMotion', preferences.reduceMotion)],
        [getScopedPreferenceKey('hideGpa', userId), serializePreference('hideGpa', preferences.hideGpa)],
        [getScopedPreferenceKey('gradeColors', userId), serializePreference('gradeColors', preferences.gradeColors)],
      ])
      await AsyncStorage.multiRemove(legacyKeys)
    }
  }

  cachedPreferences.set(scope, preferences)
  return preferences
}

async function persistPreference<Key extends keyof DisplayPreferences>(
  userId: number | undefined,
  key: Key,
  value: DisplayPreferences[Key],
): Promise<DisplayPreferences> {
  await AsyncStorage.setItem(
    getScopedPreferenceKey(key, userId),
    serializePreference(key, value),
  )

  const scope = preferenceScope(userId)
  const current = cachedPreferences.get(scope) ?? DEFAULT_PREFERENCES
  const next = { ...current, [key]: value }
  cachedPreferences.set(scope, next)
  DeviceEventEmitter.emit(CHANGE_EVENT, { scope, preferences: next } satisfies PreferenceChangeEvent)
  return next
}

export async function setReduceMotionPreference(
  value: boolean,
  userId?: number,
): Promise<void> {
  await persistPreference(userId, 'reduceMotion', value)
}

export async function setHideGpaPreference(
  value: boolean,
  userId?: number,
): Promise<void> {
  await persistPreference(userId, 'hideGpa', value)
}

export async function setGradeColorsPreference(
  value: GradeColorPreferences,
  userId?: number,
): Promise<void> {
  await persistPreference(userId, 'gradeColors', value)
}

interface DisplayPreferenceActions {
  loaded: boolean
  setReduceMotion: (value: boolean) => Promise<void>
  setHideGpa: (value: boolean) => Promise<void>
  setGradeColor: (letter: GradeLetter, color: string) => Promise<void>
  resetGradeColors: () => Promise<void>
  refresh: () => Promise<void>
}

export type DisplayPreferencesContextValue = DisplayPreferences & DisplayPreferenceActions

const DisplayPreferencesContext = createContext<DisplayPreferencesContextValue | undefined>(undefined)

function useStoredDisplayPreferences(
  userId?: number,
): DisplayPreferencesContextValue {
  const scope = preferenceScope(userId)
  const [preferences, setPreferences] = useState<DisplayPreferences>(
    cachedPreferences.get(scope) ?? DEFAULT_PREFERENCES,
  )
  const [loaded, setLoaded] = useState(false)
  const pendingRef = useRef<Partial<Record<keyof DisplayPreferences, Promise<void>>>>({})

  const refresh = useCallback(async () => {
    try {
      const stored = await getDisplayPreferences(userId)
      setPreferences(stored)
    } finally {
      setLoaded(true)
    }
  }, [userId])

  useEffect(() => {
    let active = true
    setPreferences(cachedPreferences.get(scope) ?? DEFAULT_PREFERENCES)
    setLoaded(false)

    void getDisplayPreferences(userId)
      .then((stored) => {
        if (active) setPreferences(stored)
      })
      .catch(() => {
        if (active) setPreferences(cachedPreferences.get(scope) ?? DEFAULT_PREFERENCES)
      })
      .finally(() => {
        if (active) setLoaded(true)
      })

    const subscription = DeviceEventEmitter.addListener(
      CHANGE_EVENT,
      (event: PreferenceChangeEvent) => {
        if (active && event.scope === scope) setPreferences(event.preferences)
      },
    )

    return () => {
      active = false
      subscription.remove()
    }
  }, [scope, userId])

  const updatePreference = useCallback(
    async <Key extends keyof DisplayPreferences>(
      key: Key,
      value: DisplayPreferences[Key],
    ): Promise<void> => {
      const pending = pendingRef.current[key]
      if (pending) return pending

      const previous = cachedPreferences.get(scope) ?? preferences
      const optimistic = { ...previous, [key]: value }
      setPreferences(optimistic)

      const request = persistPreference(userId, key, value)
        .then((stored) => {
          setPreferences(stored)
        })
        .catch((error: unknown) => {
          cachedPreferences.set(scope, previous)
          setPreferences(previous)
          throw error
        })
        .finally(() => {
          delete pendingRef.current[key]
        })

      pendingRef.current[key] = request
      return request
    },
    [preferences, scope, userId],
  )

  const setReduceMotion = useCallback(
    (value: boolean) => updatePreference('reduceMotion', value),
    [updatePreference],
  )
  const setHideGpa = useCallback(
    (value: boolean) => updatePreference('hideGpa', value),
    [updatePreference],
  )
  const setGradeColor = useCallback(
    (letter: GradeLetter, color: string) => {
      if (!isHexColor(color)) return Promise.reject(new Error('Invalid grade color.'))
      return updatePreference('gradeColors', { ...preferences.gradeColors, [letter]: color })
    },
    [preferences.gradeColors, updatePreference],
  )
  const resetGradeColors = useCallback(
    () => updatePreference('gradeColors', DEFAULT_GRADE_COLORS),
    [updatePreference],
  )

  return {
    ...preferences,
    loaded,
    setReduceMotion,
    setHideGpa,
    setGradeColor,
    resetGradeColors,
    refresh,
  }
}

export function DisplayPreferencesProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const value = useStoredDisplayPreferences(user?.id)

  return createElement(DisplayPreferencesContext.Provider, { value }, children)
}

export function useDisplayPreferences(): DisplayPreferencesContextValue {
  const context = useContext(DisplayPreferencesContext)
  if (!context) {
    throw new Error('useDisplayPreferences must be used within DisplayPreferencesProvider')
  }
  return context
}
