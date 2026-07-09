import React from 'react'
import { ScrollView, StyleSheet } from 'react-native'
import * as gradesApi from '../../api/gradesApi'
import { usePortalFetch } from '../../hooks/usePortalFetch'
import { Screen } from '../../components/ui/Screen'
import { Card } from '../../components/ui/Card'
import { LoadingSkeleton } from '../../components/ui/LoadingSkeleton'
import { ErrorRetryBlock } from '../../components/ui/ErrorRetryBlock'
import { UnsupportedPortalBlock } from '../../components/ui/UnsupportedPortalBlock'
import { RawDataView } from '../../components/ui/RawDataView'
import { spacing } from '../../theme/tokens'

export default function ReportCardScreen(): React.JSX.Element {
  const { data, loading, unsupported, error, reload } = usePortalFetch(() => gradesApi.getReportCard())

  return (
    <Screen edges={['left', 'right', 'bottom']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {loading ? (
          <LoadingSkeleton rows={4} />
        ) : unsupported ? (
          <UnsupportedPortalBlock feature="Report card" />
        ) : error ? (
          <ErrorRetryBlock message={error} onRetry={reload} />
        ) : (
          <Card>
            <RawDataView data={data} />
          </Card>
        )}
      </ScrollView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  scroll: { paddingVertical: spacing.lg },
})
