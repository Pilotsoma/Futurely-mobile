import './global.css'
import React from 'react'
import { NavigationContainer } from '@react-navigation/native'
import { StatusBar } from 'expo-status-bar'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { AuthProvider } from './src/context/AuthContext'
import { SchoolSessionProvider } from './src/context/SchoolSessionContext'
import RootNavigator from './src/navigation/RootNavigator'

export default function App(): React.JSX.Element {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SchoolSessionProvider>
        <AuthProvider>
          <NavigationContainer>
            <StatusBar style="light" />
            <RootNavigator />
          </NavigationContainer>
        </AuthProvider>
      </SchoolSessionProvider>
    </GestureHandlerRootView>
  )
}
