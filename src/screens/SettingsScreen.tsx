import React, { useCallback, useState } from 'react'
import { ScrollView, StyleSheet, Text } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import { useAuth } from '../context/AuthContext'
import * as studentsApi from '../api/studentsApi'
import * as gradesApi from '../api/gradesApi'
import { ApiRequestError } from '../api/client'
import { Screen } from '../components/ui/Screen'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { LoadingSkeleton } from '../components/ui/LoadingSkeleton'
import { ErrorRetryBlock } from '../components/ui/ErrorRetryBlock'
import type { PortalStatus } from '../types/grades'
import type { StudentMe } from '../types/student'
import { colors, spacing, typography } from '../theme/tokens'

export default function SettingsScreen(): React.JSX.Element {
  const { user, signOut, deleteAccount } = useAuth()
  const [student, setStudent] = useState<StudentMe | null>(null)
  const [portalStatus, setPortalStatus] = useState<PortalStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [satScore, setSatScore] = useState('')
  const [actScore, setActScore] = useState('')
  const [futureDecision, setFutureDecision] = useState('')
  const [savingProfile, setSavingProfile] = useState(false)
  const [profileSaved, setProfileSaved] = useState(false)

  const [disconnecting, setDisconnecting] = useState(false)

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deletePassword, setDeletePassword] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const [studentResult, statusResult] = await Promise.all([studentsApi.getMe(), gradesApi.getPortalStatus()])
      setStudent(studentResult)
      setPortalStatus(statusResult)
      setSatScore(studentResult.profile?.satScore != null ? String(studentResult.profile.satScore) : '')
      setActScore(studentResult.profile?.actScore != null ? String(studentResult.profile.actScore) : '')
      setFutureDecision(studentResult.profile?.futureDecision ?? '')
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not load your settings.')
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
    setSavingProfile(true)
    setProfileSaved(false)
    try {
      await studentsApi.updateProfile({
        satScore: satScore.trim() ? Number(satScore) : null,
        actScore: actScore.trim() ? Number(actScore) : null,
        futureDecision: futureDecision.trim() || null,
      })
      setProfileSaved(true)
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not save your profile.')
    } finally {
      setSavingProfile(false)
    }
  }

  async function handleDisconnectPortal(): Promise<void> {
    setDisconnecting(true)
    try {
      await gradesApi.disconnectPortal()
      await load()
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not disconnect your school portal.')
    } finally {
      setDisconnecting(false)
    }
  }

  async function handleDeleteAccount(): Promise<void> {
    setDeleteError(null)
    setDeleting(true)
    try {
      await deleteAccount(deletePassword || undefined)
    } catch (err) {
      setDeleteError(err instanceof ApiRequestError ? err.message : 'Could not delete your account.')
    } finally {
      setDeleting(false)
    }
  }

  if (loading) {
    return (
      <Screen>
        <LoadingSkeleton rows={4} />
      </Screen>
    )
  }

  if (error && !student) {
    return (
      <Screen>
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

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>Settings</Text>
        <Text style={styles.email}>{user?.email}</Text>

        <Card style={styles.card}>
          <Text style={styles.cardTitle}>College Profile</Text>
          <Input label="SAT Score" value={satScore} onChangeText={setSatScore} keyboardType="number-pad" />
          <Input label="ACT Score" value={actScore} onChangeText={setActScore} keyboardType="number-pad" />
          <Input label="College Goal" value={futureDecision} onChangeText={setFutureDecision} />
          {profileSaved ? <Text style={styles.success}>Saved!</Text> : null}
          <Button label="Save" onPress={() => void handleSaveProfile()} loading={savingProfile} />
        </Card>

        <Card style={styles.card}>
          <Text style={styles.cardTitle}>School Portal</Text>
          <Text style={styles.portalStatus}>
            {portalStatus?.connected ? `Connected · ${portalStatus.systemType ?? ''}` : 'Not connected'}
          </Text>
          {portalStatus?.connected ? (
            <Button
              label="Disconnect"
              onPress={() => void handleDisconnectPortal()}
              loading={disconnecting}
              variant="destructive"
            />
          ) : null}
        </Card>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Card style={styles.card}>
          <Button label="Log out" onPress={() => void signOut()} variant="secondary" />
        </Card>

        <Card style={styles.dangerCard}>
          <Text style={styles.cardTitle}>Danger Zone</Text>
          {!showDeleteConfirm ? (
            <Button label="Delete account" onPress={() => setShowDeleteConfirm(true)} variant="destructive" />
          ) : (
            <>
              <Text style={styles.dangerText}>
                This permanently deletes your account and all data. This cannot be undone.
              </Text>
              <Input
                label="Confirm your password"
                value={deletePassword}
                onChangeText={setDeletePassword}
                secureTextEntry
              />
              {deleteError ? <Text style={styles.error}>{deleteError}</Text> : null}
              <Button
                label="Permanently delete my account"
                onPress={() => void handleDeleteAccount()}
                loading={deleting}
                variant="destructive"
              />
              <Button label="Cancel" onPress={() => setShowDeleteConfirm(false)} variant="secondary" />
            </>
          )}
        </Card>
      </ScrollView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  scroll: { gap: spacing.md, paddingVertical: spacing.lg },
  title: { ...typography.h1, color: colors.text },
  email: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.sm },
  card: { gap: spacing.sm },
  cardTitle: { ...typography.h3, color: colors.text },
  portalStatus: { ...typography.body, color: colors.textSecondary },
  success: { ...typography.caption, color: colors.success },
  error: { ...typography.caption, color: colors.error },
  dangerCard: { gap: spacing.sm, borderColor: colors.error },
  dangerText: { ...typography.caption, color: colors.textSecondary },
})
