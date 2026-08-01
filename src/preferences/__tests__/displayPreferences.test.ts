import AsyncStorage from '@react-native-async-storage/async-storage'

import {
  DEFAULT_GRADE_COLORS,
  DISPLAY_PREFERENCE_KEYS,
  getDisplayPreferences,
  getScopedPreferenceKey,
  parseGradeColors,
  setGradeColorsPreference,
  setHideGpaPreference,
  setReduceMotionPreference,
} from '../displayPreferences'

jest.mock(
  '@react-native-async-storage/async-storage',
  // Jest's official AsyncStorage mock is CommonJS-only.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
)

describe('display preference persistence', () => {
  beforeEach(async () => {
    jest.clearAllMocks()
    await AsyncStorage.clear()
  })

  it('loads defaults and restores saved values for the same user', async () => {
    expect(await getDisplayPreferences(7)).toEqual({
      reduceMotion: false,
      hideGpa: false,
      gradeColors: DEFAULT_GRADE_COLORS,
    })

    await setHideGpaPreference(true, 7)
    await setReduceMotionPreference(true, 7)
    expect(await getDisplayPreferences(7)).toMatchObject({
      reduceMotion: true,
      hideGpa: true,
    })
  })

  it('scopes values by user so another account keeps its own defaults', async () => {
    await setHideGpaPreference(true, 7)
    expect((await getDisplayPreferences(7)).hideGpa).toBe(true)
    expect((await getDisplayPreferences(8)).hideGpa).toBe(false)
  })

  it('migrates legacy device values once and removes the unscoped keys', async () => {
    await AsyncStorage.multiSet([
      [DISPLAY_PREFERENCE_KEYS.hideGpa, '1'],
      [DISPLAY_PREFERENCE_KEYS.reduceMotion, '1'],
    ])

    const migrated = await getDisplayPreferences(11)
    expect(migrated.hideGpa).toBe(true)
    expect(migrated.reduceMotion).toBe(true)
    expect(await AsyncStorage.getItem(DISPLAY_PREFERENCE_KEYS.hideGpa)).toBeNull()
    expect(await AsyncStorage.getItem(getScopedPreferenceKey('hideGpa', 11))).toBe('1')
  })

  it('persists and restores grade colors', async () => {
    const gradeColors = { ...DEFAULT_GRADE_COLORS, A: '#123456' }
    await setGradeColorsPreference(gradeColors, 7)
    expect((await getDisplayPreferences(7)).gradeColors.A).toBe('#123456')
  })

  it('falls back safely for malformed grade-color data', () => {
    expect(parseGradeColors('{bad json')).toEqual(DEFAULT_GRADE_COLORS)
    expect(parseGradeColors(JSON.stringify({ A: 'red' }))).toEqual(DEFAULT_GRADE_COLORS)
  })

  it('does not store a false success when persistence fails', async () => {
    const setItem = AsyncStorage.setItem as jest.MockedFunction<typeof AsyncStorage.setItem>
    setItem.mockRejectedValueOnce(new Error('storage unavailable'))

    await expect(setHideGpaPreference(true, 99)).rejects.toThrow('storage unavailable')
    expect(await AsyncStorage.getItem(getScopedPreferenceKey('hideGpa', 99))).toBeNull()
  })
})
