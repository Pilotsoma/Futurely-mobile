import React, { useCallback, useState } from 'react'
import {
  ScrollView,
  StyleSheet,
  View,
} from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import Text from '../components/ui/Text'
import Button from '../components/ui/Button'
import Skeleton from '../components/ui/Skeleton'
import ScreenHeader from '../components/ui/ScreenHeader'
import { colors } from '../constants/colors'
import { fetchRoadmap, type RoadmapData, type RoadmapMilestone } from '../api/roadmapApi'

function LoadingSkeleton(): React.JSX.Element {
  return (
    <View style={{ padding: 20 }}>
      {[1, 2, 3].map(i => (
        <View key={i} style={[styles.card, { marginBottom: 12 }]}>
          <Skeleton width="50%" height={15} style={{ marginBottom: 12 }} />
          <Skeleton width="100%" height={12} style={{ marginBottom: 8 }} />
          <Skeleton width="70%" height={11} />
        </View>
      ))}
    </View>
  )
}

function ErrorView({ message, onRetry }: { message: string; onRetry: () => void }): React.JSX.Element {
  return (
    <View style={styles.centerState}>
      <Text variant="h3" color={colors.error} style={styles.stateText}>Unable to Load Roadmap</Text>
      <Text variant="body" color={colors.textSecondary} style={styles.stateText}>{message}</Text>
      <Button label="Try Again" onPress={onRetry} />
    </View>
  )
}

function MilestoneRow({ milestone, isLast }: { milestone: RoadmapMilestone; isLast: boolean }): React.JSX.Element {
  const isCurrent = !milestone.done && !isLast
  return (
    <View style={styles.milestoneRow}>
      <View style={styles.milestoneLeft}>
        <View style={[
          styles.gradeCircle,
          milestone.done
            ? { backgroundColor: colors.primary }
            : isCurrent
              ? { borderWidth: 2, borderColor: colors.primary, backgroundColor: 'transparent' }
              : { backgroundColor: colors.border },
        ]}>
          {milestone.done && (
            <Text style={{ fontSize: 14, color: colors.background }}>✓</Text>
          )}
          {!milestone.done && (
            <Text style={{ fontSize: 12, fontWeight: '700', color: isCurrent ? colors.primary : colors.textMuted }}>
              {milestone.grade}
            </Text>
          )}
        </View>
        {!isLast && <View style={styles.milestoneLine} />}
      </View>
      <View style={styles.milestoneContent}>
        <Text variant="h3" style={{ marginBottom: 4 }}>Grade {milestone.grade}</Text>
        <Text variant="caption">{milestone.label}</Text>
      </View>
    </View>
  )
}

export default function RoadmapScreen(): React.JSX.Element {
  const [data, setData] = useState<RoadmapData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    setIsLoading(true)
    setError(null)
    try {
      setData(await fetchRoadmap())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load roadmap.')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useFocusEffect(useCallback(() => { void load() }, [load]))

  const creditsCompleted = data?.creditsCompleted ?? 0
  const creditsRequired = data?.creditsRequired ?? 26
  const percentComplete = data?.percentComplete ?? 0
  const creditsByCategory = data?.creditsByCategory ?? {}
  const milestones = data?.milestones ?? []
  const activeCats = Object.entries(creditsByCategory).filter(([, v]) => v > 0)
  const maxCredits = Math.max(...Object.values(creditsByCategory), 1)

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScreenHeader title="Roadmap" />
      {isLoading ? (
        <LoadingSkeleton />
      ) : error !== null ? (
        <ErrorView message={error} onRetry={() => void load()} />
      ) : (
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          {/* Credits Progress */}
          <View style={styles.card}>
            <Text variant="h3" style={{ marginBottom: 12 }}>Credits to Graduation</Text>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${percentComplete}%` as `${number}%` }]} />
            </View>
            <View style={styles.progressRow}>
              <Text variant="caption">{creditsCompleted} of {creditsRequired} credits earned</Text>
              <Text variant="caption" color={colors.primary}>{percentComplete}% complete</Text>
            </View>
          </View>

          {/* Credits by Category */}
          <View style={[styles.card, { marginTop: 12 }]}>
            <Text variant="h3" style={{ marginBottom: 12 }}>Credits by Subject Area</Text>
            {activeCats.map(([cat, count]) => (
              <View key={cat} style={styles.catRow}>
                <Text variant="body" style={{ flex: 1 }}>{cat}</Text>
                <View style={styles.miniTrack}>
                  <View style={[styles.miniFill, { width: `${(count / maxCredits) * 100}%` as `${number}%` }]} />
                </View>
                <Text variant="caption" style={{ minWidth: 28, textAlign: 'right' }}>{count.toFixed(1)}</Text>
              </View>
            ))}
            {activeCats.length === 0 && (
              <Text variant="caption" color={colors.textMuted}>No credits completed yet</Text>
            )}
          </View>

          {/* Milestones */}
          <View style={[styles.card, { marginTop: 12 }]}>
            <Text variant="h3" style={{ marginBottom: 16 }}>High School Timeline</Text>
            {milestones.map((m, i) => (
              <MilestoneRow key={m.grade} milestone={m} isLast={i === milestones.length - 1} />
            ))}
          </View>

          {/* Goal */}
          <View style={[styles.card, { marginTop: 12, marginBottom: 40 }]}>
            <Text variant="h3" style={{ marginBottom: 12 }}>Your Plan</Text>
            <Text variant="body" style={{ marginBottom: 6 }}>
              Future goal: <Text style={{ color: colors.textPrimary, fontWeight: '600' }}>
                {data?.futureDecision ?? 'Not set'}
              </Text>
            </Text>
            <Text variant="body" style={{ marginBottom: 6 }}>
              Expected graduation: <Text style={{ color: colors.textPrimary, fontWeight: '600' }}>
                {data?.graduationYear ?? '—'}
              </Text>
            </Text>
            <Text variant="body">
              GPA: Unweighted {(data?.unweightedGpa ?? 0).toFixed(3)} | Weighted{' '}
              <Text style={{ color: colors.primary, fontWeight: '600' }}>
                {(data?.weightedGpa ?? 0).toFixed(3)}
              </Text>
            </Text>
          </View>
        </ScrollView>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  centerState: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  stateText: { textAlign: 'center', marginBottom: 8 },
  scrollContent: { paddingHorizontal: 20, paddingTop: 8 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
  },
  progressTrack: {
    width: '100%',
    height: 12,
    backgroundColor: colors.border,
    borderRadius: 6,
    overflow: 'hidden',
    marginBottom: 8,
  },
  progressFill: { height: '100%', backgroundColor: colors.primary, borderRadius: 6 },
  progressRow: { flexDirection: 'row', justifyContent: 'space-between' },
  catRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  miniTrack: { flex: 2, height: 6, backgroundColor: colors.border, borderRadius: 3, overflow: 'hidden' },
  miniFill: { height: '100%', backgroundColor: colors.primary, borderRadius: 3 },
  milestoneRow: { flexDirection: 'row', marginBottom: 4 },
  milestoneLeft: { alignItems: 'center', marginRight: 14 },
  gradeCircle: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
  },
  milestoneLine: { width: 2, flex: 1, backgroundColor: colors.border, minHeight: 16, marginVertical: 4 },
  milestoneContent: { flex: 1, paddingBottom: 20 },
})
