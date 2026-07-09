import React from 'react'
import { View, StyleSheet } from 'react-native'
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons'
import DashboardScreen from '../screens/DashboardScreen'
import GradesNavigator from './GradesNavigator'
import PlannerScreen from '../screens/PlannerScreen'
import StudyFeedScreen from '../screens/StudyFeedScreen'
import CollegesScreen from '../screens/CollegesScreen'
import AIChatScreen from '../screens/AIChatScreen'
import SettingsScreen from '../screens/SettingsScreen'
import MoreScreen from '../screens/MoreScreen'
import { colors, radii } from '../theme/tokens'

// Bottom tabs (not a drawer) matching the Figma prototype's signature nav —
// 5 primary destinations (Home/Grades/AI/Planner/Feed) + a "More" 6th tab for
// Colleges/Settings/Sign out, since a 7th-item drawer doesn't map onto a tab bar.
// Colleges and Settings stay real, directly-navigable routes (hidden from the
// tab bar via tabBarButton) so `navigation.navigate('Colleges'|'Settings')`
// keeps working exactly as before — only the chrome changed, not routing.
export type MainTabParamList = {
  Dashboard: undefined
  Grades: undefined
  AIChat: undefined
  Planner: undefined
  StudyFeed: undefined
  More: undefined
  Colleges: undefined
  Settings: undefined
}

const Tab = createBottomTabNavigator<MainTabParamList>()

function TabIcon({ focused, children }: { focused: boolean; children: React.ReactNode }): React.JSX.Element {
  return <View style={[styles.iconWrap, focused && styles.iconWrapActive]}>{children}</View>
}

function hideFromTabBar() {
  return { tabBarButton: () => null }
}

export default function MainNavigator(): React.JSX.Element {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border, height: 64, paddingTop: 6 },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      }}
    >
      <Tab.Screen
        name="Dashboard"
        component={DashboardScreen}
        options={{
          title: 'Home',
          tabBarIcon: ({ focused, color, size }) => (
            <TabIcon focused={focused}>
              <Feather name="home" size={size} color={color} />
            </TabIcon>
          ),
        }}
      />
      <Tab.Screen
        name="Grades"
        component={GradesNavigator}
        options={{
          title: 'Grades',
          tabBarIcon: ({ focused, color, size }) => (
            <TabIcon focused={focused}>
              <Feather name="bar-chart-2" size={size} color={color} />
            </TabIcon>
          ),
        }}
      />
      <Tab.Screen
        name="AIChat"
        component={AIChatScreen}
        options={{
          title: 'AI',
          tabBarIcon: ({ focused, color, size }) => (
            <TabIcon focused={focused}>
              <MaterialCommunityIcons name="brain" size={size} color={color} />
            </TabIcon>
          ),
        }}
      />
      <Tab.Screen
        name="Planner"
        component={PlannerScreen}
        options={{
          title: 'Planner',
          tabBarIcon: ({ focused, color, size }) => (
            <TabIcon focused={focused}>
              <Feather name="calendar" size={size} color={color} />
            </TabIcon>
          ),
        }}
      />
      <Tab.Screen
        name="StudyFeed"
        component={StudyFeedScreen}
        options={{
          title: 'Feed',
          tabBarIcon: ({ focused, color, size }) => (
            <TabIcon focused={focused}>
              <Feather name="users" size={size} color={color} />
            </TabIcon>
          ),
        }}
      />
      <Tab.Screen
        name="More"
        component={MoreScreen}
        options={{
          title: 'More',
          tabBarIcon: ({ focused, color, size }) => (
            <TabIcon focused={focused}>
              <Feather name="more-horizontal" size={size} color={color} />
            </TabIcon>
          ),
        }}
      />
      <Tab.Screen name="Colleges" component={CollegesScreen} options={hideFromTabBar()} />
      <Tab.Screen name="Settings" component={SettingsScreen} options={hideFromTabBar()} />
    </Tab.Navigator>
  )
}

const styles = StyleSheet.create({
  iconWrap: {
    width: 40,
    height: 28,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrapActive: { backgroundColor: colors.primaryDim },
})
