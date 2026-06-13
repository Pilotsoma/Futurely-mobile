import React from 'react'
import { createDrawerNavigator } from '@react-navigation/drawer'
import MainAIScreen from '../screens/MainAIScreen'
import DrawerContent from '../components/ui/DrawerContent'
import { colors } from '../constants/colors'

export type MainDrawerParamList = {
  MainAIHome: undefined
}

const Drawer = createDrawerNavigator<MainDrawerParamList>()

export default function MainDrawerNavigator(): React.JSX.Element {
  return (
    <Drawer.Navigator
      drawerContent={(props) => <DrawerContent {...props} />}
      screenOptions={{
        headerShown: false,
        drawerType: 'front',
        drawerStyle: { backgroundColor: colors.background, width: 280 },
        overlayColor: 'rgba(0,0,0,0.6)',
        swipeEdgeWidth: 40,
      }}
    >
      <Drawer.Screen name="MainAIHome" component={MainAIScreen} />
    </Drawer.Navigator>
  )
}
