import React from 'react'
import { ScrollView, View } from 'react-native'
import { SafeAreaView, type Edge } from 'react-native-safe-area-context'

interface ScreenProps {
  children: React.ReactNode
  scroll?: boolean
  noPadding?: boolean
  edges?: Edge[]
}

export default function Screen({
  children,
  scroll = false,
  noPadding = false,
  edges = ['top', 'left', 'right', 'bottom'],
}: ScreenProps): React.JSX.Element {
  const inner = scroll ? (
    <ScrollView
      className="flex-1"
      contentContainerStyle={{
        flexGrow: 1,
        paddingHorizontal: noPadding ? 0 : 20,
        paddingBottom: 24,
      }}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  ) : (
    <View className={noPadding ? 'flex-1' : 'flex-1 px-5'}>{children}</View>
  )

  return (
    <SafeAreaView className="flex-1 bg-[#07080F]" edges={edges}>
      {inner}
    </SafeAreaView>
  )
}
