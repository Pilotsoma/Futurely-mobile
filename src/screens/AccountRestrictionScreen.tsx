import React, { useState } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { Feather } from '@expo/vector-icons'

import { ApiRequestError } from '../api/client'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { Screen } from '../components/ui/Screen'
import { useAuth } from '../context/AuthContext'
import { colors, radii, spacing, typography } from '../theme/tokens'

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export default function AccountRestrictionScreen(): React.JSX.Element {
  const { user, updateDateOfBirth, signOut } = useAuth()
  const [dateOfBirth, setDateOfBirth] = useState('')
  const [error, setError] = useState<string>()
  const [loading, setLoading] = useState(false)

  const isBanned = user?.accountStatus === 'UNDER_13_BANNED'

  async function submitDateOfBirth(): Promise<void> {
    if (!ISO_DATE_PATTERN.test(dateOfBirth)) {
      setError('Enter your date of birth as YYYY-MM-DD.')
      return
    }

    setError(undefined)
    setLoading(true)
    try {
      await updateDateOfBirth(dateOfBirth)
    } catch (submissionError) {
      setError(
        submissionError instanceof ApiRequestError
          ? submissionError.message
          : 'We could not update your date of birth. Please try again.',
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <Screen edges={['top', 'left', 'right', 'bottom']}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View style={[styles.icon, isBanned && styles.iconBanned]}>
          <Feather
            name={isBanned ? 'shield' : 'calendar'}
            size={28}
            color={isBanned ? colors.error : colors.primary}
          />
        </View>

        <Text style={styles.title}>
          {isBanned ? 'Account temporarily restricted' : 'Confirm your date of birth'}
        </Text>
        <Text style={styles.description}>
          {isBanned
            ? 'This account is restricted by the age requirements for student accounts.'
            : 'We need a valid date of birth before you can continue. It may be checked against your school record after you connect your portal.'}
        </Text>

        {isBanned ? (
          user?.bannedUntilDate ? (
            <Text style={styles.detail}>
              Restriction scheduled through {new Date(user.bannedUntilDate).toLocaleDateString()}.
            </Text>
          ) : null
        ) : (
          <View style={styles.form}>
            <Input
              label="Date of birth"
              value={dateOfBirth}
              onChangeText={setDateOfBirth}
              placeholder="YYYY-MM-DD"
              keyboardType="numbers-and-punctuation"
              autoCapitalize="none"
              maxLength={10}
              error={error}
            />
            <Button
              label="Confirm date of birth"
              onPress={() => void submitDateOfBirth()}
              loading={loading}
            />
          </View>
        )}

        <Button
          label="Sign out"
          variant="secondary"
          onPress={() => void signOut()}
        />
      </ScrollView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    gap: spacing.md,
    paddingVertical: spacing.xxl,
  },
  icon: {
    width: 64,
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    borderRadius: radii.lg,
    backgroundColor: colors.primaryDim,
  },
  iconBanned: {
    backgroundColor: 'rgba(255, 100, 103, 0.12)',
  },
  title: {
    ...typography.h1,
    color: colors.text,
    textAlign: 'center',
  },
  description: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  detail: {
    ...typography.caption,
    color: colors.warning,
    textAlign: 'center',
  },
  form: {
    gap: spacing.md,
    marginVertical: spacing.sm,
  },
})
