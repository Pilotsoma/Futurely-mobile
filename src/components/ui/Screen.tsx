import React from 'react'
import { View, StyleSheet, ViewStyle } from 'react-native'
import { Edge, SafeAreaView } from 'react-native-safe-area-context'
import { colors, spacing } from '../../theme/tokens'

interface ScreenProps {
  children: React.ReactNode
  padded?: boolean
  /** Screens rendered under a navigator header already get top-inset handling from the header itself. */
  edges?: readonly Edge[]
  style?: ViewStyle
}

export function Screen({
  children,
  padded = true,
  edges = ['left', 'right', 'bottom'],
  style,
}: ScreenProps): React.JSX.Element {
  return (
    <SafeAreaView style={styles.safe} edges={edges}>
      <View style={[styles.container, padded && styles.padded, style]}>{children}</View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  container: { flex: 1 },
  padded: { paddingHorizontal: spacing.screenPadding },
})
