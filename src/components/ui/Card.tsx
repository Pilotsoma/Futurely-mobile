import React from 'react'
import { View, StyleSheet, StyleProp, ViewStyle } from 'react-native'
import Svg, { Defs, LinearGradient, Stop, Rect } from 'react-native-svg'
import { colors, gradients, radii, spacing } from '../../theme/tokens'

interface CardProps {
  children: React.ReactNode
  style?: StyleProp<ViewStyle>
  /** 'gradient' renders the diagonal hero fill (GPA card, etc.) via react-native-svg — no expo-linear-gradient dependency. */
  variant?: 'default' | 'gradient'
  /** Gradient stop colors, defaults to tokens.gradients.hero. */
  gradientColors?: readonly [string, string]
  /** Corner radius for the gradient fill — must match `style`'s borderRadius if overridden. */
  radius?: number
}

export function Card({
  children,
  style,
  variant = 'default',
  gradientColors = gradients.hero,
  radius = radii.md,
}: CardProps): React.JSX.Element {
  if (variant === 'gradient') {
    // `style` (gap/padding/alignItems etc.) applies to the content layer, not the
    // outer wrapper — the outer wrapper only owns the radius/border/gradient clip,
    // controlled separately via the `radius` prop, since a single merged style
    // can't cleanly split "visual" (goes on the gradient wrapper) from "layout"
    // (goes on the children) concerns.
    return (
      <View style={[styles.gradientCard, { borderRadius: radius }]}>
        <Svg style={StyleSheet.absoluteFillObject} pointerEvents="none">
          <Defs>
            <LinearGradient id="cardGradient" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor={gradientColors[0]} stopOpacity={1} />
              <Stop offset="1" stopColor={gradientColors[1]} stopOpacity={1} />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill="url(#cardGradient)" />
        </Svg>
        <View style={[styles.gradientContent, style]}>{children}</View>
      </View>
    )
  }

  return <View style={[styles.card, style]}>{children}</View>
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: spacing.cardPadding,
  },
  gradientCard: {
    overflow: 'hidden',
    borderWidth: 0.8,
    borderColor: 'rgba(142, 81, 255, 0.25)',
  },
  gradientContent: {
    padding: spacing.cardPadding,
  },
})
