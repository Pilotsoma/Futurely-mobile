import React, { useEffect, useState } from 'react'
import { ActivityIndicator, View } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { useAuth } from '../context/AuthContext'
import { useSchoolSession } from '../context/SchoolSessionContext'
import LoginScreen from '../screens/LoginScreen'
import SchoolLoginScreen from '../screens/SchoolLoginScreen'
import UserAgreementScreen from '../screens/UserAgreementScreen'
import AppNavigator from './AppNavigator'
import { colors } from '../constants/colors'

const AGREEMENT_KEY = 'nextstep_agreement_accepted'

type AuthStackParamList = {
  SchoolLogin: undefined
  Login: undefined
}

const AuthStack = createNativeStackNavigator<AuthStackParamList>()

function AuthNavigator(): React.JSX.Element {
  return (
    <AuthStack.Navigator screenOptions={{ headerShown: false }}>
      <AuthStack.Screen name="SchoolLogin" component={SchoolLoginScreen} />
      <AuthStack.Screen name="Login" component={LoginScreen} />
    </AuthStack.Navigator>
  )
}

function SplashView(): React.JSX.Element {
  return (
    <View className="flex-1 items-center justify-center bg-[#0D1117]">
      <ActivityIndicator size="large" color={colors.primary} />
    </View>
  )
}

export default function RootNavigator(): React.JSX.Element {
  const { token, isLoading: authLoading } = useAuth()
  const { hasSchoolSession, isLoaded: schoolLoaded } = useSchoolSession()

  const [hasAgreed, setHasAgreed] = useState(false)
  const [agreementLoaded, setAgreementLoaded] = useState(false)

  useEffect(() => {
    async function checkAgreement(): Promise<void> {
      if (!token) {
        setAgreementLoaded(true)
        return
      }
      try {
        const val = await AsyncStorage.getItem(AGREEMENT_KEY)
        setHasAgreed(val === 'true')
      } catch {
        setHasAgreed(false)
      } finally {
        setAgreementLoaded(true)
      }
    }
    void checkAgreement()
  }, [token])

  async function handleAgree(): Promise<void> {
    try {
      await AsyncStorage.setItem(AGREEMENT_KEY, 'true')
    } finally {
      setHasAgreed(true)
    }
  }

  // Wait for all async checks to complete
  if (authLoading || !schoolLoaded || !agreementLoaded) return <SplashView />

  // Neither a NextStep JWT nor a school session — show auth flow
  if (token === null && !hasSchoolSession) return <AuthNavigator />

  // NextStep parent account logged in but hasn't agreed to terms
  if (token !== null && !hasAgreed) {
    return <UserAgreementScreen onAgree={() => void handleAgree()} />
  }

  // Either JWT token (parent) or school session (student) — show the app
  return <AppNavigator />
}
