import React from 'react'
import { ActivityIndicator, TouchableOpacity } from 'react-native'
import Text from './Text'

interface ButtonProps {
  label: string
  onPress: () => void
  isLoading?: boolean
  disabled?: boolean
  accessibilityLabel?: string
  testID?: string
}

export default function Button({
  label,
  onPress,
  isLoading = false,
  disabled = false,
  accessibilityLabel,
  testID,
}: ButtonProps): React.JSX.Element {
  const isInert = isLoading || disabled

  return (
    <TouchableOpacity
      className={`rounded-xl min-h-[48px] px-4 items-center justify-center bg-[#00C896] ${isInert ? 'opacity-40' : ''}`}
      onPress={onPress}
      disabled={isInert}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: isInert, busy: isLoading }}
      testID={testID}
    >
      {isLoading ? (
        <ActivityIndicator color="#0D1117" />
      ) : (
        <Text className="text-[#0D1117] text-[16px] font-semibold">{label}</Text>
      )}
    </TouchableOpacity>
  )
}
