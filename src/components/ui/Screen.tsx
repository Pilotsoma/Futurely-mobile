// Screen — base wrapper used by all placeholder and real screens.
// Provides safe-area insets, themed background, and consistent horizontal padding.

import React from 'react'
import { View, StyleSheet, ViewStyle } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useTheme } from '../../theme/ThemeContext'

interface ScreenProps {
  children: React.ReactNode
  style?: ViewStyle
  /** Apply horizontal screen padding (screenPaddingH = 20). Default: true. */
  padded?: boolean
}

export default function Screen({
  children,
  style,
  padded = true,
}: ScreenProps): React.JSX.Element {
  const { theme } = useTheme()

  return (
    <SafeAreaView
      style={[{ flex: 1, backgroundColor: theme.colors.bg }]}
      edges={['top', 'left', 'right']}
    >
      <View
        style={[
          styles.content,
          padded && { paddingHorizontal: theme.spacing.screenPaddingH },
          style,
        ]}
      >
        {children}
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  content: {
    flex: 1,
  },
})
