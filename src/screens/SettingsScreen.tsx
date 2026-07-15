import React, { useCallback, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import { Feather } from '@expo/vector-icons'

import { useAuth } from '../context/AuthContext'
import * as studentsApi from '../api/studentsApi'
import * as gradesApi from '../api/gradesApi'
import * as canvasApi from '../api/canvasApi'
import { ApiRequestError } from '../api/client'
import { Screen } from '../components/ui/Screen'
import { LoadingSkeleton } from '../components/ui/LoadingSkeleton'
import { ErrorRetryBlock } from '../components/ui/ErrorRetryBlock'
import type { PortalStatus } from '../types/grades'
import type { StudentMe } from '../types/student'
import { useDisplayPreferences } from '../preferences/displayPreferences'
import type {
  CanvasConnection,
  CanvasStatus,
} from '../api/canvasApi'
import {
  colors,
  elevation,
  fonts,
  radii,
  spacing,
} from '../theme/tokens'

const DISCONNECTED_CANVAS: CanvasStatus = {
  connected: false,
  canvasInstanceUrl: null,
  canvasUserName: null,
  lastSynced: null,
  connections: [],
}

function parseName(raw: string | null | undefined): string {
  if (!raw) return 'Student'

  if (!raw.includes(',')) return raw.trim()

  const [last = '', rest = ''] = raw.split(',')
  const first = rest.trim().split(/\s+/)[0] ?? ''

  const capitalize = (value: string): string =>
    value
      ? `${value.charAt(0).toUpperCase()}${value.slice(1).toLowerCase()}`
      : ''

  return `${capitalize(first)} ${capitalize(last.trim())}`.trim() || 'Student'
}

function initials(name: string | null | undefined): string {
  const parsed = parseName(name)
  const parts = parsed.split(/\s+/).filter(Boolean)

  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
  }

  return parsed.slice(0, 2).toUpperCase()
}

function formatRelativeTime(value: string | null | undefined): string {
  if (!value) return 'Never synced'

  const timestamp = new Date(value).getTime()
  if (!Number.isFinite(timestamp)) return 'Recently synced'

  const difference = Math.max(0, Date.now() - timestamp)
  const minutes = Math.floor(difference / 60000)

  if (minutes < 1) return 'Synced just now'
  if (minutes < 60) return `Synced ${minutes}m ago`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `Synced ${hours}h ago`

  return `Synced ${Math.floor(hours / 24)}d ago`
}

function normalizeCanvasUrl(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''

  const withProtocol = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`

  return withProtocol.replace(/\/+$/, '')
}

function hostname(value: string): string {
  try {
    return new URL(value).hostname
  } catch {
    return value.replace(/^https?:\/\//i, '').replace(/\/+$/, '')
  }
}

function getCanvasConnections(status: CanvasStatus | null): CanvasConnection[] {
  if (!status) return []

  if (Array.isArray(status.connections) && status.connections.length > 0) {
    return status.connections
  }

  if (status.canvasInstanceUrl) {
    return [
      {
        canvasInstanceUrl: status.canvasInstanceUrl,
        canvasUserName: status.canvasUserName,
        lastSynced: status.lastSynced,
        syncStatus: status.syncStatus,
        syncError: status.syncError,
      },
    ]
  }

  return []
}

interface SectionHeaderProps {
  eyebrow: string
  title: string
  description?: string
  icon: React.ComponentProps<typeof Feather>['name']
  tint?: string
  action?: React.ReactNode
}

function SectionHeader({
  eyebrow,
  title,
  description,
  icon,
  tint = colors.primary,
  action,
}: SectionHeaderProps): React.JSX.Element {
  return (
    <View style={styles.sectionHeader}>
      <View
        style={[
          styles.sectionIcon,
          {
            backgroundColor: `${tint}18`,
            borderColor: `${tint}45`,
          },
        ]}
      >
        <Feather name={icon} size={17} color={tint} />
      </View>

      <View style={styles.sectionHeaderCopy}>
        <Text allowFontScaling={false} style={styles.sectionEyebrow}>
          {eyebrow}
        </Text>
        <Text allowFontScaling={false} style={styles.sectionTitle}>
          {title}
        </Text>
        {description ? (
          <Text style={styles.sectionDescription}>{description}</Text>
        ) : null}
      </View>

      {action}
    </View>
  )
}

interface FormFieldProps {
  label: string
  value: string
  onChangeText: (value: string) => void
  placeholder?: string
  keyboardType?: 'default' | 'number-pad' | 'url'
  secureTextEntry?: boolean
  autoCapitalize?: 'none' | 'sentences' | 'words'
  multiline?: boolean
}

function FormField({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType = 'default',
  secureTextEntry,
  autoCapitalize = 'sentences',
  multiline,
}: FormFieldProps): React.JSX.Element {
  return (
    <View style={styles.field}>
      <Text allowFontScaling={false} style={styles.fieldLabel}>
        {label}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#5F7089"
        keyboardType={keyboardType}
        secureTextEntry={secureTextEntry}
        autoCapitalize={autoCapitalize}
        multiline={multiline}
        style={[styles.input, multiline && styles.multilineInput]}
      />
    </View>
  )
}

interface PrimaryButtonProps {
  label: string
  onPress: () => void
  icon?: React.ComponentProps<typeof Feather>['name']
  loading?: boolean
  disabled?: boolean
  tone?: 'primary' | 'secondary' | 'danger'
  compact?: boolean
}

function PrimaryButton({
  label,
  onPress,
  icon,
  loading,
  disabled,
  tone = 'primary',
  compact,
}: PrimaryButtonProps): React.JSX.Element {
  return (
    <Pressable
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        compact ? styles.compactButton : styles.fullButton,
        tone === 'primary' && styles.primaryButton,
        tone === 'secondary' && styles.secondaryButton,
        tone === 'danger' && styles.dangerButton,
        pressed && !disabled && !loading && styles.buttonPressed,
        (disabled || loading) && styles.buttonDisabled,
      ]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {loading ? (
        <ActivityIndicator
          size="small"
          color={tone === 'danger' ? '#FF8A8D' : '#FFFFFF'}
        />
      ) : icon ? (
        <Feather
          name={icon}
          size={15}
          color={tone === 'danger' ? '#FF777A' : '#FFFFFF'}
        />
      ) : null}

      <Text
        allowFontScaling={false}
        style={[
          styles.buttonText,
          tone === 'danger' && styles.dangerButtonText,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  )
}

interface SettingRowProps {
  title: string
  description: string
  icon: React.ComponentProps<typeof Feather>['name']
  value: boolean
  onValueChange: (value: boolean) => void
}

function SettingRow({
  title,
  description,
  icon,
  value,
  onValueChange,
}: SettingRowProps): React.JSX.Element {
  return (
    <View style={styles.settingRow}>
      <View style={styles.settingRowIcon}>
        <Feather name={icon} size={16} color="#A893FF" />
      </View>

      <View style={styles.settingRowCopy}>
        <Text allowFontScaling={false} style={styles.settingRowTitle}>
          {title}
        </Text>
        <Text style={styles.settingRowDescription}>{description}</Text>
      </View>

      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: '#263853', true: '#6B42EA' }}
        thumbColor="#FFFFFF"
        ios_backgroundColor="#263853"
      />
    </View>
  )
}

export default function SettingsScreen(): React.JSX.Element {
  const { user, signOut, deleteAccount } = useAuth()

  const [student, setStudent] = useState<StudentMe | null>(null)
  const [portalStatus, setPortalStatus] = useState<PortalStatus | null>(null)
  const [canvasStatus, setCanvasStatus] = useState<CanvasStatus | null>(null)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [satScore, setSatScore] = useState('')
  const [actScore, setActScore] = useState('')
  const [futureDecision, setFutureDecision] = useState('')
  const [savingProfile, setSavingProfile] = useState(false)
  const [profileMessage, setProfileMessage] = useState<string | null>(null)

  const [portalSyncing, setPortalSyncing] = useState(false)
  const [portalDisconnecting, setPortalDisconnecting] = useState(false)

  const [canvasFormOpen, setCanvasFormOpen] = useState(false)
  const [canvasUrl, setCanvasUrl] = useState('')
  const [canvasToken, setCanvasToken] = useState('')
  const [canvasLoading, setCanvasLoading] = useState(false)
  const [canvasError, setCanvasError] = useState<string | null>(null)
  const [canvasMessage, setCanvasMessage] = useState<string | null>(null)

  const {
    reduceMotion,
    hideGpa,
    setReduceMotion,
    setHideGpa,
  } = useDisplayPreferences()

  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deletePassword, setDeletePassword] = useState('')
  const [deleteConfirmation, setDeleteConfirmation] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const connections = useMemo(
    () => getCanvasConnections(canvasStatus),
    [canvasStatus],
  )

  const load = useCallback(async () => {
    setError(null)

    try {
      const [studentResult, portalResult, canvasResult] = await Promise.all([
        studentsApi.getMe(),
        gradesApi.getPortalStatus().catch(() => null),
        canvasApi.getCanvasStatus().catch(() => DISCONNECTED_CANVAS),
      ])

      setStudent(studentResult)
      setPortalStatus(portalResult)
      setCanvasStatus(canvasResult)

      setSatScore(
        studentResult.profile?.satScore != null
          ? String(studentResult.profile.satScore)
          : '',
      )
      setActScore(
        studentResult.profile?.actScore != null
          ? String(studentResult.profile.actScore)
          : '',
      )
      setFutureDecision(studentResult.profile?.futureDecision ?? '')
    } catch (err) {
      setError(
        err instanceof ApiRequestError
          ? err.message
          : 'Could not load your settings.',
      )
    } finally {
      setLoading(false)
    }
  }, [])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load]),
  )

  async function handleSaveProfile(): Promise<void> {
    const parsedSat = satScore.trim() ? Number(satScore.trim()) : null
    const parsedAct = actScore.trim() ? Number(actScore.trim()) : null

    if (
      parsedSat !== null &&
      (!Number.isInteger(parsedSat) || parsedSat < 400 || parsedSat > 1600)
    ) {
      setProfileMessage('Enter an SAT score between 400 and 1600.')
      return
    }

    if (
      parsedAct !== null &&
      (!Number.isInteger(parsedAct) || parsedAct < 1 || parsedAct > 36)
    ) {
      setProfileMessage('Enter an ACT score between 1 and 36.')
      return
    }

    setSavingProfile(true)
    setProfileMessage(null)

    try {
      const profile = await studentsApi.updateProfile({
        satScore: parsedSat,
        actScore: parsedAct,
        futureDecision: futureDecision.trim() || null,
      })

      setStudent((current) =>
        current ? { ...current, profile } : current,
      )
      setProfileMessage('Academic profile saved.')
    } catch (err) {
      setProfileMessage(
        err instanceof ApiRequestError
          ? err.message
          : 'Could not save your academic profile.',
      )
    } finally {
      setSavingProfile(false)
    }
  }

  async function handlePortalSync(): Promise<void> {
    setPortalSyncing(true)
    setError(null)

    try {
      await gradesApi.syncProfile()
      await load()
    } catch (err) {
      setError(
        err instanceof ApiRequestError
          ? err.message
          : 'Could not sync your school portal.',
      )
    } finally {
      setPortalSyncing(false)
    }
  }

  function confirmPortalDisconnect(): void {
    Alert.alert(
      'Disconnect school portal?',
      'Grades and student information will stop syncing until the portal is connected again.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: () => void handlePortalDisconnect(),
        },
      ],
    )
  }

  async function handlePortalDisconnect(): Promise<void> {
    setPortalDisconnecting(true)
    setError(null)

    try {
      await gradesApi.disconnectPortal()
      setPortalStatus({
        connected: false,
        systemType: null,
        districtUrl: null,
        lastSynced: null,
        sessionExpiresIn: 0,
      })
    } catch (err) {
      setError(
        err instanceof ApiRequestError
          ? err.message
          : 'Could not disconnect your school portal.',
      )
    } finally {
      setPortalDisconnecting(false)
    }
  }

  function closeCanvasForm(): void {
    setCanvasFormOpen(false)
    setCanvasUrl('')
    setCanvasToken('')
    setCanvasError(null)
  }

  async function refreshCanvasStatus(): Promise<CanvasStatus> {
    const fresh = await canvasApi.getCanvasStatus()
    setCanvasStatus(fresh)
    return fresh
  }

  async function handleCanvasConnect(): Promise<void> {
    const normalizedUrl = normalizeCanvasUrl(canvasUrl)
    const token = canvasToken.trim()

    if (!normalizedUrl) {
      setCanvasError('Enter your Canvas URL.')
      return
    }

    if (!token) {
      setCanvasError('Enter a Canvas access token.')
      return
    }

    setCanvasLoading(true)
    setCanvasError(null)
    setCanvasMessage(null)

    try {
      await canvasApi.connectCanvas(normalizedUrl, token)
      const syncResult = await canvasApi.syncCanvas()
      await refreshCanvasStatus()

      setCanvasMessage(
        `${syncResult.syncedCount} assignment${
          syncResult.syncedCount === 1 ? '' : 's'
        } synced to Planner.`,
      )
      closeCanvasForm()
    } catch (err) {
      setCanvasError(
        err instanceof ApiRequestError
          ? err.message
          : 'Could not connect Canvas.',
      )
    } finally {
      setCanvasLoading(false)
    }
  }

  async function handleCanvasSync(): Promise<void> {
    setCanvasLoading(true)
    setCanvasError(null)
    setCanvasMessage(null)

    try {
      const result = await canvasApi.syncCanvas()
      await refreshCanvasStatus()
      setCanvasMessage(
        `${result.syncedCount} assignment${
          result.syncedCount === 1 ? '' : 's'
        } synced to Planner.`,
      )
    } catch (err) {
      setCanvasError(
        err instanceof ApiRequestError ? err.message : 'Canvas sync failed.',
      )
    } finally {
      setCanvasLoading(false)
    }
  }

  function confirmCanvasDisconnect(connection: CanvasConnection): void {
    Alert.alert(
      'Disconnect Canvas?',
      `${hostname(
        connection.canvasInstanceUrl,
      )} will stop syncing assignments to Planner.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: () => void handleCanvasDisconnect(connection),
        },
      ],
    )
  }

  async function handleCanvasDisconnect(
    connection: CanvasConnection,
  ): Promise<void> {
    setCanvasLoading(true)
    setCanvasError(null)
    setCanvasMessage(null)

    try {
      await canvasApi.disconnectCanvas(connection.canvasInstanceUrl)
      await refreshCanvasStatus()
      setCanvasMessage('Canvas disconnected.')
    } catch (err) {
      setCanvasError(
        err instanceof ApiRequestError
          ? err.message
          : 'Could not disconnect Canvas.',
      )
    } finally {
      setCanvasLoading(false)
    }
  }

  function confirmSignOut(): void {
    Alert.alert('Sign out?', 'You can sign back in at any time.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: () => void signOut(),
      },
    ])
  }

  async function handleDeleteAccount(): Promise<void> {
    if (deleteConfirmation.trim().toUpperCase() !== 'DELETE') {
      setDeleteError('Type DELETE to confirm.')
      return
    }

    if (student?.hasPassword && !deletePassword) {
      setDeleteError('Enter your current password.')
      return
    }

    setDeleteError(null)
    setDeleting(true)

    try {
      await deleteAccount(
        student?.hasPassword ? deletePassword : undefined,
      )
    } catch (err) {
      setDeleteError(
        err instanceof ApiRequestError
          ? err.message
          : 'Could not delete your account.',
      )
    } finally {
      setDeleting(false)
    }
  }

  if (loading) {
    return (
      <Screen edges={['top', 'left', 'right', 'bottom']}>
        <View style={styles.loadingWrap}>
          <LoadingSkeleton rows={5} rowHeight={90} />
        </View>
      </Screen>
    )
  }

  if (error && !student) {
    return (
      <Screen edges={['top', 'left', 'right', 'bottom']}>
        <ErrorRetryBlock
          message={error}
          onRetry={() => {
            setLoading(true)
            void load()
          }}
        />
      </Screen>
    )
  }

  const profile = student?.profile
  const displayName = parseName(student?.name ?? user?.name)
  const gradeSummary = [
    profile?.gradeLevel ? `Grade ${profile.gradeLevel}` : '',
    profile?.graduationYear ? `Class of ${profile.graduationYear}` : '',
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <Screen edges={['top', 'left', 'right', 'bottom']} padded={false}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.pageHeader}>
            <View style={styles.pageHeaderIcon}>
              <Feather name="settings" size={21} color="#BDAAFF" />
            </View>

            <View style={styles.pageHeaderCopy}>
              <Text allowFontScaling={false} style={styles.pageEyebrow}>
                ACCOUNT & PREFERENCES
              </Text>
              <Text allowFontScaling={false} style={styles.pageTitle}>
                Settings
              </Text>
              <Text style={styles.pageSubtitle}>
                Manage your academic profile, integrations and account.
              </Text>
            </View>
          </View>

          <View style={styles.profileCard}>
            <View style={styles.avatar}>
              <Text allowFontScaling={false} style={styles.avatarText}>
                {initials(displayName)}
              </Text>
            </View>

            <View style={styles.profileCopy}>
              <Text allowFontScaling={false} style={styles.profileName}>
                {displayName}
              </Text>
              <Text allowFontScaling={false} style={styles.profileMeta}>
                {gradeSummary || 'Student account'}
              </Text>
              <Text allowFontScaling={false} style={styles.profileEmail}>
                {student?.email ?? user?.email}
              </Text>
              {student?.id ? (
                <Text allowFontScaling={false} style={styles.futurelyId}>
                  myFuturely ID: {student.id}
                </Text>
              ) : null}
            </View>
          </View>

          <View style={styles.card}>
            <SectionHeader
              eyebrow="ACADEMIC INFO"
              title="College profile"
              description="These details improve college-fit scoring and AI guidance."
              icon="award"
              tint="#A78BFA"
            />

            <View style={styles.twoColumnFields}>
              <View style={styles.halfField}>
                <FormField
                  label="SAT Score"
                  value={satScore}
                  onChangeText={setSatScore}
                  placeholder="400–1600"
                  keyboardType="number-pad"
                />
              </View>

              <View style={styles.halfField}>
                <FormField
                  label="ACT Score"
                  value={actScore}
                  onChangeText={setActScore}
                  placeholder="1–36"
                  keyboardType="number-pad"
                />
              </View>
            </View>

            <FormField
              label="Future plan"
              value={futureDecision}
              onChangeText={setFutureDecision}
              placeholder="e.g. Computer science, engineering, business"
              multiline
            />

            <View style={styles.readOnlyGrid}>
              <View style={styles.readOnlyItem}>
                <Text allowFontScaling={false} style={styles.readOnlyLabel}>
                  Counselor
                </Text>
                <Text
                  allowFontScaling={false}
                  style={styles.readOnlyValue}
                  numberOfLines={1}
                >
                  {profile?.counselorName || 'Not available'}
                </Text>
                <Text allowFontScaling={false} style={styles.readOnlySource}>
                  From school portal
                </Text>
              </View>

              <View style={styles.readOnlyItem}>
                <Text allowFontScaling={false} style={styles.readOnlyLabel}>
                  Graduation year
                </Text>
                <Text allowFontScaling={false} style={styles.readOnlyValue}>
                  {profile?.graduationYear ?? '—'}
                </Text>
                <Text allowFontScaling={false} style={styles.readOnlySource}>
                  From school portal
                </Text>
              </View>
            </View>

            {profileMessage ? (
              <View
                style={[
                  styles.messageBanner,
                  profileMessage.includes('saved')
                    ? styles.successBanner
                    : styles.warningBanner,
                ]}
              >
                <Feather
                  name={
                    profileMessage.includes('saved')
                      ? 'check-circle'
                      : 'alert-circle'
                  }
                  size={15}
                  color={
                    profileMessage.includes('saved')
                      ? '#5ED6AE'
                      : '#F9B84C'
                  }
                />
                <Text style={styles.messageText}>{profileMessage}</Text>
              </View>
            ) : null}

            <PrimaryButton
              label="Save academic profile"
              icon="save"
              onPress={() => void handleSaveProfile()}
              loading={savingProfile}
            />
          </View>

          <View style={styles.card}>
            <SectionHeader
              eyebrow="SCHOOL PORTAL"
              title="Grades connection"
              description="Your portal supplies grades, counselor and graduation details."
              icon="link"
              tint="#3B82F6"
            />

            {portalStatus?.connected ? (
              <>
                <View style={styles.connectedBanner}>
                  <View style={styles.connectedStatus}>
                    <View style={styles.connectedDot} />
                    <Text
                      allowFontScaling={false}
                      style={styles.connectedText}
                    >
                      Connected
                    </Text>
                    <View style={styles.systemBadge}>
                      <Text
                        allowFontScaling={false}
                        style={styles.systemBadgeText}
                      >
                        {portalStatus.systemType ?? 'Portal'}
                      </Text>
                    </View>
                  </View>

                  <Text
                    allowFontScaling={false}
                    style={styles.connectionUrl}
                    numberOfLines={1}
                  >
                    {portalStatus.districtUrl ?? 'School portal'}
                  </Text>

                  <Text allowFontScaling={false} style={styles.lastSynced}>
                    {formatRelativeTime(portalStatus.lastSynced)}
                  </Text>
                </View>

                <View style={styles.actionRow}>
                  <View style={styles.actionRowPrimary}>
                    <PrimaryButton
                      label={
                        portalSyncing
                          ? 'Re-syncing'
                          : `Re-sync from ${
                              portalStatus.systemType ?? 'portal'
                            }`
                      }
                      icon="refresh-cw"
                      onPress={() => void handlePortalSync()}
                      loading={portalSyncing}
                      tone="secondary"
                    />
                  </View>

                  <PrimaryButton
                    label="Disconnect"
                    icon="link-2"
                    onPress={confirmPortalDisconnect}
                    loading={portalDisconnecting}
                    tone="danger"
                    compact
                  />
                </View>
              </>
            ) : (
              <View style={styles.disconnectedBanner}>
                <View style={styles.disconnectedIcon}>
                  <Feather name="wifi-off" size={18} color="#8393AA" />
                </View>
                <View style={styles.disconnectedCopy}>
                  <Text
                    allowFontScaling={false}
                    style={styles.disconnectedTitle}
                  >
                    School portal not connected
                  </Text>
                  <Text style={styles.disconnectedText}>
                    Reconnect through the school connection flow to restore
                    live grades.
                  </Text>
                </View>
              </View>
            )}
          </View>

          <View style={styles.card}>
            <SectionHeader
              eyebrow="PLANNER INTEGRATION"
              title="Canvas"
              description="Sync Canvas assignments directly into your Planner."
              icon="calendar"
              tint="#10B981"
              action={
                connections.length > 0 && connections.length < 2 ? (
                  <Pressable
                    onPress={() => setCanvasFormOpen(true)}
                    style={({ pressed }) => [
                      styles.addCanvasButton,
                      pressed && styles.buttonPressed,
                    ]}
                  >
                    <Feather name="plus" size={14} color="#B8A9FF" />
                    <Text
                      allowFontScaling={false}
                      style={styles.addCanvasText}
                    >
                      Add
                    </Text>
                  </Pressable>
                ) : undefined
              }
            />

            {connections.length > 0 ? (
              <>
                <View style={styles.canvasConnectedHeader}>
                  <View style={styles.canvasConnectedLabel}>
                    <View style={styles.connectedDot} />
                    <Text
                      allowFontScaling={false}
                      style={styles.canvasConnectedText}
                    >
                      Canvas connected
                    </Text>
                  </View>

                  <Pressable
                    disabled={canvasLoading}
                    onPress={() => void handleCanvasSync()}
                    style={({ pressed }) => [
                      styles.syncAllButton,
                      pressed && !canvasLoading && styles.buttonPressed,
                      canvasLoading && styles.buttonDisabled,
                    ]}
                  >
                    {canvasLoading ? (
                      <ActivityIndicator size="small" color="#A997FF" />
                    ) : (
                      <Feather
                        name="refresh-cw"
                        size={14}
                        color="#A997FF"
                      />
                    )}
                    <Text
                      allowFontScaling={false}
                      style={styles.syncAllText}
                    >
                      Sync all
                    </Text>
                  </Pressable>
                </View>

                <View style={styles.canvasConnectionList}>
                  {connections.map((connection) => (
                    <View
                      key={connection.canvasInstanceUrl}
                      style={styles.canvasConnectionRow}
                    >
                      <View style={styles.canvasLogo}>
                        <Feather
                          name="book-open"
                          size={17}
                          color="#7CD9B7"
                        />
                      </View>

                      <View style={styles.canvasConnectionCopy}>
                        <View style={styles.canvasNameRow}>
                          <Text
                            allowFontScaling={false}
                            style={styles.canvasName}
                            numberOfLines={1}
                          >
                            {connection.canvasUserName ||
                              hostname(connection.canvasInstanceUrl)}
                          </Text>

                          {connection.syncError === 'TOKEN_REVOKED' ? (
                            <View style={styles.tokenExpiredBadge}>
                              <Text
                                allowFontScaling={false}
                                style={styles.tokenExpiredText}
                              >
                                Token expired
                              </Text>
                            </View>
                          ) : null}
                        </View>

                        <Text
                          allowFontScaling={false}
                          style={styles.canvasUrlText}
                          numberOfLines={1}
                        >
                          {hostname(connection.canvasInstanceUrl)}
                        </Text>

                        <Text
                          allowFontScaling={false}
                          style={styles.canvasSyncTime}
                        >
                          {formatRelativeTime(connection.lastSynced)}
                        </Text>
                      </View>

                      <Pressable
                        disabled={canvasLoading}
                        onPress={() =>
                          confirmCanvasDisconnect(connection)
                        }
                        style={({ pressed }) => [
                          styles.connectionRemoveButton,
                          pressed && styles.buttonPressed,
                        ]}
                        accessibilityRole="button"
                        accessibilityLabel={`Disconnect ${hostname(
                          connection.canvasInstanceUrl,
                        )}`}
                      >
                        <Feather
                          name="trash-2"
                          size={15}
                          color="#FF7C80"
                        />
                      </Pressable>
                    </View>
                  ))}
                </View>
              </>
            ) : !canvasFormOpen ? (
              <View style={styles.canvasEmptyState}>
                <View style={styles.canvasEmptyIcon}>
                  <Feather name="calendar" size={23} color="#6DD3AF" />
                </View>
                <Text
                  allowFontScaling={false}
                  style={styles.canvasEmptyTitle}
                >
                  Bring assignments into Planner
                </Text>
                <Text style={styles.canvasEmptyText}>
                  Connect your Canvas account once and myFuturely can keep
                  upcoming work synchronized.
                </Text>
                <PrimaryButton
                  label="Connect Canvas"
                  icon="link"
                  onPress={() => setCanvasFormOpen(true)}
                />
              </View>
            ) : null}

            {canvasFormOpen ? (
              <View style={styles.canvasForm}>
                <View style={styles.canvasHelpCard}>
                  <Feather name="key" size={16} color="#F9B84C" />
                  <Text style={styles.canvasHelpText}>
                    In Canvas, open Profile → Settings → Approved
                    Integrations → New Access Token. A 120-day expiry is
                    recommended.
                  </Text>
                </View>

                <FormField
                  label="Canvas URL"
                  value={canvasUrl}
                  onChangeText={setCanvasUrl}
                  placeholder="https://yourdistrict.instructure.com"
                  keyboardType="url"
                  autoCapitalize="none"
                />

                <FormField
                  label="Access token"
                  value={canvasToken}
                  onChangeText={setCanvasToken}
                  placeholder="Paste your Canvas token"
                  secureTextEntry
                  autoCapitalize="none"
                />

                {canvasError ? (
                  <View style={styles.inlineError}>
                    <Feather
                      name="alert-circle"
                      size={15}
                      color="#FF7C80"
                    />
                    <Text style={styles.inlineErrorText}>
                      {canvasError}
                    </Text>
                  </View>
                ) : null}

                <View style={styles.canvasFormButtons}>
                  <View style={styles.canvasFormPrimary}>
                    <PrimaryButton
                      label="Connect and sync"
                      icon="link"
                      onPress={() => void handleCanvasConnect()}
                      loading={canvasLoading}
                    />
                  </View>
                  <PrimaryButton
                    label="Cancel"
                    onPress={closeCanvasForm}
                    tone="secondary"
                    compact
                  />
                </View>
              </View>
            ) : null}

            {canvasMessage ? (
              <View style={[styles.messageBanner, styles.successBanner]}>
                <Feather
                  name="check-circle"
                  size={15}
                  color="#5ED6AE"
                />
                <Text style={styles.messageText}>{canvasMessage}</Text>
              </View>
            ) : null}

            {canvasError && !canvasFormOpen ? (
              <View style={styles.inlineError}>
                <Feather
                  name="alert-circle"
                  size={15}
                  color="#FF7C80"
                />
                <Text style={styles.inlineErrorText}>{canvasError}</Text>
              </View>
            ) : null}
          </View>

          <View style={styles.card}>
            <SectionHeader
              eyebrow="APPEARANCE"
              title="Display preferences"
              description="Personalize how myFuturely appears on this device."
              icon="eye"
              tint="#60A5FA"
            />

            <View style={styles.themeRow}>
              <View style={styles.settingRowIcon}>
                <Feather name="moon" size={16} color="#A893FF" />
              </View>
              <View style={styles.settingRowCopy}>
                <Text
                  allowFontScaling={false}
                  style={styles.settingRowTitle}
                >
                  Theme
                </Text>
                <Text style={styles.settingRowDescription}>
                  Dark mode is optimized for the mobile experience.
                </Text>
              </View>
              <View style={styles.themeBadge}>
                <Feather name="moon" size={13} color="#C5B7FF" />
                <Text allowFontScaling={false} style={styles.themeBadgeText}>
                  Dark
                </Text>
              </View>
            </View>

            <View style={styles.settingsDivider} />

            <SettingRow
              title="Reduce animations"
              description="Use fewer motion effects on slower devices."
              icon="activity"
              value={reduceMotion}
              onValueChange={(value) => {
                void setReduceMotion(value)
              }}
            />

            <View style={styles.settingsDivider} />

            <SettingRow
              title="Hide GPA on dashboard"
              description="Protect your GPA when someone is looking over your shoulder."
              icon="eye-off"
              value={hideGpa}
              onValueChange={(value) => {
                void setHideGpa(value)
              }}
            />

            <View style={styles.settingsDivider} />

            <View style={styles.gradeColorRow}>
              <View style={styles.settingRowIcon}>
                <Feather name="bar-chart-2" size={16} color="#A893FF" />
              </View>
              <View style={styles.settingRowCopy}>
                <Text
                  allowFontScaling={false}
                  style={styles.settingRowTitle}
                >
                  Grade color coding
                </Text>
                <Text style={styles.settingRowDescription}>
                  The standard A–F palette used throughout Grades.
                </Text>

                <View style={styles.gradePalette}>
                  {[
                    ['A', '#22C55E'],
                    ['B', '#10B981'],
                    ['C', '#F59E0B'],
                    ['D', '#F97316'],
                    ['F', '#EF4444'],
                  ].map(([grade, color]) => (
                    <View key={grade} style={styles.gradeSwatchWrap}>
                      <View
                        style={[
                          styles.gradeSwatch,
                          { backgroundColor: color },
                        ]}
                      />
                      <Text
                        allowFontScaling={false}
                        style={[styles.gradeLabel, { color }]}
                      >
                        {grade}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
            </View>
          </View>

          <View style={styles.card}>
            <SectionHeader
              eyebrow="SUPPORT"
              title="Help & account"
              icon="help-circle"
              tint="#38BDF8"
            />

            <View style={styles.supportRow}>
              <Text
                allowFontScaling={false}
                style={styles.supportRowLabel}
              >
                Contact
              </Text>
              <Text
                allowFontScaling={false}
                style={styles.supportRowValue}
              >
                support@nextstep.ai
              </Text>
            </View>

            <View style={styles.settingsDivider} />

            <View style={styles.supportRow}>
              <Text
                allowFontScaling={false}
                style={styles.supportRowLabel}
              >
                Version
              </Text>
              <Text
                allowFontScaling={false}
                style={styles.supportRowValue}
              >
                v1.0.3
              </Text>
            </View>
          </View>

          {error ? (
            <View style={styles.inlineError}>
              <Feather
                name="alert-circle"
                size={15}
                color="#FF7C80"
              />
              <Text style={styles.inlineErrorText}>{error}</Text>
            </View>
          ) : null}

          <PrimaryButton
            label="Sign out"
            icon="log-out"
            onPress={confirmSignOut}
            tone="danger"
          />

          <View style={[styles.card, styles.dangerZoneCard]}>
            <SectionHeader
              eyebrow="DANGER ZONE"
              title="Delete account"
              description="Permanently delete your account and all associated data."
              icon="alert-triangle"
              tint="#FF6367"
            />

            {!deleteOpen ? (
              <PrimaryButton
                label="Delete account"
                icon="trash-2"
                onPress={() => setDeleteOpen(true)}
                tone="danger"
              />
            ) : (
              <View style={styles.deleteForm}>
                <View style={styles.deleteWarning}>
                  <Feather
                    name="alert-triangle"
                    size={17}
                    color="#FF7C80"
                  />
                  <Text style={styles.deleteWarningText}>
                    This cannot be undone. Type DELETE below to continue.
                  </Text>
                </View>

                {student?.hasPassword ? (
                  <FormField
                    label="Current password"
                    value={deletePassword}
                    onChangeText={setDeletePassword}
                    secureTextEntry
                    autoCapitalize="none"
                  />
                ) : null}

                <FormField
                  label="Type DELETE to confirm"
                  value={deleteConfirmation}
                  onChangeText={setDeleteConfirmation}
                  autoCapitalize="none"
                  placeholder="DELETE"
                />

                {deleteError ? (
                  <Text style={styles.deleteError}>{deleteError}</Text>
                ) : null}

                <View style={styles.deleteActions}>
                  <View style={styles.deletePrimary}>
                    <PrimaryButton
                      label="Delete forever"
                      icon="trash-2"
                      onPress={() => void handleDeleteAccount()}
                      loading={deleting}
                      tone="danger"
                    />
                  </View>

                  <PrimaryButton
                    label="Cancel"
                    onPress={() => {
                      setDeleteOpen(false)
                      setDeleteError(null)
                      setDeletePassword('')
                      setDeleteConfirmation('')
                    }}
                    tone="secondary"
                    compact
                  />
                </View>
              </View>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  loadingWrap: {
    flex: 1,
    paddingTop: spacing.lg,
  },
  scrollContent: {
    paddingHorizontal: spacing.screenPadding,
    paddingTop: spacing.md,
    paddingBottom: spacing.huge,
    gap: spacing.lg,
  },

  pageHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  pageHeaderIcon: {
    width: 46,
    height: 46,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 15,
    backgroundColor: '#211752',
    borderWidth: 1,
    borderColor: 'rgba(167,139,250,0.34)',
  },
  pageHeaderCopy: {
    flex: 1,
    minWidth: 0,
  },
  pageEyebrow: {
    color: '#7893BC',
    fontFamily: fonts.bold,
    fontSize: 8.5,
    fontWeight: '700',
    letterSpacing: 1.15,
  },
  pageTitle: {
    marginTop: 2,
    color: colors.text,
    fontFamily: fonts.bold,
    fontSize: 25,
    lineHeight: 30,
    fontWeight: '700',
    letterSpacing: -0.45,
  },
  pageSubtitle: {
    marginTop: 4,
    color: '#8798B1',
    fontFamily: fonts.regular,
    fontSize: 11.5,
    lineHeight: 17,
  },

  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    padding: 15,
    borderRadius: 20,
    backgroundColor: '#132038',
    borderWidth: 1,
    borderColor: '#2A4261',
    ...elevation.sm,
  },
  avatar: {
    width: 54,
    height: 54,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 27,
    backgroundColor: '#235C68',
    borderWidth: 1,
    borderColor: '#3A7A83',
  },
  avatarText: {
    color: '#F4F8FF',
    fontFamily: fonts.bold,
    fontSize: 18,
    fontWeight: '700',
  },
  profileCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  profileName: {
    color: '#F4F7FF',
    fontFamily: fonts.bold,
    fontSize: 15,
    lineHeight: 19,
    fontWeight: '700',
  },
  profileMeta: {
    color: '#9BAAC0',
    fontFamily: fonts.medium,
    fontSize: 10.5,
    lineHeight: 14,
    fontWeight: '500',
  },
  profileEmail: {
    color: '#7083A0',
    fontFamily: fonts.regular,
    fontSize: 9.5,
    lineHeight: 13,
  },
  futurelyId: {
    marginTop: 3,
    color: '#5F789B',
    fontFamily: fonts.regular,
    fontSize: 8.5,
    lineHeight: 11,
  },

  card: {
    gap: 14,
    padding: 15,
    borderRadius: 20,
    backgroundColor: '#111D30',
    borderWidth: 1,
    borderColor: '#2A4261',
    ...elevation.sm,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  sectionIcon: {
    width: 38,
    height: 38,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    borderWidth: 1,
  },
  sectionHeaderCopy: {
    flex: 1,
    minWidth: 0,
  },
  sectionEyebrow: {
    color: '#7188AB',
    fontFamily: fonts.bold,
    fontSize: 8,
    fontWeight: '700',
    letterSpacing: 1,
  },
  sectionTitle: {
    marginTop: 2,
    color: '#F2F5FF',
    fontFamily: fonts.bold,
    fontSize: 15,
    lineHeight: 19,
    fontWeight: '700',
  },
  sectionDescription: {
    marginTop: 3,
    color: '#7F91AA',
    fontFamily: fonts.regular,
    fontSize: 9.5,
    lineHeight: 14,
  },

  twoColumnFields: {
    flexDirection: 'row',
    gap: 10,
  },
  halfField: {
    flex: 1,
    minWidth: 0,
  },
  field: {
    gap: 6,
  },
  fieldLabel: {
    color: '#8496B2',
    fontFamily: fonts.bold,
    fontSize: 8.5,
    fontWeight: '700',
    letterSpacing: 0.75,
    textTransform: 'uppercase',
  },
  input: {
    minHeight: 47,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 13,
    color: '#EEF2FC',
    backgroundColor: '#0D1727',
    borderWidth: 1,
    borderColor: '#2A3D5A',
    fontFamily: fonts.regular,
    fontSize: 12.5,
  },
  multilineInput: {
    minHeight: 76,
    textAlignVertical: 'top',
  },

  readOnlyGrid: {
    flexDirection: 'row',
    gap: 10,
  },
  readOnlyItem: {
    flex: 1,
    minWidth: 0,
    gap: 3,
    padding: 11,
    borderRadius: 13,
    backgroundColor: '#142238',
    borderWidth: 1,
    borderColor: '#273E5D',
  },
  readOnlyLabel: {
    color: '#7185A4',
    fontFamily: fonts.bold,
    fontSize: 8,
    fontWeight: '700',
    letterSpacing: 0.65,
    textTransform: 'uppercase',
  },
  readOnlyValue: {
    color: '#E7ECF8',
    fontFamily: fonts.semiBold,
    fontSize: 10.5,
    lineHeight: 14,
    fontWeight: '600',
  },
  readOnlySource: {
    color: '#586C89',
    fontFamily: fonts.regular,
    fontSize: 7.5,
    lineHeight: 10,
  },

  button: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    borderRadius: 13,
    borderWidth: 1,
  },
  fullButton: {
    width: '100%',
    paddingHorizontal: 14,
  },
  compactButton: {
    paddingHorizontal: 12,
  },
  primaryButton: {
    backgroundColor: '#7048F4',
    borderColor: '#7E5AFF',
  },
  secondaryButton: {
    backgroundColor: '#15243A',
    borderColor: '#2C4668',
  },
  dangerButton: {
    backgroundColor: 'rgba(255,99,103,0.04)',
    borderColor: 'rgba(255,99,103,0.48)',
  },
  buttonPressed: {
    opacity: 0.84,
    transform: [{ scale: 0.99 }],
  },
  buttonDisabled: {
    opacity: 0.58,
  },
  buttonText: {
    color: '#FFFFFF',
    fontFamily: fonts.bold,
    fontSize: 10.5,
    lineHeight: 14,
    fontWeight: '700',
  },
  dangerButtonText: {
    color: '#FF777A',
  },

  messageBanner: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 11,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
  },
  successBanner: {
    backgroundColor: 'rgba(16,185,129,0.08)',
    borderColor: 'rgba(16,185,129,0.26)',
  },
  warningBanner: {
    backgroundColor: 'rgba(245,158,11,0.08)',
    borderColor: 'rgba(245,158,11,0.25)',
  },
  messageText: {
    flex: 1,
    color: '#B7C5D7',
    fontFamily: fonts.regular,
    fontSize: 9.5,
    lineHeight: 13,
  },

  connectedBanner: {
    gap: 5,
    padding: 12,
    borderRadius: 14,
    backgroundColor: 'rgba(16,185,129,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(16,185,129,0.20)',
  },
  connectedStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  connectedDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#2DD491',
  },
  connectedText: {
    color: '#5ED6AE',
    fontFamily: fonts.bold,
    fontSize: 10.5,
    fontWeight: '700',
  },
  systemBadge: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: '#192A43',
    borderWidth: 1,
    borderColor: '#304C70',
  },
  systemBadgeText: {
    color: '#9FB2CC',
    fontFamily: fonts.semiBold,
    fontSize: 7.5,
    fontWeight: '600',
  },
  connectionUrl: {
    color: '#7E91AB',
    fontFamily: fonts.regular,
    fontSize: 9,
    lineHeight: 12,
  },
  lastSynced: {
    color: '#5F7390',
    fontFamily: fonts.regular,
    fontSize: 8,
    lineHeight: 11,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 9,
  },
  actionRowPrimary: {
    flex: 1,
    minWidth: 0,
  },
  disconnectedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 14,
    backgroundColor: '#101A2A',
    borderWidth: 1,
    borderColor: '#263C59',
  },
  disconnectedIcon: {
    width: 38,
    height: 38,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: '#17243A',
  },
  disconnectedCopy: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  disconnectedTitle: {
    color: '#DDE4F1',
    fontFamily: fonts.semiBold,
    fontSize: 10.5,
    fontWeight: '600',
  },
  disconnectedText: {
    color: '#74859F',
    fontFamily: fonts.regular,
    fontSize: 8.5,
    lineHeight: 12,
  },

  addCanvasButton: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    borderRadius: 11,
    backgroundColor: '#1B1640',
    borderWidth: 1,
    borderColor: 'rgba(167,139,250,0.30)',
  },
  addCanvasText: {
    color: '#C6B7FF',
    fontFamily: fonts.bold,
    fontSize: 9,
    fontWeight: '700',
  },
  canvasConnectedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  canvasConnectedLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  canvasConnectedText: {
    color: '#5ED6AE',
    fontFamily: fonts.bold,
    fontSize: 10.5,
    fontWeight: '700',
  },
  syncAllButton: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    borderRadius: 11,
    backgroundColor: '#171837',
    borderWidth: 1,
    borderColor: '#343B68',
  },
  syncAllText: {
    color: '#A997FF',
    fontFamily: fonts.bold,
    fontSize: 8.5,
    fontWeight: '700',
  },
  canvasConnectionList: {
    gap: 9,
  },
  canvasConnectionRow: {
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 10,
    borderRadius: 14,
    backgroundColor: '#142238',
    borderWidth: 1,
    borderColor: '#29415F',
  },
  canvasLogo: {
    width: 40,
    height: 40,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 13,
    backgroundColor: 'rgba(16,185,129,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(16,185,129,0.30)',
  },
  canvasConnectionCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  canvasNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  canvasName: {
    flexShrink: 1,
    color: '#EAF0FA',
    fontFamily: fonts.semiBold,
    fontSize: 10.5,
    fontWeight: '600',
  },
  tokenExpiredBadge: {
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 5,
    backgroundColor: 'rgba(255,99,103,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(255,99,103,0.30)',
  },
  tokenExpiredText: {
    color: '#FF8588',
    fontFamily: fonts.bold,
    fontSize: 6.5,
    fontWeight: '700',
  },
  canvasUrlText: {
    color: '#7A8DA7',
    fontFamily: fonts.regular,
    fontSize: 8.5,
    lineHeight: 11,
  },
  canvasSyncTime: {
    color: '#5F718C',
    fontFamily: fonts.regular,
    fontSize: 7.5,
    lineHeight: 10,
  },
  connectionRemoveButton: {
    width: 34,
    height: 34,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 11,
    backgroundColor: 'rgba(255,99,103,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,99,103,0.22)',
  },
  canvasEmptyState: {
    alignItems: 'center',
    gap: 9,
    padding: 16,
    borderRadius: 15,
    backgroundColor: '#101B2B',
    borderWidth: 1,
    borderColor: '#263E5A',
  },
  canvasEmptyIcon: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    backgroundColor: 'rgba(16,185,129,0.09)',
    borderWidth: 1,
    borderColor: 'rgba(16,185,129,0.25)',
  },
  canvasEmptyTitle: {
    color: '#ECF1FA',
    fontFamily: fonts.bold,
    fontSize: 12,
    fontWeight: '700',
  },
  canvasEmptyText: {
    maxWidth: 285,
    color: '#7C8DA5',
    fontFamily: fonts.regular,
    fontSize: 9.5,
    lineHeight: 14,
    textAlign: 'center',
  },
  canvasForm: {
    gap: 12,
    paddingTop: 3,
  },
  canvasHelpCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
    padding: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(245,158,11,0.07)',
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.21)',
  },
  canvasHelpText: {
    flex: 1,
    color: '#ACA087',
    fontFamily: fonts.regular,
    fontSize: 8.5,
    lineHeight: 12.5,
  },
  canvasFormButtons: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 9,
  },
  canvasFormPrimary: {
    flex: 1,
    minWidth: 0,
  },

  inlineError: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: 'rgba(255,99,103,0.07)',
    borderWidth: 1,
    borderColor: 'rgba(255,99,103,0.22)',
  },
  inlineErrorText: {
    flex: 1,
    color: '#E7A0A3',
    fontFamily: fonts.regular,
    fontSize: 9.5,
    lineHeight: 13,
  },

  themeRow: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  settingRow: {
    minHeight: 67,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  settingRowIcon: {
    width: 36,
    height: 36,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: '#1C1742',
  },
  settingRowCopy: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  settingRowTitle: {
    color: '#E8EDF7',
    fontFamily: fonts.semiBold,
    fontSize: 10.5,
    lineHeight: 14,
    fontWeight: '600',
  },
  settingRowDescription: {
    color: '#74859F',
    fontFamily: fonts.regular,
    fontSize: 8.5,
    lineHeight: 12,
  },
  themeBadge: {
    minHeight: 31,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: '#1A2943',
    borderWidth: 1,
    borderColor: '#2D496E',
  },
  themeBadgeText: {
    color: '#C5B7FF',
    fontFamily: fonts.bold,
    fontSize: 8.5,
    fontWeight: '700',
  },
  settingsDivider: {
    height: 1,
    backgroundColor: '#263C58',
  },
  gradeColorRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  gradePalette: {
    marginTop: 8,
    flexDirection: 'row',
    gap: 9,
  },
  gradeSwatchWrap: {
    alignItems: 'center',
    gap: 4,
  },
  gradeSwatch: {
    width: 28,
    height: 28,
    borderRadius: 8,
  },
  gradeLabel: {
    fontFamily: fonts.bold,
    fontSize: 8,
    fontWeight: '700',
  },

  supportRow: {
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  supportRowLabel: {
    color: '#8294AF',
    fontFamily: fonts.medium,
    fontSize: 10,
    fontWeight: '500',
  },
  supportRowValue: {
    color: '#E5EBF6',
    fontFamily: fonts.semiBold,
    fontSize: 10,
    fontWeight: '600',
  },

  dangerZoneCard: {
    borderColor: 'rgba(255,99,103,0.35)',
  },
  deleteForm: {
    gap: 12,
  },
  deleteWarning: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
    padding: 11,
    borderRadius: 12,
    backgroundColor: 'rgba(255,99,103,0.07)',
    borderWidth: 1,
    borderColor: 'rgba(255,99,103,0.20)',
  },
  deleteWarningText: {
    flex: 1,
    color: '#DDA5A7',
    fontFamily: fonts.regular,
    fontSize: 9,
    lineHeight: 13,
  },
  deleteError: {
    color: '#FF8B8E',
    fontFamily: fonts.regular,
    fontSize: 9.5,
    lineHeight: 13,
  },
  deleteActions: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 9,
  },
  deletePrimary: {
    flex: 1,
    minWidth: 0,
  },
})