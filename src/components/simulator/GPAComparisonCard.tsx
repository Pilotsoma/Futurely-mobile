import React, { useEffect, useRef, useState } from 'react'
import { AccessibilityInfo, Animated, View } from 'react-native'
import Card from '../ui/Card'
import Text from '../ui/Text'
import { colors } from '../../constants/colors'

export interface GPAComparisonCardProps {
  currentGpa:   number | null
  projectedGpa: number | null
  hasChanges:   boolean
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function gpaColor(value: number): string {
  if (value >= 3.5) return colors.primary
  if (value >= 3.0) return colors.info
  if (value >= 2.5) return colors.warning
  return colors.error
}

interface DeltaCfg {
  color:  string
  symbol: string
  sign:   string
}

function deltaConfig(delta: number): DeltaCfg {
  if (delta > 0.005)  return { color: colors.success,  symbol: '↑', sign: '+' }
  if (delta < -0.005) return { color: colors.error,    symbol: '↓', sign: '' }
  return                     { color: colors.textMuted, symbol: '→', sign: '+' }
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function GPAComparisonCard({
  currentGpa,
  projectedGpa,
  hasChanges,
}: GPAComparisonCardProps): React.JSX.Element {
  const projectedScale                  = useRef(new Animated.Value(1)).current
  const prevProjected                   = useRef<number | null>(null)
  const [reduceMotion, setReduceMotion] = useState(false)

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion)
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion)
    return () => sub.remove()
  }, [])

  useEffect(() => {
    if (!hasChanges || projectedGpa === null) return
    if (projectedGpa === prevProjected.current) return
    prevProjected.current = projectedGpa
    if (reduceMotion) return

    Animated.sequence([
      Animated.timing(projectedScale, {
        toValue: 1.07,
        duration: 100,
        useNativeDriver: true,
      }),
      Animated.spring(projectedScale, {
        toValue: 1,
        tension: 120,
        friction: 7,
        useNativeDriver: true,
      }),
    ]).start()
  }, [projectedGpa, projectedScale, hasChanges, reduceMotion])

  const currentColor   = currentGpa   !== null ? gpaColor(currentGpa)                     : colors.textMuted
  const projectedColor = projectedGpa !== null && hasChanges ? gpaColor(projectedGpa)     : colors.textMuted

  const delta = currentGpa !== null && projectedGpa !== null && hasChanges
    ? projectedGpa - currentGpa
    : null
  const dcfg = delta !== null ? deltaConfig(delta) : null

  return (
    <Card>
      <View className="flex-row items-start">
        {/* ── Current GPA column ── */}
        <View className="flex-1">
          <Text variant="label" color={colors.textSecondary}>Current GPA</Text>
          <Text variant="display" color={currentColor} className="mt-2 mb-2">
            {currentGpa !== null ? currentGpa.toFixed(2) : '—'}
          </Text>
          <Text variant="caption" color={colors.textMuted}>Weighted</Text>
        </View>

        <View className="w-px self-stretch bg-[#30363D] mx-4" />

        {/* ── Projected GPA column ── */}
        <View className="flex-1">
          <Text variant="label" color={colors.textSecondary}>Projected GPA</Text>

          {hasChanges && projectedGpa !== null ? (
            <>
              <Animated.View style={{ transform: [{ scale: projectedScale }] }}>
                <Text variant="display" color={projectedColor} className="mt-2 mb-2">
                  {projectedGpa.toFixed(2)}
                </Text>
              </Animated.View>

              {dcfg !== null && delta !== null && (
                <View
                  className="self-start rounded-full px-3 py-1"
                  style={{ backgroundColor: `${dcfg.color}1A` }}
                  accessibilityLabel={`GPA change: ${dcfg.sign}${delta.toFixed(2)}`}
                >
                  <Text className="text-[13px] font-semibold" style={{ color: dcfg.color }}>
                    {dcfg.sign}{delta.toFixed(2)} {dcfg.symbol}
                  </Text>
                </View>
              )}
            </>
          ) : (
            <Text variant="caption" color={colors.textMuted} className="mt-3 leading-5">
              Adjust a grade{'\n'}below to simulate
            </Text>
          )}
        </View>
      </View>
    </Card>
  )
}

