import React, { useEffect, useRef, useState } from 'react'
import {
  AccessibilityInfo,
  Animated,
  type DimensionValue,
  type StyleProp,
  type ViewStyle,
} from 'react-native'

interface SkeletonProps {
  width?: DimensionValue
  height?: number
  radius?: number
  style?: StyleProp<ViewStyle>
}

export default function Skeleton({
  width = '100%',
  height = 16,
  radius = 6,
  style,
}: SkeletonProps): React.JSX.Element {
  const opacity = useRef(new Animated.Value(0.4)).current
  const [reduceMotion, setReduceMotion] = useState(false)

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion)
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion)
    return () => sub.remove()
  }, [])

  useEffect(() => {
    if (reduceMotion) {
      opacity.setValue(0.6)
      return
    }
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.85, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.3, duration: 700, useNativeDriver: true }),
      ]),
    )
    animation.start()
    return () => animation.stop()
  }, [opacity, reduceMotion])

  return (
    <Animated.View
      style={[
        { backgroundColor: '#1C1F3C', width, height, borderRadius: radius, opacity },
        style,
      ]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  )
}
