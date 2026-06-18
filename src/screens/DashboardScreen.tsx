import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native'
import { useFocusEffect, useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import Text from '../components/ui/Text'
import Skeleton from '../components/ui/Skeleton'
import Button from '../components/ui/Button'
import { colors } from '../constants/colors'
import { fetchStudentData, type StudentData, type Assignment } from '../api/studentApi'
import { getSyncStatus, type SyncStatus } from '../api/portalApi'
import type { AppParamList } from '../navigation/AppNavigator'

type NavProp = NativeStackNavigationProp<AppParamList>

const GRADE_COLORS: Record<string, string> = {
  A: '#34D399',
  B: '#38BDF8',
  C: '#FBBF24',
  D: '#FB923C',
  F: '#F87171',
}

function subjectColor(subject: string): string {
  const palette = ['#7B61FF', '#38BDF8', '#FBBF24', '#FB923C', '#34D399', '#F87171', '#A78BFA']
  let hash = 0
  for (const ch of subject) hash = (hash * 31 + ch.charCodeAt(0)) & 0xffff
  return palette[hash % palette.length] ?? '#8B8FB5'
}

function gradeColor(letter: string): string {
  return GRADE_COLORS[letter.charAt(0).toUpperCase()] ?? colors.textMuted
}

function formatToday(): string {
  return new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0])
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
}

function LoadingSkeleton(): React.JSX.Element {
  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} scrollEnabled={false}>
      <Skeleton width={120} height={14} style={{ marginBottom: 6 }} />
      <Skeleton width={200} height={28} style={{ marginBottom: 6 }} />
      <Skeleton width={100} height={12} style={{ marginBottom: 24 }} />
      <View style={styles.card}>
        <Skeleton width="60%" height={11} style={{ marginBottom: 16 }} />
        <Skeleton width="90%" height={44} />
      </View>
      <View style={[styles.card, { marginTop: 12 }]}>
        <Skeleton width="50%" height={15} style={{ marginBottom: 12 }} />
        <Skeleton width="100%" height={52} />
      </View>
    </ScrollView>
  )
}

function ErrorScreen({ message, onRetry }: { message: string; onRetry: () => void }): React.JSX.Element {
  const isAuthError = message.startsWith('401') || message.toLowerCase().includes('unauthorized')
  return (
    <View style={styles.centerState}>
      <Text variant="h3" color={colors.error} style={{ marginBottom: 8, textAlign: 'center' }}>
        Unable to Load Dashboard
      </Text>
      <Text variant="body" color={colors.textSecondary} style={{ marginBottom: 24, textAlign: 'center' }}>
        {isAuthError
          ? 'Sign in to your NextStep account to view your dashboard.'
          : message}
      </Text>
      <Button label="Try Again" onPress={onRetry} />
    </View>
  )
}

function SyncBanner({ syncStatus }: { syncStatus: SyncStatus | null }): React.JSX.Element | null {
  if (!syncStatus || syncStatus.status === 'complete' || syncStatus.status === 'idle') return null
  if (syncStatus.status === 'syncing') {
    return (
      <View style={styles.syncBanner}>
        <ActivityIndicator size="small" color={colors.primary} style={{ marginRight: 8 }} />
        <Text variant="caption" color={colors.primary}>Syncing your grades…</Text>
      </View>
    )
  }
  if (syncStatus.status === 'error') {
    return (
      <View style={[styles.syncBanner, { backgroundColor: colors.error + '18', borderColor: colors.error + '44' }]}>
        <Text variant="caption" color={colors.error}>
          Grade sync failed: {syncStatus.errorMessage ?? 'Unknown error'}
        </Text>
      </View>
    )
  }
  return null
}

export default function DashboardScreen(): React.JSX.Element {
  const navigation = useNavigation<NavProp>()
  const [data, setData] = useState<StudentData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null)
  const syncPollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopSyncPoll = useCallback((): void => {
    if (syncPollRef.current !== null) {
      clearInterval(syncPollRef.current)
      syncPollRef.current = null
    }
  }, [])

  const checkSyncStatus = useCallback(async (): Promise<void> => {
    try {
      const s = await getSyncStatus()
      setSyncStatus(s)
      // Stop polling once sync resolves
      if (s.status === 'complete' || s.status === 'error' || s.status === 'idle') {
        stopSyncPoll()
        // Reload data if sync just completed
        if (s.status === 'complete') {
          const d = await fetchStudentData().catch(() => null)
          if (d) setData(d)
        }
      }
    } catch {
      // Sync-status endpoint not available (e.g. no school connection) — fail silently
      stopSyncPoll()
    }
  }, [stopSyncPoll])

  const startSyncPoll = useCallback((): void => {
    stopSyncPoll()
    void checkSyncStatus()
    syncPollRef.current = setInterval(() => { void checkSyncStatus() }, 3000)
    // Hard stop after 5 minutes to avoid infinite polling
    setTimeout(stopSyncPoll, 5 * 60 * 1000)
  }, [checkSyncStatus, stopSyncPoll])

  const load = useCallback(async (): Promise<void> => {
    setIsLoading(true)
    setError(null)
    try {
      const d = await fetchStudentData()
      setData(d)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load dashboard.')
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Start sync-status polling on mount; stop on unmount
  useEffect(() => {
    startSyncPoll()
    return stopSyncPoll
  }, [startSyncPoll, stopSyncPoll])

  useFocusEffect(useCallback(() => { void load() }, [load]))

  if (isLoading) return <LoadingSkeleton />
  if (error !== null) return <ErrorScreen message={error} onRetry={() => void load()} />

  const profile = data?.profile ?? null
  const courses = data?.courses ?? []
  const assignments = data?.assignments ?? []
  const stats = data?.stats ?? { totalCourses: 0, completedAssignments: 0, pendingAssignments: 0, assignmentsDueToday: 0, assignmentsDueThisWeek: 0 }

  const now = new Date()
  const dueToday = assignments.filter(a => {
    if (a.completed) return false
    return isSameDay(new Date(a.dueDate), now)
  })

  const firstName = data?.name?.split(' ')[0] ?? 'Student'
  const gradeLevel = profile?.gradeLevel ?? null
  const uGpa = (profile?.unweightedGpa ?? 0).toFixed(2)
  const wGpa = (profile?.weightedGpa ?? 0).toFixed(2)

  const isSyncing = syncStatus?.status === 'syncing'

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
    >
      <SyncBanner syncStatus={syncStatus} />
      {/* Header */}
      <View style={styles.header}>
        <Text variant="body" color={colors.textSecondary}>Good morning,</Text>
        <Text style={styles.nameText}>{firstName}</Text>
        <Text style={styles.dateText}>{formatToday()}</Text>
        {gradeLevel !== null && (
          <View style={styles.gradeBadge}>
            <Text style={styles.gradeBadgeText}>{ordinal(gradeLevel)} Grade</Text>
          </View>
        )}
      </View>

      {/* GPA Card */}
      <TouchableOpacity
        style={[styles.card, styles.gpaCard]}
        onPress={() => navigation.navigate('GradePortal')}
        activeOpacity={0.8}
      >
        <Text variant="label" color={colors.textSecondary} style={{ marginBottom: 12 }}>
          Current GPA
        </Text>
        <View style={styles.gpaRow}>
          <View style={styles.gpaCol}>
            <Text style={styles.gpaValue}>{uGpa}</Text>
            <Text variant="caption">Unweighted</Text>
          </View>
          <View style={styles.gpaDivider} />
          <View style={styles.gpaCol}>
            <Text style={[styles.gpaValue, { color: colors.primary }]}>{wGpa}</Text>
            <Text variant="caption">Weighted</Text>
          </View>
        </View>
      </TouchableOpacity>

      {/* Due Today Card */}
      <View style={[styles.card, { marginTop: 12 }]}>
        <View style={styles.cardHeaderRow}>
          <Text variant="h3">Due Today</Text>
          {dueToday.length > 0 && (
            <View style={styles.countBadge}>
              <Text style={styles.countBadgeText}>{dueToday.length}</Text>
            </View>
          )}
        </View>
        {dueToday.length === 0 ? (
          <Text variant="body" color={colors.textSecondary} style={{ textAlign: 'center', paddingVertical: 16 }}>
            Nothing due today!
          </Text>
        ) : (
          dueToday.slice(0, 5).map((a) => <DueTodayRow key={a.id} assignment={a} />)
        )}
        <TouchableOpacity
          style={styles.viewAllRow}
          onPress={() => navigation.navigate('Planning')}
          activeOpacity={0.7}
        >
          <Text style={styles.viewAllText}>View all →</Text>
        </TouchableOpacity>
      </View>

      {/* Quick Stats */}
      <View style={styles.statsRow}>
        <StatCard value={stats.totalCourses.toString()} label="Courses" />
        <StatCard value={stats.assignmentsDueThisWeek.toString()} label="Due Soon" />
        <StatCard value="3" label="Day Streak 🔥" />
      </View>

      {/* Recent Grades */}
      <View style={[styles.card, { marginTop: 12 }]}>
        <View style={styles.cardHeaderRow}>
          <Text variant="h3">Recent Grades</Text>
          <TouchableOpacity onPress={() => navigation.navigate('GradePortal')} activeOpacity={0.7}>
            <Text style={styles.viewAllText}>See all →</Text>
          </TouchableOpacity>
        </View>
        {courses.slice(0, 3).map((c) => (
          <View key={c.id} style={styles.gradeRow}>
            <Text variant="body" style={{ flex: 1 }}>{c.name}</Text>
            {c.grade ? (
              <>
                <Text style={[styles.letterGrade, { color: gradeColor(c.grade.letterGrade) }]}>
                  {c.grade.letterGrade}
                </Text>
                <Text variant="caption" style={{ minWidth: 48, textAlign: 'right' }}>
                  {c.grade.percentage.toFixed(1)}%
                </Text>
              </>
            ) : (
              <Text variant="caption">—</Text>
            )}
          </View>
        ))}
        {courses.length === 0 && (
          <Text variant="caption" style={{ textAlign: 'center', paddingVertical: 12 }}>
            {isSyncing ? 'Syncing your grades…' : 'No courses found'}
          </Text>
        )}
      </View>

      <View style={{ height: 40 }} />
    </ScrollView>
  )
}

function DueTodayRow({ assignment }: { assignment: Assignment }): React.JSX.Element {
  return (
    <View style={styles.dueTodayRow}>
      <View style={[styles.dot, { backgroundColor: subjectColor(assignment.subject) }]} />
      <View style={{ flex: 1 }}>
        <Text variant="body">{assignment.title}</Text>
        <Text variant="caption">{assignment.subject}</Text>
      </View>
      <Text variant="caption">{assignment.estimatedMinutes}m</Text>
    </View>
  )
}

function StatCard({ value, label }: { value: string; label: string }): React.JSX.Element {
  return (
    <View style={styles.statCard}>
      <Text style={styles.statValue}>{value}</Text>
      <Text variant="caption" style={{ textAlign: 'center' }}>{label}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.background },
  scrollContent: { paddingHorizontal: 20 },
  centerState: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  syncBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primary + '18',
    borderWidth: 1,
    borderColor: colors.primary + '44',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginTop: 12,
    marginBottom: 4,
  },
  // Header
  header: { paddingTop: 24, paddingBottom: 20 },
  nameText: { fontSize: 26, fontWeight: '700', color: colors.textPrimary, marginBottom: 4 },
  dateText: { fontSize: 13, color: colors.textMuted, marginBottom: 10 },
  gradeBadge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.primary,
    borderRadius: 100,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  gradeBadgeText: { fontSize: 11, fontWeight: '700', color: '#FFFFFF' },
  // Cards
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
  },
  gpaCard: { borderLeftWidth: 3, borderLeftColor: colors.primary },
  gpaRow: { flexDirection: 'row', alignItems: 'center' },
  gpaCol: { flex: 1, alignItems: 'center' },
  gpaValue: { fontSize: 32, fontWeight: '700', color: colors.textPrimary },
  gpaDivider: { width: 1, height: 40, backgroundColor: colors.border },
  cardHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  countBadge: {
    backgroundColor: colors.error,
    borderRadius: 100,
    minWidth: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  countBadgeText: { fontSize: 11, fontWeight: '700', color: '#fff' },
  viewAllRow: { alignItems: 'flex-end', marginTop: 8 },
  viewAllText: { fontSize: 13, color: colors.primary, fontWeight: '500' },
  // Due today
  dueTodayRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  // Stats
  statsRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  statCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    alignItems: 'center',
  },
  statValue: { fontSize: 22, fontWeight: '700', color: colors.textPrimary, marginBottom: 4 },
  // Grade rows
  gradeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  letterGrade: { fontSize: 15, fontWeight: '700' as const, marginRight: 8 },
})
