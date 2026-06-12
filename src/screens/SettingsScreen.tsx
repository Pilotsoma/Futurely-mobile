import React, { useCallback, useState } from 'react'
import {
  Alert,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import Text from '../components/ui/Text'
import Skeleton from '../components/ui/Skeleton'
import ScreenHeader from '../components/ui/ScreenHeader'
import { colors } from '../constants/colors'
import { useAuth } from '../context/AuthContext'
import { fetchStudentData, type StudentData } from '../api/studentApi'

function initials(name: string | null): string {
  if (!name) return 'S'
  const parts = name.trim().split(' ')
  return parts.map(p => p.charAt(0).toUpperCase()).join('').slice(0, 2)
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0])
}

interface SettingsRowProps {
  label: string
  value?: string
  onPress?: () => void
  showChevron?: boolean
}

function SettingsRow({ label, value, onPress, showChevron = true }: SettingsRowProps): React.JSX.Element {
  return (
    <TouchableOpacity
      style={styles.settingsRow}
      onPress={onPress}
      activeOpacity={onPress ? 0.7 : 1}
      disabled={!onPress}
    >
      <Text variant="body" style={{ flex: 1 }}>{label}</Text>
      {value !== undefined && (
        <Text variant="caption" style={{ marginRight: showChevron ? 4 : 0 }}>{value}</Text>
      )}
      {showChevron && onPress && (
        <Text style={{ color: colors.textMuted, fontSize: 16 }}>›</Text>
      )}
    </TouchableOpacity>
  )
}

function SectionTitle({ title }: { title: string }): React.JSX.Element {
  return (
    <Text variant="label" color={colors.textSecondary} style={styles.sectionTitle}>
      {title}
    </Text>
  )
}

export default function SettingsScreen(): React.JSX.Element {
  const { logout } = useAuth()
  const [data, setData] = useState<StudentData | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useFocusEffect(
    useCallback(() => {
      setIsLoading(true)
      fetchStudentData()
        .then(setData)
        .catch(() => null)
        .finally(() => setIsLoading(false))
    }, [])
  )

  const profile = data?.profile ?? null
  const name = data?.name ?? null
  const gradeStr = profile?.gradeLevel ? `${ordinal(profile.gradeLevel)} Grade` : ''
  const classOf = profile?.graduationYear ? `Class of ${profile.graduationYear}` : ''

  function soon(): void {
    Alert.alert('Coming Soon', 'This feature is coming in a future update.')
  }

  function confirmLogout(): void {
    Alert.alert('Log Out?', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Log Out', style: 'destructive', onPress: () => void logout() },
    ])
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
    <ScreenHeader title="Settings" />
    <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
      {/* Profile card */}
      <View style={styles.profileCard}>
        <View style={styles.avatar}>
          {isLoading ? (
            <Skeleton width={40} height={40} radius={20} />
          ) : (
            <Text style={styles.avatarText}>{initials(name)}</Text>
          )}
        </View>
        {isLoading ? (
          <>
            <Skeleton width={160} height={18} style={{ marginTop: 12, borderRadius: 6 }} />
            <Skeleton width={120} height={14} style={{ marginTop: 8, borderRadius: 6 }} />
          </>
        ) : (
          <>
            <Text style={styles.profileName}>{name ?? 'Student'}</Text>
            <Text variant="caption" style={{ marginTop: 4 }}>
              {[gradeStr, classOf].filter(Boolean).join(' · ')}
            </Text>
          </>
        )}
        <TouchableOpacity
          style={styles.changeNameRow}
          onPress={soon}
          activeOpacity={0.7}
        >
          <Text variant="body">Change Name</Text>
          <Text style={{ color: colors.textMuted, fontSize: 16 }}>›</Text>
        </TouchableOpacity>
      </View>

      <SectionTitle title="Appearance" />
      <View style={styles.settingsGroup}>
        <SettingsRow label="Color Theme" value="Dark" onPress={soon} />
        <View style={styles.rowDivider} />
        <SettingsRow label="Color Coding" value="Enabled" onPress={soon} />
      </View>

      <SectionTitle title="Account" />
      <View style={styles.settingsGroup}>
        <SettingsRow label="Login Settings" onPress={soon} />
        <View style={styles.rowDivider} />
        <SettingsRow label="Manage Accounts" onPress={soon} />
      </View>

      <SectionTitle title="Academic Info" />
      <View style={styles.settingsGroup}>
        <SettingsRow
          label="SAT Score"
          value={profile?.satScore?.toString() ?? 'Not set'}
          onPress={soon}
        />
        <View style={styles.rowDivider} />
        <SettingsRow
          label="ACT Score"
          value={profile?.actScore?.toString() ?? 'Not set'}
          onPress={soon}
        />
        <View style={styles.rowDivider} />
        <SettingsRow
          label="Future Plan"
          value={profile?.futureDecision ?? 'Not set'}
          onPress={soon}
        />
        <View style={styles.rowDivider} />
        <SettingsRow
          label="Counselor"
          value={profile?.counselorName ?? 'Unassigned'}
          showChevron={false}
        />
      </View>

      <SectionTitle title="Support" />
      <View style={styles.settingsGroup}>
        <SettingsRow label="Contact Support" onPress={() => Alert.alert('Support', 'Email support@nextstep.ai')} />
        <View style={styles.rowDivider} />
        <SettingsRow label="Terms of Service" onPress={soon} />
        <View style={styles.rowDivider} />
        <SettingsRow label="Privacy Policy" onPress={soon} />
        <View style={styles.rowDivider} />
        <SettingsRow label="Leave A Review" onPress={() => Alert.alert('Thank you!', 'Your feedback means the world to us.')} />
        <View style={styles.rowDivider} />
        <SettingsRow label="NextStep.ai" onPress={() => Alert.alert('NextStep.ai', 'Visit nextstep.ai for more info.')} />
      </View>

      {/* Log Out button */}
      <TouchableOpacity style={styles.logoutBtn} onPress={confirmLogout} activeOpacity={0.7}>
        <Text style={styles.logoutText}>Log Out</Text>
      </TouchableOpacity>

      <Text variant="caption" style={styles.footer}>NextStep v1.0.0 · MVP Build</Text>
    </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.background },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 40 },
  profileCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    alignItems: 'center',
    marginTop: 16,
    marginBottom: 24,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 28, fontWeight: '700', color: colors.background },
  profileName: { fontSize: 18, fontWeight: '700', color: colors.textPrimary, marginTop: 12 },
  changeNameRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    marginTop: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  sectionTitle: { marginBottom: 8 },
  settingsGroup: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 24,
    overflow: 'hidden',
  },
  settingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    minHeight: 44,
  },
  rowDivider: { height: 1, backgroundColor: colors.border, marginLeft: 16 },
  logoutBtn: {
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 16,
  },
  logoutText: { fontSize: 16, fontWeight: '700', color: colors.error },
  footer: { textAlign: 'center' as const, paddingBottom: 40 },
})
