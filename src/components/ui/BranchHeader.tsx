import React from 'react'
import { StyleSheet, TouchableOpacity, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import type { AppParamList } from '../../navigation/AppNavigator'
import FuturelyLogo from './FuturelyLogo'

export default function BranchHeader(): React.JSX.Element {
  const navigation = useNavigation<NativeStackNavigationProp<AppParamList>>()
  const insets = useSafeAreaInsets()

  return (
    <View style={[styles.container, { paddingTop: insets.top + 12 }]}>
      <TouchableOpacity
        style={styles.logoBtn}
        onPress={() => navigation.navigate('MainAI')}
        accessibilityRole="button"
        accessibilityLabel="Return to home"
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        activeOpacity={0.8}
      >
        <FuturelyLogo size={40} />
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  logoBtn: {
    alignSelf: 'flex-start',
  },
  logo: {
    width: 40,
    height: 40,
  },
})
