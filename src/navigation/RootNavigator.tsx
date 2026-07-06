// RootNavigator — top-level auth gate.
//
// Three-state routing (avoids flash of wrong screen on cold launch):
//
//   'initializing'                         → loading indicator (blank bg)
//   'unauthenticated'                      → AuthNavigator (Login + Register)
//   'authenticated' + hasPortalConnection === null  → loading indicator
//        (portal status check is still in flight after auth token was restored)
//   'authenticated' + hasPortalConnection === false → ConnectSchoolNavigator
//        (user has a Futurely account but no school portal linked yet)
//   'authenticated' + hasPortalConnection === true  → MainNavigator (Drawer)
//
// No imperative navigation calls here — all transitions are purely reactive on
// AuthContext state, so any async update (token restore, portal status check,
// markPortalConnected) automatically triggers the correct screen without any
// navigation.navigate() call and without any flash.

import React from 'react'
import { View, ActivityIndicator } from 'react-native'
import { NavigationContainer } from '@react-navigation/native'

import { useAuth } from '../context/AuthContext'
import { useTheme } from '../theme/ThemeContext'
import AuthNavigator from './AuthNavigator'
import ConnectSchoolNavigator from './ConnectSchoolNavigator'
import MainNavigator from './MainNavigator'

export default function RootNavigator(): React.JSX.Element {
  const { status, hasPortalConnection } = useAuth()
  const { theme } = useTheme()

  const isLoading =
    status === 'initializing' ||
    (status === 'authenticated' && hasPortalConnection === null)

  if (isLoading) {
    // Blank screen matching bg color while tokens are being restored
    // or the portal status check is in flight. Resolves within one round-trip.
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: theme.colors.bg,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <ActivityIndicator color={theme.colors.primary} size="small" />
      </View>
    )
  }

  let navigator: React.JSX.Element

  if (status === 'unauthenticated') {
    navigator = <AuthNavigator />
  } else if (hasPortalConnection === false) {
    // Authenticated user who has not yet linked a school portal.
    // ConnectSchoolNavigator calls markPortalConnected() on success,
    // which flips hasPortalConnection → true here and advances to Main.
    navigator = <ConnectSchoolNavigator />
  } else {
    navigator = <MainNavigator />
  }

  return (
    <NavigationContainer>
      {navigator}
    </NavigationContainer>
  )
}
