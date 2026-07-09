// RootNavigator — top-level auth gate.
//
// Three-state routing (avoids flash of wrong screen on cold launch):
//   'initializing'                                  -> loading indicator
//   'unauthenticated'                                -> AuthNavigator (Login + Register)
//   'authenticated' + hasPortalConnection === null   -> loading indicator (status check in flight)
//   'authenticated' + hasPortalConnection === false  -> ConnectSchoolNavigator
//   'authenticated' + hasPortalConnection === true   -> MainNavigator (Drawer)
//
// No imperative navigation calls — all transitions are reactive on AuthContext
// state, so any async update (token restore, portal check, markPortalConnected)
// automatically renders the correct screen without a flash.

import React from 'react'
import { ActivityIndicator, StyleSheet, View } from 'react-native'
import { NavigationContainer } from '@react-navigation/native'
import { useAuth } from '../context/AuthContext'
import AuthNavigator from './AuthNavigator'
import ConnectSchoolNavigator from './ConnectSchoolNavigator'
import MainNavigator from './MainNavigator'
import { colors } from '../theme/tokens'

export default function RootNavigator(): React.JSX.Element {
  const { status, hasPortalConnection } = useAuth()

  const isLoading = status === 'initializing' || (status === 'authenticated' && hasPortalConnection === null)

  if (isLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.primary} size="small" />
      </View>
    )
  }

  let navigator: React.JSX.Element
  if (status === 'unauthenticated') {
    navigator = <AuthNavigator />
  } else if (hasPortalConnection === false) {
    navigator = <ConnectSchoolNavigator />
  } else {
    navigator = <MainNavigator />
  }

  return <NavigationContainer>{navigator}</NavigationContainer>
}

const styles = StyleSheet.create({
  loading: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
})
