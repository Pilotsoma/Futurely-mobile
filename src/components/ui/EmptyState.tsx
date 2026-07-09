import React from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { colors, spacing, typography } from '../../theme/tokens'
import { Button } from './Button'

interface EmptyStateProps {
  icon?: React.ComponentProps<typeof Feather>['name']
  title: string
  message?: string
  ctaLabel?: string
  onPressCta?: () => void
}

export function EmptyState({
  icon = 'inbox',
  title,
  message,
  ctaLabel,
  onPressCta,
}: EmptyStateProps): React.JSX.Element {
  return (
    <View style={styles.container}>
      <Feather name={icon} size={32} color={colors.textMuted} />
      <Text style={styles.title}>{title}</Text>
      {message ? <Text style={styles.message}>{message}</Text> : null}
      {ctaLabel && onPressCta ? <Button label={ctaLabel} onPress={onPressCta} variant="secondary" /> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.xl },
  title: { fontSize: typography.h3.fontSize, fontWeight: typography.h3.fontWeight, color: colors.text },
  message: { fontSize: typography.body.fontSize, color: colors.textSecondary, textAlign: 'center' },
})
