import React, { useMemo, useState } from 'react'
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native'
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

type PortalType = 'HAC' | 'PowerSchool'

export default function ConnectSchoolScreen(): React.JSX.Element {
  const { markPortalConnected, signOut } = useAuth()
  const [portalType, setPortalType] = useState<PortalType>('HAC')

  // HAC state
  const [search, setSearch] = useState('')
  const [selectedDistrict, setSelectedDistrict] = useState<ISDEntry | null>(null)
  const [useCustomUrl, setUseCustomUrl] = useState(false)
  const [customUrl, setCustomUrl] = useState('')

  // PowerSchool state
  const [psBaseUrl, setPsBaseUrl] = useState('')

  // Shared credential state
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const filteredDistricts = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return SORTED_ISD_LIST
    return SORTED_ISD_LIST.filter((d) => d.name.toLowerCase().includes(q))
  }, [search])

  const hacBaseUrl = useCustomUrl ? customUrl.trim() : selectedDistrict?.hacUrl

  async function handleSubmit(): Promise<void> {
    setError(null)
    const baseUrl = portalType === 'HAC' ? hacBaseUrl : psBaseUrl.trim()

    if (!baseUrl) {
      setError(portalType === 'HAC' ? 'Choose your district or enter a custom URL.' : 'Enter your district URL.')
      return
    }
    if (!username.trim() || !password) {
      setError('Enter your portal username and password.')
      return
    }

    setSubmitting(true)
    try {
      if (portalType === 'HAC') {
        await gradesApi.hacLogin({ baseUrl, username: username.trim(), password })
      } else {
        await gradesApi.powerSchoolLogin({ baseUrl, username: username.trim(), password })
      }
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

      <View style={styles.tabRow}>
        <Button
          label="HAC"
          onPress={() => setPortalType('HAC')}
          variant={portalType === 'HAC' ? 'primary' : 'secondary'}
          style={styles.tabButton}
        />
        <Button
          label="PowerSchool"
          onPress={() => setPortalType('PowerSchool')}
          variant={portalType === 'PowerSchool' ? 'primary' : 'secondary'}
          style={styles.tabButton}
        />
      </View>

      {portalType === 'HAC' ? (
        <View style={styles.form}>
          {!useCustomUrl ? (
            <>
              <Input
                label="Search your district"
                value={search}
                onChangeText={setSearch}
                placeholder="e.g. Katy ISD"
              />
              <FlatList
                data={filteredDistricts}
                keyExtractor={(item) => item.name}
                style={styles.list}
                keyboardShouldPersistTaps="handled"
                renderItem={({ item }) => (
                  <Pressable
                    onPress={() => setSelectedDistrict(item)}
                    style={[styles.districtRow, selectedDistrict?.name === item.name && styles.districtRowSelected]}
                  >
                    <Text style={styles.districtName}>{item.name}</Text>
                    <Text style={styles.districtState}>{item.state}</Text>
                  </Pressable>
                )}
                ListEmptyComponent={<Text style={styles.subtitle}>No matching district.</Text>}
              />
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
      ) : (
        <View style={styles.form}>
          <Input
            label="District portal URL"
            value={psBaseUrl}
            onChangeText={setPsBaseUrl}
            placeholder="https://yourdistrict.powerschool.com"
            autoCapitalize="none"
          />
        </View>
      )}

      <Card style={styles.credentialsCard}>
        <Input label="Username" value={username} onChangeText={setUsername} autoCapitalize="none" />
        <Input label="Password" value={password} onChangeText={setPassword} secureTextEntry />
      </Card>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Button label="Connect" onPress={() => void handleSubmit()} loading={submitting} />
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
  tabRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  tabButton: { flex: 1 },
  form: { gap: spacing.sm, marginBottom: spacing.md },
  list: { maxHeight: 220, marginBottom: spacing.sm },
  districtRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.sm,
  },
  districtRowSelected: { backgroundColor: colors.primaryDim },
  districtName: { fontSize: typography.body.fontSize, color: colors.text },
  districtState: { fontSize: typography.caption.fontSize, color: colors.textSecondary },
  credentialsCard: { gap: spacing.sm, marginBottom: spacing.md },
  error: { fontSize: typography.caption.fontSize, color: colors.error, marginBottom: spacing.md },
  signOutButton: { alignSelf: 'flex-end', height: 32, paddingHorizontal: spacing.sm, marginBottom: spacing.sm },
})
