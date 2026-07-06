// SettingsScreen — account management, profile fields, and portal connection.
//
// Mirrors app/(app)/settings/page.tsx: profile (SAT/ACT/college goal), school
// portal connection status + disconnect/reconnect, log out, and delete account.
// The portal-type picker never lists ClassLink — HAC and PowerSchool only,
// matching web (ClassLink integration is paused/unmounted server-side).

import React, { useCallback, useEffect, useState } from 'react'
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Modal,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useNavigation } from '@react-navigation/native'
import type { DrawerNavigationProp } from '@react-navigation/drawer'
import { useTheme } from '../theme/ThemeContext'
import { useAuth } from '../context/AuthContext'
import { getMe, updateProfile } from '../api/studentsApi'
import type { StudentMe } from '../api/studentsApi'
import { portalStatus, disconnectPortal } from '../api/gradesApi'
import type { PortalStatusResponse } from '../api/gradesApi'
import { deleteAccount } from '../api/authApi'
import { ApiRequestError } from '../api/client'
import type { MainDrawerParamList } from '../navigation/MainNavigator'

function extractMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiRequestError) return err.message
  if (err instanceof Error) return err.message
  return fallback
}

export default function SettingsScreen(): React.JSX.Element {
  const { theme } = useTheme()
  const { user, accessToken, signOut, markPortalDisconnected } = useAuth()
  const navigation = useNavigation<DrawerNavigationProp<MainDrawerParamList>>()

  const c  = theme.colors
  const sp = theme.spacing
  const r  = theme.radius
  const ty = theme.typography

  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)
  const [me, setMe]             = useState<StudentMe | null>(null)
  const [portal, setPortal]     = useState<PortalStatusResponse | null>(null)

  const [satScore, setSatScore]         = useState('')
  const [actScore, setActScore]         = useState('')
  const [futureDecision, setFutureDecision] = useState('')
  const [savingProfile, setSavingProfile]   = useState(false)
  const [saveMessage, setSaveMessage]       = useState<string | null>(null)

  const [disconnecting, setDisconnecting] = useState(false)

  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [deletePassword, setDeletePassword]   = useState('')
  const [deleteError, setDeleteError]         = useState<string | null>(null)
  const [deleting, setDeleting]               = useState(false)

  const load = useCallback(async (): Promise<void> => {
    if (!accessToken) return
    setLoading(true)
    setError(null)
    try {
      const [meResult, portalResult] = await Promise.all([
        getMe(accessToken),
        portalStatus(accessToken),
      ])
      setMe(meResult)
      setPortal(portalResult)
      setSatScore(meResult.profile?.satScore != null ? String(meResult.profile.satScore) : '')
      setActScore(meResult.profile?.actScore != null ? String(meResult.profile.actScore) : '')
      setFutureDecision(meResult.profile?.futureDecision ?? '')
    } catch (err: unknown) {
      setError(extractMessage(err, 'Could not load settings. Please try again.'))
    } finally {
      setLoading(false)
    }
  }, [accessToken])

  useEffect(() => { void load() }, [load])

  async function handleSaveProfile(): Promise<void> {
    if (!accessToken) return
    setSavingProfile(true)
    setSaveMessage(null)
    try {
      await updateProfile(
        {
          satScore: satScore.trim() ? parseInt(satScore.trim(), 10) : null,
          actScore: actScore.trim() ? parseInt(actScore.trim(), 10) : null,
          futureDecision: futureDecision.trim() || null,
        },
        accessToken,
      )
      setSaveMessage('Saved.')
      setTimeout(() => setSaveMessage(null), 2500)
    } catch (err: unknown) {
      setSaveMessage(extractMessage(err, 'Could not save changes.'))
    } finally {
      setSavingProfile(false)
    }
  }

  async function handleDisconnectPortal(): Promise<void> {
    if (!accessToken) return
    setDisconnecting(true)
    try {
      await disconnectPortal(accessToken)
      // RootNavigator reacts to hasPortalConnection and swaps to
      // ConnectSchoolNavigator automatically — no manual navigation call needed.
      markPortalDisconnected()
    } catch (err: unknown) {
      setError(extractMessage(err, 'Could not disconnect your school portal.'))
    } finally {
      setDisconnecting(false)
    }
  }

  function handleReconnectPortal(): void {
    // Route back to ConnectSchoolScreen the same way disconnect does — flip
    // hasPortalConnection to false and let RootNavigator swap navigators.
    // There's no existing school connection to tear down here (this button
    // only shows when portal.connected is false), so no API call is needed.
    markPortalDisconnected()
  }

  async function handleDeleteAccount(): Promise<void> {
    if (!accessToken) return
    if (me?.hasPassword && !deletePassword) {
      setDeleteError('Password required')
      return
    }
    setDeleting(true)
    setDeleteError(null)
    try {
      await deleteAccount(me?.hasPassword ? deletePassword : undefined, accessToken)
      await signOut()
    } catch (err: unknown) {
      setDeleteError(extractMessage(err, 'Could not delete account.'))
    } finally {
      setDeleting(false)
    }
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.bg }]} edges={['left', 'right', 'bottom']}>
      <ScrollView
        style={styles.flex}
        contentContainerStyle={[styles.content, { paddingHorizontal: sp.screenPaddingH, paddingBottom: sp.xl8 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {loading && (
          <View style={styles.centerState}>
            <ActivityIndicator color={c.primary} size="large" />
            <Text style={[styles.stateText, { color: c.textMuted, fontSize: ty.fontSizeBase, marginTop: sp.xl }]}>
              Loading settings…
            </Text>
          </View>
        )}

        {!loading && error !== null && (
          <View style={[styles.errorBox, { backgroundColor: `${c.error}14`, borderColor: `${c.error}33`, borderRadius: r.md }]}>
            <Text style={[styles.errorText, { color: c.error, fontSize: ty.fontSizeBase }]}>{error}</Text>
            <TouchableOpacity
              style={[styles.retryBtn, { backgroundColor: c.primary, borderRadius: r.sm, marginTop: sp.xl }]}
              onPress={() => { void load() }}
              accessibilityRole="button"
              accessibilityLabel="Retry loading settings"
            >
              <Text style={[styles.retryBtnText, { color: '#FFFFFF', fontSize: ty.fontSizeBase }]}>Retry</Text>
            </TouchableOpacity>
          </View>
        )}

        {!loading && error === null && (
          <>
            {/* Account info */}
            <Text style={[styles.sectionTitle, { color: c.textMuted, marginBottom: sp.md }]}>ACCOUNT</Text>
            <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border, borderRadius: r.lg, marginBottom: sp.xl3 }]}>
              <Text style={[styles.rowLabel, { color: c.textMuted }]}>Name</Text>
              <Text style={[styles.rowValue, { color: c.text, marginBottom: sp.md }]}>{user?.name ?? me?.name ?? '—'}</Text>
              <Text style={[styles.rowLabel, { color: c.textMuted }]}>Email</Text>
              <Text style={[styles.rowValue, { color: c.text }]}>{user?.email ?? me?.email ?? '—'}</Text>
            </View>

            {/* Academic profile */}
            <Text style={[styles.sectionTitle, { color: c.textMuted, marginBottom: sp.md }]}>ACADEMIC PROFILE</Text>
            <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border, borderRadius: r.lg, marginBottom: sp.xl3 }]}>
              <Text style={[styles.fieldLabel, { color: c.textSecondary }]}>SAT Score</Text>
              <TextInput
                value={satScore}
                onChangeText={setSatScore}
                keyboardType="number-pad"
                placeholder="e.g. 1350"
                placeholderTextColor={c.textMuted}
                style={[styles.input, { color: c.text, borderColor: c.border, borderRadius: r.sm, marginBottom: sp.lg }]}
                accessibilityLabel="SAT score"
              />
              <Text style={[styles.fieldLabel, { color: c.textSecondary }]}>ACT Score</Text>
              <TextInput
                value={actScore}
                onChangeText={setActScore}
                keyboardType="number-pad"
                placeholder="e.g. 29"
                placeholderTextColor={c.textMuted}
                style={[styles.input, { color: c.text, borderColor: c.border, borderRadius: r.sm, marginBottom: sp.lg }]}
                accessibilityLabel="ACT score"
              />
              <Text style={[styles.fieldLabel, { color: c.textSecondary }]}>College Goal</Text>
              <TextInput
                value={futureDecision}
                onChangeText={setFutureDecision}
                placeholder="e.g. University of Texas"
                placeholderTextColor={c.textMuted}
                style={[styles.input, { color: c.text, borderColor: c.border, borderRadius: r.sm, marginBottom: sp.lg }]}
                accessibilityLabel="College goal"
              />
              <TouchableOpacity
                onPress={() => { void handleSaveProfile() }}
                disabled={savingProfile}
                style={[styles.saveBtn, { backgroundColor: c.primary, borderRadius: r.sm, opacity: savingProfile ? 0.6 : 1 }]}
                accessibilityRole="button"
                accessibilityLabel="Save profile changes"
              >
                {savingProfile ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <Text style={[styles.saveBtnText, { color: '#FFFFFF' }]}>Save Changes</Text>
                )}
              </TouchableOpacity>
              {saveMessage ? (
                <Text style={[styles.saveMessage, { color: saveMessage === 'Saved.' ? c.success : c.error }]}>
                  {saveMessage}
                </Text>
              ) : null}
            </View>

            {/* School portal */}
            <Text style={[styles.sectionTitle, { color: c.textMuted, marginBottom: sp.md }]}>SCHOOL PORTAL</Text>
            <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border, borderRadius: r.lg, marginBottom: sp.xl3 }]}>
              {portal?.connected ? (
                <>
                  <View style={styles.portalStatusRow}>
                    <View style={[styles.statusDot, { backgroundColor: c.success }]} />
                    <Text style={[styles.rowValue, { color: c.text }]}>
                      Connected — {portal.systemType ?? 'Unknown portal'}
                    </Text>
                  </View>
                  {portal.lastSynced ? (
                    <Text style={[styles.rowLabel, { color: c.textMuted, marginTop: sp.sm }]}>
                      Last synced {new Date(portal.lastSynced).toLocaleString()}
                    </Text>
                  ) : null}
                  <TouchableOpacity
                    onPress={() => { void handleDisconnectPortal() }}
                    disabled={disconnecting}
                    style={[styles.outlineBtn, { borderColor: c.error, borderRadius: r.sm, marginTop: sp.xl }]}
                    accessibilityRole="button"
                    accessibilityLabel="Disconnect school portal"
                  >
                    {disconnecting ? (
                      <ActivityIndicator color={c.error} size="small" />
                    ) : (
                      <Text style={[styles.outlineBtnText, { color: c.error }]}>Disconnect</Text>
                    )}
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <View style={styles.portalStatusRow}>
                    <View style={[styles.statusDot, { backgroundColor: c.textMuted }]} />
                    <Text style={[styles.rowValue, { color: c.text }]}>Not connected</Text>
                  </View>
                  <TouchableOpacity
                    onPress={handleReconnectPortal}
                    style={[styles.saveBtn, { backgroundColor: c.primary, borderRadius: r.sm, marginTop: sp.xl }]}
                    accessibilityRole="button"
                    accessibilityLabel="Connect school portal"
                  >
                    <Text style={[styles.saveBtnText, { color: '#FFFFFF' }]}>Connect School Portal</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>

            {/* Log out */}
            <TouchableOpacity
              onPress={() => { void signOut() }}
              style={[styles.outlineBtn, { borderColor: c.border, borderRadius: r.sm, marginBottom: sp.xl2 }]}
              accessibilityRole="button"
              accessibilityLabel="Log out"
            >
              <Text style={[styles.outlineBtnText, { color: c.text }]}>Log out</Text>
            </TouchableOpacity>

            {/* Delete account */}
            <TouchableOpacity
              onPress={() => setShowDeleteModal(true)}
              style={[styles.dangerLink]}
              accessibilityRole="button"
              accessibilityLabel="Delete account"
            >
              <Text style={[styles.dangerLinkText, { color: c.error }]}>Delete Account</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>

      <Modal visible={showDeleteModal} transparent animationType="fade" onRequestClose={() => setShowDeleteModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: c.surface, borderColor: c.border, borderRadius: r.lg }]}>
            <Text style={[styles.modalTitle, { color: c.error }]}>Delete Account</Text>
            <Text style={[styles.modalBody, { color: c.textSecondary }]}>
              This permanently deletes your account and all related data. This cannot be undone.
            </Text>
            {me?.hasPassword && (
              <TextInput
                value={deletePassword}
                onChangeText={setDeletePassword}
                secureTextEntry
                placeholder="Current password"
                placeholderTextColor={c.textMuted}
                style={[styles.input, { color: c.text, borderColor: c.border, borderRadius: r.sm, marginTop: sp.lg }]}
                accessibilityLabel="Current password"
              />
            )}
            {deleteError ? (
              <Text style={[styles.deleteErrorText, { color: c.error }]}>{deleteError}</Text>
            ) : null}
            <View style={styles.modalActions}>
              <TouchableOpacity
                onPress={() => { setShowDeleteModal(false); setDeletePassword(''); setDeleteError(null) }}
                style={[styles.modalBtn, { borderColor: c.border, borderRadius: r.sm }]}
                accessibilityRole="button"
                accessibilityLabel="Cancel account deletion"
              >
                <Text style={{ color: c.text, fontWeight: '600' }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => { void handleDeleteAccount() }}
                disabled={deleting}
                style={[styles.modalBtn, { backgroundColor: c.error, borderColor: c.error, borderRadius: r.sm, opacity: deleting ? 0.6 : 1 }]}
                accessibilityRole="button"
                accessibilityLabel="Confirm account deletion"
              >
                {deleting ? <ActivityIndicator color="#FFFFFF" size="small" /> : <Text style={{ color: '#FFFFFF', fontWeight: '600' }}>Delete</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe:    { flex: 1 },
  flex:    { flex: 1 },
  content: { flexGrow: 1, paddingTop: 24 },

  sectionTitle: { fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.6 },
  card:    { borderWidth: 1, padding: 16 },

  rowLabel: { fontSize: 12, fontWeight: '600' },
  rowValue: { fontSize: 15, fontWeight: '500', marginTop: 2 },

  fieldLabel: { fontSize: 12, fontWeight: '600', marginBottom: 6 },
  input:      { height: 44, borderWidth: 1, paddingHorizontal: 12, fontSize: 15 },

  saveBtn:     { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  saveBtnText: { fontSize: 15, fontWeight: '600' },
  saveMessage: { fontSize: 13, marginTop: 10 },

  portalStatusRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusDot:       { width: 8, height: 8, borderRadius: 4 },

  outlineBtn:     { minHeight: 44, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  outlineBtnText: { fontSize: 15, fontWeight: '600' },

  dangerLink:     { minHeight: 44, justifyContent: 'center', alignItems: 'center' },
  dangerLinkText: { fontSize: 14, fontWeight: '600' },

  centerState: { alignItems: 'center', paddingVertical: 64 },
  stateText:   { textAlign: 'center' },

  errorBox:    { padding: 16, borderWidth: 1, marginTop: 24 },
  errorText:   { lineHeight: 22 },
  retryBtn:    { alignSelf: 'flex-start', paddingHorizontal: 20, paddingVertical: 10, minHeight: 44 },
  retryBtnText:{ fontWeight: '600' },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  modalCard:    { width: '100%', maxWidth: 400, borderWidth: 1, padding: 20 },
  modalTitle:   { fontSize: 18, fontWeight: '800', marginBottom: 8 },
  modalBody:    { fontSize: 14, lineHeight: 20 },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 18 },
  modalBtn:     { flex: 1, minHeight: 44, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  deleteErrorText: { fontSize: 13, marginTop: 8 },
})
