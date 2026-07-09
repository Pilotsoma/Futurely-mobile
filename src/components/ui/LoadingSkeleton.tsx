import React, { useEffect, useState } from 'react'
import { StyleSheet, View, ViewStyle } from 'react-native'
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated'
import { colors, radii, spacing } from '../../theme/tokens'

interface LoadingSkeletonProps {
  rows?: number
  rowHeight?: number
  style?: ViewStyle
}

const BAND_WIDTH = 90

// A translating highlight band clipped to the row, mirroring web's shimmer
// sweep (app/globals.css `.shimmer`) — replaces the old flat opacity pulse.
function ShimmerRow({ height }: { height: number }): React.JSX.Element {
  const [width, setWidth] = useState(0)
  const translateX = useSharedValue(-BAND_WIDTH)

  useEffect(() => {
    if (width === 0) return
    translateX.value = withRepeat(
      withSequence(
        withTiming(-BAND_WIDTH, { duration: 0 }),
        withTiming(width + BAND_WIDTH, { duration: 1100, easing: Easing.linear }),
      ),
      -1,
      false,
    )
  }, [width, translateX])

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }))

  return (
    <View style={[styles.row, { height }]} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <Animated.View style={[styles.band, animatedStyle]} />
    </View>
  )
}

// Skeleton screens, not spinners, for content loading — per DESIGN_SYSTEM.md.
export function LoadingSkeleton({ rows = 3, rowHeight = 64, style }: LoadingSkeletonProps): React.JSX.Element {
  return (
    <View style={[styles.container, style]} accessibilityLabel="Loading" accessibilityRole="progressbar">
      {Array.from({ length: rows }).map((_, i) => (
        <ShimmerRow key={i} height={rowHeight} />
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
    overflow: 'hidden',
  },
  band: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: BAND_WIDTH,
    backgroundColor: colors.surface2,
    opacity: 0.6,
  },
})
