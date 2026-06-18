import React, { useCallback } from 'react'
import { TouchableOpacity, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import Text from '../ui/Text'
import { colors } from '../../constants/colors'
import { formatDuration } from '../../utils/formatDuration'

// ─── Types ────────────────────────────────────────────────────────────────────

export type CardAccent = 'overdue' | 'today' | 'none'

export interface AssignmentCardProps {
  title: string
  subject: string
  estimatedMinutes: number
  dueDate: string
  completed: boolean
  accent: CardAccent
  onToggle: () => void
  isToggling?: boolean
}

// ─── Constants ────────────────────────────────────────────────────────────────

interface AccentTokens {
  border: string
  text: string
}

const ACCENT_TOKENS: Record<CardAccent, AccentTokens | null> = {
  overdue: { border: colors.error, text: colors.error },
  today:   { border: colors.warning, text: colors.warning },
  none:    null,
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDueLabel(isoString: string): string {
  const due = new Date(isoString)
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const dueStart   = new Date(due.getFullYear(), due.getMonth(), due.getDate())
  const diffDays   = Math.round((dueStart.getTime() - todayStart.getTime()) / 86_400_000)
  if (diffDays < 0) return due.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  if (diffDays === 0) return 'Due today'
  if (diffDays === 1) return 'Due tomorrow'
  return due.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AssignmentCard({
  title,
  subject,
  estimatedMinutes,
  dueDate,
  completed,
  accent,
  onToggle,
  isToggling = false,
}: AssignmentCardProps): React.JSX.Element {
  const tokens = ACCENT_TOKENS[accent]

  const borderLeftColor = completed || tokens === null ? colors.border : tokens.border
  const borderLeftWidth = !completed && tokens !== null ? 3 : 1
  const dueLabelColor   = !completed && tokens !== null ? tokens.text : colors.textMuted

  const handlePress = useCallback(() => {
    if (!isToggling) onToggle()
  }, [isToggling, onToggle])

  return (
    <View
      className={`flex-row items-center bg-[#0d0e1c] border border-[#1c1f3c] rounded-[12px] mx-5 mb-2 py-3 pr-4 overflow-hidden ${completed ? 'opacity-50' : ''}`}
      style={[{ borderLeftWidth, borderLeftColor }]}
      accessibilityLabel={`${subject}: ${title}, ${completed ? 'completed' : 'incomplete'}`}
    >
      <TouchableOpacity
        onPress={handlePress}
        className="w-11 h-11 items-center justify-center flex-shrink-0"
        accessibilityRole="checkbox"
        accessibilityState={{ checked: completed, disabled: isToggling }}
        accessibilityLabel={completed ? 'Mark as incomplete' : 'Mark as complete'}
        disabled={isToggling}
        activeOpacity={0.6}
      >
        <Ionicons
          name={completed ? 'checkmark-circle' : 'ellipse-outline'}
          size={24}
          color={completed ? colors.primary : colors.textMuted}
        />
      </TouchableOpacity>

      <View className="flex-1 mr-3">
        <Text
          variant="h3"
          numberOfLines={2}
          color={completed ? colors.textMuted : colors.textPrimary}
          className={`mb-1.5 ${completed ? 'line-through' : ''}`}
        >
          {title}
        </Text>
        <View className="flex-row flex-wrap items-center gap-2">
          <View className="bg-[#07080F] rounded-[4px] px-2 py-0.5">
            <Text
              className={`text-[11px] font-[500] uppercase tracking-[0.5px] leading-4 ${completed ? 'text-[#8B8FB5]' : 'text-[#8B8FB5]'}`}
              numberOfLines={1}
            >
              {subject}
            </Text>
          </View>
          <Text variant="caption" color={colors.textMuted}>
            {formatDuration(estimatedMinutes)}
          </Text>
        </View>
      </View>

      <Text
        variant="caption"
        color={dueLabelColor}
        className="flex-shrink-0 text-right max-w-[80px]"
        numberOfLines={1}
      >
        {formatDueLabel(dueDate)}
      </Text>
    </View>
  )
}
