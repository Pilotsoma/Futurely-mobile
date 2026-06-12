import React from 'react'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import CollegeHelpScreen from '../screens/CollegeHelpScreen'
import GpaSimulatorScreen from '../screens/GpaSimulatorScreen'
import RoadmapScreen from '../screens/RoadmapScreen'
import CollegesScreen from '../screens/CollegesScreen'

export type CollegeHelpParamList = {
  CollegeHelpHome: undefined
  WhatIfCalculator: undefined
  Roadmap: undefined
  Colleges: undefined
}

const Stack = createNativeStackNavigator<CollegeHelpParamList>()

export default function CollegeHelpNavigator(): React.JSX.Element {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
      <Stack.Screen name="CollegeHelpHome" component={CollegeHelpScreen} />
      <Stack.Screen name="WhatIfCalculator" component={GpaSimulatorScreen} />
      <Stack.Screen name="Roadmap" component={RoadmapScreen} />
      <Stack.Screen name="Colleges" component={CollegesScreen} />
    </Stack.Navigator>
  )
}
