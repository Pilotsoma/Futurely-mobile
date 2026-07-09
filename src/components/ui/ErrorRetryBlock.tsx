import React from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { colors, spacing, typography } from '../../theme/tokens'
import { Button } from './Button'

interface ErrorRetryBlockProps {
  message: string
  onRetry: () => void
  retrying?: boolean
}

export function ErrorRetryBlock({ message, onRetry, retrying }: ErrorRetryBlockProps): React.JSX.Element {
  return (
    <View style={styles.container}>
      <Feather name="alert-circle" size={32} color={colors.error} />
      <Text style={styles.message}>{message}</Text>
      <Button label="Retry" onPress={onRetry} loading={retrying} variant="secondary" />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xl },
  message: { fontSize: typography.body.fontSize, color: colors.textSecondary, textAlign: 'center' },
})
