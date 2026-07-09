import React from 'react'
import { createDrawerNavigator } from '@react-navigation/drawer'
import DrawerContent from './DrawerContent'
import DashboardScreen from '../screens/DashboardScreen'
import GradesNavigator from './GradesNavigator'
import PlannerScreen from '../screens/PlannerScreen'
import StudyFeedScreen from '../screens/StudyFeedScreen'
import CollegesScreen from '../screens/CollegesScreen'
import AIChatScreen from '../screens/AIChatScreen'
import SettingsScreen from '../screens/SettingsScreen'
import { colors } from '../theme/tokens'

// Drawer, not bottom tabs: matches web's collapsible sidebar, and 7 top-level
// items exceeds iOS bottom tabs' 5-item limit before a fragmenting "More" menu.
export type MainDrawerParamList = {
  Dashboard: undefined
  Grades: undefined
  Planner: undefined
  StudyFeed: undefined
  Colleges: undefined
  AIChat: undefined
  Settings: undefined
}

const Drawer = createDrawerNavigator<MainDrawerParamList>()

export default function MainNavigator(): React.JSX.Element {
  return (
    <Drawer.Navigator
      drawerContent={(props) => <DrawerContent {...props} />}
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text,
        headerTitleStyle: { fontWeight: '600' },
        headerShadowVisible: false,
        drawerStyle: { backgroundColor: colors.bg, width: 260 },
        drawerType: 'slide',
        overlayColor: 'rgba(0,0,0,0.45)',
        swipeEdgeWidth: 40,
      }}
    >
      <Drawer.Screen name="Dashboard" component={DashboardScreen} options={{ title: 'Dashboard' }} />
      <Drawer.Screen name="Grades" component={GradesNavigator} options={{ title: 'Grades', headerShown: false }} />
      <Drawer.Screen name="Planner" component={PlannerScreen} options={{ title: 'Planner' }} />
      <Drawer.Screen name="StudyFeed" component={StudyFeedScreen} options={{ title: 'Study Feed' }} />
      <Drawer.Screen name="Colleges" component={CollegesScreen} options={{ title: 'Colleges' }} />
      <Drawer.Screen name="AIChat" component={AIChatScreen} options={{ title: 'AI Chat' }} />
      <Drawer.Screen name="Settings" component={SettingsScreen} options={{ title: 'Settings' }} />
    </Drawer.Navigator>
  )
}
