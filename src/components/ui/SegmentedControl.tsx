import React from 'react'
import { Pressable, View, Text, StyleSheet } from 'react-native'
import { colors, radii, spacing, typography } from '../../theme/tokens'

interface SegmentedControlProps<T extends string> {
  segments: readonly T[]
  value: T
  onChange: (value: T) => void
}

// Pill-shaped toggle track (Planner's "Today"/"This Week") matching the
// Figma prototype — active segment filled solid violet, inactive transparent.
export function SegmentedControl<T extends string>({
  segments,
  value,
  onChange,
}: SegmentedControlProps<T>): React.JSX.Element {
  return (
    <View style={styles.track} accessibilityRole="tablist">
      {segments.map((segment) => {
        const active = segment === value
        return (
          <Pressable
            key={segment}
            style={[styles.segment, active && styles.segmentActive]}
            onPress={() => onChange(segment)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
          >
            <Text style={[styles.label, active && styles.labelActive]}>{segment}</Text>
          </Pressable>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: 4,
    gap: 4,
  },
  segment: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentActive: { backgroundColor: colors.primary },
  label: { ...typography.h3, fontSize: 13.5, color: colors.textSecondary },
  labelActive: { color: '#FFFFFF' },
})
