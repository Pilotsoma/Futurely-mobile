import React, { useCallback, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useFocusEffect, useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { Feather } from '@expo/vector-icons'
import * as gradesApi from '../api/gradesApi'
import { ApiRequestError } from '../api/client'
import { Screen } from '../components/ui/Screen'
import { Card } from '../components/ui/Card'
import { GradeBadge } from '../components/ui/GradeBadge'
import { ListRow } from '../components/ui/ListRow'
import { LoadingSkeleton } from '../components/ui/LoadingSkeleton'
import { ErrorRetryBlock } from '../components/ui/ErrorRetryBlock'
import type { CurrentGradeCourse, GpaSummary } from '../types/grades'
import type { GradesStackParamList } from '../navigation/GradesNavigator'
import { colors, gradeColors, radii, spacing, typography } from '../theme/tokens'

function letterToColor(letter: string | null): string {
  if (letter && letter.charAt(0) in gradeColors) {
    return gradeColors[letter.charAt(0) as keyof typeof gradeColors]
  }
  return colors.textMuted
}

type Nav = NativeStackNavigationProp<GradesStackParamList>

interface NavCard {
  label: string
  route: keyof GradesStackParamList
  icon: React.ComponentProps<typeof Feather>['name']
  color: string
  iconBg: string
}

// Color choices mirror web's grades hub (app/(app)/grades/page.tsx); Feather glyphs
// stand in for web's emoji icons — Android's color-emoji set bakes its own background
// into each glyph, which clashes with a tinted tile (see DashboardScreen quick access).
const NAV_CARDS: NavCard[] = [
  { label: 'Classwork', route: 'Classwork', icon: 'bar-chart-2', color: '#10B981', iconBg: 'rgba(16,185,129,0.14)' },
  { label: 'Report Card', route: 'ReportCard', icon: 'clipboard', color: '#3B82F6', iconBg: 'rgba(59,130,246,0.16)' },
  { label: 'Schedule', route: 'Schedule', icon: 'clock', color: '#F59E0B', iconBg: 'rgba(245,158,11,0.14)' },
  { label: 'What-If Calculator', route: 'GpaSimulator', icon: 'percent', color: colors.primary, iconBg: colors.primaryDim },
  { label: 'Contact Teachers', route: 'ContactTeachers', icon: 'mail', color: '#F97316', iconBg: 'rgba(249,115,22,0.14)' },
  { label: 'Progress Report', route: 'ProgressReport', icon: 'trending-up', color: '#A78BFA', iconBg: 'rgba(167,139,250,0.14)' },
  { label: 'Transcript', route: 'Transcript', icon: 'file-text', color: '#6366F1', iconBg: 'rgba(99,102,241,0.14)' },
  { label: 'Attendance', route: 'Attendance', icon: 'calendar', color: '#EF4444', iconBg: 'rgba(239,68,68,0.14)' },
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

        <Card variant="gradient" style={styles.gpaCard}>
          <Text style={styles.gpaCardLabel}>GPA{gpa?.systemType ? ` · ${gpa.systemType}` : ''}</Text>
          <View style={styles.gpaRow}>
            <View>
              <Text style={styles.gpaValue}>
                {gpa?.unweightedGpa !== null && gpa?.unweightedGpa !== undefined ? gpa.unweightedGpa.toFixed(2) : '—'}
              </Text>
              <Text style={styles.gpaCaption}>Unweighted</Text>
            </View>
            <View style={styles.gpaDivider} />
            <View>
              <Text style={styles.gpaValueSecondary}>
                {gpa?.weightedGpa !== null && gpa?.weightedGpa !== undefined ? gpa.weightedGpa.toFixed(2) : '—'}
              </Text>
              <Text style={styles.gpaCaption}>Weighted</Text>
            </View>
          </View>
        </Card>

        <View style={styles.navGrid}>
          {NAV_CARDS.map((item) => (
            <Pressable
              key={item.route}
              style={({ pressed }) => [styles.navCard, pressed && styles.navCardPressed]}
              onPress={() => navigation.navigate(item.route)}
              accessibilityRole="button"
              accessibilityLabel={item.label}
            >
              <View style={[styles.navCardIcon, { backgroundColor: item.iconBg }]}>
                <Feather name={item.icon} size={18} color={item.color} />
              </View>
              <Text style={styles.navCardLabel}>{item.label}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.sectionTitle}>Courses</Text>
        {courses.length === 0 ? (
          <Text style={styles.emptyText}>No courses found yet.</Text>
        ) : (
          courses.map((course) => (
            <ListRow
              key={course.id}
              leading={<GradeBadge letter={course.letterGrade} size="lg" />}
              title={course.name}
              subtitle={course.teacher}
              trailingValue={course.average !== null ? `${course.average}%` : undefined}
              trailingValueColor={letterToColor(course.letterGrade)}
            />
          ))
        )}
      </ScrollView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  scroll: { gap: spacing.md, paddingVertical: spacing.lg },
  title: { ...typography.h1, color: colors.text },
  gpaCard: { gap: spacing.md },
  gpaCardLabel: { ...typography.label, color: 'rgba(240, 241, 255, 0.7)' },
  gpaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xl },
  gpaDivider: { width: 1, height: 40, backgroundColor: 'rgba(255, 255, 255, 0.16)' },
  gpaValue: { ...typography.display, color: colors.text },
  gpaValueSecondary: { ...typography.h1, color: 'rgba(240, 241, 255, 0.85)' },
  gpaCaption: { ...typography.caption, color: 'rgba(240, 241, 255, 0.7)' },
  navGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  navCard: {
    width: '47%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: spacing.md,
    minHeight: 56,
  },
  navCardPressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
  navCardIcon: {
    width: 40,
    height: 40,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  navCardLabel: { ...typography.h3, fontSize: 13.5, color: colors.text, flexShrink: 1 },
  sectionTitle: { ...typography.h2, color: colors.text, marginTop: spacing.sm },
  emptyText: { ...typography.body, color: colors.textMuted },
})