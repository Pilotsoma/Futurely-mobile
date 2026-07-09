import React from 'react'
import { Pressable, View, Text, StyleSheet } from 'react-native'
import Svg, { Defs, LinearGradient, Stop, Rect } from 'react-native-svg'
import { colors, fonts, gradients, radii, spacing, typography } from '../../theme/tokens'

interface IconTileProps {
  icon: React.ReactNode
  label: string
  onPress: () => void
  gradientColors?: readonly [string, string]
}

const SIZE = 48

// 48x48 gradient-fill rounded-square icon tile + label — the Figma prototype's
// "Quick Actions" row treatment (Ask AI / Grades / Simulate / Planner).
export function IconTile({ icon, label, onPress, gradientColors = gradients.accent }: IconTileProps): React.JSX.Element {
  const gradientId = `iconTileGradient-${gradientColors[0]}-${gradientColors[1]}`

  return (
    <Pressable
      style={({ pressed }) => [styles.wrap, pressed && styles.wrapPressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <View style={styles.tile}>
        <Svg style={StyleSheet.absoluteFillObject} pointerEvents="none">
          <Defs>
            <LinearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor={gradientColors[0]} stopOpacity={1} />
              <Stop offset="1" stopColor={gradientColors[1]} stopOpacity={1} />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${gradientId})`} />
        </Svg>
        {icon}
      </View>
      <Text style={styles.label} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: spacing.xs, width: 72 },
  wrapPressed: { opacity: 0.8, transform: [{ scale: 0.96 }] },
  tile: {
    width: SIZE,
    height: SIZE,
    borderRadius: radii.md,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    ...typography.caption,
    fontFamily: fonts.medium,
    color: colors.textSecondary,
    textAlign: 'center',
  },
})
