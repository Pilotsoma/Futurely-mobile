import React, { useState } from 'react'
import { KeyboardTypeOptions, ReturnKeyTypeOptions, TextInput, View } from 'react-native'
import Text from './Text'

interface InputProps {
  label: string
  value: string
  onChangeText: (text: string) => void
  placeholder?: string
  secureTextEntry?: boolean
  keyboardType?: KeyboardTypeOptions
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters'
  autoCorrect?: boolean
  editable?: boolean
  error?: string | null
  returnKeyType?: ReturnKeyTypeOptions
  onSubmitEditing?: () => void
  accessibilityLabel?: string
  testID?: string
}

export default function Input({
  label,
  value,
  onChangeText,
  placeholder,
  secureTextEntry = false,
  keyboardType = 'default',
  autoCapitalize = 'sentences',
  autoCorrect = true,
  editable = true,
  error,
  returnKeyType,
  onSubmitEditing,
  accessibilityLabel,
  testID,
}: InputProps): React.JSX.Element {
  const [isFocused, setIsFocused] = useState(false)
  const borderClass = error
    ? 'border-[#F85149]'
    : isFocused
      ? 'border-[#00C896]'
      : 'border-[#30363D]'

  return (
    <View className="mb-4">
      <Text className="text-[12px] font-semibold tracking-[0.5px] text-[#E6EDF3] mb-1.5">{label}</Text>
      <TextInput
        className={`bg-[#0D1117] border rounded-2xl min-h-[48px] px-3 py-3 text-[#E6EDF3] text-[16px] ${borderClass}`}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#8B949E"
        secureTextEntry={secureTextEntry}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        autoCorrect={autoCorrect}
        editable={editable}
        returnKeyType={returnKeyType}
        onSubmitEditing={onSubmitEditing}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        accessibilityLabel={accessibilityLabel ?? label}
        testID={testID}
      />
      {error != null && <Text className="text-[#F85149] text-[13px] mt-1">{error}</Text>}
    </View>
  )
}
