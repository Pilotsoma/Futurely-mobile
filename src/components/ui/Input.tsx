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
    ? 'border-[#EF4444]'
    : isFocused
      ? 'border-[#2979FF]'
      : 'border-[#1A2744]'

  return (
    <View className="mb-4">
      <Text className="text-[12px] font-semibold tracking-[0.5px] text-[#E8EEFF] mb-1.5">{label}</Text>
      <TextInput
        className={`bg-[#050B18] border rounded-2xl min-h-[48px] px-3 py-3 text-[#E8EEFF] text-[16px] ${borderClass}`}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#7B8DB0"
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
      {error != null && <Text className="text-[#EF4444] text-[13px] mt-1">{error}</Text>}
    </View>
  )
}
