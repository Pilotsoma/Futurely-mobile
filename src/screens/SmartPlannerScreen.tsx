import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import Text from '../components/ui/Text'
import Button from '../components/ui/Button'
import Skeleton from '../components/ui/Skeleton'
import AssignmentCard, { type CardAccent } from '../components/planner/AssignmentCard'
import SectionHeader from '../components/planner/SectionHeader'
import { colors } from '../constants/colors'
import type { PlanningParamList } from '../navigation/PlanningNavigator'
import { fetchStudyPlan, type AiStudyPlan, type StudyPlanDay, type StudySession } from '../api/aiApi'

type NavProp = NativeStackNavigationProp<PlanningParamList>
import {
  fetchAssignments,
  toggleAssignmentComplete,
  type Assignment,
} from '../api/assignmentsApi'
import {
  groupAssignments,
  type SectionKey,
} from '../utils/assignmentGrouper'

// ─── Constants ────────────────────────────────────────────────────────────────

const SKELETON_COUNT = 5

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatHeaderDate(): string {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })
}

function sectionAccent(key: SectionKey): CardAccent {
  if (key === 'overdue') return 'overdue'
  if (key === 'today') return 'today'
  return 'none'
}

function sectionAccentColor(key: SectionKey): string | undefined {
  if (key === 'overdue') return colors.error
  if (key === 'today') return colors.warning
  return undefined
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function SkeletonCard(): React.JSX.Element {
  return (
    <View style={styles.skeletonCard}>
      <Skeleton width={24} height={24} radius={12} style={styles.skeletonCheck} />
      <View style={styles.skeletonBody}>
        <Skeleton width="65%" height={15} style={{ marginBottom: 8 }} />
        <Skeleton width="40%" height={11} />
      </View>
      <Skeleton width={52} height={11} />
    </View>
  )
}

function LoadingView(): React.JSX.Element {
  return (
    <View style={styles.loadingContainer}>
      <Skeleton width={72} height={11} style={styles.skeletonSectionLabel} />
      {Array.from({ length: SKELETON_COUNT }, (_, i) => (
        <SkeletonCard key={i} />
      ))}
    </View>
  )
}

// ─── Error / Empty ────────────────────────────────────────────────────────────

function ErrorView({
  message,
  onRetry,
}: {
  message: string
  onRetry: () => void
}): React.JSX.Element {
  return (
    <View style={styles.centerState}>
      <Text variant="h3" color={colors.error} style={styles.stateTitle}>
        Could Not Load Planner
      </Text>
      <Text variant="body" color={colors.textSecondary} style={styles.stateMessage}>
        {message}
      </Text>
      <Button label="Try Again" onPress={onRetry} />
    </View>
  )
}

function EmptyView(): React.JSX.Element {
  return (
    <View style={styles.centerState}>
      <Text variant="h2" style={styles.stateTitle}>
        You're all caught up!
      </Text>
      <Text variant="body" color={colors.textSecondary} style={styles.stateMessage}>
        No assignments due — enjoy your day!
      </Text>
    </View>
  )
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function SmartPlannerScreen(): React.JSX.Element {
  const navigation = useNavigation<NavProp>()
  const [activeTab, setActiveTab] = useState<'assignments' | 'plan'>('assignments')
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isCompletedExpanded, setIsCompletedExpanded] = useState(false)
  const [togglingIds, setTogglingIds] = useState<Set<number>>(new Set())
  const [studyPlan, setStudyPlan] = useState<AiStudyPlan | null>(null)
  const [isPlanLoading, setIsPlanLoading] = useState(false)
  const [planError, setPlanError] = useState<string | null>(null)

  const headerDate = useMemo(() => formatHeaderDate(), [])

  const plannerSections = useMemo(
    () => groupAssignments(assignments),
    [assignments],
  )

  const loadAssignments = useCallback(async (refresh: boolean = false): Promise<void> => {
    if (refresh) {
      setIsRefreshing(true)
    } else {
      setIsLoading(true)
    }
    setError(null)
    try {
      const data = await fetchAssignments()
      setAssignments(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load assignments.')
    } finally {
      setIsLoading(false)
      setIsRefreshing(false)
    }
  }, [])

  const handleToggle = useCallback(
    async (id: number, completed: boolean): Promise<void> => {
      setTogglingIds((prev) => new Set([...prev, id]))
      setAssignments((prev) =>
        prev.map((a) =>
          a.id === id
            ? { ...a, completed, completedAt: completed ? new Date().toISOString() : null }
            : a,
        ),
      )
      try {
        const updated = await toggleAssignmentComplete(id, completed)
        setAssignments((prev) => prev.map((a) => (a.id === id ? updated : a)))
      } catch {
        setAssignments((prev) =>
          prev.map((a) =>
            a.id === id ? { ...a, completed: !completed, completedAt: null } : a,
          ),
        )
      } finally {
        setTogglingIds((prev) => {
          const next = new Set(prev)
          next.delete(id)
          return next
        })
      }
    },
    [],
  )

  const onCardToggle = useCallback(
    (id: number, completed: boolean): void => {
      void handleToggle(id, completed)
    },
    [handleToggle],
  )

  const loadStudyPlan = useCallback(async (): Promise<void> => {
    setIsPlanLoading(true)
    setPlanError(null)
    try {
      const plan = await fetchStudyPlan()
      setStudyPlan(plan)
    } catch (e) {
      setPlanError(e instanceof Error ? e.message : 'Failed to generate study plan.')
    } finally {
      setIsPlanLoading(false)
    }
  }, [])

  const handleTabChange = useCallback((tab: 'assignments' | 'plan'): void => {
    setActiveTab(tab)
    if (tab === 'plan' && studyPlan === null && !isPlanLoading) {
      void loadStudyPlan()
    }
  }, [studyPlan, isPlanLoading, loadStudyPlan])

  useEffect(() => {
    void loadAssignments()
  }, [loadAssignments])

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <PlannerHeader onCalendar={() => navigation.navigate('Calendar')} date={headerDate} navigation={navigation} />

      {/* Tab bar */}
      <View style={tabBarStyles.container}>
        <TouchableOpacity
          style={[tabBarStyles.tab, activeTab === 'assignments' && tabBarStyles.activeTab]}
          onPress={() => handleTabChange('assignments')}
          activeOpacity={0.7}
        >
          <Text style={[tabBarStyles.tabText, activeTab === 'assignments' && tabBarStyles.activeTabText]}>
            Assignments
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[tabBarStyles.tab, activeTab === 'plan' && tabBarStyles.activeTab]}
          onPress={() => handleTabChange('plan')}
          activeOpacity={0.7}
        >
          <Ionicons
            name="sparkles-outline"
            size={13}
            color={activeTab === 'plan' ? colors.primary : colors.textMuted}
            style={{ marginRight: 4 }}
          />
          <Text style={[tabBarStyles.tabText, activeTab === 'plan' && tabBarStyles.activeTabText]}>
            AI Study Plan
          </Text>
        </TouchableOpacity>
      </View>

      {activeTab === 'assignments' ? (
        isLoading ? (
          <LoadingView />
        ) : error !== null ? (
          <ErrorView message={error} onRetry={() => void loadAssignments()} />
        ) : (
          <ScrollView
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={isRefreshing}
                onRefresh={() => void loadAssignments(true)}
                tintColor={colors.primary}
                colors={[colors.primary]}
              />
            }
            contentContainerStyle={styles.scrollContent}
          >
            {plannerSections.length === 0 ? (
              <EmptyView />
            ) : (
              plannerSections.map((section) => {
                const isCompleted = section.key === 'completed'
                const isExpanded = !isCompleted || isCompletedExpanded
                return (
                  <View key={section.key} style={styles.section}>
                    <SectionHeader
                      label={section.label}
                      count={section.assignments.length}
                      accentColor={sectionAccentColor(section.key)}
                      isCollapsible={isCompleted}
                      isExpanded={isExpanded}
                      onToggleExpand={() => setIsCompletedExpanded((e) => !e)}
                    />
                    {isExpanded &&
                      section.assignments.map((a) => (
                        <AssignmentCard
                          key={a.id}
                          title={a.title}
                          subject={a.subject}
                          estimatedMinutes={a.estimatedMinutes}
                          dueDate={a.dueDate}
                          completed={a.completed}
                          accent={sectionAccent(section.key)}
                          onToggle={() => onCardToggle(a.id, !a.completed)}
                          isToggling={togglingIds.has(a.id)}
                        />
                      ))}
                  </View>
                )
              })
            )}
          </ScrollView>
        )
      ) : (
        <AiPlanView
          plan={studyPlan}
          isLoading={isPlanLoading}
          error={planError}
          onLoad={() => void loadStudyPlan()}
        />
      )}
    </View>
  )
}

// ─── AI Plan Components ───────────────────────────────────────────────────────

function AiSessionCard({ session }: { session: StudySession }): React.JSX.Element {
  return (
    <View style={aiStyles.sessionCard}>
      <View style={{ flex: 1 }}>
        <Text variant="h3" style={{ marginBottom: 2 }}>{session.title}</Text>
        <Text variant="caption" color={colors.textSecondary}>{session.subject} · Due {session.dueDate}</Text>
        {session.notes ? (
          <Text variant="caption" color={colors.textMuted} style={{ marginTop: 4 }}>{session.notes}</Text>
        ) : null}
      </View>
      <View style={aiStyles.minutesBadge}>
        <Text style={aiStyles.minutesText}>{session.minutesToSpend}m</Text>
      </View>
    </View>
  )
}

function AiDaySection({ day }: { day: StudyPlanDay }): React.JSX.Element {
  const totalMin = day.sessions.reduce((sum, s) => sum + s.minutesToSpend, 0)
  return (
    <View style={aiStyles.daySection}>
      <View style={aiStyles.dayHeader}>
        <Text variant="h3" style={{ flex: 1 }}>{day.label}</Text>
        <Text variant="caption" color={colors.textMuted}>{totalMin}m</Text>
      </View>
      {day.sessions.map((s, i) => (
        <AiSessionCard key={`${s.assignmentId}-${i}`} session={s} />
      ))}
    </View>
  )
}

function AiPlanView({
  plan,
  isLoading,
  error,
  onLoad,
}: {
  plan: AiStudyPlan | null
  isLoading: boolean
  error: string | null
  onLoad: () => void
}): React.JSX.Element {
  if (isLoading) {
    return (
      <View style={styles.centerState}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text variant="body" color={colors.textSecondary} style={{ marginTop: 14 }}>
          Generating your study plan…
        </Text>
      </View>
    )
  }
  if (error !== null) {
    return (
      <View style={styles.centerState}>
        <Text variant="h3" color={colors.error} style={styles.stateTitle}>Could Not Generate Plan</Text>
        <Text variant="body" color={colors.textSecondary} style={styles.stateMessage}>{error}</Text>
        <Button label="Try Again" onPress={onLoad} />
      </View>
    )
  }
  if (plan === null) {
    return (
      <View style={styles.centerState}>
        <Ionicons name="sparkles-outline" size={40} color={colors.primary} style={{ marginBottom: 16 }} />
        <Text variant="h2" style={styles.stateTitle}>AI Study Plan</Text>
        <Text variant="body" color={colors.textSecondary} style={styles.stateMessage}>
          NextStep AI will organize your assignments into a smart daily schedule.
        </Text>
        <Button label="Generate Study Plan" onPress={onLoad} />
      </View>
    )
  }
  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={aiStyles.scrollContent}>
      {plan.overview ? (
        <View style={aiStyles.overviewCard}>
          <Ionicons name="sparkles-outline" size={16} color={colors.primary} style={{ marginRight: 8, marginTop: 2 }} />
          <Text variant="body" style={{ flex: 1 }}>{plan.overview}</Text>
        </View>
      ) : null}
      {plan.days.length === 0 ? (
        <EmptyView />
      ) : (
        plan.days.map((day, i) => <AiDaySection key={`${day.label}-${i}`} day={day} />)
      )}
      <TouchableOpacity style={aiStyles.refreshBtn} onPress={onLoad} activeOpacity={0.7}>
        <Ionicons name="refresh-outline" size={15} color={colors.textMuted} />
        <Text variant="caption" color={colors.textMuted} style={{ marginLeft: 6 }}>Regenerate Plan</Text>
      </TouchableOpacity>
    </ScrollView>
  )
}

// ─── PlannerHeader ────────────────────────────────────────────────────────────

import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { NativeStackNavigationProp as NSNP } from '@react-navigation/native-stack'

function PlannerHeader({ onCalendar, date, navigation }: { onCalendar: () => void; date: string; navigation: NSNP<PlanningParamList> }): React.JSX.Element {
  const insets = useSafeAreaInsets()
  return (
    <View style={[plannerHeaderStyles.container, { paddingTop: insets.top + 12 }]}>
      <TouchableOpacity
        style={plannerHeaderStyles.backBtn}
        onPress={() => navigation.goBack()}
        accessibilityRole="button"
        accessibilityLabel="Go back"
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        activeOpacity={0.7}
      >
        <Ionicons name="chevron-back" size={24} color={colors.primary} />
      </TouchableOpacity>
      <View style={{ flex: 1 }}>
        <Text variant="heading">Planner</Text>
        <Text variant="caption" color={colors.textSecondary}>{date}</Text>
      </View>
      <TouchableOpacity
        style={plannerHeaderStyles.calendarBtn}
        onPress={onCalendar}
        accessibilityRole="button"
        accessibilityLabel="Calendar view"
        activeOpacity={0.7}
      >
        <Ionicons name="calendar-outline" size={22} color={colors.primary} />
      </TouchableOpacity>
    </View>
  )
}

const plannerHeaderStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 4,
  },
  calendarBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
})

// ─── Tab Bar Styles ───────────────────────────────────────────────────────────

const tabBarStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingHorizontal: 16,
    paddingTop: 4,
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginRight: 4,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  activeTab: {
    borderBottomColor: colors.primary,
  },
  tabText: {
    fontSize: 14,
    fontWeight: '500' as const,
    color: colors.textMuted,
  },
  activeTabText: {
    color: colors.primary,
    fontWeight: '600' as const,
  },
})

// ─── AI Plan Styles ───────────────────────────────────────────────────────────

const aiStyles = StyleSheet.create({
  scrollContent: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 40 },
  overviewCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colors.primary + '18',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.primary + '44',
    padding: 14,
    marginBottom: 20,
  },
  daySection: {
    marginBottom: 20,
  },
  dayHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    marginBottom: 8,
  },
  sessionCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    marginBottom: 8,
  },
  minutesBadge: {
    backgroundColor: colors.primary + '22',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginLeft: 12,
    alignSelf: 'flex-start',
  },
  minutesText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: colors.primary,
  },
  refreshBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    marginTop: 4,
  },
})

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  scrollContent: {
    paddingBottom: 40,
  },
  section: {
    marginTop: 4,
  },

  // Loading skeleton
  loadingContainer: {
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  skeletonSectionLabel: {
    marginTop: 20,
    marginBottom: 12,
  },
  skeletonCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 16,
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  skeletonCheck: {
    marginRight: 12,
    flexShrink: 0,
  },
  skeletonBody: {
    flex: 1,
    marginRight: 12,
  },

  // States
  centerState: {
    paddingTop: 80,
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  stateTitle: {
    textAlign: 'center',
    marginBottom: 8,
  },
  stateMessage: {
    textAlign: 'center' as const,
    marginBottom: 24,
  },
})
