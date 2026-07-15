import React from 'react'
import { StyleSheet, View } from 'react-native'
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import DashboardScreen from '../screens/DashboardScreen'
import GradesNavigator from './GradesNavigator'
import PlannerScreen from '../screens/PlannerScreen'
import StudyFeedScreen from '../screens/StudyFeedScreen'
import CollegesScreen from '../screens/CollegesScreen'
import AIChatScreen from '../screens/AIChatScreen'
import SettingsScreen from '../screens/SettingsScreen'
import { colors, fonts } from '../theme/tokens'

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

function TabIcon({
  focused,
  children,
}: {
  focused: boolean
  children: React.ReactNode
}): React.JSX.Element {
  return <View style={[styles.iconWrap, focused && styles.iconWrapActive]}>{children}</View>
}

function hideFromTabBar() {
  return {
    tabBarButton: () => null,
    // Remove the hidden StudyFeed route from the tab bar layout entirely.
    // Without this, React Navigation can reserve a seventh empty tab slot.
    tabBarItemStyle: { display: 'none' as const },
  }
}

export default function MainNavigator(): React.JSX.Element {
  const insets = useSafeAreaInsets()

  // Adds a little extra clearance above Android's system navigation/gesture bar.
  const safeBottom = Math.max(insets.bottom, 8)
  const contentLift = 7

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarHideOnKeyboard: true,
        tabBarActiveTintColor: '#C5AEFF',
        tabBarInactiveTintColor: '#8190A7',
        tabBarStyle: [
          styles.tabBar,
          {
            height: 64 + safeBottom + contentLift,
            paddingBottom: safeBottom + contentLift,
          },
        ],
        tabBarItemStyle: styles.tabItem,
        tabBarIconStyle: styles.tabIcon,
        tabBarLabelStyle: styles.tabLabel,
      }}
    >
      <Tab.Screen
        name="Dashboard"
        component={DashboardScreen}
        options={{
          title: 'Home',
          tabBarIcon: ({ focused, color }) => (
            <TabIcon focused={focused}>
              <Feather name="home" size={20} color={color} />
            </TabIcon>
          ),
        }}
      />

      <Tab.Screen
        name="Grades"
        component={GradesNavigator}
        options={{
          title: 'Grades',
          tabBarIcon: ({ focused, color }) => (
            <TabIcon focused={focused}>
              <Feather name="bar-chart-2" size={20} color={color} />
            </TabIcon>
          ),
        }}
      />

      <Tab.Screen
        name="AIChat"
        component={AIChatScreen}
        options={{
          title: 'AI',
          tabBarIcon: ({ focused, color }) => (
            <TabIcon focused={focused}>
              <MaterialCommunityIcons name="brain" size={21} color={color} />
            </TabIcon>
          ),
        }}
      />

      <Tab.Screen
        name="Planner"
        component={PlannerScreen}
        options={{
          title: 'Planner',
          tabBarIcon: ({ focused, color }) => (
            <TabIcon focused={focused}>
              <Feather name="calendar" size={20} color={color} />
            </TabIcon>
          ),
        }}
      />

      <Tab.Screen
        name="Colleges"
        component={CollegesScreen}
        options={{
          title: 'Colleges',
          tabBarIcon: ({ focused, color }) => (
            <TabIcon focused={focused}>
              <Feather name="bookmark" size={20} color={color} />
            </TabIcon>
          ),
        }}
      />

      <Tab.Screen
        name="Settings"
        component={SettingsScreen}
        options={{
          title: 'Settings',
          tabBarIcon: ({ focused, color }) => (
            <TabIcon focused={focused}>
              <Feather name="settings" size={20} color={color} />
            </TabIcon>
          ),
        }}
      />

      <Tab.Screen name="StudyFeed" component={StudyFeedScreen} options={hideFromTabBar()} />
    </Tab.Navigator>
  )
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: '#071522',
    borderTopWidth: 1,
    borderTopColor: 'rgba(102, 128, 165, 0.30)',
    paddingTop: 7,
    paddingHorizontal: 2,
    shadowColor: '#000000',
    shadowOpacity: 0.32,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: -5 },
    elevation: 18,
  },
  tabItem: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 0,
  },
  tabIcon: {
    marginTop: 0,
  },
  tabLabel: {
    fontFamily: fonts.semiBold,
    fontWeight: '600',
    fontSize: 10,
    lineHeight: 12,
    marginTop: 2,
  },
  iconWrap: {
    width: 36,
    height: 31,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  iconWrapActive: {
    backgroundColor: colors.primaryDim,
    borderColor: 'rgba(197, 174, 255, 0.28)',
  },
})