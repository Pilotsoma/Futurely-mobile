// ConnectSchoolNavigator — single-screen stack shown after login when the user
// has no linked school portal. On successful connection, AuthContext's
// markPortalConnected() is called, which triggers RootNavigator to swap
// this navigator out for MainNavigator.

import React from 'react'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import ConnectSchoolScreen from '../screens/ConnectSchoolScreen'

export type ConnectSchoolStackParamList = {
  ConnectSchool: undefined
}

const Stack = createNativeStackNavigator<ConnectSchoolStackParamList>()

export default function ConnectSchoolNavigator(): React.JSX.Element {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="ConnectSchool" component={ConnectSchoolScreen} />
    </Stack.Navigator>
  )
}
