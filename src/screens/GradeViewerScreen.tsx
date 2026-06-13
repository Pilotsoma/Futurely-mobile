import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  FlatList,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
  type DimensionValue,
  type StyleProp,
  type ViewStyle,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import Text from '../components/ui/Text'
import Button from '../components/ui/Button'
import ScreenHeader from '../components/ui/ScreenHeader'
import { colors } from '../constants/colors'
import { fetchGrades, type CourseWithGrade, type GpaData } from '../api/gradesApi'
import { coursesCache } from './CourseDetailScreen'
import { getPortalStatus, getCurrentPortalGrades, type PortalStatus } from '../api/portalApi'
import type { GradePortalParamList } from '../navigation/GradePortalNavigator'

type GradeViewerNavProp = NativeStackNavigationProp<GradePortalParamList>

// ─── Types ────────────────────────────────────────────────────────────────────

type GpaMode = 'weighted' | 'unweighted'

interface BadgeStyle {
  text: string
  bg: string
}

// ─── Constants ────────────────────────────────────────────────────────────────

const GRADE_BADGE_STYLES: Record<string, BadgeStyle> = {
  A: { text: colors.success, bg: `${colors.success}26` },
  B: { text: colors.info,    bg: `${colors.info}26` },
  C: { text: colors.warning, bg: `${colors.warning}26` },
  D: { text: colors.orange,  bg: `${colors.orange}26` },
  F: { text: colors.error,   bg: `${colors.error}26` },
}

const FALLBACK_BADGE: BadgeStyle = { text: colors.textMuted, bg: colors.surface }

const COURSE_TYPE_LABELS: Partial<Record<string, string>> = {
  HONORS: 'Honors',
  AP: 'AP',
  IB: 'IB',
}

const SKELETON_ROW_COUNT = 5

// ─── Helpers ──────────────────────────────────────────────────────────────────

function gradeBadge(letterGrade: string): BadgeStyle {
  return GRADE_BADGE_STYLES[letterGrade.charAt(0).toUpperCase()] ?? FALLBACK_BADGE
}

function gpaColor(value: number): string {
  if (value >= 3.5) return colors.primary
  if (value >= 3.0) return colors.info
  if (value >= 2.5) return colors.warning
  return colors.error
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function SkeletonBlock({
  width,
  height,
  style,
}: {
  width: DimensionValue
  height: number
  style?: StyleProp<ViewStyle>
}): React.JSX.Element {
  return (
    <View style={[{ width, height, backgroundColor: colors.border, borderRadius: 6 }, style]} />
  )
}

function LoadingView(): React.JSX.Element {
  return (
    <ScrollView
      style={styles.list}
      scrollEnabled={false}
      contentContainerStyle={styles.listContent}
    >
      <View style={styles.gpaCard}>
        <SkeletonBlock width={120} height={11} style={{ marginBottom: 16 }} />
        <SkeletonBlock width={100} height={44} style={{ marginBottom: 20 }} />
        <SkeletonBlock width={196} height={36} />
      </View>
      <View style={styles.sectionRow}>
        <SkeletonBlock width={72} height={11} />
      </View>
      {Array.from({ length: SKELETON_ROW_COUNT }, (_, i) => (
        <View key={i} style={styles.courseRow}>
          <View style={styles.courseLeft}>
            <SkeletonBlock width="65%" height={15} style={{ marginBottom: 8 }} />
            <SkeletonBlock width="45%" height={11} />
          </View>
          <SkeletonBlock width={52} height={52} style={{ borderRadius: 10 }} />
        </View>
      ))}
    </ScrollView>
  )
}

// ─── Error & Empty ────────────────────────────────────────────────────────────

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
        Unable to Load Grades
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
    <View style={styles.emptyState}>
      <Text variant="h3" style={styles.stateTitle}>
        No Grades Yet
      </Text>
      <Text variant="body" color={colors.textSecondary} style={styles.stateMessage}>
        Your grades will appear here once your courses are set up.
      </Text>
    </View>
  )
}

// ─── GPA Card ─────────────────────────────────────────────────────────────────

function GpaToggle({
  mode,
  onToggle,
}: {
  mode: GpaMode
  onToggle: (m: GpaMode) => void
}): React.JSX.Element {
  const options: GpaMode[] = ['weighted', 'unweighted']
  return (
    <View style={styles.toggle}>
      {options.map((m) => (
        <TouchableOpacity
          key={m}
          style={[styles.togglePill, mode === m && styles.togglePillActive]}
          onPress={() => onToggle(m)}
          accessibilityRole="button"
          accessibilityLabel={`Show ${m} GPA`}
          accessibilityState={{ selected: mode === m }}
        >
          <Text style={[styles.toggleText, mode === m && styles.toggleTextActive]}>
            {m === 'weighted' ? 'Weighted' : 'Unweighted'}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  )
}

function GpaCard({
  gpa,
  mode,
  onToggle,
}: {
  gpa: GpaData | null
  mode: GpaMode
  onToggle: (m: GpaMode) => void
}): React.JSX.Element {
  const displayValue =
    gpa !== null ? (mode === 'weighted' ? gpa.weighted : gpa.unweighted) : null
  const scaleMax = mode === 'weighted' ? '/ 5.0' : '/ 4.0'
  const valueColor = displayValue !== null ? gpaColor(displayValue) : colors.textMuted

  return (
    <View style={styles.gpaCard}>
      <Text variant="label" color={colors.textSecondary} style={styles.gpaLabel}>
        {mode === 'weighted' ? 'Weighted GPA' : 'Unweighted GPA'}
      </Text>
      <View style={styles.gpaValueRow}>
        <Text variant="display" color={valueColor}>
          {displayValue !== null ? displayValue.toFixed(2) : '—'}
        </Text>
        {displayValue !== null && (
          <Text variant="caption" color={colors.textMuted} style={styles.gpaScale}>
            {scaleMax}
          </Text>
        )}
      </View>
      <GpaToggle mode={mode} onToggle={onToggle} />
    </View>
  )
}

// ─── Course Row ───────────────────────────────────────────────────────────────

function CourseTypeBadge({ type }: { type: string }): React.JSX.Element | null {
  const label = COURSE_TYPE_LABELS[type]
  if (label === undefined) return null
  return (
    <View style={styles.typeBadge}>
      <Text style={styles.typeBadgeText}>{label}</Text>
    </View>
  )
}

function CourseRow({
  course,
  onPress,
}: {
  course: CourseWithGrade
  onPress: () => void
}): React.JSX.Element {
  const letterGrade = course.grade?.letterGrade ?? null
  const percentage = course.grade?.percentage ?? null
  const badge = letterGrade !== null ? gradeBadge(letterGrade) : FALLBACK_BADGE

  const displayScore = percentage !== null ? `${percentage.toFixed(1)}%` : null

  return (
    <TouchableOpacity
      style={styles.courseRow}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={`${course.name}, ${displayScore ?? letterGrade ?? 'no grade'}, tap to see assignments`}
    >
      <View style={styles.courseLeft}>
        <View style={styles.courseNameRow}>
          <Text variant="h3" style={styles.courseName}>
            {course.name}
          </Text>
          <CourseTypeBadge type={course.courseType} />
        </View>
        <Text variant="caption" color={colors.textSecondary}>
          {course.teacher} · Period {course.period}
          {course.assignments.length > 0 && ` · ${course.assignments.length} assignments`}
        </Text>
      </View>
      <View style={styles.courseRight}>
        <View
          style={[styles.gradeBadge, { backgroundColor: badge.bg, borderColor: badge.text }]}
        >
          <Text style={[styles.gradeBadgeText, { color: badge.text }]}>
            {letterGrade ?? '—'}
          </Text>
        </View>
        {displayScore !== null && (
          <Text variant="caption" color={colors.textSecondary} style={styles.percentageText}>
            {displayScore}
          </Text>
        )}
        <Ionicons name="chevron-forward" size={14} color={colors.textMuted} style={{ marginTop: 2 }} />
      </View>
    </TouchableOpacity>
  )
}

function Separator(): React.JSX.Element {
  return <View style={styles.separator} />
}

// ─── Portal adapter ───────────────────────────────────────────────────────────

// NOTE: PowerSchool courses from the home page do not include assignment detail.
// assignments[] will be empty for PS users. Only course-level averages are available.
function adaptPortalGrades(
  portalCourses: import('../api/portalApi').NormalizedCourse[]
): CourseWithGrade[] {
  return portalCourses.map((course, index) => ({
    id: index,
    name: course.name,
    teacher: course.teacher,
    period: parseInt(course.period, 10) || (index + 1),
    courseType: 'STANDARD',
    creditHours: 1.0,
    semester: 'CURRENT',
    grade: course.average !== null
      ? {
          letterGrade: course.letterGrade ?? 'N/A',
          percentage: course.average,
          gradingPeriod: 'CURRENT',
        }
      : null,
    assignments: (course.assignments ?? []).map(a => ({
      name: a.name,
      category: a.category,
      score: a.score,
      totalPoints: a.totalPoints,
      percentage: a.percentage,
      dateDue: a.dateDue,
    })),
  }))
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function GradeViewerScreen(): React.JSX.Element {
  const navigation = useNavigation<NativeStackNavigationProp<GradePortalParamList>>()
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [gpa, setGpa] = useState<GpaData | null>(null)
  const [courses, setCourses] = useState<CourseWithGrade[]>([])
  const [gpaMode, setGpaMode] = useState<GpaMode>('weighted')
  const [portalStatus, setPortalStatus] = useState<PortalStatus | null>(null)
  const [dataSource, setDataSource] = useState<'portal' | 'seeded' | 'unknown'>('unknown')

  const loadGrades = useCallback(async (refresh: boolean = false): Promise<void> => {
    if (refresh) {
      setIsRefreshing(true)
    } else {
      setIsLoading(true)
    }
    setError(null)
    try {
      const status = await getPortalStatus()
      setPortalStatus(status)

      if (status.connected) {
        setDataSource('portal')
        const portalCourses = await getCurrentPortalGrades()
        const adapted = adaptPortalGrades(portalCourses)
        setCourses(adapted)

        const graded = adapted.filter(c => c.grade !== null)
        const pointMap: Record<string, number> = { A: 4.0, B: 3.0, C: 2.0, D: 1.0, F: 0.0 }
        const totalPoints = graded.reduce((sum, c) => {
          const letter = (c.grade?.letterGrade ?? 'F').charAt(0)
          return sum + (pointMap[letter] ?? 0)
        }, 0)
        const unweighted = graded.length > 0
          ? Math.round((totalPoints / graded.length) * 100) / 100
          : null

        setGpa(unweighted !== null ? { weighted: unweighted, unweighted } : null)

      } else if (status.sessionExpiresIn === 0 && status.districtUrl !== null) {
        // Session expired or lost — show re-auth prompt
        setDataSource('seeded')
        setError('Your school portal session expired. Please reconnect.')
      } else if (__DEV__) {
        setDataSource('seeded')
        const data = await fetchGrades()
        setGpa(data.gpa)
        setCourses(data.courses)
      } else {
        setDataSource('seeded')
        setCourses([])
        setGpa(null)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load grades.')
    } finally {
      setIsLoading(false)
      setIsRefreshing(false)
    }
  }, [])

  const handleRefresh = useCallback((): void => {
    void loadGrades(true)
  }, [loadGrades])

  useEffect(() => {
    void loadGrades()
  }, [loadGrades])

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      void loadGrades()
    })
    return unsubscribe
  }, [navigation, loadGrades])

  const sortedCourses = useMemo(
    () => [...courses].sort((a, b) => a.period - b.period),
    [courses],
  )

  if (isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <ScreenHeader title="Report Card" />
        <LoadingView />
      </View>
    )
  }

  if (error !== null) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <ScreenHeader title="Report Card" />
        <ErrorView message={error} onRetry={() => void loadGrades()} />
      </View>
    )
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScreenHeader title="Report Card" />
      <FlatList
        style={styles.list}
        data={sortedCourses}
        keyExtractor={(item) => item.id.toString()}
        renderItem={({ item }) => (
          <CourseRow
            course={item}
            onPress={() => {
              coursesCache.current = sortedCourses
              navigation.navigate('CourseDetail', {
                courseId: item.id.toString(),
                courseName: item.name,
              })
            }}
          />
        )}
        ListHeaderComponent={
          <>
            {__DEV__ && dataSource !== 'unknown' && (
              <Text
                style={{ textAlign: 'center', fontSize: 11, color: colors.textMuted, marginTop: 8, marginBottom: 2 }}
              >
                {dataSource === 'portal' ? '🟢 Live portal data' : '🟡 Demo/seeded data'}
              </Text>
            )}
            <GpaCard gpa={gpa} mode={gpaMode} onToggle={setGpaMode} />
            <View style={styles.sectionRow}>
              <Text variant="label" color={colors.textSecondary}>
                Courses
              </Text>
              {sortedCourses.length > 0 && (
                <Text variant="caption" color={colors.textMuted}>
                  {sortedCourses.length}
                </Text>
              )}
            </View>
          </>
        }
        ListEmptyComponent={
          dataSource === 'portal' || portalStatus?.connected ? (
            <View style={styles.emptyState}>
              <Ionicons name="school-outline" size={40} color={colors.textSecondary} />
              <Text variant="h3" style={styles.stateTitle}>No Grades Found</Text>
              <Text variant="body" style={[styles.stateMessage, { color: colors.textSecondary }]}>
                Your school portal is connected but no grades were returned. Grades may not be
                available yet for this term.
              </Text>
            </View>
          ) : (
            <View style={styles.emptyState}>
              <Ionicons name="link-outline" size={40} color={colors.textSecondary} />
              <Text variant="h3" style={styles.stateTitle}>Connect Your School Portal</Text>
              <Text variant="body" style={[styles.stateMessage, { color: colors.textSecondary }]}>
                Link your HAC or PowerSchool account to see your real grades here.
              </Text>
              <TouchableOpacity
                style={{ backgroundColor: colors.primary, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 10 }}
                onPress={() => navigation.navigate('PortalConnect')}
                accessibilityRole="button"
              >
                <Text style={{ color: '#000', fontWeight: '700', fontSize: 14 }}>
                  Connect School Portal
                </Text>
              </TouchableOpacity>
              {__DEV__ && (
                <TouchableOpacity
                  style={{ marginTop: 12 }}
                  onPress={() => {
                    setDataSource('seeded')
                    fetchGrades().then(d => { setGpa(d.gpa); setCourses(d.courses) }).catch(() => {})
                  }}
                >
                  <Text variant="caption" style={{ color: colors.textSecondary }}>
                    [DEV] Load demo data
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          )
        }
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={handleRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
        contentContainerStyle={styles.listContent}
        ItemSeparatorComponent={Separator}
        showsVerticalScrollIndicator={false}
      />
    </View>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  list: {
    flex: 1,
  },
  listContent: {
    paddingBottom: 32,
  },
  // GPA card
  gpaCard: {
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  gpaLabel: {
    marginBottom: 8,
  },
  gpaValueRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    marginBottom: 16,
  },
  gpaScale: {
    marginBottom: 6,
  },
  // Toggle
  toggle: {
    flexDirection: 'row',
    gap: 8,
  },
  togglePill: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 100,
    borderWidth: 1,
    borderColor: colors.border,
    minHeight: 44,
    justifyContent: 'center',
  },
  togglePillActive: {
    backgroundColor: colors.primary + '26',
    borderColor: colors.primary,
  },
  toggleText: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  toggleTextActive: {
    color: colors.primary,
    fontWeight: '600',
  },
  // Section header row
  sectionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 8,
  },
  // Course rows
  courseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  courseLeft: {
    flex: 1,
    marginRight: 12,
  },
  courseNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
    flexWrap: 'wrap',
  },
  courseName: {
    flexShrink: 1,
  },
  courseRight: {
    alignItems: 'center',
    minWidth: 56,
  },
  gradeBadge: {
    width: 52,
    height: 52,
    borderRadius: 10,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gradeBadgeText: {
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: -0.3,
    lineHeight: 20,
  },
  percentageText: {
    marginTop: 4,
  },
  typeBadge: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  typeBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    lineHeight: 14,
  },
  separator: {
    height: 1,
    backgroundColor: colors.border,
    marginHorizontal: 20,
  },
  // States
  centerState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyState: {
    paddingTop: 80,
    alignItems: 'center',
    paddingHorizontal: 20,
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
