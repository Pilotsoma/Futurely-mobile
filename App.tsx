import './global.css'
import React from 'react'
import { StatusBar } from 'expo-status-bar'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { NavigationContainer } from '@react-navigation/native'

import { AuthProvider } from './src/context/AuthContext'
import AuthNavigator from './src/navigation/AuthNavigator'

// Temporary direct-mount for incremental verification — replaced by RootNavigator
// (auth gate + ConnectSchool + main Drawer) once Phase 7 lands.
export default function App(): React.JSX.Element {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <AuthProvider>
          <NavigationContainer>
            <AuthNavigator />
          </NavigationContainer>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}
