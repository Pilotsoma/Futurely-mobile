import React from 'react'
import { ScrollView, TouchableOpacity, View, type StyleProp, type ViewStyle } from 'react-native'
import Card from '../ui/Card'
import Text from '../ui/Text'
import { colors } from '../../constants/colors'
import { getGradeBadgeConfig, COURSE_TYPE_LABELS } from '../../constants/grades'
import { LETTER_GRADES, type LetterGrade } from '../../lib/gpa'

export interface GradeAdjustRowProps {
  courseId:      number
  courseName:    string
  courseType:    string
  originalGrade: string
  selectedGrade: string
  onGradeChange: (courseId: number, grade: LetterGrade) => void
  style?:        StyleProp<ViewStyle>
}

const PILL_WIDTH  = 44
const PILL_GAP    = 6

function GradePill({
  grade,
  isSelected,
  isOriginal,
  onPress,
}: {
  grade:      LetterGrade
  isSelected: boolean
  isOriginal: boolean
  onPress:    () => void
}): React.JSX.Element {
  const cfg = getGradeBadgeConfig(grade)
  return (
    <TouchableOpacity
      className="w-11 h-11 rounded-[8px] border border-[#1C1F3C] items-center justify-center"
      style={isSelected ? { backgroundColor: cfg.bg, borderColor: cfg.text } : undefined}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${grade}${isOriginal ? ', original grade' : ''}`}
      accessibilityState={{ selected: isSelected }}
      hitSlop={{ top: 6, bottom: 6, left: 2, right: 2 }}
    >
      <Text className="text-[12px] font-[500] leading-4" style={isSelected ? { color: cfg.text, fontWeight: '700' } : undefined}>
        {grade}
      </Text>
      {/* Dot is always rendered to keep pill height stable; transparent when not applicable */}
      <View
        className="w-1 h-1 rounded-full mt-1"
        style={{
          backgroundColor: isOriginal
            ? (isSelected ? cfg.text : colors.textSecondary)
            : 'transparent',
        }}
      />
    </TouchableOpacity>
  )
}

export default function GradeAdjustRow({
  courseId,
  courseName,
  courseType,
  originalGrade,
  selectedGrade,
  onGradeChange,
  style,
}: GradeAdjustRowProps): React.JSX.Element {
  const isModified   = selectedGrade !== originalGrade
  const typeLabel    = COURSE_TYPE_LABELS[courseType]

  return (
    <Card style={[style, isModified ? { borderColor: colors.primary } : undefined]}>
      <View className="flex-row items-stretch -mx-4 -my-4 p-4 rounded-[12px] overflow-hidden">
        <View className={`w-1 rounded-[2px] mr-3 ${isModified ? 'bg-[#7B61FF]' : 'bg-transparent'}`} />
        <View className="flex-1">
          <View className="flex-row items-center gap-2 mb-1">
            <Text variant="h3" className="flex-1" numberOfLines={1}>
              {courseName}
            </Text>
            {typeLabel !== undefined && (
              <View className="bg-[#0D0E1C] border border-[#1C1F3C] rounded-[4px] px-2 py-1">
                <Text className="text-[10px] font-bold uppercase tracking-[0.5px] leading-4 text-[#8B8FB5]">
                  {typeLabel}
                </Text>
              </View>
            )}
          </View>

          <Text variant="caption" color={colors.textMuted} className="mb-3">
            Original: {originalGrade}
            {isModified ? ` → ${selectedGrade}` : ''}
          </Text>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            nestedScrollEnabled
            contentContainerStyle={{ paddingHorizontal: 4, gap: PILL_GAP }}
            style={{ marginHorizontal: -4 }}
          >
            {LETTER_GRADES.map((grade) => (
              <GradePill
                key={grade}
                grade={grade}
                isSelected={selectedGrade === grade}
                isOriginal={originalGrade === grade}
                onPress={() => onGradeChange(courseId, grade)}
              />
            ))}
          </ScrollView>
        </View>
      </View>
    </Card>
  )
}
