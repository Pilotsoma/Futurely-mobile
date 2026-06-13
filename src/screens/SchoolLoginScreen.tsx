import React, { useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { useNavigation } from '@react-navigation/native'
import Text from '../components/ui/Text'
import { colors } from '../constants/colors'
import { useSchoolSession } from '../context/SchoolSessionContext'
import { connectHac, connectPowerSchool } from '../api/portalApi'

// ── Navigation type ───────────────────────────────────────────────────────────

type AuthStackParamList = {
  SchoolLogin: undefined
  Login: undefined
}

type NavProp = NativeStackNavigationProp<AuthStackParamList, 'SchoolLogin'>

// ── District data ─────────────────────────────────────────────────────────────

interface District {
  label: string
  url: string
  system: 'HAC' | 'PowerSchool'
}

const DISTRICTS: District[] = [
  { label: 'Katy ISD', url: 'https://homeaccess.katyisd.org', system: 'HAC' },
  { label: 'Houston ISD (HISD)', url: 'https://hac.houstonisd.org', system: 'HAC' },
  { label: 'Cy-Fair ISD (CFISD)', url: 'https://hac.cfisd.net', system: 'HAC' },
  { label: 'Fort Bend ISD', url: 'https://hac.fortbendisd.com', system: 'HAC' },
  { label: 'Alief ISD', url: 'https://hac.aliefisd.net', system: 'HAC' },
  { label: 'Spring Branch ISD', url: 'https://hac.springbranchisd.com', system: 'HAC' },
  { label: 'Klein ISD', url: 'https://hac.kleinisd.net', system: 'HAC' },
  { label: 'Humble ISD', url: 'https://hac.humble.k12.tx.us', system: 'HAC' },
  { label: 'Conroe ISD', url: 'https://hac.conroeisd.net', system: 'HAC' },
  { label: 'Pearland ISD', url: 'https://hac.pearlandisd.org', system: 'HAC' },
  { label: 'Deer Park ISD', url: 'https://hac.dpisd.org', system: 'HAC' },
  { label: 'Pasadena ISD', url: 'https://hac.pasadenaisd.org', system: 'HAC' },
  { label: 'Aldine ISD', url: 'https://hac.aldineisd.org', system: 'HAC' },
  { label: 'Spring ISD', url: 'https://hac.springisd.org', system: 'HAC' },
  { label: 'Galena Park ISD', url: 'https://hac.galenaparkisd.com', system: 'HAC' },
  { label: 'Sheldon ISD', url: 'https://hac.sheldonisd.com', system: 'HAC' },
  { label: 'Other (enter URL below)', url: '', system: 'HAC' },
]

// ── Screen ────────────────────────────────────────────────────────────────────

export default function SchoolLoginScreen(): React.JSX.Element {
  const navigation = useNavigation<NavProp>()
  const { signIn } = useSchoolSession()
  const insets = useSafeAreaInsets()

  // Form state
  const [selectedDistrict, setSelectedDistrict] = useState<District | null>(null)
  // districtUrl is auto-set when a named district is selected, or typed manually for "Other"
  const [districtUrl, setDistrictUrl] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  // Dropdown modal state
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [searchText, setSearchText] = useState('')

  // Async state
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Focus state for input rows
  const [focused, setFocused] = useState<'url' | 'username' | 'password' | null>(null)

  // Refs for keyboard navigation
  const usernameRef = useRef<TextInput>(null)
  const passwordRef = useRef<TextInput>(null)

  // Derived state
  const isCustom = selectedDistrict?.url === ''
  const filteredDistricts = useMemo(
    () => DISTRICTS.filter(d => d.label.toLowerCase().includes(searchText.toLowerCase())),
    [searchText]
  )
  const isFormValid =
    selectedDistrict !== null &&
    (selectedDistrict.url !== '' || districtUrl.trim().length > 0) &&
    username.trim().length > 0 &&
    password.trim().length > 0

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handleSignIn = async (): Promise<void> => {
    if (!selectedDistrict) {
      setError('Please select your school district.')
      return
    }

    const baseUrl = districtUrl.trim()

    if (!baseUrl) {
      setError('Please enter your district portal URL.')
      return
    }
    if (!baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) {
      setError('District URL must start with http:// or https://')
      return
    }
    if (!username.trim()) {
      setError('Please enter your username.')
      return
    }
    if (!password.trim()) {
      setError('Please enter your password.')
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      console.log('[SCHOOL LOGIN] Attempting backend portal connection...')
      console.log('[SCHOOL LOGIN] system:', selectedDistrict.system)
      console.log('[SCHOOL LOGIN] baseUrl:', baseUrl)
      console.log('[SCHOOL LOGIN] username exists:', Boolean(username.trim()))

      // Step 1: Hit the backend to create a real HAC/PowerSchool session
      if (selectedDistrict.system === 'HAC') {
        await connectHac(baseUrl, username.trim(), password)
      } else {
        await connectPowerSchool(baseUrl, username.trim(), password)
      }

      console.log('[SCHOOL LOGIN] Backend connection successful — saving session metadata')

      // Step 2: Only if the backend call succeeded, persist metadata to AsyncStorage
      // NOTE: password is intentionally NOT persisted anywhere
      await signIn({
        district: selectedDistrict.label,
        districtUrl: baseUrl,
        username: username.trim(),
        systemType: selectedDistrict.system,
      })

      // Step 3: Clear password from memory immediately
      setPassword('')

      console.log('[SCHOOL LOGIN] Sign-in complete')
      // RootNavigator will automatically re-render to AppNavigator
      // because hasSchoolSession is now true

    } catch (err: unknown) {
      // Clear password on any failure
      setPassword('')

      const message = err instanceof Error ? err.message : 'Sign in failed. Please try again.'
      console.log('[SCHOOL LOGIN] Error:', message)

      // Provide user-friendly error messages
      if (message.includes('Invalid credentials') || message.includes('401')) {
        setError('Incorrect username or password. Please check your school portal credentials.')
      } else if (message.includes('Cannot reach') || message.includes('ENOTFOUND') || message.includes('Network')) {
        setError('Cannot reach your school portal. Check the district URL and your internet connection.')
      } else if (message.includes('timeout') || message.includes('ETIMEDOUT')) {
        setError('Connection timed out. Your school portal may be slow — try again.')
      } else if (message.includes('login form') || message.includes('SSO')) {
        setError('This district may use SSO or ClassLink login. Contact support for help.')
      } else {
        setError(message)
      }
    } finally {
      setIsLoading(false)
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <View style={styles.screen}>

      {/* ── District picker — bottom sheet modal ── */}
      <Modal
        visible={dropdownOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setDropdownOpen(false)}
      >
        {/* Dimmed backdrop — tap to dismiss */}
        <TouchableOpacity
          style={styles.backdrop}
          activeOpacity={1}
          onPress={() => setDropdownOpen(false)}
        />

        {/* Sheet */}
        <View style={[styles.dropdownSheet, { paddingBottom: Math.max(32, insets.bottom + 16) }]}>

          {/* Sheet header */}
          <View style={styles.dropdownHeader}>
            <Text variant="h3">Select your district</Text>
            <TouchableOpacity
              onPress={() => { setDropdownOpen(false); setSearchText('') }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <Ionicons name="close" size={22} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          {/* Search input */}
          <View style={styles.dropdownSearch}>
            <Ionicons name="search-outline" size={16} color={colors.textSecondary} />
            <TextInput
              style={styles.dropdownSearchInput}
              placeholder="Search districts..."
              placeholderTextColor={colors.textMuted}
              value={searchText}
              onChangeText={setSearchText}
              autoFocus
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
            />
            {searchText.length > 0 && (
              <TouchableOpacity
                onPress={() => setSearchText('')}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="close-circle" size={16} color={colors.textMuted} />
              </TouchableOpacity>
            )}
          </View>

          {/* Districts list */}
          <FlatList<District>
            data={filteredDistricts}
            keyExtractor={item => item.label}
            keyboardShouldPersistTaps="handled"
            ItemSeparatorComponent={() => <View style={styles.listSeparator} />}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[
                  styles.dropdownItem,
                  selectedDistrict?.label === item.label && styles.dropdownItemSelected,
                ]}
                onPress={() => {
                  setSelectedDistrict(item)
                  setDistrictUrl(item.url)
                  setDropdownOpen(false)
                  setSearchText('')
                }}
                accessibilityRole="button"
                accessibilityLabel={item.label}
                activeOpacity={0.7}
              >
                <Text
                  style={[
                    styles.dropdownItemText,
                    selectedDistrict?.label === item.label && { color: colors.primary },
                  ]}
                >
                  {item.label}
                </Text>
                {selectedDistrict?.label === item.label && (
                  <Ionicons name="checkmark" size={18} color={colors.primary} />
                )}
              </TouchableOpacity>
            )}
          />
        </View>
      </Modal>

      {/* ── Main form ── */}
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={[styles.inner, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 20 }]}>

          {/* Brand */}
          <View style={styles.brand}>
            <Image
              source={require('../../assets/logo.png')}
              style={styles.logo}
              resizeMode="contain"
            />
            <Text style={styles.title}>Sign in with your{'\n'}school account</Text>
            <Text style={styles.subtitle}>Select your district and enter your school login</Text>
          </View>

          {/* District selector */}
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>School district</Text>
            <TouchableOpacity
              style={[styles.dropdownBtn, dropdownOpen && styles.dropdownBtnFocused]}
              onPress={() => setDropdownOpen(true)}
              accessibilityRole="button"
              accessibilityLabel="Select school district"
              activeOpacity={0.75}
            >
              <Ionicons name="school-outline" size={20} color={colors.textSecondary} style={styles.inputIcon} />
              <Text
                style={[
                  styles.dropdownBtnText,
                  { color: selectedDistrict ? colors.textPrimary : colors.textMuted },
                ]}
                numberOfLines={1}
              >
                {selectedDistrict ? selectedDistrict.label : 'Select your district…'}
              </Text>
              <Ionicons name="chevron-down" size={18} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          {/* Custom URL input — only shown when "Other" is selected */}
          {isCustom && (
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>District portal URL</Text>
              <View style={[styles.inputRow, focused === 'url' && styles.inputRowFocused]}>
                <Ionicons name="globe-outline" size={20} color={colors.textSecondary} style={styles.inputIcon} />
                <TextInput
                  style={styles.textInput}
                  placeholder="https://hac.yourdistrict.org"
                  placeholderTextColor={colors.textMuted}
                  value={districtUrl}
                  onChangeText={text => { setDistrictUrl(text); setError(null) }}
                  onFocus={() => setFocused('url')}
                  onBlur={() => setFocused(null)}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                  returnKeyType="next"
                  onSubmitEditing={() => usernameRef.current?.focus()}
                  editable={!isLoading}
                />
              </View>
            </View>
          )}

          {/* Username */}
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Username</Text>
            <View style={[styles.inputRow, focused === 'username' && styles.inputRowFocused]}>
              <Ionicons name="person-outline" size={20} color={colors.textSecondary} style={styles.inputIcon} />
              <TextInput
                ref={usernameRef}
                style={styles.textInput}
                placeholder="Student ID or username"
                placeholderTextColor={colors.textMuted}
                value={username}
                onChangeText={text => { setUsername(text); setError(null) }}
                onFocus={() => setFocused('username')}
                onBlur={() => setFocused(null)}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="next"
                onSubmitEditing={() => passwordRef.current?.focus()}
                editable={!isLoading}
                accessibilityLabel="Username"
              />
            </View>
          </View>

          {/* Password */}
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Password</Text>
            <View style={[styles.inputRow, focused === 'password' && styles.inputRowFocused]}>
              <Ionicons name="lock-closed-outline" size={20} color={colors.textSecondary} style={styles.inputIcon} />
              <TextInput
                ref={passwordRef}
                style={styles.textInput}
                placeholder="Your school password"
                placeholderTextColor={colors.textMuted}
                value={password}
                onChangeText={text => { setPassword(text); setError(null) }}
                onFocus={() => setFocused('password')}
                onBlur={() => setFocused(null)}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="done"
                onSubmitEditing={() => void handleSignIn()}
                editable={!isLoading}
                accessibilityLabel="Password"
              />
              <TouchableOpacity
                onPress={() => setShowPassword(v => !v)}
                style={styles.eyeBtn}
                accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons
                  name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                  size={20}
                  color={colors.textSecondary}
                />
              </TouchableOpacity>
            </View>
          </View>

          {/* Error banner */}
          {error !== null && (
            <View style={styles.errorBanner}>
              <Ionicons name="alert-circle-outline" size={16} color={colors.error} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          {/* Sign In button */}
          <TouchableOpacity
            style={[styles.signInBtn, (!isFormValid || isLoading) && styles.signInBtnDisabled]}
            onPress={() => void handleSignIn()}
            disabled={!isFormValid || isLoading}
            accessibilityRole="button"
            accessibilityLabel="Sign in with school account"
            activeOpacity={0.85}
          >
            {isLoading ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <ActivityIndicator color="#000" size="small" />
                <Text style={[styles.signInBtnText, { fontSize: 13 }]}>Connecting to your school portal...</Text>
              </View>
            ) : (
              <Text style={styles.signInBtnText}>Sign In</Text>
            )}
          </TouchableOpacity>

          {/* Parent / guardian link */}
          <TouchableOpacity
            style={styles.parentLink}
            onPress={() => navigation.navigate('Login')}
            accessibilityRole="link"
            accessibilityLabel="Parent or guardian sign in"
          >
            <Text style={styles.parentLinkText}>
              Parent or Guardian?{' '}
              <Text style={styles.parentLinkAccent}>Sign in here</Text>
            </Text>
          </TouchableOpacity>

        </View>
      </KeyboardAvoidingView>
    </View>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  flex: {
    flex: 1,
  },
  inner: {
    flex: 1,
    paddingHorizontal: 20,
    justifyContent: 'center',
  },

  // Brand
  brand: {
    alignItems: 'center',
    marginBottom: 32,
  },
  logo: {
    width: 72,
    height: 72,
    marginBottom: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.textPrimary,
    textAlign: 'center',
    lineHeight: 30,
  },
  subtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: 6,
  },

  // Input group
  inputGroup: {
    marginBottom: 14,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: 6,
    letterSpacing: 0.3,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    height: 48,
    paddingHorizontal: 12,
    gap: 8,
  },
  inputRowFocused: {
    borderColor: colors.primary,
  },
  inputIcon: {
    flexShrink: 0,
  },
  textInput: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: 15,
    padding: 0,
  },
  eyeBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // District dropdown trigger button
  dropdownBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    height: 48,
    paddingHorizontal: 12,
    gap: 8,
  },
  dropdownBtnFocused: {
    borderColor: colors.primary,
  },
  dropdownBtnText: {
    flex: 1,
    fontSize: 15,
  },

  // Error banner
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 14,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.error,
    backgroundColor: colors.error + '18',
  },
  errorText: {
    flex: 1,
    fontSize: 13,
    color: colors.error,
    lineHeight: 18,
  },

  // Sign In button
  signInBtn: {
    height: 52,
    borderRadius: 12,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  signInBtnDisabled: {
    opacity: 0.4,
  },
  signInBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#000',
  },

  // Parent link
  parentLink: {
    marginTop: 20,
    alignItems: 'center',
    paddingVertical: 8,
  },
  parentLinkText: {
    fontSize: 13,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  parentLinkAccent: {
    color: colors.primary,
    fontWeight: '600',
  },

  // Bottom-sheet modal
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  dropdownSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '75%',
    paddingBottom: 32,
  },
  dropdownHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  dropdownSearch: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    margin: 12,
    paddingHorizontal: 12,
    height: 44,
    gap: 8,
  },
  dropdownSearchInput: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: 15,
    padding: 0,
  },
  dropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    minHeight: 52,
  },
  dropdownItemSelected: {
    backgroundColor: colors.primary + '15',
  },
  dropdownItemText: {
    fontSize: 15,
    color: colors.textPrimary,
    flex: 1,
  },
  listSeparator: {
    height: 1,
    backgroundColor: colors.border,
    marginLeft: 16,
  },
})
