import './global.css'
import React from 'react'
import { StyleSheet, Text, TextInput, View } from 'react-native'
import { StatusBar } from 'expo-status-bar'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import {
  useFonts,
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from '@expo-google-fonts/inter'

import { AuthProvider } from './src/context/AuthContext'
import RootNavigator from './src/navigation/RootNavigator'
import { colors, fonts } from './src/theme/tokens'

// Bundling Inter (matches web's next/font Inter) instead of relying on the OS
// default typeface — device-level "custom system font" settings (common on
// Samsung/One UI) otherwise silently replace every unstyled Text with whatever
// font the user picked in their phone settings.
const textDefaults = { fontFamily: fonts.regular }
;(Text as unknown as { defaultProps?: { style?: unknown } }).defaultProps = {
  ...(Text as unknown as { defaultProps?: object }).defaultProps,
  style: [textDefaults, (Text as unknown as { defaultProps?: { style?: unknown } }).defaultProps?.style],
}
;(TextInput as unknown as { defaultProps?: { style?: unknown } }).defaultProps = {
  ...(TextInput as unknown as { defaultProps?: object }).defaultProps,
  style: [textDefaults, (TextInput as unknown as { defaultProps?: { style?: unknown } }).defaultProps?.style],
}

export default function App(): React.JSX.Element | null {
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  })

  if (!fontsLoaded) {
    return <View style={[styles.flex, styles.splash]} />
  }

  return (
    // GestureHandlerRootView is required by react-native-gesture-handler
    // (used by the drawer navigator) — must wrap the entire tree.
    <GestureHandlerRootView style={styles.flex}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <AuthProvider>
          <RootNavigator />
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  splash: { backgroundColor: colors.bg },
})
