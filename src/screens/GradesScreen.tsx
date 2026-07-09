import React, { useCallback, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useFocusEffect, useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import * as gradesApi from '../api/gradesApi'
import { ApiRequestError } from '../api/client'
import { Screen } from '../components/ui/Screen'
import { Card } from '../components/ui/Card'
import { GradeBadge } from '../components/ui/GradeBadge'
import { LoadingSkeleton } from '../components/ui/LoadingSkeleton'
import { ErrorRetryBlock } from '../components/ui/ErrorRetryBlock'
import type { CurrentGradeCourse, GpaSummary } from '../types/grades'
import type { GradesStackParamList } from '../navigation/GradesNavigator'
import { colors, radii, spacing, typography } from '../theme/tokens'

type Nav = NativeStackNavigationProp<GradesStackParamList>

const NAV_CARDS: Array<{ label: string; route: keyof GradesStackParamList }> = [
  { label: 'Classwork', route: 'Classwork' },
  { label: 'Report Card', route: 'ReportCard' },
  { label: 'Schedule', route: 'Schedule' },
  { label: 'What-If Calculator', route: 'GpaSimulator' },
  { label: 'Contact Teachers', route: 'ContactTeachers' },
  { label: 'Progress Report', route: 'ProgressReport' },
  { label: 'Transcript', route: 'Transcript' },
  { label: 'Attendance', route: 'Attendance' },
]

export default function GradesScreen(): React.JSX.Element {
  const navigation = useNavigation<Nav>()
  const [courses, setCourses] = useState<CurrentGradeCourse[]>([])
  const [gpa, setGpa] = useState<GpaSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const [current, gpaResult] = await Promise.all([gradesApi.getCurrentGrades(), gradesApi.getGpa()])
      setCourses(current.grades)
      setGpa(gpaResult)
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not load your grades.')
    } finally {
      setLoading(false)
    }
  }, [])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load]),
  )

  if (loading) {
    return (
      <Screen edges={['top', 'left', 'right', 'bottom']}>
        <LoadingSkeleton rows={5} />
      </Screen>
    )
  }

  if (error && courses.length === 0) {
    return (
      <Screen edges={['top', 'left', 'right', 'bottom']}>
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

  return (
    <Screen edges={['top', 'left', 'right', 'bottom']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>Grades</Text>

        <Card style={styles.gpaCard}>
          <Text style={styles.gpaValue}>{gpa?.weightedGpa !== null && gpa?.weightedGpa !== undefined ? gpa.weightedGpa.toFixed(2) : '—'}</Text>
          <Text style={styles.gpaCaption}>Weighted GPA{gpa?.systemType ? ` · ${gpa.systemType}` : ''}</Text>
        </Card>

        <View style={styles.navGrid}>
          {NAV_CARDS.map((item) => (
            <Pressable
              key={item.route}
              style={styles.navCard}
              onPress={() => navigation.navigate(item.route)}
              accessibilityRole="button"
              accessibilityLabel={item.label}
            >
              <Text style={styles.navCardLabel}>{item.label}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.sectionTitle}>Courses</Text>
        {courses.length === 0 ? (
          <Text style={styles.emptyText}>No courses found yet.</Text>
        ) : (
          courses.map((course) => (
            <Card key={course.id} style={styles.courseCard}>
              <View style={styles.courseInfo}>
                <Text style={styles.courseName}>{course.name}</Text>
                <Text style={styles.courseTeacher}>{course.teacher}</Text>
              </View>
              <GradeBadge letter={course.letterGrade} size="lg" />
            </Card>
          ))
        )}
      </ScrollView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  scroll: { gap: spacing.md, paddingVertical: spacing.lg },
  title: { ...typography.h1, color: colors.text },
  gpaCard: { alignItems: 'center', gap: spacing.xs },
  gpaValue: { ...typography.display, color: colors.primary },
  gpaCaption: { ...typography.caption, color: colors.textSecondary },
  navGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  navCard: {
    width: '47%',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: spacing.md,
    minHeight: 56,
    justifyContent: 'center',
  },
  navCardLabel: { ...typography.h3, color: colors.text },
  sectionTitle: { ...typography.h2, color: colors.text, marginTop: spacing.sm },
  courseCard: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  courseInfo: { flex: 1, gap: spacing.xs, marginRight: spacing.sm },
  courseName: { ...typography.h3, color: colors.text },
  courseTeacher: { ...typography.caption, color: colors.textSecondary },
  emptyText: { ...typography.body, color: colors.textMuted },
})
