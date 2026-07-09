import './global.css'
import React from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { StatusBar } from 'expo-status-bar'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'

// Minimal boot stub — rebuilt incrementally per melodic-wobbling-pillow.md.
// ThemeProvider/AuthProvider/RootNavigator are wired back in as each layer lands.
export default function App(): React.JSX.Element {
  return (
    <GestureHandlerRootView style={styles.flex}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <View style={styles.container}>
          <Text style={styles.text}>Futurely — rebuilding</Text>
        </View>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: {
    flex: 1,
    backgroundColor: '#0D1829',
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    color: '#E8EEFF',
    fontSize: 16,
  },
})
