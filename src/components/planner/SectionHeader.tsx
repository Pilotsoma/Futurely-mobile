import React from 'react'
import { TouchableOpacity, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import Text from '../ui/Text'
import { colors } from '../../constants/colors'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SectionHeaderProps {
  label: string
  count: number
  accentColor?: string
  isCollapsible?: boolean
  isExpanded?: boolean
  onToggleExpand?: () => void
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function SectionHeader({
  label,
  count,
  accentColor,
  isCollapsible = false,
  isExpanded = true,
  onToggleExpand,
}: SectionHeaderProps): React.JSX.Element {
  return (
    <View className="flex-row justify-between items-center px-5 pt-5 pb-2">
      <View className="flex-row items-center gap-2">
        <Text variant="label" color={accentColor ?? colors.textSecondary} className="leading-4">
          {label}
        </Text>
        <View className="bg-[#07080F] border border-[#1C1F3C] rounded-full px-2 py-0.5 min-w-[24px] items-center">
          <Text variant="caption" color={colors.textMuted}>
            {count}
          </Text>
        </View>
      </View>

      {isCollapsible && (
        <TouchableOpacity
          onPress={onToggleExpand}
          className="w-8 h-8 items-center justify-center"
          accessibilityRole="button"
          accessibilityLabel={isExpanded ? `Collapse ${label}` : `Expand ${label}`}
          accessibilityState={{ expanded: isExpanded }}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Ionicons
            name={isExpanded ? 'chevron-up' : 'chevron-down'}
            size={16}
            color={colors.textMuted}
          />
        </TouchableOpacity>
      )}
    </View>
  )
}

