import React from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import * as gradesApi from '../../api/gradesApi'
import { usePortalFetch } from '../../hooks/usePortalFetch'
import { Screen } from '../../components/ui/Screen'
import { Card } from '../../components/ui/Card'
import { GradeBadge } from '../../components/ui/GradeBadge'
import { LoadingSkeleton } from '../../components/ui/LoadingSkeleton'
import { ErrorRetryBlock } from '../../components/ui/ErrorRetryBlock'
import { UnsupportedPortalBlock } from '../../components/ui/UnsupportedPortalBlock'
import { RawDataView } from '../../components/ui/RawDataView'
import { colors, spacing, typography } from '../../theme/tokens'

// Shows the current grading period only — the backend's `availablePeriods`/
// `currentPeriod` fields are typed `unknown` (upstream-scraped shape), so a
// period switcher isn't built here rather than guessing an unverified format.
export default function ClassworkScreen(): React.JSX.Element {
  const { data, loading, unsupported, error, reload } = usePortalFetch(() => gradesApi.getClasswork())

  return (
    <Screen edges={['left', 'right', 'bottom']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {loading ? (
          <LoadingSkeleton rows={4} />
        ) : unsupported ? (
          <UnsupportedPortalBlock feature="Classwork" />
        ) : error ? (
          <ErrorRetryBlock message={error} onRetry={reload} />
        ) : data && data.classes.length > 0 ? (
          data.classes.map((cls, i) => (
            <Card key={i} style={styles.classCard}>
              <View style={styles.headerRow}>
                <Text style={styles.className}>{cls.name ?? 'Unknown class'}</Text>
                <GradeBadge letter={cls.letterGrade ?? null} />
                {cls.average ? <Text style={styles.average}>{cls.average}%</Text> : null}
              </View>
              {cls.categoryWeights ? <RawDataView data={cls.categoryWeights} /> : null}
            </Card>
          ))
        ) : (
          <Text style={styles.empty}>No classwork found.</Text>
        )}
      </ScrollView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  scroll: { gap: spacing.md, paddingVertical: spacing.lg },
  classCard: { gap: spacing.sm },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  className: { ...typography.h3, color: colors.text, flex: 1 },
  average: { ...typography.body, color: colors.textSecondary },
  empty: { ...typography.body, color: colors.textMuted },
})
