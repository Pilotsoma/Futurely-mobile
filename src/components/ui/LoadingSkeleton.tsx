import React, { useEffect, useState } from 'react'
import { StyleSheet, View, ViewStyle } from 'react-native'
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated'

import { useDisplayPreferences } from '../../preferences/displayPreferences'
import { colors, radii, spacing } from '../../theme/tokens'

interface LoadingSkeletonProps {
  rows?: number
  rowHeight?: number
  style?: ViewStyle
}

const BAND_WIDTH = 90

function ShimmerRow({
  height,
  reduceMotion,
}: {
  height: number
  reduceMotion: boolean
}): React.JSX.Element {
  const [width, setWidth] = useState(0)
  const translateX = useSharedValue(-BAND_WIDTH)

  useEffect(() => {
    cancelAnimation(translateX)

    if (reduceMotion || width === 0) {
      translateX.value = -BAND_WIDTH
      return
    }

    translateX.value = withRepeat(
      withSequence(
        withTiming(-BAND_WIDTH, { duration: 0 }),
        withTiming(width + BAND_WIDTH, {
          duration: 1100,
          easing: Easing.linear,
        }),
      ),
      -1,
      false,
    )

    return () => {
      cancelAnimation(translateX)
    }
  }, [reduceMotion, translateX, width])

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }))

  return (
    <View
      style={[styles.row, { height }]}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
    >
      {reduceMotion ? (
        <View style={styles.staticBand} />
      ) : (
        <Animated.View style={[styles.band, animatedStyle]} />
      )}
    </View>
  )
}

export function LoadingSkeleton({
  rows = 3,
  rowHeight = 64,
  style,
}: LoadingSkeletonProps): React.JSX.Element {
  const { reduceMotion } = useDisplayPreferences()

  return (
    <View
      style={[styles.container, style]}
      accessibilityLabel="Loading"
      accessibilityRole="progressbar"
    >
      {Array.from({ length: rows }).map((_, index) => (
        <ShimmerRow
          key={index}
          height={rowHeight}
          reduceMotion={reduceMotion}
        />
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.ms,
  },
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
  staticBand: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    width: '32%',
    backgroundColor: colors.surface2,
    opacity: 0.32,
  },
})