import React, { useEffect, useRef } from 'react'
import { Animated, View, StyleSheet, ViewStyle } from 'react-native'
import { colors, radii, spacing } from '../../theme/tokens'

interface LoadingSkeletonProps {
  rows?: number
  rowHeight?: number
  style?: ViewStyle
}

// Skeleton screens, not spinners, for content loading — per DESIGN_SYSTEM.md.
export function LoadingSkeleton({ rows = 3, rowHeight = 64, style }: LoadingSkeletonProps): React.JSX.Element {
  const opacity = useRef(new Animated.Value(0.4)).current

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.4, duration: 700, useNativeDriver: true }),
      ]),
    )
    loop.start()
    return () => loop.stop()
  }, [opacity])

  return (
    <View style={[styles.container, style]} accessibilityLabel="Loading" accessibilityRole="progressbar">
      {Array.from({ length: rows }).map((_, i) => (
        <Animated.View key={i} style={[styles.row, { height: rowHeight, opacity }]} />
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { gap: spacing.ms },
  row: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
})
