import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { DrawerContentScrollView, type DrawerContentComponentProps } from '@react-navigation/drawer'
import { Feather } from '@expo/vector-icons'
import { useAuth } from '../context/AuthContext'
import { FuturelyLogo } from '../components/ui/FuturelyLogo'
import { colors, radii, spacing, touchTarget, typography } from '../theme/tokens'
import type { MainDrawerParamList } from './MainNavigator'

interface NavItem {
  name: keyof MainDrawerParamList
  label: string
  icon: React.ComponentProps<typeof Feather>['name']
}

const NAV_ITEMS: NavItem[] = [
  { name: 'Dashboard', label: 'Dashboard', icon: 'grid' },
  { name: 'Grades', label: 'Grades', icon: 'bar-chart-2' },
  { name: 'Planner', label: 'Planner', icon: 'calendar' },
  { name: 'StudyFeed', label: 'Study Feed', icon: 'globe' },
  { name: 'Colleges', label: 'Colleges', icon: 'bookmark' },
  { name: 'AIChat', label: 'AI Chat', icon: 'message-circle' },
  { name: 'Settings', label: 'Settings', icon: 'settings' },
]

function displayFirstName(name: string | null | undefined): string {
  const value = name ?? 'Student'
  if (value.includes(',')) {
    const rest = value.split(',')[1]?.trim() ?? ''
    const first = rest.split(' ')[0] ?? rest
    return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase()
  }
  return value.split(' ')[0] ?? value
}

export default function DrawerContent(props: DrawerContentComponentProps): React.JSX.Element {
  const { user, signOut } = useAuth()
  const { state } = props
  const activeRouteName = state.routes[state.index]?.name ?? ''
  const displayName = displayFirstName(user?.name)

  return (
    <DrawerContentScrollView {...props} contentContainerStyle={styles.container} scrollEnabled={false}>
      <View style={styles.logoRow}>
        <FuturelyLogo size={36} />
        <Text style={styles.logoText}>Futurely</Text>
      </View>

      <View style={styles.nav}>
        {NAV_ITEMS.map((item) => {
          const isActive = activeRouteName === item.name
          return (
            <TouchableOpacity
              key={item.name}
              onPress={() => props.navigation.navigate(item.name)}
              style={[styles.navItem, isActive && styles.navItemActive]}
              accessibilityRole="menuitem"
              accessibilityLabel={item.label}
              accessibilityState={{ selected: isActive }}
            >
              {isActive ? <View style={styles.activeBorder} /> : null}
              <Feather name={item.icon} size={18} color={isActive ? colors.primary : colors.textSecondary} />
              <Text style={[styles.navLabel, isActive && styles.navLabelActive]}>{item.label}</Text>
            </TouchableOpacity>
          )
        })}
      </View>

      <View style={styles.bottom}>
        <View style={styles.userRow}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{displayName.charAt(0).toUpperCase()}</Text>
          </View>
          <Text style={styles.userName} numberOfLines={1}>
            {displayName}
          </Text>
        </View>
        <TouchableOpacity
          onPress={() => {
            void signOut()
          }}
          style={styles.logoutBtn}
          accessibilityRole="button"
          accessibilityLabel="Log out"
        >
          <Text style={styles.logoutText}>Log out</Text>
        </TouchableOpacity>
      </View>
    </DrawerContentScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, paddingBottom: spacing.xl },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.ms,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
  },
  logoText: { ...typography.h3, color: colors.text },
  nav: { flex: 1, paddingHorizontal: spacing.ms, gap: 2 },
  navItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 11,
    paddingHorizontal: spacing.md,
    borderRadius: radii.sm,
    minHeight: touchTarget,
    position: 'relative',
  },
  navItemActive: { backgroundColor: colors.primaryDim },
  activeBorder: {
    position: 'absolute',
    left: 0,
    top: 8,
    bottom: 8,
    width: 3,
    borderRadius: 2,
    backgroundColor: colors.primary,
  },
  navLabel: { ...typography.body, color: colors.textSecondary },
  navLabelActive: { color: colors.primary, fontWeight: '600' },
  bottom: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  userRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.primaryGlow,
    backgroundColor: colors.primaryDim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: colors.primary, fontWeight: '700', fontSize: 13 },
  userName: { ...typography.body, color: colors.textSecondary, flex: 1 },
  logoutBtn: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    paddingVertical: 9,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: touchTarget,
  },
  logoutText: { ...typography.body, color: colors.textSecondary },
})
