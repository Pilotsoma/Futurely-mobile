import React from 'react'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import SmartPlannerScreen from '../screens/SmartPlannerScreen'
import CalendarScreen from '../screens/CalendarScreen'

export type PlanningParamList = {
  SmartPlanner: undefined
  Calendar: undefined
}

const Stack = createNativeStackNavigator<PlanningParamList>()

export default function PlanningNavigator(): React.JSX.Element {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="SmartPlanner" component={SmartPlannerScreen} />
      <Stack.Screen
        name="Calendar"
        component={CalendarScreen}
        options={{ animation: 'slide_from_right' }}
      />
    </Stack.Navigator>
  )
}
