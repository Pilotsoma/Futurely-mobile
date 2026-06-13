import React, { useCallback, useState } from 'react'
import {
  Alert,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import Text from '../components/ui/Text'
import Button from '../components/ui/Button'
import Skeleton from '../components/ui/Skeleton'
import ScreenHeader from '../components/ui/ScreenHeader'
import { colors } from '../constants/colors'
import { fetchStudentData } from '../api/studentApi'

interface TeacherEntry {
  name: string
  subject: string
}

function initials(name: string): string {
  return name
    .split(' ')
    .map(w => w.charAt(0).toUpperCase())
    .join('')
    .slice(0, 2)
}

function teacherEmail(name: string): string {
  const parts = name.trim().split(' ')
  const first = parts[0] ?? ''
  const last = parts[parts.length - 1] ?? ''
  return `${first.charAt(0).toLowerCase()}.${last.toLowerCase()}@slhs.edu`
}

function showContactAlert(name: string): void {
  Alert.alert('Contact Teacher', `Email: ${teacherEmail(name)}`)
}

function LoadingSkeleton(): React.JSX.Element {
  return (
    <View style={{ padding: 20 }}>
      {[1, 2, 3].map(i => (
        <View key={i} style={[styles.row, { marginBottom: 8 }]}>
          <Skeleton width={44} height={44} radius={22} />
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Skeleton width="50%" height={15} style={{ marginBottom: 6 }} />
            <Skeleton width="35%" height={11} />
          </View>
        </View>
      ))}
    </View>
  )
}

function ErrorView({ message, onRetry }: { message: string; onRetry: () => void }): React.JSX.Element {
  return (
    <View style={styles.centerState}>
      <Text variant="h3" color={colors.error} style={styles.stateText}>Unable to Load Teachers</Text>
      <Text variant="body" color={colors.textSecondary} style={styles.stateText}>{message}</Text>
      <Button label="Try Again" onPress={onRetry} />
    </View>
  )
}

function TeacherRow({ teacher }: { teacher: TeacherEntry }): React.JSX.Element {
  return (
    <TouchableOpacity
      style={styles.row}
      onPress={() => showContactAlert(teacher.name)}
      activeOpacity={0.75}
    >
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{initials(teacher.name)}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text variant="h3">{teacher.name}</Text>
        <Text variant="caption" style={{ marginTop: 2 }}>{teacher.subject}</Text>
      </View>
      <View style={styles.inBadge}>
        <Text style={styles.inText}>IN</Text>
      </View>
      <TouchableOpacity
        onPress={() => showContactAlert(teacher.name)}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Text style={styles.emailBtn}>Email</Text>
      </TouchableOpacity>
    </TouchableOpacity>
  )
}

export default function ContactTeachersScreen(): React.JSX.Element {
  const [teachers, setTeachers] = useState<TeacherEntry[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    setIsLoading(true)
    setError(null)
    try {
      const d = await fetchStudentData()
      const seen = new Set<string>()
      const unique: TeacherEntry[] = []
      for (const c of d.courses) {
        if (!seen.has(c.teacher)) {
          seen.add(c.teacher)
          unique.push({ name: c.teacher, subject: c.name })
        }
      }
      setTeachers(unique)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load teachers.')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useFocusEffect(useCallback(() => { void load() }, [load]))

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScreenHeader title="Contact Teachers" />
      {isLoading ? (
        <LoadingSkeleton />
      ) : error !== null ? (
        <ErrorView message={error} onRetry={() => void load()} />
      ) : (
        <FlatList
          data={teachers}
          keyExtractor={item => item.name}
          renderItem={({ item }) => <TeacherRow teacher={item} />}
          contentContainerStyle={{ paddingBottom: 40 }}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <Text variant="caption" style={{ textAlign: 'center', paddingTop: 40 }}>
              No teachers found
            </Text>
          }
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  centerState: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  stateText: { textAlign: 'center', marginBottom: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: 12,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  avatarText: { fontSize: 16, fontWeight: '700', color: colors.background },
  inBadge: {
    width: 22,
    height: 22,
    borderRadius: 4,
    backgroundColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inText: { fontSize: 10, fontWeight: '700', color: colors.textMuted },
  emailBtn: { fontSize: 13, color: colors.primary, fontWeight: '500' as const },
})
