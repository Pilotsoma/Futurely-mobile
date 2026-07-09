import React, { useState } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { KeyboardAvoidingView, Platform } from 'react-native'
import { useAuth } from '../context/AuthContext'
import * as authApi from '../api/authApi'
import { ApiRequestError } from '../api/client'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { FuturelyLogo } from '../components/ui/FuturelyLogo'
import { colors, spacing, typography } from '../theme/tokens'

type Mode = 'login' | 'register'
type RegisterStep = 'dob' | 'account' | 'terms'

function calculateAge(dateOfBirth: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) return null
  const dob = new Date(dateOfBirth)
  if (Number.isNaN(dob.getTime())) return null
  const now = new Date()
  let age = now.getFullYear() - dob.getFullYear()
  const monthDiff = now.getMonth() - dob.getMonth()
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < dob.getDate())) age -= 1
  return age
}

export default function LoginScreen(): React.JSX.Element {
  const { signIn, register } = useAuth()
  const [mode, setMode] = useState<Mode>('login')

  // Login state
  const [loginEmail, setLoginEmail] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [loginError, setLoginError] = useState<string | null>(null)
  const [loginLoading, setLoginLoading] = useState(false)

  // Register state
  const [registerStep, setRegisterStep] = useState<RegisterStep>('dob')
  const [dateOfBirth, setDateOfBirth] = useState('')
  const [coppaBlocked, setCoppaBlocked] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [otp, setOtp] = useState('')
  const [otpSent, setOtpSent] = useState(false)
  const [otpLoading, setOtpLoading] = useState(false)
  const [acceptedTos, setAcceptedTos] = useState(false)
  const [acceptedPrivacy, setAcceptedPrivacy] = useState(false)
  const [registerError, setRegisterError] = useState<string | null>(null)
  const [registerLoading, setRegisterLoading] = useState(false)

  function switchMode(next: Mode): void {
    setMode(next)
    setLoginError(null)
    setRegisterError(null)
  }

  async function handleLogin(): Promise<void> {
    setLoginError(null)
    setLoginLoading(true)
    try {
      await signIn({ email: loginEmail.trim(), password: loginPassword })
    } catch (err) {
      if (err instanceof ApiRequestError) {
        if (err.code === 'ACCOUNT_LOCKED') {
          const seconds = (err.raw as { secondsRemaining?: number })?.secondsRemaining
          const minutes = seconds ? Math.ceil(seconds / 60) : null
          setLoginError(minutes ? `Account locked. Try again in ${minutes} minute(s).` : err.message)
        } else {
          setLoginError(err.message)
        }
      } else {
        setLoginError('Something went wrong. Please try again.')
      }
    } finally {
      setLoginLoading(false)
    }
  }

  function handleDobContinue(): void {
    const age = calculateAge(dateOfBirth)
    if (age === null) {
      setRegisterError('Enter your date of birth as YYYY-MM-DD.')
      return
    }
    if (age < 13) {
      setCoppaBlocked(true)
      return
    }
    setCoppaBlocked(false)
    setRegisterError(null)
    setRegisterStep('account')
  }

  async function handleSendOtp(): Promise<void> {
    setRegisterError(null)
    if (!email.trim() || !password) {
      setRegisterError('Enter your email and password first.')
      return
    }
    setOtpLoading(true)
    try {
      await authApi.sendOtp({ email: email.trim() })
      setOtpSent(true)
    } catch (err) {
      setRegisterError(err instanceof ApiRequestError ? err.message : 'Could not send code. Try again.')
    } finally {
      setOtpLoading(false)
    }
  }

  async function handleRegisterSubmit(): Promise<void> {
    setRegisterError(null)
    if (!acceptedTos || !acceptedPrivacy) {
      setRegisterError('You must accept the Terms of Service and Privacy Policy.')
      return
    }
    setRegisterLoading(true)
    try {
      await register({
        email: email.trim(),
        password,
        name: name.trim() || undefined,
        otp,
        dateOfBirth,
      })
    } catch (err) {
      if (err instanceof ApiRequestError) {
        const messages: Record<string, string> = {
          COPPA_BLOCK: 'You must be at least 13 years old to create an account.',
          CONFLICT: 'An account with this email already exists.',
          NAME_TAKEN: 'That display name is already taken.',
          INVALID_OTP: 'That code is incorrect or has expired. Request a new one.',
          OTP_REQUIRED: 'Enter the verification code sent to your email.',
        }
        setRegisterError((err.code && messages[err.code]) || err.message)
      } else {
        setRegisterError('Something went wrong. Please try again.')
      }
    } finally {
      setRegisterLoading(false)
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <FuturelyLogo size={56} />
          <Text style={styles.title}>Futurely</Text>
          <Text style={styles.subtitle}>Your AI-powered academic companion</Text>
        </View>

        {mode === 'login' ? (
          <View style={styles.form}>
            <Input
              label="Email"
              value={loginEmail}
              onChangeText={setLoginEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              textContentType="emailAddress"
            />
            <Input
              label="Password"
              value={loginPassword}
              onChangeText={setLoginPassword}
              secureTextEntry
              textContentType="password"
            />
            {loginError ? <Text style={styles.error}>{loginError}</Text> : null}
            <Button label="Sign In" onPress={() => void handleLogin()} loading={loginLoading} />
            <Button label="Create an account" onPress={() => switchMode('register')} variant="secondary" />
          </View>
        ) : (
          <View style={styles.form}>
            {registerStep === 'dob' && (
              <>
                <Text style={styles.stepTitle}>When were you born?</Text>
                <Input
                  label="Date of birth (YYYY-MM-DD)"
                  value={dateOfBirth}
                  onChangeText={(v) => {
                    setDateOfBirth(v)
                    setCoppaBlocked(false)
                  }}
                  placeholder="2010-05-14"
                  keyboardType="numbers-and-punctuation"
                />
                {coppaBlocked ? (
                  <Text style={styles.error}>
                    You must be at least 13 years old to create a Futurely account. Please ask a
                    parent or guardian for help.
                  </Text>
                ) : registerError ? (
                  <Text style={styles.error}>{registerError}</Text>
                ) : null}
                <Button label="Continue" onPress={handleDobContinue} disabled={coppaBlocked} />
              </>
            )}

            {registerStep === 'account' && (
              <>
                <Text style={styles.stepTitle}>Create your account</Text>
                <Input label="Display name (optional)" value={name} onChangeText={setName} />
                <Input
                  label="Email"
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  textContentType="emailAddress"
                />
                <Input
                  label="Password"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  textContentType="newPassword"
                />
                {otpSent ? (
                  <Input
                    label="Verification code"
                    value={otp}
                    onChangeText={setOtp}
                    keyboardType="number-pad"
                    placeholder="6-digit code"
                  />
                ) : null}
                {registerError ? <Text style={styles.error}>{registerError}</Text> : null}
                <Button
                  label={otpSent ? 'Resend code' : 'Send verification code'}
                  onPress={() => void handleSendOtp()}
                  loading={otpLoading}
                  variant="secondary"
                />
                <Button
                  label="Continue"
                  onPress={() => setRegisterStep('terms')}
                  disabled={!otpSent || otp.length === 0}
                />
              </>
            )}

            {registerStep === 'terms' && (
              <>
                <Text style={styles.stepTitle}>Almost there</Text>
                <CheckboxRow
                  checked={acceptedTos}
                  onToggle={() => setAcceptedTos((v) => !v)}
                  label="I agree to the Terms of Service"
                />
                <CheckboxRow
                  checked={acceptedPrivacy}
                  onToggle={() => setAcceptedPrivacy((v) => !v)}
                  label="I agree to the Privacy Policy"
                />
                {registerError ? <Text style={styles.error}>{registerError}</Text> : null}
                <Button
                  label="Create account"
                  onPress={() => void handleRegisterSubmit()}
                  loading={registerLoading}
                  disabled={!acceptedTos || !acceptedPrivacy}
                />
              </>
            )}

            <Button label="Back to sign in" onPress={() => switchMode('login')} variant="secondary" />
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

function CheckboxRow({
  checked,
  onToggle,
  label,
}: {
  checked: boolean
  onToggle: () => void
  label: string
}): React.JSX.Element {
  return (
    <Button
      label={`${checked ? '☑' : '☐'}  ${label}`}
      onPress={onToggle}
      variant="secondary"
      style={styles.checkboxButton}
    />
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: spacing.screenPadding, gap: spacing.xl },
  header: { alignItems: 'center', gap: spacing.sm },
  title: { fontSize: typography.h1.fontSize, fontWeight: typography.h1.fontWeight, color: colors.text },
  subtitle: { fontSize: typography.body.fontSize, color: colors.textSecondary },
  form: { gap: spacing.md },
  stepTitle: {
    fontSize: typography.h2.fontSize,
    fontWeight: typography.h2.fontWeight,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  error: { fontSize: typography.caption.fontSize, color: colors.error },
  checkboxButton: { alignItems: 'flex-start', justifyContent: 'flex-start', paddingHorizontal: spacing.md },
})
