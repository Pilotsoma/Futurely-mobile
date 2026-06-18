import React from 'react'
import { View } from 'react-native'
import Card from '../ui/Card'
import Text from '../ui/Text'
import { colors } from '../../constants/colors'

interface DeltaCardProps {
  currentGpa:   number | null
  projectedGpa: number | null
  hasChanges:   boolean
}

function gpaColor(value: number): string {
  if (value >= 3.5) return colors.primary
  if (value >= 3.0) return colors.info
  if (value >= 2.5) return colors.warning
  return colors.error
}

function deltaConfig(delta: number): { color: string; symbol: string; sign: string } {
  if (delta > 0.005)  return { color: colors.success,   symbol: '↑', sign: '+' }
  if (delta < -0.005) return { color: colors.error,     symbol: '↓', sign: '' }
  return               { color: colors.textMuted,       symbol: '→', sign: '+' }
}

export default function DeltaCard({
  currentGpa,
  projectedGpa,
  hasChanges,
}: DeltaCardProps): React.JSX.Element {
  const currentColor   = currentGpa !== null ? gpaColor(currentGpa) : colors.textMuted
  const projectedColor = projectedGpa !== null && hasChanges ? gpaColor(projectedGpa) : colors.textMuted

  const delta = currentGpa !== null && projectedGpa !== null && hasChanges
    ? projectedGpa - currentGpa
    : null
  const dcfg = delta !== null ? deltaConfig(delta) : null

  return (
    <Card>
      <View className="flex-row items-start">
        {/* Left column — current */}
        <View className="flex-1">
          <Text variant="label" color={colors.textSecondary}>Current GPA</Text>
          <Text variant="display" color={currentColor} className="mt-2 mb-2">
            {currentGpa !== null ? currentGpa.toFixed(2) : '—'}
          </Text>
          <Text variant="caption" color={colors.textMuted}>Weighted</Text>
        </View>

        <View className="w-px self-stretch bg-[#1C1F3C] mx-4" />

        {/* Right column — projected */}
        <View className="flex-1">
          <Text variant="label" color={colors.textSecondary}>Projected GPA</Text>
          {hasChanges && projectedGpa !== null ? (
            <>
              <Text variant="display" color={projectedColor} className="mt-2 mb-2">
                {projectedGpa.toFixed(2)}
              </Text>
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

