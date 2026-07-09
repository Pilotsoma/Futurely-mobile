import React from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { colors, spacing, typography } from '../../theme/tokens'

// Several grades endpoints (attendance/schedule/report-card/progress-report/
// contact-teachers) return upstream-scraped, loosely-typed payloads — the
// backend itself types these as `unknown`. This renders them defensively as
// a generic key/value tree rather than pretending a stricter shape exists;
// approximate by design, same tradeoff the web app's own equivalents make.

interface RawDataViewProps {
  data: unknown
  depth?: number
}

function formatKey(key: string): string {
  const spaced = key.replace(/([A-Z])/g, ' $1').trim()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

function isNumericLike(value: string): boolean {
  return /^-?\d+(\.\d+)?%?$/.test(value.trim())
}

export function RawDataView({ data, depth = 0 }: RawDataViewProps): React.JSX.Element {
  if (data === null || data === undefined) {
    return <Text style={styles.empty}>No data available.</Text>
  }

  if (Array.isArray(data)) {
    if (data.length === 0) return <Text style={styles.empty}>No data available.</Text>
    return (
      <View style={styles.group}>
        {data.map((item, i) => (
          <View key={i} style={styles.arrayItem}>
            <RawDataView data={item} depth={depth + 1} />
          </View>
        ))}
      </View>
    )
  }

  if (typeof data === 'object') {
    const entries = Object.entries(data as Record<string, unknown>)
    if (entries.length === 0) return <Text style={styles.empty}>No data available.</Text>
    return (
      <View style={styles.group}>
        {entries.map(([key, value]) => (
          <View key={key} style={styles.row}>
            <Text style={styles.label}>{formatKey(key)}</Text>
            {typeof value === 'object' && value !== null ? (
              <RawDataView data={value} depth={depth + 1} />
            ) : (
              <Text style={[styles.value, isNumericLike(String(value)) && styles.numericValue]}>
                {String(value)}
              </Text>
            )}
          </View>
        ))}
      </View>
    )
  }

  return <Text style={styles.value}>{String(data)}</Text>
}

const styles = StyleSheet.create({
  group: { gap: spacing.sm },
  row: { gap: spacing.xs },
  arrayItem: { borderLeftWidth: 1, borderLeftColor: colors.border, paddingLeft: spacing.sm },
  label: { ...typography.label, color: colors.textSecondary },
  value: { ...typography.body, color: colors.text },
  numericValue: { color: colors.primary, fontWeight: '600' },
  empty: { ...typography.body, color: colors.textMuted },
})
