import React, { createContext, useContext, useEffect, useState } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'

// ── Storage keys ──────────────────────────────────────────────────────────────

const KEY_ACTIVE = 'school_session_active'
const KEY_DISTRICT = 'school_district'
const KEY_DISTRICT_URL = 'school_district_url'
const KEY_USERNAME = 'school_username'
const KEY_SYSTEM_TYPE = 'school_system_type'

const ALL_KEYS = [KEY_ACTIVE, KEY_DISTRICT, KEY_DISTRICT_URL, KEY_USERNAME, KEY_SYSTEM_TYPE] as const

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SchoolInfo {
  district: string
  districtUrl: string
  username: string
  systemType: 'HAC' | 'PowerSchool'
}

interface SchoolSessionContextValue {
  hasSchoolSession: boolean
  schoolInfo: SchoolInfo | null
  isLoaded: boolean
  signIn: (info: SchoolInfo) => Promise<void>
  signOut: () => Promise<void>
}

// ── Context ───────────────────────────────────────────────────────────────────

const SchoolSessionContext = createContext<SchoolSessionContextValue | null>(null)

export function SchoolSessionProvider({
  children,
}: {
  children: React.ReactNode
}): React.JSX.Element {
  const [schoolInfo, setSchoolInfo] = useState<SchoolInfo | null>(null)
  const [isLoaded, setIsLoaded] = useState(false)

  useEffect(() => {
    async function load(): Promise<void> {
      try {
        const active = await AsyncStorage.getItem(KEY_ACTIVE)
        if (active !== 'true') return

        const [district, districtUrl, username, systemType] = await Promise.all([
          AsyncStorage.getItem(KEY_DISTRICT),
          AsyncStorage.getItem(KEY_DISTRICT_URL),
          AsyncStorage.getItem(KEY_USERNAME),
          AsyncStorage.getItem(KEY_SYSTEM_TYPE),
        ])

        if (district && districtUrl && username) {
          setSchoolInfo({
            district,
            districtUrl,
            username,
            systemType: systemType === 'PowerSchool' ? 'PowerSchool' : 'HAC',
          })
        }
      } catch {
        // AsyncStorage unavailable — stay signed out
      } finally {
        setIsLoaded(true)
      }
    }
    void load()
  }, [])

  const signIn = async (info: SchoolInfo): Promise<void> => {
    await AsyncStorage.multiSet([
      [KEY_ACTIVE, 'true'],
      [KEY_DISTRICT, info.district],
      [KEY_DISTRICT_URL, info.districtUrl],
      [KEY_USERNAME, info.username],
      [KEY_SYSTEM_TYPE, info.systemType],
    ])
    setSchoolInfo(info)
  }

  const signOut = async (): Promise<void> => {
    await AsyncStorage.multiRemove([...ALL_KEYS])
    setSchoolInfo(null)
  }

  return (
    <SchoolSessionContext.Provider
      value={{
        hasSchoolSession: schoolInfo !== null,
        schoolInfo,
        isLoaded,
        signIn,
        signOut,
      }}
    >
      {children}
    </SchoolSessionContext.Provider>
  )
}

export function useSchoolSession(): SchoolSessionContextValue {
  const ctx = useContext(SchoolSessionContext)
  if (!ctx) throw new Error('useSchoolSession must be called inside SchoolSessionProvider')
  return ctx
}
