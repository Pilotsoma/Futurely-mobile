import React, { useState } from 'react'
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native'
import { useAuth } from '../context/AuthContext'
import { colors } from '../constants/colors'
import Button from '../components/ui/Button'
import Input from '../components/ui/Input'
import Text from '../components/ui/Text'
import FuturelyLogo from '../components/ui/FuturelyLogo'

type Mode = 'login' | 'register'

export default function LoginScreen(): React.JSX.Element {
  const { login, register } = useAuth()

  const [mode, setMode]             = useState<Mode>('login')
  const [email, setEmail]           = useState('')
  const [password, setPassword]     = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [name, setName]             = useState('')
  const [isLoading, setIsLoading]   = useState(false)
  const [error, setError]           = useState<string | null>(null)

  const isRegister = mode === 'register'

  async function handleSubmit(): Promise<void> {
    if (!email.trim() || !password.trim()) {
      setError('Please enter your email and password.')
      return
    }

    if (isRegister) {
      if (password !== confirmPassword) {
        setError('Passwords do not match.')
        return
      }
      if (password.length < 6) {
        setError('Password must be at least 6 characters.')
        return
      }
    }

    setIsLoading(true)
    setError(null)

    try {
      if (isRegister) {
        await register(email.trim(), password, name.trim() || undefined)
      } else {
        await login(email.trim(), password)
      }
      // RootNavigator re-renders automatically when token is set in AuthContext
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  function switchMode(): void {
    setMode(m => m === 'login' ? 'register' : 'login')
    setError(null)
    setEmail('')
    setPassword('')
    setConfirmPassword('')
    setName('')
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.inner}>

        {/* ── Brand ── */}
        <View style={styles.brand}>
          <FuturelyLogo size={80} />
          <Text variant="display" color={colors.primary} style={{ textAlign: 'center', marginTop: 16 }}>
            Futurely
          </Text>
          <Text variant="body" color={colors.textSecondary} style={{ textAlign: 'center', marginTop: 8 }}>
            {isRegister ? 'Create your account' : 'Your academic companion'}
          </Text>
        </View>

        {/* ── Form ── */}
        <View>
          {/* Display name (register only) */}
          {isRegister && (
            <Input
              label="Display Name (optional)"
              value={name}
              onChangeText={(v) => { setName(v); setError(null) }}
              placeholder="Jane Doe"
              autoCapitalize="words"
              editable={!isLoading}
              returnKeyType="next"
            />
          )}

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
            placeholder={isRegister ? 'At least 6 characters' : 'Enter your password'}
            secureTextEntry
            editable={!isLoading}
            returnKeyType={isRegister ? 'next' : 'done'}
            onSubmitEditing={() => { if (!isRegister) void handleSubmit() }}
            testID="password-input"
          />

          {/* Confirm password (register only) */}
          {isRegister && (
            <Input
              label="Confirm Password"
              value={confirmPassword}
              onChangeText={(v) => { setConfirmPassword(v); setError(null) }}
              placeholder="Re-enter your password"
              secureTextEntry
              editable={!isLoading}
              returnKeyType="done"
              onSubmitEditing={() => void handleSubmit()}
              error={error}
            />
          )}

          {!isRegister && error && (
            <Text style={styles.errorText}>{error}</Text>
          )}

          <Button
            label={isLoading
              ? (isRegister ? 'Creating account...' : 'Logging in...')
              : (isRegister ? 'Create Account' : 'Log In')}
            onPress={() => void handleSubmit()}
            isLoading={isLoading}
            testID="login-button"
          />

          {/* ── Mode switch ── */}
          <Text
            style={styles.switchText}
            onPress={switchMode}
          >
            {isRegister
              ? 'Already have an account? Log In'
              : "Don't have an account? Create one"}
          </Text>

          {/* ── Test hint (login only) ── */}
          {!isRegister && (
            <Text style={styles.hint}>
              Test account: test@nextstep.com / nextstep123
            </Text>
          )}
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
  },
  hint: {
    fontSize: 12,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: 16,
  },
  switchText: {
    fontSize: 13,
    color: colors.primary,
    textAlign: 'center',
    marginTop: 20,
    fontWeight: '600',
  },
  errorText: {
    fontSize: 13,
    color: colors.error,
    textAlign: 'center',
    marginBottom: 8,
  },
})