import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native'
import Text from '../components/ui/Text'
import Button from '../components/ui/Button'
import Skeleton from '../components/ui/Skeleton'
import Card from '../components/ui/Card'
import ScreenHeader from '../components/ui/ScreenHeader'
import DeltaCard from '../components/simulator/DeltaCard'
import GradeAdjustRow from '../components/simulator/GradeAdjustRow'
import { colors } from '../constants/colors'
import { fetchGrades, type CourseWithGrade, type GradeData } from '../api/gradesApi'
import {
  calculateGpa,
  isLetterGrade,
  isCourseType,
  type GradeInput,
  type GpaResult,
  type LetterGrade,
} from '../lib/gpa'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toInputs(
  courses: CourseWithGrade[],
  overrides: Record<number, LetterGrade>,
): GradeInput[] {
  const inputs: GradeInput[] = []
  for (const c of courses) {
    if (c.grade === null) continue
    const rawGrade  = overrides[c.id] ?? c.grade.letterGrade
    if (!isLetterGrade(rawGrade)) continue
    const courseType = isCourseType(c.courseType) ? c.courseType : 'STANDARD'
    inputs.push({ letterGrade: rawGrade, courseType, creditHours: c.creditHours })
  }
  return inputs
}

// ─── Loading skeleton ─────────────────────────────────────────────────────────

function LoadingView(): React.JSX.Element {
  return (
    <ScrollView scrollEnabled={false} contentContainerStyle={styles.scrollContent}>
      <Text variant="heading" style={styles.screenTitle}>GPA Simulator</Text>

      {/* DeltaCard skeleton */}
      <Card style={styles.cardSpacing}>
        <View style={styles.skeletonDeltaRow}>
          <View style={{ flex: 1 }}>
            <Skeleton width={80} height={11} style={{ marginBottom: 12 }} />
            <Skeleton width={64} height={40} style={{ marginBottom: 10 }} />
            <Skeleton width={56} height={11} />
          </View>
          <View style={styles.skeletonDivider} />
          <View style={{ flex: 1 }}>
            <Skeleton width={88} height={11} style={{ marginBottom: 12 }} />
            <Skeleton width={100} height={28} />
          </View>
        </View>
      </Card>

      {/* Section header skeleton */}
      <View style={styles.sectionHeader}>
        <Skeleton width={72} height={11} />
        <Skeleton width={40} height={11} />
      </View>

      {/* Row skeletons */}
      {Array.from({ length: 5 }, (_, i) => (
        <Card key={i} style={styles.cardSpacing}>
          <Skeleton width="65%" height={15} style={{ marginBottom: 8 }} />
          <Skeleton width="40%" height={11} style={{ marginBottom: 14 }} />
          <View style={styles.skeletonPillRow}>
            {Array.from({ length: 6 }, (__, j) => (
              <Skeleton key={j} width={44} height={44} radius={8} />
            ))}
          </View>
        </Card>
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
    <View style={styles.centerState}>
      <Text variant="h3" style={styles.stateTitle}>No Grades to Simulate</Text>
      <Text variant="body" color={colors.textSecondary} style={styles.stateMessage}>
        Check back once your courses have grades recorded.
      </Text>
    </View>
  )
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function GpaSimulatorScreen(): React.JSX.Element {
  const [courses,   setCourses]   = useState<CourseWithGrade[]>([])
  const [overrides, setOverrides] = useState<Record<number, LetterGrade>>({})
  const [isLoading, setIsLoading] = useState(true)
  const [error,     setError]     = useState<string | null>(null)

  const loadGrades = useCallback(async (): Promise<void> => {
    setIsLoading(true)
    setError(null)
    setOverrides({})
    try {
      const data = await fetchGrades()
      setCourses([...data.courses].sort((a, b) => a.period - b.period))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load grades.')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => { void loadGrades() }, [loadGrades])

  const originalGpa: GpaResult | null = useMemo(
    () => calculateGpa(toInputs(courses, {})),
    [courses],
  )

  const projectedGpa: GpaResult | null = useMemo(
    () => calculateGpa(toInputs(courses, overrides)),
    [courses, overrides],
  )

  const handleGradeChange = useCallback((courseId: number, grade: LetterGrade): void => {
    setOverrides((prev) => ({ ...prev, [courseId]: grade }))
  }, [])

  const handleReset = useCallback((): void => {
    setOverrides({})
  }, [])

  const hasChanges    = Object.keys(overrides).length > 0
  const gradedCourses = courses.filter(
    (c): c is CourseWithGrade & { grade: GradeData } => c.grade !== null,
  )

  if (isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <ScreenHeader title="GPA Simulator" />
        <LoadingView />
      </View>
    )
  }

  if (error !== null) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <ScreenHeader title="GPA Simulator" />
        <ErrorView message={error} onRetry={() => void loadGrades()} />
      </View>
    )
  }

  if (gradedCourses.length === 0) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <ScreenHeader title="GPA Simulator" />
        <EmptyView />
      </View>
    )
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScreenHeader title="GPA Simulator" />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Text variant="heading" style={styles.screenTitle}>GPA Simulator</Text>

        <DeltaCard
          currentGpa={originalGpa?.weighted ?? null}
          projectedGpa={projectedGpa?.weighted ?? null}
          hasChanges={hasChanges}
        />

        <View style={styles.sectionHeader}>
          <Text variant="label" color={colors.textSecondary}>Courses</Text>
          <TouchableOpacity
            onPress={handleReset}
            disabled={!hasChanges}
            style={[styles.resetButton, !hasChanges && styles.resetButtonDisabled]}
            accessibilityRole="button"
            accessibilityLabel="Reset all grades to original"
            accessibilityState={{ disabled: !hasChanges }}
          >
            <Text style={[styles.resetText, !hasChanges && styles.resetTextDisabled]}>
              ↺ Reset
            </Text>
          </TouchableOpacity>
        </View>

        {gradedCourses.map((course) => (
          <GradeAdjustRow
            key={course.id}
            courseId={course.id}
            courseName={course.name}
            courseType={course.courseType}
            originalGrade={course.grade.letterGrade}
            selectedGrade={overrides[course.id] ?? course.grade.letterGrade}
            onGradeChange={handleGradeChange}
            style={styles.cardSpacing}
          />
        ))}
      </ScrollView>
    </View>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  screenTitle: {
    paddingTop: 24,
    marginBottom: 16,
  },
  cardSpacing: {
    marginBottom: 12,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 24,
    marginBottom: 12,
  },
  resetButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    minHeight: 44,
    justifyContent: 'center',
  },
  resetButtonDisabled: {
    opacity: 0.4,
  },
  resetText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.primary,
  },
  resetTextDisabled: {
    color: colors.textSecondary,
  },
  // Loading skeleton styles
  skeletonDeltaRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  skeletonDivider: {
    width: 1,
    height: 80,
    backgroundColor: colors.border,
    marginHorizontal: 16,
  },
  skeletonPillRow: {
    flexDirection: 'row',
    gap: 6,
  },
  // State views
  centerState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
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
