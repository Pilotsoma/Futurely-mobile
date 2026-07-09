import React from 'react'
import { ScrollView, StyleSheet, Text } from 'react-native'
import * as gradesApi from '../../api/gradesApi'
import { usePortalFetch } from '../../hooks/usePortalFetch'
import { Screen } from '../../components/ui/Screen'
import { Card } from '../../components/ui/Card'
import { LoadingSkeleton } from '../../components/ui/LoadingSkeleton'
import { ErrorRetryBlock } from '../../components/ui/ErrorRetryBlock'
import { RawDataView } from '../../components/ui/RawDataView'
import { colors, spacing, typography } from '../../theme/tokens'

// Both HAC and PowerSchool support this endpoint — no UnsupportedPortalBlock needed here.
export default function TranscriptScreen(): React.JSX.Element {
  const { data, loading, error, reload } = usePortalFetch(() => gradesApi.getTranscript())

  return (
    <Screen edges={['left', 'right', 'bottom']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {loading ? (
          <LoadingSkeleton rows={4} />
        ) : error ? (
          <ErrorRetryBlock message={error} onRetry={reload} />
        ) : (
          <Card>
            {data?.systemType ? <Text style={styles.systemType}>{data.systemType}</Text> : null}
            <RawDataView data={data?.transcript} />
          </Card>
        )}
      </ScrollView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  scroll: { paddingVertical: spacing.lg },
  systemType: { ...typography.label, color: colors.textSecondary, marginBottom: spacing.sm },
})
