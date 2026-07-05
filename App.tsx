import './global.css'
import React from 'react'
import { View } from 'react-native'
import { StatusBar } from 'expo-status-bar'

export default function App(): React.JSX.Element {
  return (
    <View style={{ flex: 1, backgroundColor: '#0D1829' }}>
      <StatusBar style="light" />
    </View>
  )
}
