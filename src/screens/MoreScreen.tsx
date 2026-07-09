import React from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs'
import { Feather } from '@expo/vector-icons'
import { useAuth } from '../context/AuthContext'
import { Screen } from '../components/ui/Screen'
import { ListRow } from '../components/ui/ListRow'
import { Button } from '../components/ui/Button'
import type { MainTabParamList } from '../navigation/MainNavigator'
import { colors, radii, spacing, typography } from '../theme/tokens'

type Nav = BottomTabNavigationProp<MainTabParamList>

function displayFirstName(name: string | null | undefined): string {
  const value = name ?? 'Student'
  if (value.includes(',')) {
    const rest = value.split(',')[1]?.trim() ?? ''
    const first = rest.split(' ')[0] ?? rest
    return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase()
  }
  return value.split(' ')[0] ?? value
}

// Colleges and Settings live one tap away here instead of in the bottom tab
// bar — see MainNavigator.tsx for why (5 prototype-matching primary tabs +
// this 6th overflow tab, all 7 destinations still directly reachable).
export default function MoreScreen(): React.JSX.Element {
  const navigation = useNavigation<Nav>()
  const { user, signOut } = useAuth()
  const displayName = displayFirstName(user?.name)

  return (
    <Screen>
      <Text style={styles.title}>More</Text>

      <View style={styles.userRow}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{displayName.charAt(0).toUpperCase()}</Text>
        </View>
        <View>
          <Text style={styles.userName}>{displayName}</Text>
          <Text style={styles.userEmail} numberOfLines={1}>
            {user?.email}
          </Text>
        </View>
      </View>

      <ListRow
        leading={
          <View style={styles.rowIcon}>
            <Feather name="bookmark" size={18} color={colors.primary} />
          </View>
        }
        title="Colleges"
        subtitle="Saved schools & admission insights"
        rightAccessory={<Feather name="chevron-right" size={18} color={colors.textMuted} />}
        onPress={() => navigation.navigate('Colleges')}
      />

      <ListRow
        leading={
          <View style={styles.rowIcon}>
            <Feather name="settings" size={18} color={colors.primary} />
          </View>
        }
        title="Settings"
        subtitle="Profile, school portal, account"
        rightAccessory={<Feather name="chevron-right" size={18} color={colors.textMuted} />}
        onPress={() => navigation.navigate('Settings')}
      />

      <Button
        label="Sign out"
        onPress={() => void signOut()}
        variant="secondary"
        style={styles.signOutButton}
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  title: { ...typography.h1, color: colors.text, marginBottom: spacing.lg },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.ms,
    marginBottom: spacing.xl,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.primaryGlow,
    backgroundColor: colors.primaryDim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: colors.primary, fontSize: 18, fontWeight: '700' },
  userName: { ...typography.h3, color: colors.text },
  userEmail: { ...typography.caption, color: colors.textSecondary },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: radii.sm,
    backgroundColor: colors.primaryDim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  signOutButton: { marginTop: spacing.lg },
})
