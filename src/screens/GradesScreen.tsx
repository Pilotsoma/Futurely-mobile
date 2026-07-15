import React, { useCallback, useMemo, useState } from 'react'
import {
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
import {
  colors,
  elevation,
  fonts,
  radii,
  spacing,
} from '../theme/tokens'

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
    color: '#36D5A5',
    iconBackground: 'rgba(16,185,129,0.14)',
  },
  {
    label: 'Report Card',
    description: 'Official grades by reporting period',
    route: 'ReportCard',
    icon: 'clipboard',
    color: '#6CB6FF',
    iconBackground: 'rgba(59,130,246,0.16)',
  },
  {
    label: 'Schedule',
    description: 'Your classes and periods',
    route: 'Schedule',
    icon: 'clock',
    color: '#FFC547',
    iconBackground: 'rgba(245,158,11,0.15)',
  },
  {
    label: 'What-If',
    description: 'Simulate grade and GPA changes',
    route: 'GpaSimulator',
    icon: 'percent',
    color: '#B49AFF',
    iconBackground: 'rgba(127,34,254,0.18)',
  },
  {
    label: 'Teachers',
    description: 'Quickly contact your teachers',
    route: 'ContactTeachers',
    icon: 'mail',
    color: '#FF9A56',
    iconBackground: 'rgba(249,115,22,0.15)',
  },
  {
    label: 'Progress',
    description: 'Review interim grade reports',
    route: 'ProgressReport',
    icon: 'trending-up',
    color: '#C0A7FF',
    iconBackground: 'rgba(167,139,250,0.16)',
  },
  {
    label: 'Transcript',
    description: 'Credits and GPA history',
    route: 'Transcript',
    icon: 'file-text',
    color: '#8794FF',
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
  {
    label: 'Roadmap',
    description: 'Graduation progress and milestones',
    route: 'Roadmap',
    icon: 'flag',
    color: '#5FD0C4',
    iconBackground: 'rgba(16,185,129,0.14)',
  },
]

const ACADEMIC_TOOL_ROWS: AcademicTool[][] = Array.from(
  { length: Math.ceil(ACADEMIC_TOOLS.length / 2) },
  (_, index) => ACADEMIC_TOOLS.slice(index * 2, index * 2 + 2),
)

function toFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function resultMessage(error: unknown, fallback: string): string {
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

    if (currentResult.status === 'rejected' && gpaResult.status === 'rejected') {
      setFatalError(
        resultMessage(currentResult.reason, 'Could not load your grades. Please try again.'),
      )
    } else if (currentResult.status === 'rejected') {
      setInlineError(
        resultMessage(currentResult.reason, 'Your course list could not be loaded.'),
      )
    } else if (gpaResult.status === 'rejected') {
      setInlineError(resultMessage(gpaResult.reason, 'Your GPA could not be loaded.'))
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
      setInlineError(resultMessage(error, 'Grade sync failed. Please try again.'))
    } finally {
      setSyncing(false)
    }
  }, [load])

  const unweightedGpa =
    toFiniteNumber(gpa?.unweightedGpa) ?? toFiniteNumber(gpa?.gpa) ?? 0
  const weightedGpa =
    toFiniteNumber(gpa?.weightedGpa) ?? toFiniteNumber(gpa?.gpa) ?? 0

  const courseCount = Math.max(
    0,
    Math.round(toFiniteNumber(gpa?.courseCount) ?? courses.length),
  )

  const averageGrade = useMemo(() => {
    const validAverages = courses
      .map((course) => toFiniteNumber(course.average))
      .filter((value): value is number => value !== null)

    if (validAverages.length === 0) return null
    return validAverages.reduce((sum, value) => sum + value, 0) / validAverages.length
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
          <View style={styles.headerCopy}>
            <Text allowFontScaling={false} style={styles.eyebrow}>
              ACADEMIC CENTER
            </Text>
            <Text allowFontScaling={false} style={styles.pageTitle}>
              Grades
            </Text>
            <Text allowFontScaling={false} style={styles.pageSubtitle}>
              Your GPA, classes and academic progress in one place.
            </Text>
          </View>
        </View>

        <View style={styles.gpaCard}>
          <View pointerEvents="none" style={styles.gpaStripeLarge} />
          <View pointerEvents="none" style={styles.gpaStripeSmall} />
          <View pointerEvents="none" style={styles.gpaGlow} />

          <View style={styles.gpaContent}>
            <View style={styles.gpaTopRow}>
              <View>
                <Text allowFontScaling={false} style={styles.gpaEyebrow}>
                  GPA OVERVIEW
                </Text>
                <Text allowFontScaling={false} style={styles.gpaTitle}>
                  Academic standing
                </Text>
              </View>

              <View style={styles.gpaTopActions}>
                <View style={styles.portalPill}>
                  <View style={styles.portalDot} />
                  <Text allowFontScaling={false} style={styles.portalPillText}>
                    {gpa?.systemType ?? 'Portal'}
                  </Text>
                </View>

                <Pressable
                  disabled={syncing}
                  onPress={() => void handleSync()}
                  style={({ pressed }) => [
                    styles.gpaSyncButton,
                    pressed && !syncing && styles.gpaSyncButtonPressed,
                    syncing && styles.disabled,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Re-sync grades"
                >
                  <Feather name="refresh-cw" size={13} color="#FFFFFF" />
                  <Text allowFontScaling={false} style={styles.gpaSyncButtonText}>
                    {syncing ? 'Syncing' : 'Re-sync'}
                  </Text>
                </Pressable>
              </View>
            </View>

            <View style={styles.gpaMetricsRow}>
              <View style={styles.gpaMetric}>
                <Text allowFontScaling={false} style={styles.gpaNumber}>
                  {unweightedGpa.toFixed(3)}
                </Text>
                <Text allowFontScaling={false} style={styles.gpaMetricLabel}>
                  Unweighted
                </Text>
              </View>

              <View style={styles.gpaDivider} />

              <View style={styles.gpaMetric}>
                <Text allowFontScaling={false} style={styles.gpaNumber}>
                  {weightedGpa.toFixed(3)}
                </Text>
                <Text allowFontScaling={false} style={styles.gpaMetricLabel}>
                  Weighted
                </Text>
              </View>
            </View>

            <View style={styles.gpaFooter}>
              <View style={styles.heroStat}>
                <Feather name="book-open" size={14} color="rgba(255,255,255,0.82)" />
                <Text allowFontScaling={false} style={styles.heroStatText}>
                  {courseCount} {courseCount === 1 ? 'course' : 'courses'}
                </Text>
              </View>

              <View style={styles.heroStatDivider} />

              <View style={styles.heroStat}>
                <Feather name="activity" size={14} color="rgba(255,255,255,0.82)" />
                <Text allowFontScaling={false} style={styles.heroStatText}>
                  {averageGrade === null ? 'No average yet' : `${averageGrade.toFixed(1)}% average`}
                </Text>
              </View>

            </View>
          </View>
        </View>

        <View style={styles.sectionHeader}>
          <View style={styles.sectionHeaderCopy}>
            <Text allowFontScaling={false} style={styles.sectionEyebrow}>
              ACADEMIC TOOLS
            </Text>
            <Text allowFontScaling={false} style={styles.sectionTitle}>
              Everything you need
            </Text>
            <Text allowFontScaling={false} style={styles.sectionSubtitle}>
              Open your gradebook, reports, schedule and planning tools.
            </Text>
          </View>

          <View style={styles.toolsCountBadge}>
            <Feather name="grid" size={14} color="#A990FF" />
            <Text allowFontScaling={false} style={styles.toolsCountText}>
              {ACADEMIC_TOOLS.length}
            </Text>
          </View>
        </View>

        <View style={styles.toolsGrid}>
          {ACADEMIC_TOOL_ROWS.map((row, rowIndex) => (
            <View key={`academic-tool-row-${rowIndex}`} style={styles.toolRow}>
              {row.map((item) => (
                <View
                  key={item.route}
                  style={[
                    styles.toolCardShell,
                    { borderLeftColor: item.color },
                  ]}
                >
                  <Pressable
                    onPress={() => navigation.navigate(item.route)}
                    style={({ pressed }) => [
                      styles.toolCardPressable,
                      pressed && styles.toolCardPressed,
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={item.label}
                  >
                    <View
                      style={[
                        styles.toolIcon,
                        {
                          backgroundColor: item.iconBackground,
                          borderColor: `${item.color}66`,
                        },
                      ]}
                    >
                      <Feather name={item.icon} size={19} color={item.color} />
                    </View>

                    <Text
                      pointerEvents="none"
                      allowFontScaling={false}
                      style={styles.toolLabel}
                      numberOfLines={1}
                      ellipsizeMode="tail"
                    >
                      {item.label}
                    </Text>

                    <View pointerEvents="none" style={styles.toolChevronBox}>
                      <Feather name="chevron-right" size={16} color="#8EA4C1" />
                    </View>
                  </Pressable>
                </View>
              ))}
            </View>
          ))}
        </View>

        {inlineError ? (
          <View style={styles.inlineErrorCard}>
            <Feather name="alert-circle" size={15} color={colors.error} />
            <Text style={styles.inlineErrorText}>{inlineError}</Text>
          </View>
        ) : null}
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
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 16,
  },
  headerCopy: {
    flex: 1,
    minWidth: 0,
  },
  eyebrow: {
    color: '#7896C2',
    fontFamily: fonts.semiBold,
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 1.35,
  },
  pageTitle: {
    color: '#F7F9FF',
    fontFamily: fonts.bold,
    fontSize: 31,
    lineHeight: 36,
    fontWeight: '700',
    letterSpacing: -0.8,
    marginTop: 2,
  },
  pageSubtitle: {
    color: '#77859A',
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 3,
    maxWidth: 270,
  },
  gpaCard: {
    position: 'relative',
    minHeight: 220,
    overflow: 'hidden',
    borderRadius: 24,
    backgroundColor: '#6430F1',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.20)',
    ...elevation.md,
  },
  gpaStripeLarge: {
    position: 'absolute',
    top: -105,
    left: 72,
    width: 94,
    height: 430,
    backgroundColor: 'rgba(255,255,255,0.045)',
    transform: [{ rotate: '25deg' }],
  },
  gpaStripeSmall: {
    position: 'absolute',
    top: -90,
    right: 88,
    width: 52,
    height: 410,
    backgroundColor: 'rgba(255,255,255,0.028)',
    transform: [{ rotate: '25deg' }],
  },
  gpaGlow: {
    position: 'absolute',
    right: -55,
    bottom: -80,
    width: 190,
    height: 190,
    borderRadius: 95,
    backgroundColor: 'rgba(36,58,206,0.27)',
  },
  gpaContent: {
    minHeight: 220,
    padding: 18,
    justifyContent: 'space-between',
    gap: 17,
  },
  gpaTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  gpaEyebrow: {
    color: 'rgba(255,255,255,0.68)',
    fontFamily: fonts.semiBold,
    fontSize: 9.5,
    fontWeight: '600',
    letterSpacing: 1.15,
  },
  gpaTitle: {
    color: '#FFFFFF',
    fontFamily: fonts.bold,
    fontSize: 20,
    lineHeight: 25,
    fontWeight: '700',
    marginTop: 2,
  },
  gpaTopActions: {
    alignItems: 'flex-end',
    gap: 7,
    flexShrink: 0,
  },
  portalPill: {
    minHeight: 27,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 9,
    borderRadius: 999,
    backgroundColor: 'rgba(19,16,66,0.25)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  portalDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#43E2B0',
  },
  portalPillText: {
    color: 'rgba(255,255,255,0.86)',
    fontFamily: fonts.semiBold,
    fontSize: 9.5,
    fontWeight: '600',
  },
  gpaMetricsRow: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
  },
  gpaMetric: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 0,
  },
  gpaNumber: {
    color: '#FFFFFF',
    fontFamily: fonts.bold,
    fontSize: 33,
    lineHeight: 39,
    fontWeight: '700',
    letterSpacing: -1.1,
  },
  gpaMetricLabel: {
    color: 'rgba(255,255,255,0.70)',
    fontFamily: fonts.medium,
    fontSize: 11,
    fontWeight: '500',
    marginTop: 1,
  },
  gpaDivider: {
    width: 1,
    height: 54,
    backgroundColor: 'rgba(255,255,255,0.20)',
  },
  gpaFooter: {
    minHeight: 39,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 11,
    borderRadius: 13,
    backgroundColor: 'rgba(19,16,66,0.22)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.13)',
  },
  heroStat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  heroStatText: {
    color: 'rgba(255,255,255,0.80)',
    fontFamily: fonts.medium,
    fontSize: 9.5,
    fontWeight: '500',
  },
  heroStatDivider: {
    width: 1,
    height: 17,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  gpaSyncButton: {
    minHeight: 30,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: 'rgba(19,16,66,0.30)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  gpaSyncButtonPressed: {
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  gpaSyncButtonText: {
    color: '#FFFFFF',
    fontFamily: fonts.semiBold,
    fontSize: 10,
    fontWeight: '600',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    marginTop: 4,
  },
  sectionHeaderCopy: {
    flex: 1,
    minWidth: 0,
  },
  sectionEyebrow: {
    color: '#6E91C0',
    fontFamily: fonts.semiBold,
    fontSize: 9.5,
    fontWeight: '600',
    letterSpacing: 1.25,
  },
  sectionTitle: {
    color: colors.text,
    fontFamily: fonts.bold,
    fontSize: 19,
    lineHeight: 24,
    fontWeight: '700',
    marginTop: 2,
  },
  sectionSubtitle: {
    color: '#708098',
    fontFamily: fonts.regular,
    fontSize: 10.5,
    lineHeight: 15,
    marginTop: 2,
    maxWidth: 265,
  },
  toolsCountBadge: {
    minWidth: 48,
    height: 31,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 10,
    borderRadius: 11,
    backgroundColor: '#121729',
    borderWidth: 1,
    borderColor: 'rgba(151,119,255,0.24)',
  },
  toolsCountText: {
    color: '#C5B5FF',
    fontFamily: fonts.bold,
    fontSize: 11,
    fontWeight: '700',
  },
  toolsGrid: {
    width: '100%',
    alignSelf: 'stretch',
    gap: 11,
  },
  toolRow: {
    width: '100%',
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 11,
  },
  toolCardShell: {
    flex: 1,
    flexBasis: 0,
    minWidth: 0,
    height: 94,
    overflow: 'hidden',
    borderRadius: 17,
    backgroundColor: '#16243A',
    borderWidth: 1,
    borderColor: '#2B4262',
    borderLeftWidth: 3,
  },
  toolCardPressable: {
    position: 'relative',
    flex: 1,
    width: '100%',
    minWidth: 0,
  },
  toolCardPressed: {
    opacity: 0.88,
    backgroundColor: '#1D304B',
  },
  toolIcon: {
    position: 'absolute',
    left: 10,
    top: 25,
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 13,
    borderWidth: 1,
    zIndex: 2,
  },
  toolLabel: {
    position: 'absolute',
    left: 62,
    right: 40,
    top: 36,
    color: '#F5F7FF',
    fontSize: 12.5,
    lineHeight: 17,
    fontWeight: '700',
    letterSpacing: -0.1,
    zIndex: 3,
  },
  toolChevronBox: {
    position: 'absolute',
    right: 8,
    top: 31,
    width: 26,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9,
    backgroundColor: '#0D1726',
    borderWidth: 1,
    borderColor: 'rgba(123,151,188,0.25)',
    zIndex: 2,
  },
  inlineErrorCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: spacing.ms,
    borderRadius: radii.md,
    backgroundColor: 'rgba(255,100,103,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,100,103,0.18)',
  },
  inlineErrorText: {
    flex: 1,
    color: colors.error,
    fontFamily: fonts.regular,
    fontSize: 11,
    lineHeight: 16,
  },
  pressed: {
    opacity: 0.82,
    transform: [{ scale: 0.98 }],
  },
  disabled: {
    opacity: 0.55,
  },
})