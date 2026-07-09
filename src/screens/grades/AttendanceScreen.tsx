import React, { useState } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import * as gradesApi from '../../api/gradesApi'
import { usePortalFetch } from '../../hooks/usePortalFetch'
import { Screen } from '../../components/ui/Screen'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { LoadingSkeleton } from '../../components/ui/LoadingSkeleton'
import { ErrorRetryBlock } from '../../components/ui/ErrorRetryBlock'
import { UnsupportedPortalBlock } from '../../components/ui/UnsupportedPortalBlock'
import { RawDataView } from '../../components/ui/RawDataView'
import { colors, spacing, typography } from '../../theme/tokens'

export default function AttendanceScreen(): React.JSX.Element {
  const [monthOffset, setMonthOffset] = useState(0)
  const { data, loading, unsupported, error, reload } = usePortalFetch(
    () => gradesApi.getAttendance(monthOffset),
    [monthOffset],
  )

  return (
    <Screen edges={['left', 'right', 'bottom']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.monthRow}>
          <Button label="< Prev" onPress={() => setMonthOffset((m) => m - 1)} variant="secondary" style={styles.monthButton} />
          <Text style={styles.monthLabel}>{monthOffset === 0 ? 'This Month' : monthOffset < 0 ? `${-monthOffset} mo. ago` : `+${monthOffset} mo.`}</Text>
          <Button label="Next >" onPress={() => setMonthOffset((m) => m + 1)} variant="secondary" style={styles.monthButton} />
        </View>

        {loading ? (
          <LoadingSkeleton rows={3} />
        ) : unsupported ? (
          <UnsupportedPortalBlock feature="Attendance" />
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
  scroll: { gap: spacing.md, paddingVertical: spacing.lg },
  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  monthButton: { flex: 0 },
  monthLabel: { ...typography.h3, color: colors.text },
})
