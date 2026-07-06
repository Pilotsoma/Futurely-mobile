// AuthNavigator — stack for unauthenticated users.
//
// Only Login lives here now. ConnectSchool is gated separately by RootNavigator
// (shown after authentication but before a portal is linked), so it has its own
// ConnectSchoolNavigator and is not reachable from unauthenticated state.

import React from 'react'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import LoginScreen from '../screens/LoginScreen'

export type AuthStackParamList = {
  Login: undefined
}

const Stack = createNativeStackNavigator<AuthStackParamList>()

export default function AuthNavigator(): React.JSX.Element {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Login" component={LoginScreen} />
    </Stack.Navigator>
  )
}
