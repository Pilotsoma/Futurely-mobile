import React, { useEffect } from 'react'
import { StyleSheet, ViewStyle } from 'react-native'
import { Edge, SafeAreaView } from 'react-native-safe-area-context'
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated'
import { animation, colors, spacing } from '../../theme/tokens'

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
  const reduceMotion = useReducedMotion()
  const progress = useSharedValue(reduceMotion ? 1 : 0)

  useEffect(() => {
    if (reduceMotion) {
      progress.value = 1
      return
    }
    // One-shot mount entrance, mirroring web's `.fade-up` page-entrance animation.
    progress.value = withTiming(1, { duration: animation.durSlow, easing: Easing.out(Easing.cubic) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * 12 }],
  }))

  return (
    <SafeAreaView style={styles.safe} edges={edges}>
      <Animated.View style={[styles.container, padded && styles.padded, animatedStyle, style]}>
        {children}
      </Animated.View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  container: { flex: 1 },
  padded: { paddingHorizontal: spacing.screenPadding },
})
