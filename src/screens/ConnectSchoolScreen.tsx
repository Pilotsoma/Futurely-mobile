// ConnectSchoolScreen — full "Connect your school" flow.
//
// Shown after login when the user has no linked school portal. On success,
// markPortalConnected() is called and RootNavigator auto-advances to MainNavigator.
//
// System types:
//   HAC (Home Access Center) — select from SORTED_HAC_DISTRICTS list or enter
//     a custom URL. Backend receives { baseUrl, username, password }.
//   PowerSchool — enter a portal URL directly (no static district list exists)
//     plus username + password.
//
// Note: ClassLink is intentionally absent. It is a backend-only integration and
//   must never surface in any client UI on this product.
//
// State machine:
//   idle → submitting (up to 45s, shows "Connecting..." message) → error | success
//   error → back to idle (dismiss re-shows the form with credentials intact)
//   success → markPortalConnected() → RootNavigator handles the transition

import React, { useState, useRef, useCallback, useMemo } from 'react'
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
  FlatList,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useTheme } from '../theme/ThemeContext'
import { useAuth } from '../context/AuthContext'
import FuturelyLogo from '../components/ui/FuturelyLogo'
import { ApiRequestError } from '../api/client'
import { hacLogin, powerschoolLogin } from '../api/gradesApi'
import { SORTED_HAC_DISTRICTS, type ISDEntry } from '../constants/isds'

// ── Types ──────────────────────────────────────────────────────────────────────

type SystemType = 'HAC' | 'PowerSchool'

type ScreenState =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'error'; message: string }

// ── Helpers ────────────────────────────────────────────────────────────────────

function extractErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiRequestError) return err.message
  if (err instanceof Error) return err.message
  return fallback
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function ConnectSchoolScreen(): React.JSX.Element {
  const { theme } = useTheme()
  const { accessToken, markPortalConnected } = useAuth()

  const c = theme.colors
  const s = theme.spacing
  const r = theme.radius
  const t = theme.typography

  // ── System-type toggle ─────────────────────────────────────────────────────
  const [systemType, setSystemType] = useState<SystemType>('HAC')

  // ── HAC-specific state ─────────────────────────────────────────────────────
  const [selectedDistrict, setSelectedDistrict] = useState<ISDEntry | null>(null)
  const [useCustomUrl, setUseCustomUrl]         = useState(false)
  const [customHacUrl, setCustomHacUrl]         = useState('')
  const [hacUsername, setHacUsername]           = useState('')
  const [hacPassword, setHacPassword]           = useState('')

  // District picker modal
  const [pickerOpen, setPickerOpen] = useState(false)
  const [districtSearch, setDistrictSearch] = useState('')

  // ── PowerSchool-specific state ─────────────────────────────────────────────
  const [psUrl, setPsUrl]           = useState('')
  const [psUsername, setPsUsername] = useState('')
  const [psPassword, setPsPassword] = useState('')

  // ── Screen state ───────────────────────────────────────────────────────────
  const [screenState, setScreenState] = useState<ScreenState>({ kind: 'idle' })

  // ── Refs ───────────────────────────────────────────────────────────────────
  const hacUsernameRef = useRef<TextInput>(null)
  const hacPasswordRef = useRef<TextInput>(null)
  const psUrlRef       = useRef<TextInput>(null)
  const psUsernameRef  = useRef<TextInput>(null)
  const psPasswordRef  = useRef<TextInput>(null)
  const customUrlRef   = useRef<TextInput>(null)

  // ── Computed ───────────────────────────────────────────────────────────────

  // The URL that will be sent to the backend for HAC login.
  const resolvedHacUrl = useCustomUrl ? customHacUrl.trim() : (selectedDistrict?.hacUrl ?? '')

  // District picker — filter list by search query (matches name or state code).
  const filteredDistricts = useMemo<ISDEntry[]>(() => {
    const q = districtSearch.toLowerCase().trim()
    if (!q) return SORTED_HAC_DISTRICTS
    return SORTED_HAC_DISTRICTS.filter(
      d =>
        d.name.toLowerCase().includes(q) ||
        d.state.toLowerCase().includes(q),
    )
  }, [districtSearch])

  // Display label for the district button.
  const districtLabel = useCustomUrl
    ? 'Other / Not Listed'
    : selectedDistrict
    ? `${selectedDistrict.name} (${selectedDistrict.state})`
    : ''

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleSelectDistrict = useCallback((isd: ISDEntry): void => {
    setSelectedDistrict(isd)
    setUseCustomUrl(false)
    setCustomHacUrl('')
    setDistrictSearch('')
    setPickerOpen(false)
  }, [])

  const handleSelectOther = useCallback((): void => {
    setSelectedDistrict(null)
    setUseCustomUrl(true)
    setCustomHacUrl('')
    setDistrictSearch('')
    setPickerOpen(false)
    // Focus the custom URL input after the modal closes.
    setTimeout(() => customUrlRef.current?.focus(), 350)
  }, [])

  const handleOpenPicker = useCallback((): void => {
    setDistrictSearch('')
    setPickerOpen(true)
  }, [])

  const handleSwitchSystem = useCallback((type: SystemType): void => {
    setSystemType(type)
    setScreenState({ kind: 'idle' })
  }, [])

  const handleSubmit = useCallback(async (): Promise<void> => {
    if (!accessToken) {
      setScreenState({ kind: 'error', message: 'Session expired. Please log in again.' })
      return
    }

    // Validate inputs before hitting the network.
    if (systemType === 'HAC') {
      if (!resolvedHacUrl) {
        setScreenState({ kind: 'error', message: 'Please select your school district.' })
        return
      }
      if (useCustomUrl && !customHacUrl.trim()) {
        setScreenState({ kind: 'error', message: 'Please enter your portal URL.' })
        return
      }
      if (!hacUsername.trim()) {
        setScreenState({ kind: 'error', message: 'HAC username is required.' })
        return
      }
      if (!hacPassword) {
        setScreenState({ kind: 'error', message: 'HAC password is required.' })
        return
      }
    } else {
      if (!psUrl.trim()) {
        setScreenState({ kind: 'error', message: 'Please enter your PowerSchool portal URL.' })
        return
      }
      if (!psUsername.trim()) {
        setScreenState({ kind: 'error', message: 'Username is required.' })
        return
      }
      if (!psPassword) {
        setScreenState({ kind: 'error', message: 'Password is required.' })
        return
      }
    }

    setScreenState({ kind: 'submitting' })

    try {
      if (systemType === 'HAC') {
        await hacLogin(
          {
            baseUrl: resolvedHacUrl,
            username: hacUsername.trim(),
            password: hacPassword,
          },
          accessToken,
        )
      } else {
        await powerschoolLogin(
          {
            baseUrl: psUrl.trim(),
            username: psUsername.trim(),
            password: psPassword,
          },
          accessToken,
        )
      }

      // Success — RootNavigator listens to this and advances to MainNavigator.
      markPortalConnected()
    } catch (err: unknown) {
      setScreenState({
        kind: 'error',
        message: extractErrorMessage(
          err,
          'Could not connect to your school portal. Please check your credentials and try again.',
        ),
      })
    }
  }, [
    accessToken,
    systemType,
    resolvedHacUrl,
    useCustomUrl,
    customHacUrl,
    hacUsername,
    hacPassword,
    psUrl,
    psUsername,
    psPassword,
    markPortalConnected,
  ])

  const handleDismissError = useCallback((): void => {
    setScreenState({ kind: 'idle' })
  }, [])

  // ── Derived booleans ───────────────────────────────────────────────────────

  const isSubmitting = screenState.kind === 'submitting'
  const errorMessage = screenState.kind === 'error' ? screenState.message : null

  // ── Styles (dynamic, using tokens) ────────────────────────────────────────

  const inputStyle = [
    styles.input,
    {
      backgroundColor: c.surface,
      borderColor: c.border,
      color: c.text,
    },
  ]

  const labelStyle = [styles.label, { color: c.textSecondary }]

  // ── Render: district picker modal ─────────────────────────────────────────

  function renderDistrictPicker(): React.JSX.Element {
    return (
      <Modal
        visible={pickerOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setPickerOpen(false)}
        accessibilityViewIsModal
      >
        <SafeAreaView
          style={[styles.pickerSafe, { backgroundColor: c.bg }]}
          edges={['top', 'left', 'right', 'bottom']}
        >
          {/* Header */}
          <View style={[styles.pickerHeader, { borderBottomColor: c.border }]}>
            <Text style={[styles.pickerTitle, { color: c.text }]}>
              Select Your District
            </Text>
            <TouchableOpacity
              onPress={() => setPickerOpen(false)}
              accessibilityLabel="Close district picker"
              accessibilityRole="button"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={styles.pickerCloseBtn}
            >
              <Text style={[styles.pickerCloseText, { color: c.textMuted }]}>Done</Text>
            </TouchableOpacity>
          </View>

          {/* Search box */}
          <View style={[styles.pickerSearchWrap, { paddingHorizontal: s.screenPaddingH }]}>
            <TextInput
              style={[inputStyle, styles.pickerSearch]}
              placeholder="Search by name or state..."
              placeholderTextColor={c.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              value={districtSearch}
              onChangeText={setDistrictSearch}
              autoFocus
              accessibilityLabel="Search districts"
            />
          </View>

          {/* List */}
          <FlatList
            data={filteredDistricts}
            keyExtractor={item => item.hacUrl}
            keyboardShouldPersistTaps="always"
            contentContainerStyle={{ paddingBottom: s.xl3 }}
            ItemSeparatorComponent={() => (
              <View style={[styles.listSeparator, { backgroundColor: c.border }]} />
            )}
            ListHeaderComponent={
              // "Other" option pinned at the top so it's always reachable.
              <TouchableOpacity
                style={[
                  styles.districtRow,
                  useCustomUrl && { backgroundColor: c.primaryDim },
                ]}
                onPress={handleSelectOther}
                accessibilityRole="button"
                accessibilityLabel="Other — my district is not listed"
              >
                <Text
                  style={[
                    styles.districtName,
                    { color: useCustomUrl ? c.primary : c.textSecondary, fontStyle: 'italic' },
                  ]}
                >
                  Other / My district is not listed
                </Text>
              </TouchableOpacity>
            }
            ListEmptyComponent={
              <Text style={[styles.pickerEmpty, { color: c.textMuted }]}>
                No districts found for &quot;{districtSearch}&quot;
              </Text>
            }
            renderItem={({ item }) => {
              const isSelected = !useCustomUrl && selectedDistrict?.hacUrl === item.hacUrl
              return (
                <TouchableOpacity
                  style={[
                    styles.districtRow,
                    isSelected && { backgroundColor: c.primaryDim },
                  ]}
                  onPress={() => handleSelectDistrict(item)}
                  accessibilityRole="button"
                  accessibilityLabel={`${item.name}, ${item.state}`}
                >
                  <Text
                    style={[
                      styles.districtName,
                      { color: isSelected ? c.primary : c.text },
                    ]}
                  >
                    {item.name}
                  </Text>
                  <Text style={[styles.districtState, { color: c.textMuted }]}>
                    {item.state}
                  </Text>
                </TouchableOpacity>
              )
            }}
          />
        </SafeAreaView>
      </Modal>
    )
  }

  // ── Render: HAC form ───────────────────────────────────────────────────────

  function renderHacForm(): React.JSX.Element {
    return (
      <View style={styles.form}>
        {/* District picker button */}
        <Text style={labelStyle}>School District</Text>
        <TouchableOpacity
          style={[
            styles.districtBtn,
            {
              backgroundColor: c.surface,
              borderColor: c.border,
            },
          ]}
          onPress={handleOpenPicker}
          accessibilityRole="button"
          accessibilityLabel={
            districtLabel
              ? `Selected district: ${districtLabel}. Tap to change.`
              : 'Search for your school district'
          }
        >
          <Text
            style={[
              styles.districtBtnText,
              { color: districtLabel ? c.text : c.textMuted },
            ]}
            numberOfLines={1}
          >
            {districtLabel || 'Search for your school district...'}
          </Text>
          <Text style={[styles.chevron, { color: c.textMuted }]}>{'›'}</Text>
        </TouchableOpacity>

        {/* Custom URL field — only shown when "Other" is selected */}
        {useCustomUrl && (
          <>
            <Text style={[labelStyle, { marginTop: s.lg }]}>Portal URL</Text>
            <TextInput
              ref={customUrlRef}
              style={inputStyle}
              placeholder="https://homeaccess.yourisd.org/"
              placeholderTextColor={c.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              textContentType="URL"
              returnKeyType="next"
              value={customHacUrl}
              onChangeText={setCustomHacUrl}
              onSubmitEditing={() => hacUsernameRef.current?.focus()}
              accessibilityLabel="Home Access Center portal URL"
            />
            <Text style={[styles.hint, { color: c.textMuted }]}>
              Enter the base URL of your school&apos;s Home Access Center portal.
            </Text>
          </>
        )}

        {/* HAC credentials */}
        <Text style={[labelStyle, { marginTop: s.lg }]}>HAC Username</Text>
        <TextInput
          ref={hacUsernameRef}
          style={inputStyle}
          placeholder="Your HAC username"
          placeholderTextColor={c.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          textContentType="username"
          returnKeyType="next"
          value={hacUsername}
          onChangeText={setHacUsername}
          onSubmitEditing={() => hacPasswordRef.current?.focus()}
          accessibilityLabel="HAC username"
        />

        <Text style={[labelStyle, { marginTop: s.lg }]}>HAC Password</Text>
        <TextInput
          ref={hacPasswordRef}
          style={inputStyle}
          placeholder="Your HAC password"
          placeholderTextColor={c.textMuted}
          secureTextEntry
          textContentType="password"
          returnKeyType="done"
          value={hacPassword}
          onChangeText={setHacPassword}
          onSubmitEditing={() => { void handleSubmit() }}
          accessibilityLabel="HAC password"
        />

        <Text style={[styles.hint, { color: c.textMuted, marginTop: s.md }]}>
          Your school credentials are never stored — used only to fetch grades.
        </Text>
      </View>
    )
  }

  // ── Render: PowerSchool form ───────────────────────────────────────────────

  function renderPowerSchoolForm(): React.JSX.Element {
    return (
      <View style={styles.form}>
        <Text style={labelStyle}>PowerSchool Portal URL</Text>
        <TextInput
          ref={psUrlRef}
          style={inputStyle}
          placeholder="https://ps.yourisd.org/"
          placeholderTextColor={c.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          textContentType="URL"
          returnKeyType="next"
          value={psUrl}
          onChangeText={setPsUrl}
          onSubmitEditing={() => psUsernameRef.current?.focus()}
          accessibilityLabel="PowerSchool portal URL"
        />
        <Text style={[styles.hint, { color: c.textMuted }]}>
          Enter the base URL of your school&apos;s PowerSchool portal.
        </Text>

        <Text style={[labelStyle, { marginTop: s.lg }]}>Username</Text>
        <TextInput
          ref={psUsernameRef}
          style={inputStyle}
          placeholder="Your PowerSchool username"
          placeholderTextColor={c.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          textContentType="username"
          returnKeyType="next"
          value={psUsername}
          onChangeText={setPsUsername}
          onSubmitEditing={() => psPasswordRef.current?.focus()}
          accessibilityLabel="PowerSchool username"
        />

        <Text style={[labelStyle, { marginTop: s.lg }]}>Password</Text>
        <TextInput
          ref={psPasswordRef}
          style={inputStyle}
          placeholder="Your PowerSchool password"
          placeholderTextColor={c.textMuted}
          secureTextEntry
          textContentType="password"
          returnKeyType="done"
          value={psPassword}
          onChangeText={setPsPassword}
          onSubmitEditing={() => { void handleSubmit() }}
          accessibilityLabel="PowerSchool password"
        />

        <Text style={[styles.hint, { color: c.textMuted, marginTop: s.md }]}>
          Your school credentials are never stored — used only to fetch grades.
        </Text>
      </View>
    )
  }

  // ── Render: submitting state ───────────────────────────────────────────────

  function renderSubmitting(): React.JSX.Element {
    return (
      <View style={styles.submittingContainer}>
        <ActivityIndicator size="large" color={c.primary} style={styles.submittingSpinner} />
        <Text style={[styles.submittingTitle, { color: c.text }]}>
          Connecting to your school portal...
        </Text>
        <Text style={[styles.submittingSubtitle, { color: c.textSecondary }]}>
          This may take up to 45 seconds while we securely fetch your grades.
          Please keep the app open.
        </Text>
      </View>
    )
  }

  // ── Render: error state ────────────────────────────────────────────────────

  function renderError(): React.JSX.Element {
    return (
      <View style={[styles.errorCard, { backgroundColor: c.surface, borderColor: c.border }]}>
        <Text style={[styles.errorCardTitle, { color: c.error }]}>
          Connection Failed
        </Text>
        <Text style={[styles.errorCardMessage, { color: c.textSecondary }]}>
          {errorMessage}
        </Text>
        <TouchableOpacity
          style={[
            styles.btn,
            { backgroundColor: c.primary, minHeight: s.touchTarget, marginTop: s.xl2 },
          ]}
          onPress={handleDismissError}
          accessibilityLabel="Try again"
          accessibilityRole="button"
        >
          <Text style={styles.btnText}>Try again</Text>
        </TouchableOpacity>
      </View>
    )
  }

  // ── Render: main content ───────────────────────────────────────────────────

  function renderContent(): React.JSX.Element {
    if (isSubmitting) return renderSubmitting()
    if (errorMessage) return renderError()

    return (
      <>
        {/* System-type toggle */}
        <View
          style={[
            styles.toggleContainer,
            { backgroundColor: c.surface2, borderColor: c.border },
          ]}
        >
          <TouchableOpacity
            style={[
              styles.toggleOption,
              systemType === 'HAC' && {
                backgroundColor: c.primary,
                borderRadius: r.sm,
              },
            ]}
            onPress={() => handleSwitchSystem('HAC')}
            accessibilityRole="radio"
            accessibilityState={{ selected: systemType === 'HAC' }}
            accessibilityLabel="Home Access Center"
          >
            <Text
              style={[
                styles.toggleText,
                { color: systemType === 'HAC' ? '#FFFFFF' : c.textSecondary },
              ]}
            >
              Home Access Center
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.toggleOption,
              systemType === 'PowerSchool' && {
                backgroundColor: c.primary,
                borderRadius: r.sm,
              },
            ]}
            onPress={() => handleSwitchSystem('PowerSchool')}
            accessibilityRole="radio"
            accessibilityState={{ selected: systemType === 'PowerSchool' }}
            accessibilityLabel="PowerSchool"
          >
            <Text
              style={[
                styles.toggleText,
                { color: systemType === 'PowerSchool' ? '#FFFFFF' : c.textSecondary },
              ]}
            >
              PowerSchool
            </Text>
          </TouchableOpacity>
        </View>

        {/* Portal-specific credential form */}
        {systemType === 'HAC' ? renderHacForm() : renderPowerSchoolForm()}

        {/* Submit button */}
        <TouchableOpacity
          style={[
            styles.btn,
            {
              backgroundColor: c.primary,
              minHeight: s.touchTarget,
              opacity: isSubmitting ? 0.6 : 1,
              marginTop: s.xl2,
            },
          ]}
          onPress={() => { void handleSubmit() }}
          disabled={isSubmitting}
          accessibilityLabel="Connect school portal"
          accessibilityRole="button"
        >
          <Text style={styles.btnText}>Connect School Portal</Text>
        </TouchableOpacity>
      </>
    )
  }

  // ── Root render ────────────────────────────────────────────────────────────

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
          {/* Logo */}
          <View style={styles.logoArea}>
            <FuturelyLogo size={48} showWordmark />
          </View>

          {/* Header */}
          <Text style={[styles.screenTitle, { color: c.text }]}>
            Connect your school
          </Text>
          <Text style={[styles.subtitle, { color: c.textSecondary }]}>
            Link your school portal to see grades, schedule, and assignments.
          </Text>

          {/* Main content (form / submitting / error) */}
          {renderContent()}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* District picker modal — rendered outside the ScrollView to avoid
          z-index issues on Android */}
      {renderDistrictPicker()}
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
    marginBottom: 36,
  },
  screenTitle: {
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 28,
  },

  // ── Toggle ──────────────────────────────────────────────────────────────────
  toggleContainer: {
    flexDirection: 'row',
    borderRadius: 10,
    borderWidth: 1,
    padding: 4,
    marginBottom: 24,
  },
  toggleOption: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    minHeight: 44, // ≥ 44pt touch target
  },
  toggleText: {
    fontSize: 13,
    fontWeight: '600',
  },

  // ── Form ────────────────────────────────────────────────────────────────────
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
  hint: {
    fontSize: 12,
    lineHeight: 16,
    marginTop: 4,
  },

  // ── District selector button ────────────────────────────────────────────────
  districtBtn: {
    height: 48,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  districtBtnText: {
    fontSize: 15,
    flex: 1,
    marginRight: 6,
  },
  chevron: {
    fontSize: 20,
    fontWeight: '600',
  },

  // ── Submit button ───────────────────────────────────────────────────────────
  btn: {
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  btnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },

  // ── Submitting state ────────────────────────────────────────────────────────
  submittingContainer: {
    alignItems: 'center',
    paddingVertical: 32,
    paddingHorizontal: 16,
  },
  submittingSpinner: {
    marginBottom: 20,
  },
  submittingTitle: {
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 10,
  },
  submittingSubtitle: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },

  // ── Error card ──────────────────────────────────────────────────────────────
  errorCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 20,
    marginTop: 8,
  },
  errorCardTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 8,
  },
  errorCardMessage: {
    fontSize: 14,
    lineHeight: 20,
  },

  // ── District picker modal ───────────────────────────────────────────────────
  pickerSafe: {
    flex: 1,
  },
  pickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  pickerTitle: {
    fontSize: 17,
    fontWeight: '700',
  },
  pickerCloseBtn: {
    minHeight: 44,
    minWidth: 44,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  pickerCloseText: {
    fontSize: 15,
    fontWeight: '600',
  },
  pickerSearchWrap: {
    paddingVertical: 10,
  },
  pickerSearch: {
    height: 44,
  },
  pickerEmpty: {
    textAlign: 'center',
    paddingVertical: 28,
    fontSize: 14,
    paddingHorizontal: 20,
  },
  listSeparator: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: 16,
  },
  districtRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 52, // ≥ 44pt touch target with comfortable padding
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  districtName: {
    fontSize: 14,
    fontWeight: '500',
    flex: 1,
  },
  districtState: {
    fontSize: 12,
    fontWeight: '500',
    marginLeft: 10,
    width: 28,
    textAlign: 'right',
  },
})
