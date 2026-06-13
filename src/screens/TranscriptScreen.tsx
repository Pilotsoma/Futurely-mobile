import React, { useCallback, useState } from 'react'
import {
  SectionList,
  StyleSheet,
  View,
} from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import Text from '../components/ui/Text'
import Button from '../components/ui/Button'
import Skeleton from '../components/ui/Skeleton'
import ScreenHeader from '../components/ui/ScreenHeader'
import { colors } from '../constants/colors'
import { fetchStudentData, type CourseWithGrade, type StudentData } from '../api/studentApi'

const GRADE_COLORS: Record<string, string> = {
  A: '#3FB950', B: '#00C896', C: '#D29922', D: '#F0883E', F: '#F85149',
}

function gradeColor(letter: string): string {
  return GRADE_COLORS[letter.charAt(0).toUpperCase()] ?? colors.textMuted
}

function formatSemester(s: string): string {
  const [year, term] = s.split('-')
  if (!year || !term) return s
  if (term === 'FA') return `Fall ${year}`
  if (term === 'SP') return `Spring ${year}`
  if (term === 'SU') return `Summer ${year}`
  return s
}

function groupBySemester(courses: CourseWithGrade[]): { title: string; data: CourseWithGrade[] }[] {
  const map = new Map<string, CourseWithGrade[]>()
  for (const c of courses) {
    const sem = c.semester || 'Unknown'
    const arr = map.get(sem) ?? []
    arr.push(c)
    map.set(sem, arr)
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([sem, data]) => ({ title: formatSemester(sem), data }))
}

function LoadingSkeleton(): React.JSX.Element {
  return (
    <View style={{ padding: 20 }}>
      {[1, 2, 3, 4, 5].map(i => (
        <Skeleton key={i} width="100%" height={44} style={{ marginBottom: 8, borderRadius: 8 }} />
      ))}
    </View>
  )
}

function ErrorView({ message, onRetry }: { message: string; onRetry: () => void }): React.JSX.Element {
  return (
    <View style={styles.centerState}>
      <Text variant="h3" color={colors.error} style={styles.stateText}>Unable to Load Transcript</Text>
      <Text variant="body" color={colors.textSecondary} style={styles.stateText}>{message}</Text>
      <Button label="Try Again" onPress={onRetry} />
    </View>
  )
}

export default function TranscriptScreen(): React.JSX.Element {
  const [data, setData] = useState<StudentData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    setIsLoading(true)
    setError(null)
    try {
      setData(await fetchStudentData())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load transcript.')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useFocusEffect(useCallback(() => { void load() }, [load]))

  const courses = data?.courses ?? []
  const sections = groupBySemester(courses)
  const totalCredits = courses.filter(c => c.grade && c.grade.letterGrade !== 'F').length
  const uGpa = (data?.profile?.unweightedGpa ?? 0).toFixed(2)
  const wGpa = (data?.profile?.weightedGpa ?? 0).toFixed(2)

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScreenHeader title="Transcript" />
      {isLoading ? (
        <LoadingSkeleton />
      ) : error !== null ? (
        <ErrorView message={error} onRetry={() => void load()} />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id.toString()}
          renderSectionHeader={({ section }) => (
            <View style={styles.sectionHeader}>
              <Text variant="h3">{section.title}</Text>
            </View>
          )}
          renderItem={({ item }) => (
            <View style={styles.courseRow}>
              <Text variant="body" style={{ flex: 1 }}>{item.name}</Text>
              {item.grade ? (
                <Text style={[styles.letterGrade, { color: gradeColor(item.grade.letterGrade) }]}>
                  {item.grade.letterGrade}
                </Text>
              ) : (
                <Text variant="caption">—</Text>
              )}
              <Text variant="caption" style={styles.credits}>1.0 cr</Text>
            </View>
          )}
          ListFooterComponent={
            <View style={styles.footer}>
              <Text variant="label" color={colors.textSecondary} style={{ marginBottom: 8 }}>
                Cumulative GPA
              </Text>
              <View style={styles.gpaRow}>
                <Text variant="body">Unweighted: <Text style={{ color: colors.textPrimary, fontWeight: '700' }}>{uGpa}</Text></Text>
                <Text variant="body" style={{ marginLeft: 16 }}>Weighted: <Text style={{ color: colors.primary, fontWeight: '700' }}>{wGpa}</Text></Text>
              </View>
              <Text variant="caption" style={{ marginTop: 8 }}>Total Credits Earned: {totalCredits}</Text>
            </View>
          }
          contentContainerStyle={{ paddingBottom: 40 }}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  centerState: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  stateText: { textAlign: 'center', marginBottom: 8 },
  sectionHeader: {
    backgroundColor: colors.surface,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  courseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  letterGrade: { fontSize: 14, fontWeight: '700', marginRight: 12 },
  credits: { minWidth: 44, textAlign: 'right' },
  footer: {
    margin: 20,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
  },
  gpaRow: { flexDirection: 'row', flexWrap: 'wrap' },
})
