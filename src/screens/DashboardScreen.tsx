import React, { useCallback, useState } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import { useAuth } from '../context/AuthContext'
import * as studentsApi from '../api/studentsApi'
import * as gradesApi from '../api/gradesApi'
import * as marketplaceApi from '../api/marketplaceApi'
import { ApiRequestError } from '../api/client'
import type { DailyCoinsResult } from '../api/marketplaceApi'
import { Screen } from '../components/ui/Screen'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { LoadingSkeleton } from '../components/ui/LoadingSkeleton'
import { ErrorRetryBlock } from '../components/ui/ErrorRetryBlock'
import type { StudentMe } from '../types/student'
import type { GpaSummary } from '../types/grades'
import { colors, spacing, typography } from '../theme/tokens'

export default function DashboardScreen(): React.JSX.Element {
  const { user } = useAuth()
  const [student, setStudent] = useState<StudentMe | null>(null)
  const [gpa, setGpa] = useState<GpaSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [coinResult, setCoinResult] = useState<DailyCoinsResult | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const [studentResult, gpaResult] = await Promise.all([
        studentsApi.getMe(),
        gradesApi.getGpa().catch(() => null),
      ])
      setStudent(studentResult)
      setGpa(gpaResult)
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not load your dashboard.')
    } finally {
      setLoading(false)
    }
  }, [])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load]),
  )

  useFocusEffect(
    useCallback(() => {
      let cancelled = false
      marketplaceApi
        .claimDailyCoins()
        .then((result) => {
          if (!cancelled && result.claimed) setCoinResult(result)
        })
        .catch(() => undefined)
      return () => {
        cancelled = true
      }
    }, []),
  )

  async function handleResync(): Promise<void> {
    setSyncing(true)
    try {
      await gradesApi.syncProfile()
      await load()
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Sync failed. Please try again.')
    } finally {
      setSyncing(false)
    }
  }

  if (loading) {
    return (
      <Screen>
        <LoadingSkeleton rows={4} />
      </Screen>
    )
  }

  if (error && !student) {
    return (
      <Screen>
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

  const displayName = (student?.name ?? user?.name ?? 'Student').split(' ')[0]
  const profile = student?.profile
  const weighted = gpa?.weightedGpa ?? profile?.weightedGpa ?? null
  const unweighted = gpa?.unweightedGpa ?? profile?.unweightedGpa ?? null

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.greeting}>Welcome back, {displayName}</Text>

        {coinResult ? (
          <Card style={styles.coinCard}>
            <Text style={styles.coinTitle}>+{coinResult.coinBonus} coins claimed today!</Text>
            <Text style={styles.coinSubtitle}>Balance: {coinResult.coins}</Text>
          </Card>
        ) : null}

        <Card style={styles.gapMd}>
          <Text style={styles.cardLabel}>Your GPA</Text>
          <View style={styles.gpaRow}>
            <View>
              <Text style={styles.gpaValue}>{weighted !== null ? weighted.toFixed(2) : '—'}</Text>
              <Text style={styles.gpaCaption}>Weighted</Text>
            </View>
            <View>
              <Text style={styles.gpaValueSecondary}>{unweighted !== null ? unweighted.toFixed(2) : '—'}</Text>
              <Text style={styles.gpaCaption}>Unweighted</Text>
            </View>
          </View>
          <Button label="Re-sync grades" onPress={() => void handleResync()} loading={syncing} variant="secondary" />
        </Card>

        {student?.stats ? (
          <Card style={styles.gapMd}>
            <Text style={styles.cardLabel}>This week</Text>
            <View style={styles.statsRow}>
              <StatItem label="Due today" value={student.stats.assignmentsDueToday} />
              <StatItem label="Due this week" value={student.stats.assignmentsDueThisWeek} />
              <StatItem label="Pending" value={student.stats.pendingAssignments} />
            </View>
          </Card>
        ) : null}

        {error ? <Text style={styles.inlineError}>{error}</Text> : null}
      </ScrollView>
    </Screen>
  )
}

function StatItem({ label, value }: { label: string; value: number }): React.JSX.Element {
  return (
    <View style={styles.statItem}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  scroll: { gap: spacing.md, paddingVertical: spacing.lg },
  greeting: { ...typography.h1, color: colors.text },
  coinCard: { backgroundColor: colors.primaryDim, borderColor: colors.primaryGlow },
  coinTitle: { ...typography.h3, color: colors.text },
  coinSubtitle: { ...typography.caption, color: colors.textSecondary },
  gapMd: { gap: spacing.md },
  cardLabel: { ...typography.label, color: colors.textSecondary },
  gpaRow: { flexDirection: 'row', gap: spacing.xxl },
  gpaValue: { ...typography.display, color: colors.primary },
  gpaValueSecondary: { ...typography.h1, color: colors.text },
  gpaCaption: { ...typography.caption, color: colors.textSecondary },
  statsRow: { flexDirection: 'row', justifyContent: 'space-between' },
  statItem: { alignItems: 'center', gap: spacing.xs },
  statValue: { ...typography.h2, color: colors.text },
  statLabel: { ...typography.caption, color: colors.textSecondary },
  inlineError: { ...typography.caption, color: colors.error },
})
