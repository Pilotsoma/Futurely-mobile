import React, { useCallback, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { useFocusEffect, useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { Feather } from '@expo/vector-icons'

import * as gradesApi from '../api/gradesApi'
import { ApiRequestError } from '../api/client'
import { Screen } from '../components/ui/Screen'
import { LoadingSkeleton } from '../components/ui/LoadingSkeleton'
import { ErrorRetryBlock } from '../components/ui/ErrorRetryBlock'
import type { CurrentGradeCourse, GpaSummary } from '../types/grades'
import type { GradesStackParamList } from '../navigation/GradesNavigator'
import { colors, elevation, radii, spacing } from '../theme/tokens'

type Nav = NativeStackNavigationProp<GradesStackParamList>
type FeatherName = React.ComponentProps<typeof Feather>['name']

interface AcademicTool {
  label: string
  description: string
  route: keyof GradesStackParamList
  icon: FeatherName
  color: string
  iconBackground: string
}

const ACADEMIC_TOOLS: AcademicTool[] = [
  {
    label: 'Classwork',
    description: 'Assignments and current averages',
    route: 'Classwork',
    icon: 'bar-chart-2',
    color: '#38D9AC',
    iconBackground: 'rgba(16,185,129,0.15)',
  },
  {
    label: 'Report Card',
    description: 'Official grades by reporting period',
    route: 'ReportCard',
    icon: 'clipboard',
    color: '#68B5FF',
    iconBackground: 'rgba(59,130,246,0.16)',
  },
  {
    label: 'Schedule',
    description: 'Your classes and periods',
    route: 'Schedule',
    icon: 'clock',
    color: '#FFC247',
    iconBackground: 'rgba(245,158,11,0.15)',
  },
  {
    label: 'What-If',
    description: 'Simulate grade and GPA changes',
    route: 'GpaSimulator',
    icon: 'percent',
    color: '#B59BFF',
    iconBackground: 'rgba(127,34,254,0.18)',
  },
  {
    label: 'Teachers',
    description: 'Quickly contact your teachers',
    route: 'ContactTeachers',
    icon: 'mail',
    color: '#FF9658',
    iconBackground: 'rgba(249,115,22,0.15)',
  },
  {
    label: 'Progress',
    description: 'Review interim grade reports',
    route: 'ProgressReport',
    icon: 'trending-up',
    color: '#C1A8FF',
    iconBackground: 'rgba(167,139,250,0.16)',
  },
  {
    label: 'Transcript',
    description: 'Credits and GPA history',
    route: 'Transcript',
    icon: 'file-text',
    color: '#8997FF',
    iconBackground: 'rgba(99,102,241,0.16)',
  },
  {
    label: 'Attendance',
    description: 'Absences, tardies and calendar',
    route: 'Attendance',
    icon: 'calendar',
    color: '#FF777A',
    iconBackground: 'rgba(239,68,68,0.15)',
  },
]

function toFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null

  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiRequestError ? error.message : fallback
}

export default function GradesScreen(): React.JSX.Element {
  const navigation = useNavigation<Nav>()

  const [courses, setCourses] = useState<CurrentGradeCourse[]>([])
  const [gpa, setGpa] = useState<GpaSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [fatalError, setFatalError] = useState<string | null>(null)
  const [inlineError, setInlineError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setFatalError(null)
    setInlineError(null)

    const [currentResult, gpaResult] = await Promise.allSettled([
      gradesApi.getCurrentGrades(),
      gradesApi.getGpa(),
    ])

    if (currentResult.status === 'fulfilled') {
      setCourses(currentResult.value.grades)
    }

    if (gpaResult.status === 'fulfilled') {
      setGpa(gpaResult.value)
    }

    if (
      currentResult.status === 'rejected' &&
      gpaResult.status === 'rejected'
    ) {
      setFatalError(
        getErrorMessage(
          currentResult.reason,
          'Could not load your grades. Please try again.',
        ),
      )
    } else if (currentResult.status === 'rejected') {
      setInlineError(
        getErrorMessage(
          currentResult.reason,
          'Your current course data could not be loaded.',
        ),
      )
    } else if (gpaResult.status === 'rejected') {
      setInlineError(
        getErrorMessage(
          gpaResult.reason,
          'Your GPA could not be loaded.',
        ),
      )
    }

    setLoading(false)
  }, [])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load]),
  )

  const handleRefresh = useCallback(async () => {
    setRefreshing(true)

    try {
      await load()
    } finally {
      setRefreshing(false)
    }
  }, [load])

  const handleSync = useCallback(async () => {
    setSyncing(true)
    setInlineError(null)

    try {
      await gradesApi.syncProfile()
      await load()
    } catch (error) {
      setInlineError(
        getErrorMessage(
          error,
          'Grade sync failed. Please check your portal connection.',
        ),
      )
    } finally {
      setSyncing(false)
    }
  }, [load])

  const unweightedGpa =
    toFiniteNumber(gpa?.unweightedGpa) ??
    toFiniteNumber(gpa?.gpa) ??
    0

  const weightedGpa =
    toFiniteNumber(gpa?.weightedGpa) ??
    toFiniteNumber(gpa?.gpa) ??
    0

  const courseCount = Math.max(
    0,
    Math.round(
      toFiniteNumber(gpa?.courseCount) ?? courses.length,
    ),
  )

  const averageGrade = useMemo(() => {
    const averages = courses
      .map((course) => toFiniteNumber(course.average))
      .filter((value): value is number => value !== null)

    if (averages.length === 0) return null

    return (
      averages.reduce((total, value) => total + value, 0) /
      averages.length
    )
  }, [courses])

  if (loading) {
    return (
      <Screen edges={['top', 'left', 'right']}>
        <LoadingSkeleton rows={5} />
      </Screen>
    )
  }

  if (fatalError) {
    return (
      <Screen edges={['top', 'left', 'right']}>
        <ErrorRetryBlock
          message={fatalError}
          onRetry={() => {
            setLoading(true)
            void load()
          }}
        />
      </Screen>
    )
  }

  return (
    <Screen edges={['top', 'left', 'right']}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void handleRefresh()}
            tintColor={colors.primary}
            colors={[colors.primary]}
            progressBackgroundColor={colors.surface2}
          />
        }
      >
        <View style={styles.header}>
          <Text allowFontScaling={false} style={styles.eyebrow}>
            ACADEMIC CENTER
          </Text>

          <Text allowFontScaling={false} style={styles.pageTitle}>
            Grades
          </Text>

          <Text allowFontScaling={false} style={styles.pageSubtitle}>
            Your GPA, gradebook and academic tools in one place.
          </Text>
        </View>

        <View style={styles.gpaCard}>
          <View pointerEvents="none" style={styles.gpaStripeOne} />
          <View pointerEvents="none" style={styles.gpaStripeTwo} />
          <View pointerEvents="none" style={styles.gpaFooterShade} />

          <View style={styles.gpaTopRow}>
            <View style={styles.gpaHeadingCopy}>
              <Text allowFontScaling={false} style={styles.gpaEyebrow}>
                GPA OVERVIEW
              </Text>

              <Text allowFontScaling={false} style={styles.gpaTitle}>
                Academic standing
              </Text>
            </View>

            <View style={styles.portalPill}>
              <View style={styles.portalDot} />
              <Text allowFontScaling={false} style={styles.portalPillText}>
                {gpa?.systemType ?? 'Portal'}
              </Text>
            </View>
          </View>

          <View style={styles.gpaMetricsRow}>
            <View style={styles.gpaMetric}>
              <Text allowFontScaling={false} style={styles.gpaNumber}>
                {unweightedGpa.toFixed(3)}
              </Text>
              <Text
                allowFontScaling={false}
                style={styles.gpaMetricLabel}
              >
                Unweighted
              </Text>
            </View>

            <View style={styles.gpaDivider} />

            <View style={styles.gpaMetric}>
              <Text allowFontScaling={false} style={styles.gpaNumber}>
                {weightedGpa.toFixed(3)}
              </Text>
              <Text
                allowFontScaling={false}
                style={styles.gpaMetricLabel}
              >
                Weighted
              </Text>
            </View>
          </View>

          <View style={styles.gpaFooter}>
            <View style={styles.gpaSummary}>
              <View style={styles.gpaSummaryItem}>
                <Feather
                  name="book-open"
                  size={14}
                  color="rgba(255,255,255,0.82)"
                />
                <Text
                  allowFontScaling={false}
                  style={styles.gpaSummaryText}
                >
                  {courseCount} {courseCount === 1 ? 'course' : 'courses'}
                </Text>
              </View>

              <View style={styles.summaryDivider} />

              <View style={styles.gpaSummaryItem}>
                <Feather
                  name="activity"
                  size={14}
                  color="rgba(255,255,255,0.82)"
                />
                <Text
                  allowFontScaling={false}
                  style={styles.gpaSummaryText}
                  numberOfLines={1}
                >
                  {averageGrade === null
                    ? 'No average yet'
                    : `${averageGrade.toFixed(1)}% average`}
                </Text>
              </View>
            </View>

            <Pressable
              disabled={syncing}
              onPress={() => void handleSync()}
              style={({ pressed }) => [
                styles.syncButton,
                pressed && !syncing && styles.syncButtonPressed,
                syncing && styles.disabled,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Re-sync grades"
            >
              {syncing ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Feather
                  name="refresh-cw"
                  size={14}
                  color="#FFFFFF"
                />
              )}

              <Text allowFontScaling={false} style={styles.syncButtonText}>
                {syncing ? 'Syncing' : 'Re-sync'}
              </Text>
            </Pressable>
          </View>
        </View>

        {inlineError ? (
          <View style={styles.portalErrorCard}>
            <View style={styles.portalErrorIcon}>
              <Feather
                name="alert-triangle"
                size={17}
                color="#FF8588"
              />
            </View>

            <View style={styles.portalErrorCopy}>
              <Text
                allowFontScaling={false}
                style={styles.portalErrorTitle}
              >
                School portal needs attention
              </Text>
              <Text style={styles.portalErrorText}>
                {inlineError}
              </Text>
            </View>

            <Pressable
              disabled={syncing}
              onPress={() => void handleSync()}
              style={({ pressed }) => [
                styles.portalRetryButton,
                pressed && styles.portalRetryPressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Retry portal sync"
            >
              <Feather
                name="refresh-cw"
                size={14}
                color="#C9BBFF"
              />
            </Pressable>
          </View>
        ) : null}

        <View style={styles.sectionHeader}>
          <View style={styles.sectionHeaderCopy}>
            <Text
              allowFontScaling={false}
              style={styles.sectionEyebrow}
            >
              ACADEMIC TOOLS
            </Text>

            <Text
              allowFontScaling={false}
              style={styles.sectionTitle}
            >
              Everything you need
            </Text>

            <Text
              allowFontScaling={false}
              style={styles.sectionSubtitle}
            >
              Open your gradebook, reports, schedule and planning tools.
            </Text>
          </View>

          <View style={styles.toolsCountBadge}>
            <Feather name="grid" size={14} color="#B9A7FF" />
            <Text
              allowFontScaling={false}
              style={styles.toolsCountText}
            >
              {ACADEMIC_TOOLS.length}
            </Text>
          </View>
        </View>

        <View style={styles.toolsGrid}>
          {ACADEMIC_TOOLS.map((item) => (
            <Pressable
              key={item.route}
              onPress={() => navigation.navigate(item.route)}
              hitSlop={3}
              android_ripple={{
                color: 'rgba(255,255,255,0.07)',
                borderless: false,
              }}
              style={({ pressed }) => [
                styles.toolCard,
                pressed && styles.toolCardPressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel={`Open ${item.label}`}
              accessibilityHint={item.description}
            >
              <View
                pointerEvents="none"
                style={[
                  styles.toolIcon,
                  {
                    backgroundColor: item.iconBackground,
                    borderColor: `${item.color}55`,
                  },
                ]}
              >
                <Feather
                  name={item.icon}
                  size={20}
                  color={item.color}
                />
              </View>

              <View pointerEvents="none" style={styles.toolCopy}>
                <Text
                  allowFontScaling={false}
                  style={styles.toolTitle}
                  numberOfLines={1}
                >
                  {item.label}
                </Text>

                <Text
                  allowFontScaling={false}
                  style={styles.toolDescription}
                  numberOfLines={2}
                >
                  {item.description}
                </Text>
              </View>

              <View pointerEvents="none" style={styles.toolChevron}>
                <Feather
                  name="chevron-right"
                  size={16}
                  color="#8298B7"
                />
              </View>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  scrollContent: {
    paddingTop: 10,
    paddingBottom: 118,
    gap: 16,
  },

  header: {
    gap: 3,
  },
  eyebrow: {
    color: '#7896C2',
    fontSize: 9.5,
    lineHeight: 12,
    fontWeight: '700',
    letterSpacing: 1.25,
  },
  pageTitle: {
    color: '#F7F9FF',
    fontSize: 29,
    lineHeight: 34,
    fontWeight: '800',
    letterSpacing: -0.7,
  },
  pageSubtitle: {
    maxWidth: 310,
    color: '#7F8FA7',
    fontSize: 11.5,
    lineHeight: 17,
  },

  gpaCard: {
    position: 'relative',
    minHeight: 216,
    overflow: 'hidden',
    borderRadius: 23,
    backgroundColor: '#6731F2',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.20)',
    ...elevation.md,
  },
  gpaStripeOne: {
    position: 'absolute',
    top: -100,
    left: 75,
    width: 88,
    height: 410,
    backgroundColor: 'rgba(255,255,255,0.045)',
    transform: [{ rotate: '25deg' }],
  },
  gpaStripeTwo: {
    position: 'absolute',
    top: -90,
    right: 86,
    width: 48,
    height: 395,
    backgroundColor: 'rgba(255,255,255,0.026)',
    transform: [{ rotate: '25deg' }],
  },
  gpaFooterShade: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 57,
    backgroundColor: 'rgba(25,17,80,0.22)',
  },
  gpaTopRow: {
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 15,
  },
  gpaHeadingCopy: {
    flex: 1,
    minWidth: 0,
  },
  gpaEyebrow: {
    color: 'rgba(255,255,255,0.69)',
    fontSize: 9,
    lineHeight: 12,
    fontWeight: '700',
    letterSpacing: 1.05,
  },
  gpaTitle: {
    marginTop: 2,
    color: '#FFFFFF',
    fontSize: 20,
    lineHeight: 25,
    fontWeight: '800',
    letterSpacing: -0.25,
  },
  portalPill: {
    minHeight: 29,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(23,16,72,0.28)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.17)',
  },
  portalDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#43E2B0',
  },
  portalPillText: {
    color: 'rgba(255,255,255,0.90)',
    fontSize: 9.5,
    lineHeight: 12,
    fontWeight: '700',
  },
  gpaMetricsRow: {
    minHeight: 88,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
  },
  gpaMetric: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gpaNumber: {
    color: '#FFFFFF',
    fontSize: 33,
    lineHeight: 39,
    fontWeight: '800',
    letterSpacing: -1,
  },
  gpaMetricLabel: {
    marginTop: 1,
    color: 'rgba(255,255,255,0.72)',
    fontSize: 10.5,
    lineHeight: 14,
    fontWeight: '500',
  },
  gpaDivider: {
    width: 1,
    height: 52,
    backgroundColor: 'rgba(255,255,255,0.21)',
  },
  gpaFooter: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 12,
    paddingBottom: 10,
  },
  gpaSummary: {
    flex: 1,
    minWidth: 0,
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(22,16,70,0.22)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.13)',
  },
  gpaSummaryItem: {
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  gpaSummaryText: {
    flexShrink: 1,
    color: 'rgba(255,255,255,0.82)',
    fontSize: 9,
    lineHeight: 12,
    fontWeight: '600',
  },
  summaryDivider: {
    width: 1,
    height: 17,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  syncButton: {
    minWidth: 84,
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(22,16,70,0.31)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.17)',
  },
  syncButtonPressed: {
    backgroundColor: 'rgba(255,255,255,0.17)',
  },
  syncButtonText: {
    color: '#FFFFFF',
    fontSize: 9.5,
    lineHeight: 12,
    fontWeight: '700',
  },

  portalErrorCard: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 11,
    borderRadius: 16,
    backgroundColor: 'rgba(255,99,103,0.075)',
    borderWidth: 1,
    borderColor: 'rgba(255,99,103,0.24)',
  },
  portalErrorIcon: {
    width: 37,
    height: 37,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: 'rgba(255,99,103,0.09)',
  },
  portalErrorCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  portalErrorTitle: {
    color: '#F0B0B2',
    fontSize: 10.5,
    lineHeight: 14,
    fontWeight: '700',
  },
  portalErrorText: {
    color: '#A98589',
    fontSize: 9,
    lineHeight: 13,
  },
  portalRetryButton: {
    width: 35,
    height: 35,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 11,
    backgroundColor: '#1B163D',
    borderWidth: 1,
    borderColor: 'rgba(167,139,250,0.28)',
  },
  portalRetryPressed: {
    opacity: 0.82,
  },

  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    marginTop: 2,
  },
  sectionHeaderCopy: {
    flex: 1,
    minWidth: 0,
  },
  sectionEyebrow: {
    color: '#7394C1',
    fontSize: 9,
    lineHeight: 12,
    fontWeight: '700',
    letterSpacing: 1.15,
  },
  sectionTitle: {
    marginTop: 2,
    color: '#F3F6FF',
    fontSize: 18,
    lineHeight: 23,
    fontWeight: '800',
    letterSpacing: -0.25,
  },
  sectionSubtitle: {
    maxWidth: 275,
    marginTop: 3,
    color: '#75859D',
    fontSize: 10.5,
    lineHeight: 15,
  },
  toolsCountBadge: {
    minWidth: 47,
    height: 31,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingHorizontal: 9,
    borderRadius: 11,
    backgroundColor: '#14172A',
    borderWidth: 1,
    borderColor: 'rgba(151,119,255,0.27)',
  },
  toolsCountText: {
    color: '#C5B6FF',
    fontSize: 10.5,
    lineHeight: 13,
    fontWeight: '800',
  },

  toolsGrid: {
    width: '100%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 11,
  },
  toolCard: {
    width: '48.45%',
    minHeight: 108,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 11,
    paddingVertical: 11,
    borderRadius: 17,
    backgroundColor: '#142238',
    borderWidth: 1,
    borderColor: '#29415F',
    ...elevation.sm,
  },
  toolCardPressed: {
    opacity: 0.88,
    transform: [{ scale: 0.985 }],
    backgroundColor: '#1A2C46',
  },
  toolIcon: {
    width: 42,
    height: 42,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 13,
    borderWidth: 1,
  },
  toolCopy: {
    flex: 1,
    minWidth: 0,
    gap: 3,
    marginLeft: 9,
    marginRight: 4,
  },
  toolTitle: {
    color: '#F4F7FF',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
    letterSpacing: -0.1,
  },
  toolDescription: {
    color: '#8798B0',
    fontSize: 8.7,
    lineHeight: 12.5,
  },
  toolChevron: {
    width: 25,
    height: 31,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9,
    backgroundColor: '#0A1524',
    borderWidth: 1,
    borderColor: '#294660',
  },

  disabled: {
    opacity: 0.56,
  },
})