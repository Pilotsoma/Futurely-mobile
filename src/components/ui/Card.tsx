import React from 'react'
import { TouchableOpacity, View, type StyleProp, type ViewStyle } from 'react-native'

interface CardProps {
  children: React.ReactNode
  onPress?: () => void
  testID?: string
  style?: StyleProp<ViewStyle>
}

export default function Card({
  children,
  onPress,
  testID,
  style,
}: CardProps): React.JSX.Element {
  const cardClassName = 'bg-[#0D0E1C] border border-[#1C1F3C] rounded-[12px] p-4'

  if (onPress !== undefined) {
    return (
      <TouchableOpacity className={`${cardClassName}`} onPress={onPress} activeOpacity={0.75} testID={testID} style={style}>
        {children}
      </TouchableOpacity>
    )
  }

  return (
    <View className={cardClassName} testID={testID} style={style}>
      {children}
    </View>
  )
}
