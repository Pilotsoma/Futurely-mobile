import React from 'react'
import { TouchableOpacity, View, type StyleProp, type ViewStyle } from 'react-native'
import Card from '../ui/Card'
import Text from '../ui/Text'
import { colors } from '../../constants/colors'

export type GpaMode = 'weighted' | 'unweighted'
export type GpaTrend = 'up' | 'down' | 'stable'

interface TrendConfig {
  symbol: string
  color: string
}

const TREND_CONFIG: Record<GpaTrend, TrendConfig> = {
  up:     { symbol: '↑', color: colors.success },
  down:   { symbol: '↓', color: colors.error },
  stable: { symbol: '→', color: colors.textMuted },
}

function gpaColor(value: number): string {
  if (value >= 3.5) return colors.primary
  if (value >= 3.0) return colors.info
  if (value >= 2.5) return colors.warning
  return colors.error
}

interface ModeToggleProps {
  mode: GpaMode
  onChange: (m: GpaMode) => void
}

function ModeToggle({ mode, onChange }: ModeToggleProps): React.JSX.Element {
  const options: GpaMode[] = ['weighted', 'unweighted']
  return (
    <View className="flex-row gap-2">
      {options.map((m) => (
        <TouchableOpacity
          key={m}
          className={`rounded-full px-4 py-2 min-h-[44px] justify-center border ${mode === m ? 'border-[#7B61FF] bg-[#7B61FF]/10' : 'border-[#1C1F3C] bg-transparent'}`}
          onPress={() => onChange(m)}
          accessibilityRole="button"
          accessibilityLabel={`Show ${m} GPA`}
          accessibilityState={{ selected: mode === m }}
        >
          <Text className={`text-[13px] ${mode === m ? 'font-semibold text-[#7B61FF]' : 'font-medium text-[#8B8FB5]'}`}>
            {m === 'weighted' ? 'Weighted' : 'Unweighted'}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  )
}

export interface GPASummaryCardProps {
  weightedGpa: number | null
  unweightedGpa: number | null
  mode: GpaMode
  onModeChange: (mode: GpaMode) => void
  trend?: GpaTrend | null
  trendDelta?: number | null
  style?: StyleProp<ViewStyle>
}

export default function GPASummaryCard({
  weightedGpa,
  unweightedGpa,
  mode,
  onModeChange,
  trend,
  trendDelta,
  style,
}: GPASummaryCardProps): React.JSX.Element {
  const displayValue = mode === 'weighted' ? weightedGpa : unweightedGpa
  const valueColor = displayValue !== null ? gpaColor(displayValue) : colors.textMuted
  const scaleLabel = mode === 'weighted' ? '/ 5.0' : '/ 4.0'
  const trendCfg = trend != null ? TREND_CONFIG[trend] : null

  return (
    <Card style={style}>
      <View className="flex-row justify-between items-center mb-2">
        <Text variant="label" color={colors.textSecondary}>
          {mode === 'weighted' ? 'Weighted GPA' : 'Unweighted GPA'}
        </Text>
        {trendCfg !== null && (
          <View className="flex-row items-center gap-1" accessibilityLabel={`GPA trend: ${trend ?? ''}`}>
            <Text className="text-[18px] font-semibold leading-6" style={{ color: trendCfg.color }}>
              {trendCfg.symbol}
            </Text>
            {trendDelta != null && (
              <Text className="text-[13px] font-semibold" style={{ color: trendCfg.color }}>

                {trendDelta > 0 ? '+' : ''}{trendDelta.toFixed(2)}
              </Text>
            )}
          </View>
        )}
      </View>

      <View className="flex-row items-end gap-2 mb-4">
        <Text variant="display" color={valueColor}>
          {displayValue !== null ? displayValue.toFixed(2) : '—'}
        </Text>
        {displayValue !== null && (
          <Text variant="caption" color={colors.textMuted} className="mb-1">
            {scaleLabel}
          </Text>
        )}
      </View>

      <ModeToggle mode={mode} onChange={onModeChange} />
    </Card>
  )
}

