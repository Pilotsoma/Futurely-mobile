// ContactTeachersScreen — teacher contact info for each of the student's classes.
//
// Endpoint: GET /integrations/grades/contact-teachers (HAC only, 24h cache)
// Response: { teachers?: [{ name, email, courseName, period }] }
// PowerSchool connections receive a 400 UNSUPPORTED error — handled below.

import React, { useCallback, useState } from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Linking,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useFocusEffect } from '@react-navigation/native'
import { useTheme } from '../../theme/ThemeContext'
import { useAuth } from '../../context/AuthContext'
import { getContactTeachers } from '../../api/gradesApi'
import type { TeacherContact } from '../../api/gradesApi'
import { ApiRequestError } from '../../api/client'

function extractMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiRequestError) {
    if (err.code === 'UNSUPPORTED') {
      return 'Contact Teachers is only available for Home Access Center (HAC) connections.'
    }
    return err.message
  }
  if (err instanceof Error) return err.message
  return fallback
}

export default function ContactTeachersScreen(): React.JSX.Element {
  const { theme } = useTheme()
  const { accessToken } = useAuth()

  const [teachers, setTeachers] = useState<TeacherContact[]>([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)

  const c  = theme.colors
  const sp = theme.spacing
  const r  = theme.radius
  const ty = theme.typography

  const load = useCallback(async (): Promise<void> => {
    if (!accessToken) return
    setLoading(true)
    setError(null)
    try {
      const result = await getContactTeachers(accessToken)
      setTeachers(result.teachers ?? [])
    } catch (err: unknown) {
      setError(extractMessage(err, 'Could not load teacher contacts. Please try again.'))
    } finally {
      setLoading(false)
    }
  }, [accessToken])

  useFocusEffect(
    useCallback(() => { void load() }, [load]),
  )

  function renderTeacher(teacher: TeacherContact, i: number): React.JSX.Element {
    const initial = (teacher.name ?? '?').trim().charAt(0).toUpperCase() || '?'
    return (
      <View
        key={i}
        style={[styles.card, { backgroundColor: c.surface, borderColor: c.border, borderRadius: r.lg, marginBottom: sp.md }]}
      >
        <View style={[styles.avatar, { backgroundColor: c.primaryDim, borderColor: c.primaryGlow }]}>
          <Text style={[styles.avatarText, { color: c.primary }]}>{initial}</Text>
        </View>
        <View style={styles.info}>
          <Text style={[styles.name, { color: c.text, fontSize: ty.fontSizeBase }]} numberOfLines={1}>
            {teacher.name ?? 'Unknown Teacher'}
          </Text>
          <Text style={[styles.course, { color: c.textMuted, fontSize: ty.fontSizeSm }]} numberOfLines={1}>
            {[teacher.courseName, teacher.period ? `Period ${teacher.period}` : null].filter(Boolean).join(' · ') || 'No course listed'}
          </Text>
        </View>
        {teacher.email ? (
          <TouchableOpacity
            style={[styles.emailBtn, { backgroundColor: c.primary, borderRadius: r.sm, minHeight: sp.touchTarget, minWidth: sp.touchTarget }]}
            onPress={() => { void Linking.openURL(`mailto:${teacher.email}`) }}
            accessibilityRole="button"
            accessibilityLabel={`Email ${teacher.name ?? 'teacher'}`}
          >
            <Text style={[styles.emailBtnText, { color: '#FFFFFF' }]}>✉️</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    )
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.bg }]} edges={['left', 'right', 'bottom']}>
      <ScrollView
        style={styles.flex}
        contentContainerStyle={[styles.content, { paddingHorizontal: sp.screenPaddingH, paddingBottom: sp.xl8 }]}
        showsVerticalScrollIndicator={false}
      >
        {loading && (
          <View style={styles.centerState}>
            <ActivityIndicator color={c.primary} size="large" />
            <Text style={[styles.stateText, { color: c.textMuted, fontSize: ty.fontSizeBase, marginTop: sp.xl }]}>
              Loading teacher contacts…
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
              accessibilityLabel="Retry loading teacher contacts"
            >
              <Text style={[styles.retryBtnText, { color: '#FFFFFF', fontSize: ty.fontSizeBase }]}>Retry</Text>
            </TouchableOpacity>
          </View>
        )}

        {!loading && error === null && (
          teachers.length > 0 ? (
            teachers.map((t, i) => renderTeacher(t, i))
          ) : (
            <View style={styles.centerState}>
              <Text style={{ fontSize: 40, marginBottom: sp.lg, textAlign: 'center' }}>✉️</Text>
              <Text style={[styles.stateText, { color: c.textMuted, fontSize: ty.fontSizeBase }]}>
                No teacher contacts found.
              </Text>
            </View>
          )
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe:    { flex: 1 },
  flex:    { flex: 1 },
  content: { flexGrow: 1, paddingTop: 16 },

  card:    { flexDirection: 'row', alignItems: 'center', borderWidth: 1, padding: 14, gap: 12 },
  avatar:  { width: 44, height: 44, borderRadius: 22, borderWidth: 1, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  avatarText: { fontSize: 17, fontWeight: '700' },
  info:    { flex: 1, minWidth: 0 },
  name:    { fontWeight: '600', lineHeight: 20 },
  course:  { marginTop: 2, lineHeight: 16 },
  emailBtn:{ alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  emailBtnText: { fontSize: 18 },

  centerState: { alignItems: 'center', paddingVertical: 64 },
  stateText:   { textAlign: 'center', lineHeight: 22 },

  errorBox:    { padding: 16, borderWidth: 1, marginTop: 24 },
  errorText:   { lineHeight: 22 },
  retryBtn:    { alignSelf: 'flex-start', paddingHorizontal: 20, paddingVertical: 10, minHeight: 44 },
  retryBtnText:{ fontWeight: '600' },
})
