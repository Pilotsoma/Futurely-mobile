import React from 'react'
import { StyleSheet, View } from 'react-native'
import Svg, { Circle } from 'react-native-svg'

interface ProgressRingProps {
  /** 0-100 */
  progress: number
  size?: number
  strokeWidth?: number
  color?: string
  trackColor?: string
  children?: React.ReactNode
}

// Circular progress indicator built from react-native-svg's Circle (already a
// dependency used elsewhere for gradient fills) — no new library added.
export function ProgressRing({
  progress,
  size = 84,
  strokeWidth = 8,
  color = '#FFFFFF',
  trackColor = 'rgba(255,255,255,0.22)',
  children,
}: ProgressRingProps): React.JSX.Element {
  const clamped = Math.max(0, Math.min(100, progress))
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference * (1 - clamped / 100)

  return (
    <View style={[styles.wrap, { width: size, height: size }]}>
      <Svg width={size} height={size}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={trackColor}
          strokeWidth={strokeWidth}
          fill="none"
        />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={strokeWidth}
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          rotation={-90}
          origin={`${size / 2}, ${size / 2}`}
        />
      </Svg>
      {children ? <View style={styles.content}>{children}</View> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
  content: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
})
