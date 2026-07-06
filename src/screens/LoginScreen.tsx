// LoginScreen — full Futurely auth screen.
//
// Supports two top-level modes:
//   'login'    — email + password → signIn → RootNavigator advances automatically.
//   'register' — multi-step flow:
//     Step 1: email → POST /auth/send-otp → Step 2
//     Step 2: 6-digit OTP verification → Step 3
//     Step 3: password + display name + date of birth + COPPA gate + ToS/Privacy → submit
//               → POST /auth/register → signIn is implicit in the register response
//
// Error handling:
//   - ApiRequestError.message is always a server-supplied human string — displayed directly.
//   - COPPA_BLOCK (403) gets a dedicated message matching web copy.
//   - ACCOUNT_LOCKED gets a time-remaining message.
//   - All errors show inline; no [object Object] can reach the UI.
//
// Field order mirrors web's app/login/page.tsx for consistency.

import React, { useState, useRef, useCallback } from 'react'
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Modal,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useTheme } from '../theme/ThemeContext'
import { useAuth } from '../context/AuthContext'
import FuturelyLogo from '../components/ui/FuturelyLogo'
import { ApiRequestError } from '../api/client'
import { sendOtp, register } from '../api/authApi'
import { storeTokens } from '../utils/storage'

// ── Types ──────────────────────────────────────────────────────────────────────

type Mode = 'login' | 'register'
type RegisterStep = 'email' | 'otp' | 'details'

// ── Helpers ────────────────────────────────────────────────────────────────────

function extractErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiRequestError) {
    return err.message
  }
  if (err instanceof Error) {
    return err.message
  }
  return fallback
}

function formatLockoutTime(secondsRemaining: number): string {
  const totalMins = Math.ceil(secondsRemaining / 60)
  const hours = Math.floor(totalMins / 60)
  const mins = totalMins % 60
  if (hours > 0) {
    return `${hours}h${mins > 0 ? ` ${mins}m` : ''}`
  }
  return `${mins}m`
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function LoginScreen(): React.JSX.Element {
  const { theme } = useTheme()
  const { signIn, markPortalConnected } = useAuth()

  const [mode, setMode]                 = useState<Mode>('login')
  const [registerStep, setRegisterStep] = useState<RegisterStep>('email')

  // Shared fields
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')

  // Register-only fields
  const [otpCode, setOtpCode]               = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [displayName, setDisplayName]       = useState('')
  const [dateOfBirth, setDateOfBirth]       = useState('')

  // UI state
  const [loading, setLoading]         = useState(false)
  const [error, setError]             = useState<string | null>(null)
  const [showTos, setShowTos]         = useState(false)
  const [agreedTos, setAgreedTos]     = useState(false)
  const [agreedPrivacy, setAgreedPrivacy] = useState(false)

  const passwordRef     = useRef<TextInput>(null)
  const otpRef          = useRef<TextInput>(null)
  const confirmPassRef  = useRef<TextInput>(null)
  const nameRef         = useRef<TextInput>(null)
  const dobRef          = useRef<TextInput>(null)

  const c = theme.colors
  const s = theme.spacing
  const r = theme.radius
  const t = theme.typography

  // ── Reset helpers ─────────────────────────────────────────────────────────

  const resetRegister = useCallback((): void => {
    setRegisterStep('email')
    setOtpCode('')
    setConfirmPassword('')
    setDisplayName('')
    setDateOfBirth('')
    setAgreedTos(false)
    setAgreedPrivacy(false)
    setError(null)
  }, [])

  const switchMode = useCallback((next: Mode): void => {
    setMode(next)
    setError(null)
    setPassword('')
    if (next === 'login') {
      resetRegister()
    } else {
      resetRegister()
    }
  }, [resetRegister])

  // ── Login flow ─────────────────────────────────────────────────────────────

  const handleLogin = useCallback(async (): Promise<void> => {
    if (!email.trim()) { setError('Email is required.'); return }
    if (!password)     { setError('Password is required.'); return }

    setError(null)
    setLoading(true)
    try {
      await signIn(email.trim().toLowerCase(), password)
      // RootNavigator reacts to auth status change automatically.
    } catch (err: unknown) {
      if (err instanceof ApiRequestError && err.code === 'ACCOUNT_LOCKED') {
        const seconds = (err as ApiRequestError & { secondsRemaining?: number }).secondsRemaining
        const timeStr = seconds ? formatLockoutTime(seconds) : 'some time'
        setError(`Account locked. Too many failed attempts — try again in ${timeStr}.`)
      } else {
        setError(extractErrorMessage(err, 'Login failed. Please try again.'))
      }
    } finally {
      setLoading(false)
    }
  }, [email, password, signIn])

  // ── Register — Step 1: send OTP ────────────────────────────────────────────

  const handleSendOtp = useCallback(async (): Promise<void> => {
    if (!email.trim()) { setError('Email is required.'); return }

    setError(null)
    setLoading(true)
    try {
      await sendOtp(email.trim().toLowerCase())
      setOtpCode('')
      setRegisterStep('otp')
    } catch (err: unknown) {
      setError(extractErrorMessage(err, 'Failed to send verification code. Please try again.'))
    } finally {
      setLoading(false)
    }
  }, [email])

  // ── Register — Step 2: verify OTP ─────────────────────────────────────────

  const handleVerifyOtp = useCallback((): void => {
    const code = otpCode.trim()
    if (code.length !== 6) {
      setError('Enter the 6-digit code we sent to your email.')
      return
    }
    setError(null)
    setRegisterStep('details')
  }, [otpCode])

  // ── Register — Step 3: open ToS modal before final submit ─────────────────

  const handleDetailsNext = useCallback((): void => {
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (!/[A-Z]/.test(password)) {
      setError('Password must contain at least one uppercase letter.')
      return
    }
    if (!/[0-9]/.test(password)) {
      setError('Password must contain at least one number.')
      return
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }
    if (!dateOfBirth.trim()) {
      setError('Date of birth is required.')
      return
    }
    // Basic YYYY-MM-DD format check
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth.trim())) {
      setError('Enter your date of birth in YYYY-MM-DD format (e.g. 2008-03-15).')
      return
    }
    setError(null)
    setAgreedTos(false)
    setAgreedPrivacy(false)
    setShowTos(true)
  }, [password, confirmPassword, dateOfBirth])

  // ── Register — final submit (after ToS agreed) ─────────────────────────────

  const handleRegisterSubmit = useCallback(async (): Promise<void> => {
    if (!agreedTos || !agreedPrivacy) return

    setShowTos(false)
    setError(null)
    setLoading(true)
    try {
      const result = await register({
        email: email.trim().toLowerCase(),
        password,
        name: displayName.trim() || undefined,
        dateOfBirth: dateOfBirth.trim(),
        otp: otpCode.trim(),
      })
      // register() returns the same shape as login(); persist the session.
      await storeTokens(result.token, result.refreshToken)
      // signIn is not called here because we already have the token.
      // Instead we call the context's signIn to apply the session. But signIn
      // calls login() internally, which would make a second network call.
      // Instead, call signIn with the known credentials so AuthContext state
      // is updated correctly (token is already valid, /auth/me will succeed).
      await signIn(email.trim().toLowerCase(), password)
    } catch (err: unknown) {
      if (err instanceof ApiRequestError && err.code === 'COPPA_BLOCK') {
        setError(
          'Futurely requires users to be at least 13 years old. If you are under 13, a parent or guardian must contact support@futurely.app to request account access.',
        )
      } else if (err instanceof ApiRequestError && err.code === 'NAME_TAKEN') {
        setError('That display name is already taken. Please choose a different one.')
        setRegisterStep('details')
      } else if (err instanceof ApiRequestError && err.code === 'CONFLICT') {
        setError('An account with this email already exists. Try logging in instead.')
        setMode('login')
        setRegisterStep('email')
      } else {
        setError(extractErrorMessage(err, 'Account creation failed. Please try again.'))
      }
    } finally {
      setLoading(false)
    }
  }, [
    agreedTos, agreedPrivacy, email, password, displayName,
    dateOfBirth, otpCode, signIn,
  ])

  // ── Render ─────────────────────────────────────────────────────────────────

  const inputStyle = [
    styles.input,
    {
      backgroundColor: c.bg,
      borderColor: error ? c.error : c.border,
      color: c.text,
    },
  ]

  const labelStyle = [styles.label, { color: c.textSecondary }]

  function renderLoginForm(): React.JSX.Element {
    return (
      <>
        <Text style={[styles.screenTitle, { color: c.text }]}>Sign in</Text>
        <Text style={[styles.subtitle, { color: c.textSecondary }]}>
          Welcome back to Futurely
        </Text>

        <View style={styles.form}>
          <Text style={labelStyle}>Email</Text>
          <TextInput
            style={inputStyle}
            placeholder="you@example.com"
            placeholderTextColor={c.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="emailAddress"
            returnKeyType="next"
            value={email}
            onChangeText={setEmail}
            onSubmitEditing={() => passwordRef.current?.focus()}
            accessibilityLabel="Email address"
          />

          <Text style={[labelStyle, { marginTop: 12 }]}>Password</Text>
          <TextInput
            ref={passwordRef}
            style={inputStyle}
            placeholder="••••••••"
            placeholderTextColor={c.textMuted}
            secureTextEntry
            textContentType="password"
            returnKeyType="done"
            value={password}
            onChangeText={setPassword}
            onSubmitEditing={() => { void handleLogin() }}
            accessibilityLabel="Password"
          />

          {error !== null && (
            <Text style={[styles.errorText, { color: c.error }]}>{error}</Text>
          )}

          <TouchableOpacity
            style={[
              styles.btn,
              {
                backgroundColor: c.primary,
                minHeight: s.touchTarget,
                opacity: loading ? 0.6 : 1,
              },
            ]}
            onPress={() => { void handleLogin() }}
            disabled={loading}
            accessibilityLabel="Sign in"
            accessibilityRole="button"
          >
            {loading ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.btnText}>Log In</Text>
            )}
          </TouchableOpacity>
        </View>

        <View style={styles.switchRow}>
          <Text style={[styles.switchText, { color: c.textSecondary }]}>
            Don&apos;t have an account?{' '}
          </Text>
          <TouchableOpacity
            onPress={() => switchMode('register')}
            accessibilityRole="button"
            hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
          >
            <Text style={[styles.switchLink, { color: c.primary }]}>Create one</Text>
          </TouchableOpacity>
        </View>
      </>
    )
  }

  function renderRegisterEmail(): React.JSX.Element {
    return (
      <>
        <Text style={[styles.screenTitle, { color: c.text }]}>Create account</Text>
        <Text style={[styles.subtitle, { color: c.textSecondary }]}>
          Your academic companion
        </Text>

        <View style={styles.form}>
          <Text style={labelStyle}>Email</Text>
          <TextInput
            style={inputStyle}
            placeholder="you@example.com"
            placeholderTextColor={c.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="emailAddress"
            returnKeyType="done"
            value={email}
            onChangeText={setEmail}
            onSubmitEditing={() => { void handleSendOtp() }}
            accessibilityLabel="Email address"
          />

          {error !== null && (
            <Text style={[styles.errorText, { color: c.error }]}>{error}</Text>
          )}

          <TouchableOpacity
            style={[
              styles.btn,
              { backgroundColor: c.primary, minHeight: s.touchTarget, opacity: loading ? 0.6 : 1 },
            ]}
            onPress={() => { void handleSendOtp() }}
            disabled={loading}
            accessibilityLabel="Send verification code"
            accessibilityRole="button"
          >
            {loading ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.btnText}>Send verification code</Text>
            )}
          </TouchableOpacity>
        </View>

        <View style={styles.switchRow}>
          <Text style={[styles.switchText, { color: c.textSecondary }]}>
            Already have an account?{' '}
          </Text>
          <TouchableOpacity
            onPress={() => switchMode('login')}
            accessibilityRole="button"
            hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
          >
            <Text style={[styles.switchLink, { color: c.primary }]}>Log In</Text>
          </TouchableOpacity>
        </View>
      </>
    )
  }

  function renderRegisterOtp(): React.JSX.Element {
    return (
      <>
        <Text style={[styles.screenTitle, { color: c.text }]}>Check your email</Text>
        <Text style={[styles.subtitle, { color: c.textSecondary }]}>
          We sent a 6-digit code to {email}
        </Text>

        <View style={styles.form}>
          <Text style={labelStyle}>Verification code</Text>
          <TextInput
            ref={otpRef}
            style={[inputStyle, styles.otpInput]}
            placeholder="000000"
            placeholderTextColor={c.textMuted}
            keyboardType="number-pad"
            maxLength={6}
            returnKeyType="done"
            value={otpCode}
            onChangeText={v => setOtpCode(v.replace(/\D/g, ''))}
            onSubmitEditing={handleVerifyOtp}
            accessibilityLabel="6-digit verification code"
            autoFocus
          />

          {error !== null && (
            <Text style={[styles.errorText, { color: c.error }]}>{error}</Text>
          )}

          <TouchableOpacity
            style={[
              styles.btn,
              { backgroundColor: c.primary, minHeight: s.touchTarget },
            ]}
            onPress={handleVerifyOtp}
            accessibilityLabel="Verify code"
            accessibilityRole="button"
          >
            <Text style={styles.btnText}>Verify code</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.ghostBtn, { minHeight: s.touchTarget }]}
            onPress={() => { setRegisterStep('email'); setError(null) }}
            accessibilityRole="button"
          >
            <Text style={[styles.ghostBtnText, { color: c.textMuted }]}>
              Back / change email
            </Text>
          </TouchableOpacity>
        </View>
      </>
    )
  }

  function renderRegisterDetails(): React.JSX.Element {
    return (
      <>
        <Text style={[styles.screenTitle, { color: c.text }]}>Set up your account</Text>
        <Text style={[styles.subtitle, { color: c.textSecondary }]}>
          Just a few more details
        </Text>

        <View style={styles.form}>
          <Text style={labelStyle}>Display Name{' '}
            <Text style={{ color: c.textMuted }}>(optional)</Text>
          </Text>
          <TextInput
            ref={nameRef}
            style={[styles.input, { backgroundColor: c.bg, borderColor: c.border, color: c.text }]}
            placeholder="Jane Doe"
            placeholderTextColor={c.textMuted}
            autoCapitalize="words"
            textContentType="name"
            returnKeyType="next"
            value={displayName}
            onChangeText={setDisplayName}
            onSubmitEditing={() => dobRef.current?.focus()}
            accessibilityLabel="Display name"
          />

          <Text style={[labelStyle, { marginTop: 12 }]}>Date of Birth</Text>
          <TextInput
            ref={dobRef}
            style={[
              styles.input,
              {
                backgroundColor: c.bg,
                borderColor: error?.includes('date') ? c.error : c.border,
                color: c.text,
              },
            ]}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={c.textMuted}
            keyboardType="numbers-and-punctuation"
            returnKeyType="next"
            maxLength={10}
            value={dateOfBirth}
            onChangeText={setDateOfBirth}
            onSubmitEditing={() => confirmPassRef.current?.focus()}
            accessibilityLabel="Date of birth in YYYY-MM-DD format"
          />
          <Text style={[styles.hint, { color: c.textMuted }]}>
            Must be 13 or older to use Futurely (COPPA).
          </Text>

          <Text style={[labelStyle, { marginTop: 12 }]}>Password</Text>
          <TextInput
            style={[
              styles.input,
              { backgroundColor: c.bg, borderColor: c.border, color: c.text },
            ]}
            placeholder="At least 8 characters"
            placeholderTextColor={c.textMuted}
            secureTextEntry
            textContentType="newPassword"
            returnKeyType="next"
            value={password}
            onChangeText={setPassword}
            onSubmitEditing={() => confirmPassRef.current?.focus()}
            accessibilityLabel="Password"
          />

          <Text style={[labelStyle, { marginTop: 12 }]}>Confirm Password</Text>
          <TextInput
            ref={confirmPassRef}
            style={[
              styles.input,
              { backgroundColor: c.bg, borderColor: c.border, color: c.text },
            ]}
            placeholder="Re-enter your password"
            placeholderTextColor={c.textMuted}
            secureTextEntry
            textContentType="newPassword"
            returnKeyType="done"
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            onSubmitEditing={handleDetailsNext}
            accessibilityLabel="Confirm password"
          />

          {error !== null && (
            <Text style={[styles.errorText, { color: c.error }]}>{error}</Text>
          )}

          <TouchableOpacity
            style={[
              styles.btn,
              { backgroundColor: c.primary, minHeight: s.touchTarget },
            ]}
            onPress={handleDetailsNext}
            accessibilityLabel="Continue to terms"
            accessibilityRole="button"
          >
            <Text style={styles.btnText}>Continue</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.ghostBtn, { minHeight: s.touchTarget }]}
            onPress={() => { setRegisterStep('otp'); setError(null) }}
            accessibilityRole="button"
          >
            <Text style={[styles.ghostBtnText, { color: c.textMuted }]}>
              Back
            </Text>
          </TouchableOpacity>
        </View>
      </>
    )
  }

  function renderContent(): React.JSX.Element {
    if (mode === 'login') return renderLoginForm()
    if (registerStep === 'otp') return renderRegisterOtp()
    if (registerStep === 'details') return renderRegisterDetails()
    return renderRegisterEmail()
  }

  return (
    <SafeAreaView
      style={[styles.safeArea, { backgroundColor: c.bg }]}
      edges={['top', 'left', 'right', 'bottom']}
    >
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          style={styles.flex}
          contentContainerStyle={[
            styles.scrollContent,
            { paddingHorizontal: s.screenPaddingH },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.logoArea}>
            <FuturelyLogo size={48} showWordmark />
          </View>

          {renderContent()}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* ── ToS / Privacy Policy modal ── */}
      <Modal
        visible={showTos}
        transparent
        animationType="fade"
        onRequestClose={() => setShowTos(false)}
        accessibilityViewIsModal
      >
        <View style={styles.modalBackdrop}>
          <View
            style={[
              styles.modalCard,
              { backgroundColor: c.surface, borderColor: c.border },
            ]}
          >
            <View style={[styles.modalHeader, { borderBottomColor: c.border }]}>
              <Text style={[styles.modalTitle, { color: c.text }]}>
                Terms of Service &amp; Privacy Policy
              </Text>
              <TouchableOpacity
                onPress={() => setShowTos(false)}
                accessibilityLabel="Close"
                accessibilityRole="button"
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={[styles.modalClose, { color: c.textMuted }]}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalBody} showsVerticalScrollIndicator>
              <Text style={[styles.tosSection, { color: c.text }]}>Terms of Service</Text>

              <Text style={[styles.tosText, { color: c.textSecondary }]}>
                By creating an account and using Futurely, you agree to be bound by these Terms
                of Service. Please read them carefully.
              </Text>

              <Text style={[styles.tosHeading, { color: c.text }]}>1. Eligibility</Text>
              <Text style={[styles.tosText, { color: c.textSecondary }]}>
                You must be at least 13 years of age to use Futurely. By registering, you confirm
                that you meet this requirement. If you are under 18, a parent or guardian must
                review and agree to these terms on your behalf.
              </Text>

              <Text style={[styles.tosHeading, { color: c.text }]}>2. Acceptable Use</Text>
              <Text style={[styles.tosText, { color: c.textSecondary }]}>
                You agree to use Futurely only for lawful purposes. You may not harass, threaten,
                or harm others; post obscene or unlawful content; attempt unauthorized access to
                other accounts; or disrupt the platform.
              </Text>

              <Text style={[styles.tosHeading, { color: c.text }]}>3. Account Responsibility</Text>
              <Text style={[styles.tosText, { color: c.textSecondary }]}>
                You are responsible for maintaining the confidentiality of your account credentials.
                Notify us at support@futurely.app if you suspect unauthorized access.
              </Text>

              <Text style={[styles.tosHeading, { color: c.text }]}>4. Virtual Items &amp; Coins</Text>
              <Text style={[styles.tosText, { color: c.textSecondary }]}>
                Futurely&apos;s marketplace, virtual coins, and in-app items have no real-world monetary
                value and are not redeemable for cash or external goods. Futurely reserves the right
                to modify, adjust, or remove virtual items at any time.
              </Text>

              <Text style={[styles.tosHeading, { color: c.text }]}>5. Intellectual Property</Text>
              <Text style={[styles.tosText, { color: c.textSecondary }]}>
                All content on Futurely is owned by Futurely, Inc. and protected by applicable
                intellectual property laws.
              </Text>

              <Text style={[styles.tosSection, { color: c.text, marginTop: 20 }]}>Privacy Policy</Text>

              <Text style={[styles.tosText, { color: c.textSecondary }]}>
                This Privacy Policy explains how we collect, use, and protect your information.
              </Text>

              <Text style={[styles.tosHeading, { color: c.text }]}>1. Information We Collect</Text>
              <Text style={[styles.tosText, { color: c.textSecondary }]}>
                We collect the information you provide when registering (name, email, password).
                For students who connect their school portal, we temporarily process your Home
                Access Center credentials solely to fetch academic data — these credentials are
                encrypted server-side and never stored in plain text.
              </Text>

              <Text style={[styles.tosHeading, { color: c.text }]}>2. Children&apos;s Privacy (COPPA)</Text>
              <Text style={[styles.tosText, { color: c.textSecondary }]}>
                Futurely is intended for users who are 13 years of age or older. We do not
                knowingly collect personal information from children under 13.
              </Text>

              <Text style={[styles.tosHeading, { color: c.text }]}>3. Educational Records (FERPA)</Text>
              <Text style={[styles.tosText, { color: c.textSecondary }]}>
                Futurely is designed to comply with FERPA. Academic data fetched from your school
                portal is used solely to provide you with the services you request.
              </Text>

              <Text style={[styles.tosHeading, { color: c.text }]}>4. Contact Us</Text>
              <Text style={[styles.tosText, { color: c.textSecondary }]}>
                Questions? Reach us at support@futurely.app.
              </Text>
            </ScrollView>

            <View style={[styles.modalFooter, { borderTopColor: c.border }]}>
              {/* ToS checkbox */}
              <TouchableOpacity
                style={styles.checkRow}
                onPress={() => setAgreedTos(v => !v)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: agreedTos }}
                accessibilityLabel="I have read and agree to the Terms of Service"
              >
                <View
                  style={[
                    styles.checkbox,
                    {
                      borderColor: agreedTos ? c.primary : c.border,
                      backgroundColor: agreedTos ? c.primary : 'transparent',
                    },
                  ]}
                >
                  {agreedTos && <Text style={styles.checkmark}>✓</Text>}
                </View>
                <Text style={[styles.checkLabel, { color: c.text }]}>
                  I have read and agree to the Terms of Service
                </Text>
              </TouchableOpacity>

              {/* Privacy checkbox */}
              <TouchableOpacity
                style={[styles.checkRow, { marginTop: 10 }]}
                onPress={() => setAgreedPrivacy(v => !v)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: agreedPrivacy }}
                accessibilityLabel="I have read and agree to the Privacy Policy"
              >
                <View
                  style={[
                    styles.checkbox,
                    {
                      borderColor: agreedPrivacy ? c.primary : c.border,
                      backgroundColor: agreedPrivacy ? c.primary : 'transparent',
                    },
                  ]}
                >
                  {agreedPrivacy && <Text style={styles.checkmark}>✓</Text>}
                </View>
                <Text style={[styles.checkLabel, { color: c.text }]}>
                  I have read and agree to the Privacy Policy
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.btn,
                  {
                    backgroundColor: c.primary,
                    minHeight: s.touchTarget,
                    marginTop: 14,
                    opacity: agreedTos && agreedPrivacy && !loading ? 1 : 0.4,
                  },
                ]}
                disabled={!agreedTos || !agreedPrivacy || loading}
                onPress={() => { void handleRegisterSubmit() }}
                accessibilityLabel="Continue and create account"
                accessibilityRole="button"
              >
                {loading ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.btnText}>Continue &amp; Create Account</Text>
                )}
              </TouchableOpacity>

              {error !== null && (
                <Text style={[styles.errorText, { color: c.error, marginTop: 8 }]}>
                  {error}
                </Text>
              )}
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  )
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea:     { flex: 1 },
  flex:         { flex: 1 },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingVertical: 40,
  },
  logoArea: {
    alignItems: 'center',
    marginBottom: 40,
  },
  screenTitle: {
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 15,
    marginBottom: 28,
  },
  form: {
    gap: 4,
  },
  label: {
    fontSize: 13,
    fontWeight: '500',
    marginBottom: 4,
  },
  input: {
    height: 48,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 14,
    fontSize: 15,
  },
  otpInput: {
    textAlign: 'center',
    fontSize: 26,
    fontWeight: '700',
    letterSpacing: 8,
    height: 60,
  },
  errorText: {
    fontSize: 13,
    marginTop: 8,
    lineHeight: 18,
  },
  hint: {
    fontSize: 12,
    marginTop: 4,
    lineHeight: 16,
  },
  btn: {
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 20,
    paddingHorizontal: 16,
  },
  btnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  ghostBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    paddingHorizontal: 16,
  },
  ghostBtnText: {
    fontSize: 13,
  },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginTop: 20,
  },
  switchText: {
    fontSize: 13,
    textAlign: 'center',
  },
  switchLink: {
    fontSize: 13,
    fontWeight: '600',
  },
  // Modal
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    width: '100%',
    maxHeight: '88%',
    borderRadius: 18,
    borderWidth: 1,
    overflow: 'hidden',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 18,
    borderBottomWidth: 1,
  },
  modalTitle: {
    fontSize: 15,
    fontWeight: '700',
    flex: 1,
    paddingRight: 12,
  },
  modalClose: {
    fontSize: 16,
    padding: 4,
  },
  modalBody: {
    padding: 18,
    maxHeight: 320,
  },
  modalFooter: {
    padding: 18,
    borderTopWidth: 1,
  },
  tosSection: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 6,
  },
  tosHeading: {
    fontSize: 13,
    fontWeight: '700',
    marginTop: 14,
    marginBottom: 4,
  },
  tosText: {
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 2,
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginTop: 1,
  },
  checkmark: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  checkLabel: {
    fontSize: 13,
    lineHeight: 18,
    flex: 1,
  },
})
