import React from 'react'
import { View, StyleSheet, ViewStyle } from 'react-native'
import { colors, elevation, radii, spacing } from '../../theme/tokens'

interface CardProps {
  children: React.ReactNode
  style?: ViewStyle
}

export function Card({ children, style }: CardProps): React.JSX.Element {
  return <View style={[styles.card, style]}>{children}</View>
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: spacing.cardPadding,
    ...elevation.sm,
  },
})
