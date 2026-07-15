import React, { useCallback, useState } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import { Feather } from '@expo/vector-icons'

import * as roadmapApi from '../../api/roadmapApi'
import { ApiRequestError } from '../../api/client'
import { Screen } from '../../components/ui/Screen'
import { Card } from '../../components/ui/Card'
import { ListRow } from '../../components/ui/ListRow'
import { ProgressRing } from '../../components/ui/ProgressRing'
import { LoadingSkeleton } from '../../components/ui/LoadingSkeleton'
import { ErrorRetryBlock } from '../../components/ui/ErrorRetryBlock'
import type { Roadmap } from '../../types/roadmap'
import { colors, fonts, gradients, radii, spacing, typography } from '../../theme/tokens'

type FeatherName = React.ComponentProps<typeof Feather>['name']

const CATEGORY_ICON: Record<string, FeatherName> = {
  English: 'book-open',
  Math: 'percent',
  Science: 'activity',
  'Social Studies': 'globe',
  Language: 'message-circle',
  'Fine Arts': 'image',
  'PE / Health': 'heart',
  Electives: 'star',
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`
}

// Endpoint is a plain DB-backed read (not a HAC/PowerSchool portal scrape), so this
// intentionally doesn't reuse usePortalFetch — that hook's UNSUPPORTED-portal branch
// doesn't apply here. Mirrors the same cancellation-guard pattern it demonstrates.
function useRoadmap(): { data: Roadmap | null; loading: boolean; error: string | null; reload: () => void } {
  const [data, setData] = useState<Roadmap | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useFocusEffect(
    useCallback(() => {
      let cancelled = false
      setLoading(true)
      setError(null)

      roadmapApi
        .getRoadmap()
        .then((result) => {
          if (!cancelled) setData(result)
        })
        .catch((err: unknown) => {
          if (!cancelled) setError(err instanceof ApiRequestError ? err.message : 'Something went wrong.')
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })

      return () => {
        cancelled = true
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [reloadKey]),
  )

  return { data, loading, error, reload: () => setReloadKey((k) => k + 1) }
}

export default function RoadmapScreen(): React.JSX.Element {
  const { data, loading, error, reload } = useRoadmap()

  if (loading) {
    return (
      <Screen edges={['left', 'right', 'bottom']}>
        <LoadingSkeleton rows={4} />
      </Screen>
    )
  }

  if (error || !data) {
    return (
      <Screen edges={['left', 'right', 'bottom']}>
        <ErrorRetryBlock message={error ?? 'Could not load your roadmap.'} onRetry={reload} />
      </Screen>
    )
  }

  const categories = Object.entries(data.creditsByCategory).filter(([, credits]) => credits > 0)

  return (
    <Screen edges={['left', 'right', 'bottom']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Card variant="gradient" gradientColors={gradients.hero} style={styles.heroCard}>
          <View style={styles.heroTop}>
            <View>
              <Text style={styles.heroEyebrow}>GRADUATION PROGRESS</Text>
              <Text style={styles.heroTitle}>{ordinal(data.gradeLevel)} Grade</Text>
              {data.graduationYear ? (
                <Text style={styles.heroSubtitle}>Class of {data.graduationYear}</Text>
              ) : null}
            </View>
            <ProgressRing progress={data.percentComplete} size={76} strokeWidth={7}>
              <Text style={styles.ringText}>{data.percentComplete}%</Text>
            </ProgressRing>
          </View>
          <View style={styles.heroCreditsRow}>
            <Feather name="award" size={14} color="rgba(255,255,255,0.86)" />
            <Text style={styles.heroCreditsText}>
              {data.creditsCompleted} of {data.creditsRequired} credits completed
            </Text>
          </View>
        </Card>

        <View style={styles.gpaRow}>
          <Card style={styles.gpaCard}>
            <Text style={styles.gpaLabel}>Unweighted GPA</Text>
            <Text style={styles.gpaValue}>{data.unweightedGpa.toFixed(3)}</Text>
          </Card>
          <Card style={styles.gpaCard}>
            <Text style={styles.gpaLabel}>Weighted GPA</Text>
            <Text style={[styles.gpaValue, styles.gpaValueSecondary]}>{data.weightedGpa.toFixed(3)}</Text>
          </Card>
        </View>

        {categories.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Credits by subject</Text>
            {categories.map(([category, credits]) => (
              <ListRow
                key={category}
                leading={
                  <View style={styles.categoryIcon}>
                    <Feather name={CATEGORY_ICON[category] ?? 'book'} size={16} color={colors.primary} />
                  </View>
                }
                title={category}
                trailingValue={`${credits} cr`}
              />
            ))}
          </View>
        ) : null}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Milestones</Text>
          <View style={styles.timeline}>
            {data.milestones.map((milestone, index) => {
              const isLast = index === data.milestones.length - 1
              const isCurrent = milestone.grade === data.gradeLevel
              return (
                <View key={milestone.grade} style={styles.timelineRow}>
                  <View style={styles.timelineMarkerCol}>
                    <View
                      style={[
                        styles.timelineMarker,
                        milestone.done && styles.timelineMarkerDone,
                        isCurrent && !milestone.done && styles.timelineMarkerCurrent,
                      ]}
                    >
                      {milestone.done ? <Feather name="check" size={11} color={colors.bg} /> : null}
                    </View>
                    {!isLast ? (
                      <View style={[styles.timelineLine, milestone.done && styles.timelineLineDone]} />
                    ) : null}
                  </View>
                  <View style={styles.timelineBody}>
                    <Text style={styles.timelineGrade}>{ordinal(milestone.grade)} Grade</Text>
                    <Text style={styles.timelineLabel}>{milestone.label}</Text>
                  </View>
                </View>
              )
            })}
          </View>
        </View>
      </ScrollView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  scroll: { paddingVertical: spacing.lg, gap: spacing.lg },
  heroCard: { gap: spacing.md },
  heroTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  heroEyebrow: {
    ...typography.label,
    color: 'rgba(255,255,255,0.72)',
  },
  heroTitle: { ...typography.h1, color: '#FFFFFF', marginTop: 4 },
  heroSubtitle: { ...typography.caption, color: 'rgba(255,255,255,0.72)', marginTop: 2 },
  ringText: { ...typography.h3, fontSize: 15, color: '#FFFFFF' },
  heroCreditsRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  heroCreditsText: { ...typography.caption, color: 'rgba(255,255,255,0.86)' },
  gpaRow: { flexDirection: 'row', gap: spacing.sm },
  gpaCard: { flex: 1, gap: 4 },
  gpaLabel: { ...typography.caption, color: colors.textSecondary },
  gpaValue: { ...typography.h2, color: colors.text },
  gpaValueSecondary: { color: colors.primary },
  section: { gap: spacing.sm },
  sectionTitle: { ...typography.label, color: colors.textSecondary },
  categoryIcon: {
    width: 32,
    height: 32,
    borderRadius: radii.sm,
    backgroundColor: colors.primaryDim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timeline: { paddingTop: spacing.xs },
  timelineRow: { flexDirection: 'row', gap: spacing.ms },
  timelineMarkerCol: { alignItems: 'center', width: 22 },
  timelineMarker: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  timelineMarkerDone: { backgroundColor: colors.success, borderColor: colors.success },
  timelineMarkerCurrent: { borderColor: colors.primary },
  timelineLine: { width: 2, flex: 1, minHeight: 20, backgroundColor: colors.border, marginVertical: 2 },
  timelineLineDone: { backgroundColor: colors.success },
  timelineBody: { flex: 1, paddingBottom: spacing.lg },
  timelineGrade: { ...typography.h3, fontSize: 14.5, color: colors.text, fontFamily: fonts.semiBold },
  timelineLabel: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
})
