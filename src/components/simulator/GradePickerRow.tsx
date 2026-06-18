import React from 'react'
import { ScrollView, TouchableOpacity, View, type StyleProp, type ViewStyle } from 'react-native'
import Card from '../ui/Card'
import Text from '../ui/Text'
import { colors } from '../../constants/colors'
import { COURSE_TYPE_LABELS } from '../../constants/grades'
import { LETTER_GRADES, isLetterGrade, type LetterGrade } from '../../lib/gpa'

export interface GradePickerRowProps {
  courseId:      number
  courseName:    string
  courseType:    string
  originalGrade: string
  selectedGrade: string
  onGradeChange: (courseId: number, grade: LetterGrade) => void
  style?:        StyleProp<ViewStyle>
}

const PILL_SIZE = 44
const PILL_GAP  = 6

// ─── Grade pill ───────────────────────────────────────────────────────────────

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
  return (
    <TouchableOpacity
      className="w-11 h-11 rounded-[8px] border border-[#1C1F3C] items-center justify-center"
      style={isSelected ? { backgroundColor: `${colors.primary}26`, borderColor: colors.primary } : undefined}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${grade}${isOriginal ? ', your current grade' : ''}`}
      accessibilityState={{ selected: isSelected }}
      hitSlop={{ top: 6, bottom: 6, left: 2, right: 2 }}
    >
      <Text className={`text-[12px] leading-4 ${isSelected ? 'font-bold text-[#7B61FF]' : 'font-medium text-[#8B8FB5]'}`}>
        {grade}
      </Text>
      <View
        className="w-1 h-1 rounded-full mt-1"
        style={{
          backgroundColor: isOriginal
            ? (isSelected ? colors.primary : colors.textSecondary)
            : 'transparent',
        }}
      />
    </TouchableOpacity>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function GradePickerRow({
  courseId,
  courseName,
  courseType,
  originalGrade,
  selectedGrade,
  onGradeChange,
  style,
}: GradePickerRowProps): React.JSX.Element {
  const isModified = selectedGrade !== originalGrade
  const typeLabel  = COURSE_TYPE_LABELS[courseType]

  return (
    <Card style={style}>
      <View className="flex-row items-center gap-2 mb-1">
        <Text variant="h3" className="flex-1" numberOfLines={1}>
          {courseName}
        </Text>
        {typeLabel !== undefined && (
          <View className="bg-[#0D0E1C] border border-[#1C1F3C] rounded-[4px] px-2 py-1">
            <Text className="text-[10px] font-bold uppercase tracking-[0.5px] leading-4 text-[#8B8FB5]">{typeLabel}</Text>
          </View>
        )}
      </View>

      <Text variant="caption" color={colors.textMuted} className="mb-3">
        {isModified ? `${originalGrade} → ${selectedGrade}` : `Current: ${originalGrade}`}
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
            onPress={() => {
              if (isLetterGrade(grade)) onGradeChange(courseId, grade)
            }}
          />
        ))}
      </ScrollView>
    </Card>
  )
}

