import React, { useMemo, useState } from 'react'
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { useAuth } from '../context/AuthContext'
import * as gradesApi from '../api/gradesApi'
import { ApiRequestError } from '../api/client'
import { Screen } from '../components/ui/Screen'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { Card } from '../components/ui/Card'
import { FuturelyLogo } from '../components/ui/FuturelyLogo'
import { SORTED_ISD_LIST, type ISDEntry } from '../constants/isds'
import { colors, radii, spacing, typography } from '../theme/tokens'

// Mirrors SettingsScreen's normalizeCanvasUrl — force HTTPS on a hand-typed portal
// URL so credentials never submit over an unencrypted scheme.
function normalizeHacUrl(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  return withProtocol.replace(/^http:\/\//i, 'https://').replace(/\/+$/, '')
}

export default function ConnectSchoolScreen(): React.JSX.Element {
  const { markPortalConnected, signOut } = useAuth()

  const [search, setSearch] = useState('')
  const [selectedDistrict, setSelectedDistrict] = useState<ISDEntry | null>(null)
  const [isdOpen, setIsdOpen] = useState(false)
  const [useCustomUrl, setUseCustomUrl] = useState(false)
  const [customUrl, setCustomUrl] = useState('')

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const filteredDistricts = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return SORTED_ISD_LIST
    return SORTED_ISD_LIST.filter((d) => d.name.toLowerCase().includes(q))
  }, [search])

  const baseUrl = useCustomUrl ? normalizeHacUrl(customUrl) : selectedDistrict?.hacUrl

  function selectDistrict(item: ISDEntry): void {
    setSelectedDistrict(item)
    setSearch(item.name)
    setIsdOpen(false)
  }

  async function handleSubmit(): Promise<void> {
    setError(null)

    if (!baseUrl) {
      setError('Choose your district or enter a custom URL.')
      return
    }
    if (!username.trim() || !password) {
      setError('Enter your portal username and password.')
      return
    }

    setSubmitting(true)
    try {
      // Every district in the list resolves to Home Access Center — the backend
      // has no per-district portal lookup, and (matching web's registration
      // flow) PowerSchool is only ever reached by hand-entering a custom URL,
      // which isn't exposed here to keep district selection portal-agnostic.
      await gradesApi.hacLogin({ baseUrl, username: username.trim(), password })
      // Best-effort initial sync — connection already succeeded even if this fails,
      // so we don't block on it; the user can re-sync from Dashboard/Settings.
      await gradesApi.syncProfile().catch(() => undefined)
      markPortalConnected()
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not connect. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Screen edges={['top', 'left', 'right', 'bottom']}>
      <View style={styles.header}>
        <FuturelyLogo size={48} />
        <Text style={styles.title}>Connect your school portal</Text>
        <Text style={styles.subtitle}>
          Link your school account so Futurely can show your real grades, schedule, and more.
        </Text>
      </View>

      <Button
        label="Sign out"
        onPress={() => void signOut()}
        variant="secondary"
        style={styles.signOutButton}
      />

      <View style={styles.form}>
        {!useCustomUrl ? (
          <>
            <Input
              label="Search your district"
              value={search}
              onChangeText={(text) => {
                setSearch(text)
                setSelectedDistrict(null)
                setIsdOpen(true)
              }}
              onFocus={() => setIsdOpen(true)}
              placeholder="e.g. Katy ISD"
            />
            {isdOpen ? (
              <FlatList
                data={filteredDistricts}
                keyExtractor={(item) => item.name}
                style={styles.list}
                keyboardShouldPersistTaps="handled"
                renderItem={({ item }) => (
                  <Pressable onPress={() => selectDistrict(item)} style={styles.districtRow}>
                    <Text style={styles.districtName}>{item.name}</Text>
                    <Text style={styles.districtState}>{item.state}</Text>
                  </Pressable>
                )}
                ListEmptyComponent={<Text style={styles.subtitle}>No matching district.</Text>}
              />
            ) : null}
            <Button label="My district isn't listed" onPress={() => setUseCustomUrl(true)} variant="secondary" />
          </>
        ) : (
          <>
            <Input
              label="District portal URL"
              value={customUrl}
              onChangeText={setCustomUrl}
              placeholder="https://hac.yourdistrict.org"
              autoCapitalize="none"
            />
            <Button label="Pick from list instead" onPress={() => setUseCustomUrl(false)} variant="secondary" />
          </>
        )}
      </View>

      <Card style={styles.credentialsCard}>
        <Input label="Username" value={username} onChangeText={setUsername} autoCapitalize="none" />
        <Input label="Password" value={password} onChangeText={setPassword} secureTextEntry />
      </Card>

      <View style={styles.securityNote}>
        <Feather name="shield" size={14} color={colors.success} />
        <Text style={styles.securityNoteText}>
          Your school login is sent directly to your portal to connect your account — it is not shared anywhere
          else.
        </Text>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Button label="Connect securely" onPress={() => void handleSubmit()} loading={submitting} />
    </Screen>
  )
}

const styles = StyleSheet.create({
  header: { alignItems: 'center', gap: spacing.sm, marginBottom: spacing.lg },
  title: {
    fontSize: typography.h1.fontSize,
    fontWeight: typography.h1.fontWeight,
    color: colors.text,
    textAlign: 'center',
  },
  subtitle: { fontSize: typography.body.fontSize, color: colors.textSecondary, textAlign: 'center' },
  securityNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: 'rgba(0, 212, 146, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(0, 212, 146, 0.25)',
    borderRadius: radii.md,
    padding: spacing.ms,
    marginBottom: spacing.md,
  },
  securityNoteText: { ...typography.caption, color: colors.success, flex: 1, lineHeight: 17 },
  form: { gap: spacing.sm, marginBottom: spacing.md },
  list: { maxHeight: 220, marginBottom: spacing.sm },
  districtRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.sm,
  },
  districtName: { fontSize: typography.body.fontSize, color: colors.text },
  districtState: { fontSize: typography.caption.fontSize, color: colors.textSecondary },
  credentialsCard: { gap: spacing.sm, marginBottom: spacing.md },
  error: { fontSize: typography.caption.fontSize, color: colors.error, marginBottom: spacing.md },
  signOutButton: { alignSelf: 'flex-end', height: 32, paddingHorizontal: spacing.sm, marginBottom: spacing.sm },
})
