import React from 'react'
import { View, type StyleProp, type ViewStyle } from 'react-native'
import Card from '../ui/Card'
import Text from '../ui/Text'
import { colors } from '../../constants/colors'
import { getGradeBadgeConfig, COURSE_TYPE_LABELS } from '../../constants/grades'

export interface GradeCardProps {
  subjectName: string
  teacher?: string | null
  letterGrade: string
  percentage: number
  courseType?: string | null
  onPress?: () => void
  style?: StyleProp<ViewStyle>
}

function CourseTypeBadge({ type }: { type: string }): React.JSX.Element | null {
  const label = COURSE_TYPE_LABELS[type]
  if (label === undefined) return null
  return (
    <View className="bg-[#0D0E1C] border border-[#1C1F3C] rounded-[4px] px-2 py-1">
      <Text className="text-[10px] font-bold uppercase tracking-[0.5px] leading-4 text-[#8B8FB5]">{label}</Text>
    </View>
  )
}

export default function GradeCard({
  subjectName,
  teacher,
  letterGrade,
  percentage,
  courseType,
  onPress,
  style,
}: GradeCardProps): React.JSX.Element {
  const badge = getGradeBadgeConfig(letterGrade)

  return (
    <Card onPress={onPress} style={style}>
      <View className="flex-row items-center">
        <View className="flex-1 mr-3">
          <View className="flex-row flex-wrap items-center gap-2 mb-1">
            <Text variant="h3" className="flex-1">
              {subjectName}
            </Text>
            {courseType != null && <CourseTypeBadge type={courseType} />}
          </View>
          {teacher != null && (
            <Text variant="caption" color={colors.textSecondary}>
              {teacher}
            </Text>
          )}
        </View>

        <View className="items-center min-w-[56px]" accessibilityLabel={`${letterGrade} — ${percentage.toFixed(1)} percent`}>
          <View
            className="w-[52px] h-[52px] rounded-[10px] border-[1.5px] items-center justify-center"
            style={{ backgroundColor: badge.bg, borderColor: badge.text }}
          >
            <Text className="text-[15px] font-bold tracking-[-0.3px] leading-5" style={{ color: badge.text }}>
              {letterGrade}
            </Text>
          </View>
          <Text variant="caption" color={colors.textSecondary} className="mt-1">
            {percentage.toFixed(1)}%
          </Text>
        </View>
      </View>
    </Card>
  )
}

