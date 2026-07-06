// MainNavigator — drawer navigation for authenticated users.
//
// Navigation primitive decision: DRAWER, not bottom tabs.
// Reasoning:
//   1. The web app uses a collapsible sidebar — drawer is the faithful RN analog.
//   2. 7 top-level nav items is too many for bottom tabs; iOS bottom tab bars
//      display at most 5 before requiring "More" overflow, which fragments UX.
//   3. DESIGN_SYSTEM.md specifies drawer styles explicitly (sidebar bg, active
//      item left-border, active/inactive colors) — this was designed for a drawer.
//
// Nav order mirrors web (app/(app)/layout.tsx NAV array):
//   Dashboard, Grades, Planner, Study Feed, Colleges, AI Chat, Settings
//
// Marketplace is intentionally excluded — confirmed decision: no nav link on web,
// not included on mobile either.

import React from 'react'
import { View, Text, StyleSheet, TouchableOpacity, Image } from 'react-native'
import {
  createDrawerNavigator,
  DrawerContentScrollView,
  type DrawerContentComponentProps,
} from '@react-navigation/drawer'
import { useNavigation, DrawerActions } from '@react-navigation/native'

import { useTheme } from '../theme/ThemeContext'
import { useAuth } from '../context/AuthContext'

import DashboardScreen  from '../screens/DashboardScreen'
import GradesNavigator  from './GradesNavigator'
import PlannerScreen    from '../screens/PlannerScreen'
import StudyFeedScreen  from '../screens/StudyFeedScreen'
import CollegesScreen   from '../screens/CollegesScreen'
import AIChatScreen     from '../screens/AIChatScreen'
import SettingsScreen   from '../screens/SettingsScreen'

export type MainDrawerParamList = {
  Dashboard:  undefined
  Grades:     undefined
  Planner:    undefined
  StudyFeed:  undefined
  Colleges:   undefined
  AIChat:     undefined
  Settings:   undefined
}

const Drawer = createDrawerNavigator<MainDrawerParamList>()

// ── Nav items with inline SVG path data ──────────────────────────────────────
// Icons mirror web's exact SVG paths (confirmed from app/(app)/layout.tsx NAV array).

interface NavItem {
  name: keyof MainDrawerParamList
  label: string
  icon: string // SVG path data for a 24×24 stroke icon
}

const NAV_ITEMS: NavItem[] = [
  {
    name: 'Dashboard',
    label: 'Dashboard',
    icon: 'M3 3h7v7H3V3zm11 0h7v7h-7V3zM3 14h7v7H3v-7zm11 0h7v7h-7v-7z',
  },
  {
    name: 'Grades',
    label: 'Grades',
    icon: 'M18 20V10M12 20V4M6 20v-6',
  },
  {
    name: 'Planner',
    label: 'Planner',
    icon: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2z',
  },
  {
    name: 'StudyFeed',
    label: 'Study Feed',
    icon: 'M12 2a10 10 0 100 20 10 10 0 000-20zM2 12h20M12 2a15 15 0 014 10 15 15 0 01-4 10 15 15 0 01-4-10 15 15 0 014-10z',
  },
  {
    name: 'Colleges',
    label: 'Colleges',
    icon: 'M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2V9zM9 22V12h6v10',
  },
  {
    name: 'AIChat',
    label: 'AI Chat',
    icon: 'M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z',
  },
  {
    name: 'Settings',
    label: 'Settings',
    icon: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06A1.65 1.65 0 0015 19.4a1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z',
  },
]

// ── Custom drawer content ──────────────────────────────────────────────────────

function DrawerContent(props: DrawerContentComponentProps): React.JSX.Element {
  const { theme } = useTheme()
  const { user, signOut } = useAuth()
  const { state } = props

  const activeRouteName = state.routes[state.index]?.name ?? ''

  const displayName: string = (() => {
    const name = user?.name ?? 'Student'
    if (name.includes(',')) {
      const rest = name.split(',')[1]?.trim() ?? ''
      const first = rest.split(' ')[0] ?? rest
      return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase()
    }
    return name.split(' ')[0] ?? name
  })()

  return (
    <DrawerContentScrollView
      {...props}
      contentContainerStyle={[
        styles.drawerContent,
        { backgroundColor: theme.colors.bg },
      ]}
      scrollEnabled={false}
    >
      {/* Logo row */}
      <View style={styles.logoRow}>
        <Image
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          source={require('../../assets/logo.png') as number}
          style={styles.logoImg}
          accessibilityLabel="Futurely logo"
          resizeMode="contain"
        />
        <Text style={[styles.logoText, { color: theme.colors.text }]}>
          Futurely
        </Text>
      </View>

      {/* Nav items */}
      <View style={styles.nav}>
        {NAV_ITEMS.map(item => {
          const isActive = activeRouteName === item.name
          return (
            <TouchableOpacity
              key={item.name}
              onPress={() => props.navigation.navigate(item.name)}
              style={[
                styles.navItem,
                isActive && {
                  borderLeftColor: theme.colors.primary,
                  backgroundColor: theme.colors.primaryDim,
                },
              ]}
              accessibilityRole="menuitem"
              accessibilityLabel={item.label}
              accessibilityState={{ selected: isActive }}
            >
              {/* Active left border indicator */}
              {isActive && (
                <View
                  style={[
                    styles.activeBorder,
                    { backgroundColor: theme.colors.primary },
                  ]}
                />
              )}
              <Text
                style={[
                  styles.navLabel,
                  {
                    color: isActive
                      ? theme.colors.primary
                      : theme.colors.textSecondary,
                    fontWeight: isActive ? '600' : '500',
                  },
                ]}
              >
                {item.label}
              </Text>
            </TouchableOpacity>
          )
        })}
      </View>

      {/* Bottom: user row + logout */}
      <View style={[styles.bottom, { borderTopColor: theme.colors.border }]}>
        <View style={styles.userRow}>
          <View
            style={[
              styles.avatar,
              {
                backgroundColor: theme.colors.primaryDim,
                borderColor: theme.colors.primaryGlow,
              },
            ]}
          >
            <Text style={[styles.avatarText, { color: theme.colors.primary }]}>
              {displayName.charAt(0).toUpperCase()}
            </Text>
          </View>
          <Text
            style={[styles.userName, { color: theme.colors.textSecondary }]}
            numberOfLines={1}
          >
            {displayName}
          </Text>
        </View>

        <TouchableOpacity
          onPress={() => { void signOut() }}
          style={[
            styles.logoutBtn,
            {
              borderColor: theme.colors.border,
              minHeight: theme.spacing.touchTarget,
            },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Log out"
        >
          <Text style={[styles.logoutText, { color: theme.colors.textSecondary }]}>
            Log out
          </Text>
        </TouchableOpacity>
      </View>
    </DrawerContentScrollView>
  )
}

// ── Hamburger button for screen headers ───────────────────────────────────────

function MenuButton(): React.JSX.Element {
  const { theme } = useTheme()
  const navigation = useNavigation()

  return (
    <TouchableOpacity
      onPress={() => navigation.dispatch(DrawerActions.toggleDrawer())}
      style={styles.menuBtn}
      accessibilityRole="button"
      accessibilityLabel="Open menu"
    >
      <View style={[styles.menuLine, { backgroundColor: theme.colors.text }]} />
      <View style={[styles.menuLine, { backgroundColor: theme.colors.text }]} />
      <View style={[styles.menuLine, { backgroundColor: theme.colors.text }]} />
    </TouchableOpacity>
  )
}

// ── Drawer navigator ───────────────────────────────────────────────────────────

export default function MainNavigator(): React.JSX.Element {
  const { theme } = useTheme()

  const commonHeaderOptions = {
    headerLeft: () => <MenuButton />,
    headerStyle:      { backgroundColor: theme.colors.surface },
    headerTintColor:  theme.colors.text,
    headerTitleStyle: { fontWeight: '600' as const, fontSize: 17 },
    headerShadowVisible: false,
  }

  return (
    <Drawer.Navigator
      drawerContent={(props) => <DrawerContent {...props} />}
      screenOptions={{
        drawerStyle: {
          backgroundColor: theme.colors.bg,
          width: 260,
        },
        drawerType: 'slide',
        overlayColor: 'rgba(0,0,0,0.45)',
        swipeEdgeWidth: 40,
      }}
    >
      <Drawer.Screen
        name="Dashboard"
        component={DashboardScreen}
        options={{ ...commonHeaderOptions, title: 'Dashboard' }}
      />
      <Drawer.Screen
        name="Grades"
        component={GradesNavigator}
        options={{ ...commonHeaderOptions, title: 'Grades', headerShown: false }}
      />
      <Drawer.Screen
        name="Planner"
        component={PlannerScreen}
        options={{ ...commonHeaderOptions, title: 'Planner' }}
      />
      <Drawer.Screen
        name="StudyFeed"
        component={StudyFeedScreen}
        options={{ ...commonHeaderOptions, title: 'Study Feed' }}
      />
      <Drawer.Screen
        name="Colleges"
        component={CollegesScreen}
        options={{ ...commonHeaderOptions, title: 'Colleges' }}
      />
      <Drawer.Screen
        name="AIChat"
        component={AIChatScreen}
        options={{ ...commonHeaderOptions, title: 'AI Chat' }}
      />
      <Drawer.Screen
        name="Settings"
        component={SettingsScreen}
        options={{ ...commonHeaderOptions, title: 'Settings' }}
      />
    </Drawer.Navigator>
  )
}

const styles = StyleSheet.create({
  drawerContent: {
    flex: 1,
    paddingTop: 0,
    paddingBottom: 24,
  },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 24,
  },
  logoImg: {
    width: 36,
    height: 36,
    borderRadius: 7,
  },
  logoText: {
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: -0.4,
  },
  nav: {
    flex: 1,
    paddingHorizontal: 12,
    gap: 2,
  },
  navItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 11,
    paddingHorizontal: 16,
    borderRadius: 10,
    minHeight: 44,
    position: 'relative',
  },
  activeBorder: {
    position: 'absolute',
    left: 0,
    top: 8,
    bottom: 8,
    width: 3,
    borderRadius: 2,
  },
  navLabel: {
    fontSize: 15,
    letterSpacing: 0.1,
  },
  bottom: {
    borderTopWidth: 1,
    paddingTop: 16,
    paddingHorizontal: 16,
    gap: 8,
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 13,
    fontWeight: '700',
  },
  userName: {
    fontSize: 14,
    fontWeight: '500',
    flex: 1,
  },
  logoutBtn: {
    borderWidth: 1,
    borderRadius: 9,
    paddingVertical: 9,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoutText: {
    fontSize: 14,
    fontWeight: '500',
  },
  menuBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 4,
    minWidth: 44,
    minHeight: 44,
    justifyContent: 'center',
  },
  menuLine: {
    height: 2,
    width: 20,
    borderRadius: 1,
  },
})
