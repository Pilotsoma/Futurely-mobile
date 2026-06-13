import React, { useState, useCallback, useRef } from 'react'
import {
  View,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Text as NativeText,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useNavigation } from '@react-navigation/native'
import { useFocusEffect } from '@react-navigation/native'
import Text from '../components/ui/Text'
import ScreenHeader from '../components/ui/ScreenHeader'
import { colors } from '../constants/colors'
import { connectHac, connectPowerSchool, getPortalStatus, disconnectPortal, type PortalStatus } from '../api/portalApi'

// ── Types ─────────────────────────────────────────────────────────────────────

type PortalType = 'HAC' | 'PowerSchool'
type FocusedField = 'url' | 'username' | 'password' | null

type ConnectionState =
  | { status: 'idle' }
  | { status: 'connecting' }
  | { status: 'success'; portalType: PortalType }
  | { status: 'error'; message: string }

// ── Constants ─────────────────────────────────────────────────────────────────

interface PortalOption {
  type: PortalType
  label: string
  subtitle: string
  icon: React.ComponentProps<typeof Ionicons>['name']
  placeholder: string
}

interface DistrictChip {
  label: string
  url: string
}

const PORTAL_OPTIONS: PortalOption[] = [
  {
    type: 'HAC',
    label: 'HAC',
    subtitle: 'Home Access Center',
    icon: 'school-outline',
    placeholder: 'https://hac.katyisd.org',
  },
  {
    type: 'PowerSchool',
    label: 'PowerSchool',
    subtitle: 'Student Info System',
    icon: 'laptop-outline',
    placeholder: 'https://powerschool.yourdistrict.org',
  },
]

const DISTRICTS: DistrictChip[] = [
  { label: 'Katy ISD', url: 'https://homeaccess.katyisd.org' },
  { label: 'HISD', url: 'https://hac.houstonisd.org' },
  { label: 'CFISD', url: 'https://hac.cfisd.net' },
  { label: 'Fort Bend ISD', url: 'https://hac.fortbendisd.com' },
  { label: 'Alief ISD', url: 'https://hac.aliefisd.net' },
]

const KNOWN_DISTRICTS: string[] = ['katyisd', 'houstonisd', 'cfisd', 'alief', 'fortbendisd']

// ── Screen ────────────────────────────────────────────────────────────────────

export default function PortalConnectScreen(): React.JSX.Element {
  const navigation = useNavigation()

  // Portal status state — for the connected-state check
  const [portalStatus, setPortalStatus] = useState<PortalStatus | null>(null)
  const [statusLoading, setStatusLoading] = useState(true)
  const [disconnecting, setDisconnecting] = useState(false)

  const loadStatus = useCallback(async () => {
    setStatusLoading(true)
    try {
      const s = await getPortalStatus()
      setPortalStatus(s)
    } catch {
      setPortalStatus(null)
    } finally {
      setStatusLoading(false)
    }
  }, [])

  useFocusEffect(useCallback(() => { void loadStatus() }, [loadStatus]))

  const handleDisconnect = async (): Promise<void> => {
    setDisconnecting(true)
    try {
      await disconnectPortal()
      await loadStatus()
    } catch {
      // ignore
    } finally {
      setDisconnecting(false)
    }
  }

  // Form state
  const [portalType, setPortalType] = useState<PortalType>('HAC')
  const [districtUrl, setDistrictUrl] = useState('')
  const [username, setUsername] = useState('')
  // Password lives only in local state and is never persisted
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [connectionState, setConnectionState] = useState<ConnectionState>({ status: 'idle' })

  // UI state
  const [focused, setFocused] = useState<FocusedField>(null)
  const [portalDetected, setPortalDetected] = useState(false)

  // Refs for keyboard navigation
  const usernameRef = useRef<TextInput>(null)
  const passwordRef = useRef<TextInput>(null)

  // Derived
  const isConnecting = connectionState.status === 'connecting'
  const selectedPortal = PORTAL_OPTIONS.find(p => p.type === portalType)!

  // Keep this false unless connecting/success so the button can run validation/debug logs.
  // Empty fields are still handled by validate().
  const isButtonDisabled = isConnecting || connectionState.status === 'success'

  // ── Logic ───────────────────────────────────────────────────────────────────

  const validate = useCallback((): string | null => {
    const url = districtUrl.trim()
    const user = username.trim()
    const pass = password // do not trim passwords

    if (!url) return 'Please enter your district portal URL.'
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      return 'District URL must start with http:// or https://'
    }
    if (!user) return 'Please enter your username.'
    if (!pass) return 'Please enter your password.'
    if (pass.length < 4) return 'Password seems too short — please check it.'
    return null
  }, [districtUrl, username, password])

  const handleConnect = useCallback(async (): Promise<void> => {
    console.log('[PORTAL CONNECT] button pressed')

    const validationError = validate()

    if (validationError) {
      console.log('[PORTAL CONNECT] validation failed:', validationError)
      setConnectionState({ status: 'error', message: validationError })
      return
    }

    setConnectionState({ status: 'connecting' })

    const url = districtUrl.trim()
    const user = username.trim()
    const pass = password

    console.log('[PORTAL CONNECT] validation passed')
    console.log('[PORTAL CONNECT] portal type:', portalType)
    console.log('[PORTAL CONNECT] district URL:', url)
    console.log('[PORTAL CONNECT] username exists:', Boolean(user))
    console.log('[PORTAL CONNECT] password exists:', Boolean(pass))

    try {
      if (portalType === 'HAC') {
        console.log('[PORTAL CONNECT] calling connectHac')
        await connectHac(url, user, pass)
        console.log('[PORTAL CONNECT] connectHac completed')
      } else {
        console.log('[PORTAL CONNECT] calling connectPowerSchool')
        await connectPowerSchool(url, user, pass)
        console.log('[PORTAL CONNECT] connectPowerSchool completed')
      }

      setPassword('')
      setConnectionState({ status: 'success', portalType })

      setTimeout(() => {
        navigation.goBack()
      }, 1800)
    } catch (err: unknown) {
      console.log('[PORTAL CONNECT] failed:', err)

      const message =
        err instanceof Error
          ? err.message.replace(pass, '[hidden]')
          : 'Connection failed. Check your URL and credentials and try again.'

      setPassword('')
      setConnectionState({ status: 'error', message })
    }
  }, [validate, districtUrl, username, password, portalType, navigation])

  // ── UI handler ───────────────────────────────────────────────────────────────

  const handleUrlBlur = useCallback((): void => {
    setFocused(null)
    setPortalDetected(KNOWN_DISTRICTS.some(d => districtUrl.toLowerCase().includes(d)))
  }, [districtUrl])

  // ── Render ───────────────────────────────────────────────────────────────────

  // Loading state — checking connection
  if (statusLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <ScreenHeader title="School Portal" />
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </View>
    )
  }

  // Already connected — show status card
  if (portalStatus?.connected) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <ScreenHeader title="School Portal" />
        <ScrollView contentContainerStyle={{ padding: 20 }}>
          <View style={styles.statusCard}>
            <View style={styles.statusCardHeader}>
              <View style={styles.greenDot} />
              <Text variant="h3" style={{ color: colors.success }}>Connected</Text>
            </View>
            <Text variant="body" style={{ color: colors.textSecondary, marginTop: 4 }}>
              {portalStatus.systemType ?? 'Portal'} · {portalStatus.districtUrl?.replace(/^https?:\/\//, '') ?? ''}
            </Text>
            {portalStatus.lastSynced !== null && (
              <Text variant="caption" style={{ color: colors.textMuted, marginTop: 4 }}>
                Last synced: {new Date(portalStatus.lastSynced).toLocaleString()}
              </Text>
            )}
            <Text variant="caption" style={{ color: colors.textMuted, marginTop: 4 }}>
              Session expires in: {Math.floor(portalStatus.sessionExpiresIn / 60)}m {portalStatus.sessionExpiresIn % 60}s
            </Text>
          </View>

          <TouchableOpacity
            style={[styles.disconnectButton, { marginTop: 24 }]}
            onPress={() => void handleDisconnect()}
            disabled={disconnecting}
            accessibilityRole="button"
          >
            {disconnecting
              ? <ActivityIndicator color="#fff" size="small" />
              : <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>
                  Disconnect Portal
                </Text>
            }
          </TouchableOpacity>

          <Text variant="caption" style={{ textAlign: 'center', color: colors.textMuted, marginTop: 16 }}>
            Disconnecting will not delete your school data. You can reconnect at any time.
          </Text>
        </ScrollView>
      </View>
    )
  }

  return (
    <View style={styles.screen}>
      <ScreenHeader title="Connect School Portal" />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* ── 1. Portal type selector ── */}
          <Text variant="label" style={styles.sectionLabel}>Portal Type</Text>
          <View style={styles.portalSelectorRow}>
            {PORTAL_OPTIONS.map(option => {
              const isSelected = portalType === option.type
              return (
                <TouchableOpacity
                  key={option.type}
                  style={[
                    styles.portalCard,
                    isSelected ? styles.portalCardSelected : styles.portalCardUnselected,
                  ]}
                  onPress={() => {
                    setPortalType(option.type)
                    setDistrictUrl('')
                    setPortalDetected(false)
                    setConnectionState({ status: 'idle' })
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: isSelected }}
                  accessibilityLabel={option.label}
                  activeOpacity={0.75}
                >
                  <Ionicons
                    name={option.icon}
                    size={28}
                    color={isSelected ? colors.primary : colors.textSecondary}
                  />
                  <Text style={[styles.portalCardLabel, { color: isSelected ? colors.primary : colors.textPrimary }]}>
                    {option.label}
                  </Text>
                  <Text variant="caption" style={styles.portalCardSubtitle}>
                    {option.subtitle}
                  </Text>
                </TouchableOpacity>
              )
            })}
          </View>

          {/* ── 2. District URL input ── */}
          <View style={styles.inputGroup}>
            <Text variant="caption" style={styles.inputLabel}>District portal URL</Text>
            <View style={[styles.inputRow, focused === 'url' && styles.inputRowFocused]}>
              <Ionicons name="globe-outline" size={20} color={colors.textSecondary} style={styles.inputIcon} />
              <TextInput
                style={styles.textInput}
                placeholder={selectedPortal.placeholder}
                placeholderTextColor={colors.textMuted}
                value={districtUrl}
                onChangeText={text => {
                  setDistrictUrl(text)
                  setConnectionState({ status: 'idle' })
                }}
                onFocus={() => setFocused('url')}
                onBlur={handleUrlBlur}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                returnKeyType="next"
                onSubmitEditing={() => usernameRef.current?.focus()}
                editable={!isConnecting}
                accessibilityLabel="District portal URL"
              />
            </View>
            {portalDetected && (
              <View style={styles.detectRow}>
                <Ionicons name="checkmark-circle" size={14} color={colors.success} />
                <Text style={styles.detectText}>Portal detected</Text>
              </View>
            )}
          </View>

          {/* ── 3. Quick-fill chips ── */}
          <Text variant="caption" style={styles.chipsLabel}>Common districts →</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipsContainer}
            style={styles.chipsScroll}
          >
            {DISTRICTS.map(district => (
              <TouchableOpacity
                key={district.url}
                style={styles.chip}
                onPress={() => {
                  setDistrictUrl(district.url)
                  setPortalDetected(true)
                  setConnectionState({ status: 'idle' })
                }}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={`Fill ${district.label} portal URL`}
              >
                <Text style={styles.chipText}>{district.label}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* ── 4. Username input ── */}
          <View style={styles.inputGroup}>
            <Text variant="caption" style={styles.inputLabel}>Username</Text>
            <View style={[styles.inputRow, focused === 'username' && styles.inputRowFocused]}>
              <Ionicons name="person-outline" size={20} color={colors.textSecondary} style={styles.inputIcon} />
              <TextInput
                ref={usernameRef}
                style={styles.textInput}
                placeholder="Student ID or username"
                placeholderTextColor={colors.textMuted}
                value={username}
                onChangeText={text => {
                  setUsername(text)
                  setConnectionState({ status: 'idle' })
                }}
                onFocus={() => setFocused('username')}
                onBlur={() => setFocused(null)}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="next"
                onSubmitEditing={() => passwordRef.current?.focus()}
                editable={!isConnecting}
                accessibilityLabel="Username"
              />
            </View>
          </View>

          {/* ── 5. Password input ── */}
          <View style={styles.inputGroup}>
            <Text variant="caption" style={styles.inputLabel}>Password</Text>
            <View style={[styles.inputRow, focused === 'password' && styles.inputRowFocused]}>
              <Ionicons name="lock-closed-outline" size={20} color={colors.textSecondary} style={styles.inputIcon} />
              <TextInput
                ref={passwordRef}
                style={styles.textInput}
                placeholder="Your school password"
                placeholderTextColor={colors.textMuted}
                value={password}
                onChangeText={text => {
                  setPassword(text)
                  setConnectionState({ status: 'idle' })
                }}
                onFocus={() => setFocused('password')}
                onBlur={() => setFocused(null)}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="done"
                onSubmitEditing={handleConnect}
                editable={!isConnecting}
                accessibilityLabel="Password"
              />
              <TouchableOpacity
                onPress={() => setShowPassword(v => !v)}
                style={styles.eyeButton}
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

          {/* ── 6. Error / Success banners ── */}
          {connectionState.status === 'error' && (
            <View style={styles.errorBanner}>
              <Ionicons name="alert-circle-outline" size={18} color={colors.error} />
              <Text style={styles.errorText}>{connectionState.message}</Text>
            </View>
          )}
          {connectionState.status === 'success' && (
            <View style={styles.successBanner}>
              <Ionicons name="checkmark-circle-outline" size={18} color={colors.primary} />
              <Text style={styles.successText}>Connected! Returning to Grade Portal…</Text>
            </View>
          )}

          {/* ── 7. Security disclaimer ── */}
          <View style={styles.disclaimer}>
            <Ionicons name="shield-checkmark-outline" size={20} color={colors.textSecondary} style={styles.disclaimerIcon} />
            <Text variant="caption" style={styles.disclaimerBody}>
              {'Your credentials are only used for this session and are '}
              <NativeText style={styles.disclaimerBold}>never stored</NativeText>
              {' on NextStep servers. We do not retain your password.'}
            </Text>
          </View>

          {/* ── 8. Connect button ── */}
          <TouchableOpacity
            style={[
              styles.connectButton,
              isButtonDisabled && !isConnecting && styles.connectButtonDisabled,
              isConnecting && styles.connectButtonLoading,
            ]}
            onPress={handleConnect}
            disabled={isButtonDisabled}
            accessibilityRole="button"
            accessibilityLabel="Connect to school portal"
            accessibilityState={{ disabled: isButtonDisabled, busy: isConnecting }}
            activeOpacity={0.85}
          >
            {isConnecting ? (
              <ActivityIndicator color="#000" size="small" />
            ) : (
              <>
                <Ionicons name="link-outline" size={20} color="#000" />
                <Text style={styles.connectButtonText}>
                  {connectionState.status === 'success' ? '✓ Connected' : 'Connect Portal'}
                </Text>
              </>
            )}
          </TouchableOpacity>

        </ScrollView>
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
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 60,
  },
  sectionLabel: {
    marginBottom: 12,
  },

  // ── Portal type cards ────────────────────────────────────────────────────────
  portalSelectorRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 24,
  },
  portalCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    gap: 6,
  },
  portalCardSelected: {
    borderWidth: 2,
    borderColor: colors.primary,
  },
  portalCardUnselected: {
    borderWidth: 1,
    borderColor: colors.border,
  },
  portalCardLabel: {
    fontSize: 15,
    fontWeight: '700',
    marginTop: 4,
  },
  portalCardSubtitle: {
    textAlign: 'center',
  },

  // ── Input group ──────────────────────────────────────────────────────────────
  inputGroup: {
    marginBottom: 16,
  },
  inputLabel: {
    color: colors.textSecondary,
    marginBottom: 8,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
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
  eyeButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Portal detected ──────────────────────────────────────────────────────────
  detectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 6,
  },
  detectText: {
    fontSize: 12,
    color: colors.success,
  },

  // ── Quick-fill chips ─────────────────────────────────────────────────────────
  chipsLabel: {
    color: colors.textSecondary,
    marginBottom: 8,
  },
  chipsScroll: {
    marginBottom: 20,
  },
  chipsContainer: {
    gap: 8,
    paddingRight: 4,
  },
  chip: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  chipText: {
    fontSize: 12,
    color: colors.textPrimary,
  },

  // ── Status banners ───────────────────────────────────────────────────────────
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 16,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.error,
    backgroundColor: colors.error + '1A',
  },
  errorText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
    color: colors.error,
  },
  successBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 16,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.primary + '1A',
  },
  successText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
    color: colors.primary,
  },

  // ── Security disclaimer ──────────────────────────────────────────────────────
  disclaimer: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    flexDirection: 'row',
    gap: 10,
    marginVertical: 16,
  },
  disclaimerIcon: {
    marginTop: 1,
    flexShrink: 0,
  },
  disclaimerBody: {
    flex: 1,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  disclaimerBold: {
    color: colors.textPrimary,
    fontWeight: '600',
  },

  // ── Connected status card ────────────────────────────────────────────────────
  statusCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
  },
  statusCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  greenDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.success,
  },
  disconnectButton: {
    height: 52,
    borderRadius: 12,
    backgroundColor: colors.error,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Connect button ───────────────────────────────────────────────────────────
  connectButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    borderRadius: 12,
    height: 52,
    gap: 8,
  },
  connectButtonDisabled: {
    opacity: 0.4,
  },
  connectButtonLoading: {
    opacity: 0.7,
  },
  connectButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#000',
  },
})