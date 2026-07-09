import React from 'react'
import { Pressable, View, Text, StyleSheet } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { Card } from './Card'
import { colors, radii, spacing, typography } from '../../theme/tokens'

interface ListRowProps {
  leading: React.ReactNode
  title: string
  subtitle?: string
  trailingValue?: string
  trailingValueColor?: string
  trailingDelta?: string
  trailingDeltaDirection?: 'up' | 'down'
  rightAccessory?: React.ReactNode
  onPress?: () => void
}

// Leading badge/icon -> title+subtitle -> trailing value+delta, the repeated
// row pattern across the Figma prototype's Grades/Planner/Recent-changes lists.
export function ListRow({
  leading,
  title,
  subtitle,
  trailingValue,
  trailingValueColor = colors.text,
  trailingDelta,
  trailingDeltaDirection,
  rightAccessory,
  onPress,
}: ListRowProps): React.JSX.Element {
  const content = (
    <Card style={styles.card}>
      <View style={styles.leading}>{leading}</View>
      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.subtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {rightAccessory ? (
        rightAccessory
      ) : trailingValue ? (
        <View style={styles.trailing}>
          <Text style={[styles.trailingValue, { color: trailingValueColor }]}>{trailingValue}</Text>
          {trailingDelta ? (
            <View style={styles.deltaRow}>
              <Feather
                name={trailingDeltaDirection === 'down' ? 'trending-down' : 'trending-up'}
                size={11}
                color={trailingDeltaDirection === 'down' ? colors.error : colors.success}
              />
              <Text
                style={[
                  styles.delta,
                  { color: trailingDeltaDirection === 'down' ? colors.error : colors.success },
                ]}
              >
                {trailingDelta}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}
    </Card>
  )

  if (!onPress) return content

  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={title}>
      {content}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.ms,
    borderRadius: radii.lg,
    marginBottom: spacing.sm,
  },
  leading: { flexShrink: 0 },
  body: { flex: 1, gap: 2 },
  title: { ...typography.h3, fontSize: 14.5, color: colors.text },
  subtitle: { ...typography.caption, color: colors.textSecondary },
  trailing: { alignItems: 'flex-end', gap: 2 },
  trailingValue: { ...typography.h3, fontSize: 15 },
  deltaRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  delta: { ...typography.caption, fontSize: 11, fontWeight: '600' },
})
