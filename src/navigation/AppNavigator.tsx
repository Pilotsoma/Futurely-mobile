import React from 'react'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import MainDrawerNavigator from './MainDrawerNavigator'
import GradePortalNavigator from './GradePortalNavigator'
import CollegeHelpNavigator from './CollegeHelpNavigator'
import PlanningNavigator from './PlanningNavigator'
import SettingsScreen from '../screens/SettingsScreen'

export type AppParamList = {
  MainAI: undefined
  GradePortal: undefined
  CollegeHelp: undefined
  Planning: undefined
  Settings: undefined
}

const Stack = createNativeStackNavigator<AppParamList>()

export default function AppNavigator(): React.JSX.Element {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="MainAI" component={MainDrawerNavigator} />
      <Stack.Screen name="GradePortal" component={GradePortalNavigator} />
      <Stack.Screen name="CollegeHelp" component={CollegeHelpNavigator} />
      <Stack.Screen name="Planning" component={PlanningNavigator} />
      <Stack.Screen
        name="Settings"
        component={SettingsScreen}
        options={{ animation: 'slide_from_right' }}
      />
    </Stack.Navigator>
  )
}
