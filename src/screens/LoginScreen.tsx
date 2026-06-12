import React, { useState } from 'react'
import { Image, KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native'
import { useAuth } from '../context/AuthContext'
import { colors } from '../constants/colors'
import Button from '../components/ui/Button'
import Input from '../components/ui/Input'
import Text from '../components/ui/Text'

export default function LoginScreen(): React.JSX.Element {
  const { login } = useAuth()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleLogin(): Promise<void> {
    if (!email.trim() || !password.trim()) {
      setError('Please enter your email and password.')
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      await login(email.trim(), password)
      // RootNavigator re-renders automatically when token is set in AuthContext
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Login failed. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.inner}>

        {/* ── Brand ── */}
        <View style={styles.brand}>
          <Image
            source={require('../../assets/logo.png')}
            style={styles.logo}
          />
          <Text style={styles.title}>NextStep</Text>
          <Text style={styles.subtitle}>Your academic companion</Text>
        </View>

        {/* ── Form ── */}
        <View>
          <Input
            label="Email"
            value={email}
            onChangeText={(v) => { setEmail(v); setError(null) }}
            placeholder="Enter your email"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!isLoading}
            returnKeyType="next"
            testID="email-input"
          />

          <Input
            label="Password"
            value={password}
            onChangeText={(v) => { setPassword(v); setError(null) }}
            placeholder="Enter your password"
            secureTextEntry
            editable={!isLoading}
            returnKeyType="done"
            onSubmitEditing={() => void handleLogin()}
            error={error}
            testID="password-input"
          />

          <Button
            label="Log In"
            onPress={() => void handleLogin()}
            isLoading={isLoading}
            testID="login-button"
          />

          <Text style={styles.hint}>
            Test account: test@nextstep.com / nextstep123
          </Text>
        </View>

      </View>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  inner: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  brand: {
    alignItems: 'center',
    marginBottom: 40,
  },
  logo: {
    width: 80,
    height: 80,
    resizeMode: 'contain',
    marginBottom: 16,
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
    color: colors.primary,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 15,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: 8,
  },
  hint: {
    fontSize: 12,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: 16,
  },
})
