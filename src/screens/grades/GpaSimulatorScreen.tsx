import React, { useMemo, useState } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import * as gradesApi from '../../api/gradesApi'
import { usePortalFetch } from '../../hooks/usePortalFetch'
import { Screen } from '../../components/ui/Screen'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { LoadingSkeleton } from '../../components/ui/LoadingSkeleton'
import { ErrorRetryBlock } from '../../components/ui/ErrorRetryBlock'
import { UnsupportedPortalBlock } from '../../components/ui/UnsupportedPortalBlock'
import { averageToLetter, detectLevel, gradePoints, type CourseLevel, type GpaType } from '../../constants/gradeScale'
import { colors, spacing, typography } from '../../theme/tokens'

interface SimCourse {
  name: string
  average: number
  level: CourseLevel
}

const LEVELS: CourseLevel[] = ['Regular', 'KAP', 'AP', 'Dual Credit']

// Client-side "what-if" math only — never persists to the server, mirrors
// web's hardcoded Katy ISD scale exactly (see constants/gradeScale.ts).
// Sourced from /integrations/grades/classwork, which is HAC-only.
export default function GpaSimulatorScreen(): React.JSX.Element {
  const { data, loading, unsupported, error, reload } = usePortalFetch(() => gradesApi.getClasswork())
  const [overrides, setOverrides] = useState<Record<number, SimCourse>>({})
  const [gpaType, setGpaType] = useState<GpaType>('weighted')

  const baseCourses: SimCourse[] = useMemo(() => {
    if (!data) return []
    return data.classes
      .filter((c) => c.name)
      .map((c) => {
        const name = c.name as string
        const avg = c.average ? parseFloat(c.average) : NaN
        return { name, average: Number.isNaN(avg) ? 70 : avg, level: detectLevel(name) }
      })
  }, [data])

  const courses = baseCourses.map((c, i) => overrides[i] ?? c)

  function adjustAverage(index: number, delta: number): void {
    setOverrides((prev) => {
      const current = prev[index] ?? courses[index]
      const nextAverage = Math.max(0, Math.min(100, current.average + delta))
      return { ...prev, [index]: { ...current, average: nextAverage } }
    })
  }

  function setLevel(index: number, level: CourseLevel): void {
    setOverrides((prev) => {
      const current = prev[index] ?? courses[index]
      return { ...prev, [index]: { ...current, level } }
    })
  }

  const simulatedGpa = useMemo(() => {
    if (courses.length === 0) return null
    const total = courses.reduce((sum, c) => sum + gradePoints(c.average, c.level, gpaType), 0)
    return Math.round((total / courses.length) * 1000) / 1000
  }, [courses, gpaType])

  if (loading) {
    return (
      <Screen edges={['left', 'right', 'bottom']}>
        <LoadingSkeleton rows={4} />
      </Screen>
    )
  }
  if (unsupported) {
    return (
      <Screen edges={['left', 'right', 'bottom']}>
        <UnsupportedPortalBlock feature="What-if GPA calculator" />
      </Screen>
    )
  }
  if (error) {
    return (
      <Screen edges={['left', 'right', 'bottom']}>
        <ErrorRetryBlock message={error} onRetry={reload} />
      </Screen>
    )
  }

  return (
    <Screen edges={['left', 'right', 'bottom']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.note}>
          Adjust hypothetical grades below to see how they&apos;d affect your GPA. This doesn&apos;t
          save or change your real grades.
        </Text>

        <Card variant="gradient" style={styles.gpaCard}>
          <Text style={styles.gpaValue}>{simulatedGpa !== null ? simulatedGpa.toFixed(2) : '—'}</Text>
          <Text style={styles.gpaCaption}>Simulated {gpaType} GPA</Text>
          <View style={styles.toggleRow}>
            <Button
              label="Weighted"
              variant={gpaType === 'weighted' ? 'primary' : 'secondary'}
              onPress={() => setGpaType('weighted')}
              style={styles.toggleButton}
            />
            <Button
              label="Unweighted"
              variant={gpaType === 'unweighted' ? 'primary' : 'secondary'}
              onPress={() => setGpaType('unweighted')}
              style={styles.toggleButton}
            />
          </View>
        </Card>

        {courses.length === 0 ? (
          <Text style={styles.empty}>No courses found to simulate.</Text>
        ) : (
          courses.map((course, i) => (
            <Card key={i} style={styles.courseCard}>
              <Text style={styles.courseName}>{course.name}</Text>
              <View style={styles.levelRow}>
                {LEVELS.map((level) => (
                  <Button
                    key={level}
                    label={level}
                    variant={course.level === level ? 'primary' : 'secondary'}
                    onPress={() => setLevel(i, level)}
                    style={styles.levelButton}
                  />
                ))}
              </View>
              <View style={styles.averageRow}>
                <Button label="-1" onPress={() => adjustAverage(i, -1)} variant="secondary" style={styles.stepButton} />
                <Text style={styles.averageValue}>
                  {course.average.toFixed(0)} ({averageToLetter(course.average)})
                </Text>
                <Button label="+1" onPress={() => adjustAverage(i, 1)} variant="secondary" style={styles.stepButton} />
              </View>
            </Card>
          ))
        )}
      </ScrollView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  scroll: { gap: spacing.md, paddingVertical: spacing.lg },
  note: { ...typography.caption, color: colors.textSecondary },
  gpaCard: { alignItems: 'center', gap: spacing.sm },
  gpaValue: { ...typography.display, color: colors.text },
  gpaCaption: { ...typography.caption, color: 'rgba(240, 241, 255, 0.7)' },
  toggleRow: { flexDirection: 'row', gap: spacing.sm },
  toggleButton: { flex: 1 },
  courseCard: { gap: spacing.sm },
  courseName: { ...typography.h3, color: colors.text },
  levelRow: { flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap' },
  levelButton: { paddingHorizontal: spacing.sm, height: 36 },
  averageRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  stepButton: { width: 56 },
  averageValue: { ...typography.h2, color: colors.text },
  empty: { ...typography.body, color: colors.textMuted },
})
