import React, { useEffect, useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { DrawerContentComponentProps } from '@react-navigation/drawer'
import { fetchStudentData, type StudentData } from '../../api/studentApi'
import { colors } from '../../constants/colors'
import FuturelyLogo from './FuturelyLogo'

const NAV_ITEMS = [
  { key: 'Home',        label: 'Home',         icon: 'grid-outline'     as const },
  { key: 'GradePortal', label: 'Grade Portal',  icon: 'school-outline'   as const },
  { key: 'Planning',    label: 'Planning',       icon: 'calendar-outline' as const },
  { key: 'CollegeHelp', label: 'College Help',   icon: 'ribbon-outline'   as const },
  { key: 'Settings',    label: 'Settings',       icon: 'settings-outline' as const },
] as const

export default function DrawerContent({ navigation, state }: DrawerContentComponentProps): React.JSX.Element {
  const insets = useSafeAreaInsets()
  const [studentData, setStudentData] = useState<StudentData | null>(null)

  useEffect(() => {
    fetchStudentData().then(setStudentData).catch(() => null)
  }, [])

  function handleNav(key: string): void {
    if (key === 'Home') {
      navigation.closeDrawer()
      return
    }
    navigation.closeDrawer()
    navigation.navigate(key as never)
  }

  const activeRouteName = state.routes[state.index]?.name

  const firstName = studentData?.name?.split(' ')[0] ?? null
  const gradeLevel = studentData?.profile?.gradeLevel
  const gradeText = gradeLevel !== undefined ? `Grade ${gradeLevel}` : null

  return (
    <View style={[styles.container, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 16 }]}>
      {/* Logo */}
      <View style={styles.logoSection}>
        <View style={{ marginBottom: 8 }}>
          <FuturelyLogo size={44} />
        </View>
        {(firstName !== null || gradeText !== null) && (
          <View style={styles.studentInfo}>
            {firstName !== null && (
              <Text style={styles.studentName}>{studentData?.name ?? firstName}</Text>
            )}
            {gradeText !== null && (
              <Text style={styles.studentGrade}>{gradeText}</Text>
            )}
          </View>
        )}
      </View>

      <View style={styles.divider} />

      {/* Nav items */}
      {NAV_ITEMS.map(item => {
        const isActive = item.key === 'Home'
          ? activeRouteName === 'MainAIHome'
          : false
        return (
          <TouchableOpacity
            key={item.key}
            style={[styles.navItem, isActive && styles.navItemActive]}
            onPress={() => handleNav(item.key)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={item.label}
          >
            <Ionicons
              name={item.icon}
              size={20}
              color={isActive ? colors.primary : colors.textSecondary}
            />
            <Text style={[styles.navLabel, isActive && styles.navLabelActive]}>
              {item.label}
            </Text>
          </TouchableOpacity>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  logoSection: {
    alignItems: 'center',
    paddingHorizontal: 20,
    marginBottom: 20,
  },
  logoImage: {
    width: 44,
    height: 44,
  },
  studentInfo: {
    alignItems: 'center',
    marginTop: 8,
  },
  studentName: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: 2,
  },
  studentGrade: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginHorizontal: 20,
    marginBottom: 12,
  },
  navItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 20,
    gap: 14,
    borderLeftWidth: 3,
    borderLeftColor: 'transparent',
  },
  navItemActive: {
    borderLeftColor: colors.primary,
  },
  navLabel: {
    fontSize: 15,
    fontWeight: '400',
    color: colors.textSecondary,
  },
  navLabelActive: {
    fontWeight: '600',
    color: colors.primary,
  },
})
