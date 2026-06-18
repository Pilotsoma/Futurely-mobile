import React from 'react'
import { TouchableOpacity } from 'react-native'
import Text from './Text'

export interface ResetButtonProps {
  onPress: () => void
  disabled?: boolean
  label?: string
  testID?: string
}

export default function ResetButton({
  onPress,
  disabled = false,
  label = 'Reset',
  testID,
}: ResetButtonProps): React.JSX.Element {
  return (
    <TouchableOpacity
      className={`flex-row items-center justify-center gap-2 h-12 rounded-2xl border border-[#1C1F3C] px-5 ${disabled ? 'opacity-40' : ''}`}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={`${label} grades to original`}
      accessibilityState={{ disabled }}
      testID={testID}
    >
      <Text className={`text-[18px] leading-[22px] ${disabled ? 'text-[#8B8FB5]' : 'text-[#EDEEFF]'}`}>↺</Text>
      <Text className={`text-[15px] font-semibold ${disabled ? 'text-[#8B8FB5]' : 'text-[#EDEEFF]'}`}>{label}</Text>
    </TouchableOpacity>
  )
}
