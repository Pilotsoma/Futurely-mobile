import React from 'react'
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import { Ionicons } from '@expo/vector-icons'
import DashboardScreen from '../screens/DashboardScreen'
import GradeViewerScreen from '../screens/GradeViewerScreen'
import GpaSimulatorScreen from '../screens/GpaSimulatorScreen'
import SmartPlannerScreen from '../screens/SmartPlannerScreen'
import { colors } from '../constants/colors'

export type TabParamList = {
  Dashboard: undefined
  Grades:    undefined
  Simulator: undefined
  Planner:   undefined
}

type IoniconName = React.ComponentProps<typeof Ionicons>['name']

interface TabIconConfig {
  active: IoniconName
  inactive: IoniconName
}

const TAB_ICONS: Record<keyof TabParamList, TabIconConfig> = {
  Dashboard: { active: 'grid',             inactive: 'grid-outline' },
  Grades:    { active: 'school',           inactive: 'school-outline' },
  Simulator: { active: 'calculator',       inactive: 'calculator-outline' },
  Planner:   { active: 'calendar',         inactive: 'calendar-outline' },
}

const Tab = createBottomTabNavigator<TabParamList>()

export default function TabNavigator(): React.JSX.Element {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          borderTopWidth: 1,
        },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarIcon: ({ focused, color, size }) => {
          const icons = TAB_ICONS[route.name as keyof TabParamList]
          const iconName = focused ? icons.active : icons.inactive
          return <Ionicons name={iconName} size={size} color={color} />
        },
      })}
    >
      <Tab.Screen name="Dashboard" component={DashboardScreen} />
      <Tab.Screen
        name="Grades"
        component={GradeViewerScreen}
        options={{ tabBarLabel: 'Grades' }}
      />
      <Tab.Screen
        name="Simulator"
        component={GpaSimulatorScreen}
        options={{ tabBarLabel: 'Simulate' }}
      />
      <Tab.Screen
        name="Planner"
        component={SmartPlannerScreen}
        options={{ tabBarLabel: 'Planner' }}
      />
    </Tab.Navigator>
  )
}

