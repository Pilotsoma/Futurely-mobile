import React, { useCallback, useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useFocusEffect, useNavigation } from '@react-navigation/native'
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs'
import { Feather } from '@expo/vector-icons'
import { useAuth } from '../context/AuthContext'
import * as studentsApi from '../api/studentsApi'
import * as gradesApi from '../api/gradesApi'
import * as marketplaceApi from '../api/marketplaceApi'
import { ApiRequestError } from '../api/client'
import type { DailyCoinsResult } from '../api/marketplaceApi'
import { Screen } from '../components/ui/Screen'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { LoadingSkeleton } from '../components/ui/LoadingSkeleton'
import { ErrorRetryBlock } from '../components/ui/ErrorRetryBlock'
import { useCountUp, useCountUpFloat } from '../hooks/useCountUp'
import type { StudentMe } from '../types/student'
import type { Assignment } from '../types/assignments'
import type { GpaSummary } from '../types/grades'
import type { MainTabParamList } from '../navigation/MainNavigator'
import { colors, elevation, fonts, radii, spacing, typography } from '../theme/tokens'

type Nav = BottomTabNavigationProp<MainTabParamList>

interface QuickLink {
  label: string
  icon: React.ComponentProps<typeof Feather>['name']
  color: string
  iconBg: string
  route: keyof MainTabParamList
}

// Same 4 destinations + tint colors as web's QUICK_LINKS (app/(app)/dashboard/page.tsx),
// using Feather glyphs instead of color emoji — Android's emoji set renders each
// emoji with its own baked-in background/shape, which clashes with a tinted tile.
// Icon names match MainNavigator's tab bar icons for consistency across the app.
const QUICK_LINKS: QuickLink[] = [
  { label: 'Grades', icon: 'bar-chart-2', color: '#10B981', iconBg: 'rgba(16,185,129,0.16)', route: 'Grades' },
  { label: 'AI Chat', icon: 'message-circle', color: '#6366F1', iconBg: 'rgba(99,102,241,0.18)', route: 'AIChat' },
  { label: 'Planner', icon: 'calendar', color: '#F59E0B', iconBg: 'rgba(245,158,11,0.16)', route: 'Planner' },
  { label: 'Colleges', icon: 'bookmark', color: '#3B82F6', iconBg: 'rgba(59,130,246,0.18)', route: 'Colleges' },
]

function getTimeOfDay(): string {
  const h = new Date().getHours()
  return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening'
}

function formatDate(): string {
  return new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
}

export default function DashboardScreen(): React.JSX.Element {
  const navigation = useNavigation<Nav>()
  const { user } = useAuth()
  const [student, setStudent] = useState<StudentMe | null>(null)
  const [gpa, setGpa] = useState<GpaSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [coinResult, setCoinResult] = useState<DailyCoinsResult | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const [studentResult, gpaResult] = await Promise.all([
        studentsApi.getMe(),
        gradesApi.getGpa().catch(() => null),
      ])
      setStudent(studentResult)
      setGpa(gpaResult)
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not load your dashboard.')
    } finally {
      setLoading(false)
    }
  }, [])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load]),
  )

  useFocusEffect(
    useCallback(() => {
      let cancelled = false
      marketplaceApi
        .claimDailyCoins()
        .then((result) => {
          if (!cancelled && result.claimed) setCoinResult(result)
        })
        .catch(() => undefined)
      return () => {
        cancelled = true
      }
    }, []),
  )

  async function handleResync(): Promise<void> {
    setSyncing(true)
    try {
      await gradesApi.syncProfile()
      await load()
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Sync failed. Please try again.')
    } finally {
      setSyncing(false)
    }
  }

  const profile = student?.profile
  const weighted = gpa?.weightedGpa ?? profile?.weightedGpa ?? null
  const unweighted = gpa?.unweightedGpa ?? profile?.unweightedGpa ?? null
  const animWeighted = useCountUpFloat(weighted)
  const animUnweighted = useCountUpFloat(unweighted)
  const animCourses = useCountUp(student?.stats.totalCourses ?? null)
  const animDueWeek = useCountUp(student?.stats.assignmentsDueThisWeek ?? null)
  const animPending = useCountUp(student?.stats.pendingAssignments ?? null)

  const dueToday: Assignment[] = useMemo(() => {
    if (!student) return []
    const now = new Date()
    return student.assignments.filter((a) => {
      if (a.completed) return false
      const d = new Date(a.dueDate)
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
    })
  }, [student])

  if (loading) {
    return (
      <Screen>
        <LoadingSkeleton rows={4} />
      </Screen>
    )
  }

  if (error && !student) {
    return (
      <Screen>
        <ErrorRetryBlock
          message={error}
          onRetry={() => {
            setLoading(true)
            void load()
          }}
        />
      </Screen>
    )
  }

  const displayName = (student?.name ?? user?.name ?? 'Student').split(' ')[0]

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.greetingLine}>Good {getTimeOfDay()},</Text>
            <Text style={styles.greetingName}>{displayName}</Text>
          </View>
          <Text style={styles.dateChip}>{formatDate()}</Text>
        </View>

        {coinResult ? (
          <Card style={styles.coinCard}>
            <Text style={styles.coinTitle}>+{coinResult.coinBonus} coins claimed today!</Text>
            <Text style={styles.coinSubtitle}>Balance: {coinResult.coins}</Text>
          </Card>
        ) : null}

        <Pressable onPress={() => navigation.navigate('Grades')}>
          <Card style={styles.gpaCard}>
            <Text style={styles.cardLabel}>GPA</Text>
            <View style={styles.gpaRow}>
              <View>
                <Text style={styles.gpaValue}>{unweighted !== null ? animUnweighted.toFixed(2) : '—'}</Text>
                <Text style={styles.gpaCaption}>Unweighted</Text>
              </View>
              <View style={styles.gpaDivider} />
              <View>
                <Text style={styles.gpaValueSecondary}>{weighted !== null ? animWeighted.toFixed(2) : '—'}</Text>
                <Text style={styles.gpaCaption}>Weighted</Text>
              </View>
            </View>
            <Button label="Re-sync grades" onPress={() => void handleResync()} loading={syncing} variant="secondary" />
          </Card>
        </Pressable>

        <Pressable onPress={() => navigation.navigate('Planner')}>
          <Card style={styles.gapSm}>
            <View style={styles.dueHeaderRow}>
              <Text style={styles.cardLabel}>Due Today</Text>
              {dueToday.length > 0 ? (
                <View style={styles.countPill}>
                  <Text style={styles.countPillText}>{dueToday.length}</Text>
                </View>
              ) : null}
            </View>
            {dueToday.length === 0 ? (
              <Text style={styles.emptyMsg}>All clear for today ✓</Text>
            ) : (
              dueToday.slice(0, 3).map((a) => (
                <View key={a.id} style={styles.dueRow}>
                  <View style={styles.dueDot} />
                  <View style={styles.dueInfo}>
                    <Text style={styles.dueTitle} numberOfLines={1}>
                      {a.title}
                    </Text>
                    <Text style={styles.dueSub}>{a.subject}</Text>
                  </View>
                  {a.estimatedMinutes ? <Text style={styles.dueTime}>{a.estimatedMinutes}m</Text> : null}
                </View>
              ))
            )}
          </Card>
        </Pressable>

        {student?.stats ? (
          <View style={styles.statsRow}>
            <Pressable style={styles.statCardWrap} onPress={() => navigation.navigate('Grades')}>
              <Card style={styles.statCard}>
                <Text style={styles.statValue}>{animCourses}</Text>
                <Text style={styles.statLabel}>Courses</Text>
              </Card>
            </Pressable>
            <Pressable style={styles.statCardWrap} onPress={() => navigation.navigate('Planner')}>
              <Card style={styles.statCard}>
                <Text style={styles.statValue}>{animDueWeek}</Text>
                <Text style={styles.statLabel}>Due This Week</Text>
              </Card>
            </Pressable>
            <Pressable style={styles.statCardWrap} onPress={() => navigation.navigate('Planner')}>
              <Card style={styles.statCard}>
                <Text style={styles.statValue}>{animPending}</Text>
                <Text style={styles.statLabel}>Pending</Text>
              </Card>
            </Pressable>
          </View>
        ) : null}

        <View style={styles.quickAccessWrap}>
          <Text style={styles.cardLabel}>Quick Access</Text>
          <View style={styles.quickAccessRow}>
            {QUICK_LINKS.map((link) => (
              <Pressable
                key={link.route}
                style={({ pressed }) => [styles.quickAccessCard, pressed && styles.quickAccessCardPressed]}
                onPress={() => navigation.navigate(link.route)}
                accessibilityRole="button"
                accessibilityLabel={link.label}
              >
                <View style={[styles.quickAccessIcon, { backgroundColor: link.iconBg }]}>
                  <Feather name={link.icon} size={19} color={link.color} />
                </View>
                <Text style={styles.quickAccessLabel}>{link.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        {error ? <Text style={styles.inlineError}>{error}</Text> : null}
      </ScrollView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  scroll: { gap: spacing.md, paddingVertical: spacing.lg },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  greetingLine: { ...typography.body, color: colors.textSecondary },
  greetingName: { ...typography.display, color: colors.text },
  dateChip: {
    ...typography.caption,
    color: colors.textSecondary,
    backgroundColor: colors.surface2,
    borderRadius: radii.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    overflow: 'hidden',
  },
  coinCard: {
    backgroundColor: colors.primaryDim,
    borderColor: colors.primaryGlow,
    borderRadius: radii.lg,
    ...elevation.md,
  },
  coinTitle: { ...typography.h3, color: colors.text },
  coinSubtitle: { ...typography.caption, color: colors.textSecondary },
  gapMd: { gap: spacing.md },
  gapSm: { gap: spacing.sm },
  gpaCard: { gap: spacing.md },
  cardLabel: { ...typography.label, color: colors.textSecondary },
  gpaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xl },
  gpaDivider: { width: 1, height: 40, backgroundColor: colors.border },
  gpaValue: { ...typography.display, color: colors.primary },
  gpaValueSecondary: { ...typography.h1, color: colors.text },
  gpaCaption: { ...typography.caption, color: colors.textSecondary },
  dueHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  countPill: {
    backgroundColor: colors.primaryDim,
    borderRadius: 100,
    paddingHorizontal: spacing.sm,
    minWidth: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countPillText: { ...typography.caption, color: colors.primary, fontFamily: fonts.bold, fontWeight: '700' },
  emptyMsg: { ...typography.body, color: colors.textSecondary },
  dueRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs },
  dueDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.warning },
  dueInfo: { flex: 1, gap: 2 },
  dueTitle: { ...typography.body, color: colors.text },
  dueSub: { ...typography.caption, color: colors.textSecondary },
  dueTime: { ...typography.caption, color: colors.textMuted },
  statsRow: { flexDirection: 'row', gap: spacing.sm },
  statCardWrap: { flex: 1 },
  statCard: { alignItems: 'center', gap: spacing.xs, padding: spacing.md },
  statValue: { ...typography.h1, color: colors.text },
  statLabel: { ...typography.caption, color: colors.textSecondary, textAlign: 'center' },
  quickAccessWrap: { gap: spacing.sm },
  quickAccessRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  quickAccessCard: {
    width: '47%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    ...elevation.sm,
  },
  quickAccessCardPressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
  quickAccessIcon: {
    width: 40,
    height: 40,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickAccessLabel: { ...typography.h3, fontSize: 13.5, color: colors.text, flexShrink: 1 },
  inlineError: { ...typography.caption, color: colors.error },
})
