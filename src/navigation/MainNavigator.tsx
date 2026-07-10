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
import { colors, radii } from '../theme/tokens'

// Bottom tabs (not a drawer) matching the Figma prototype's signature nav.
// Visible tabs: Home/Grades/AI/Planner/Colleges/Settings. Study Feed stays a
// real, directly-navigable route (hidden via tabBarButton) rather than being
// deleted — routing/params are unaffected, only which tabs are shown changed.
export type MainTabParamList = {
  Dashboard: undefined
  Grades: undefined
  AIChat: undefined
  Planner: undefined
  Colleges: undefined
  Settings: undefined
  StudyFeed: undefined
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
        // No explicit height/paddingTop — bottom-tabs sizes itself around the
        // bottom safe-area inset automatically; overriding height clipped the
        // label text on devices with a gesture/button nav bar.
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
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
        name="Colleges"
        component={CollegesScreen}
        options={{
          title: 'Colleges',
          tabBarIcon: ({ focused, color, size }) => (
            <TabIcon focused={focused}>
              <Feather name="bookmark" size={size} color={color} />
            </TabIcon>
          ),
        }}
      />
      <Tab.Screen
        name="Settings"
        component={SettingsScreen}
        options={{
          title: 'Settings',
          tabBarIcon: ({ focused, color, size }) => (
            <TabIcon focused={focused}>
              <Feather name="settings" size={size} color={color} />
            </TabIcon>
          ),
        }}
      />
      <Tab.Screen name="StudyFeed" component={StudyFeedScreen} options={hideFromTabBar()} />
    </Tab.Navigator>
  )
}

const styles = StyleSheet.create({
  iconWrap: {
    paddingHorizontal: 14,
    paddingVertical: 4,
    borderRadius: radii.sm,
  },
  iconWrapActive: { backgroundColor: colors.primaryDim },
})
