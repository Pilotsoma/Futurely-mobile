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
