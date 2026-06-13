import React, { useCallback, useState } from 'react'
import {
  FlatList,
  StyleSheet,
  View,
} from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import Text from '../components/ui/Text'
import Button from '../components/ui/Button'
import Skeleton from '../components/ui/Skeleton'
import ScreenHeader from '../components/ui/ScreenHeader'
import { colors } from '../constants/colors'
import { fetchStudentData, type CourseWithGrade } from '../api/studentApi'

function LoadingSkeleton(): React.JSX.Element {
  return (
    <View style={{ padding: 20 }}>
      {[1, 2, 3, 4, 5, 6].map(i => (
        <View key={i} style={[styles.row, { opacity: 0.5 }]}>
          <Skeleton width={40} height={40} radius={20} />
          <View style={{ flex: 1, marginLeft: 14 }}>
            <Skeleton width="60%" height={15} style={{ marginBottom: 6 }} />
            <Skeleton width="40%" height={11} />
          </View>
        </View>
      ))}
    </View>
  )
}

function ErrorView({ message, onRetry }: { message: string; onRetry: () => void }): React.JSX.Element {
  return (
    <View style={styles.centerState}>
      <Text variant="h3" color={colors.error} style={styles.stateText}>Unable to Load Schedule</Text>
      <Text variant="body" color={colors.textSecondary} style={styles.stateText}>{message}</Text>
      <Button label="Try Again" onPress={onRetry} />
    </View>
  )
}

function CourseRow({ item, index }: { item: CourseWithGrade; index: number }): React.JSX.Element {
  return (
    <View style={[styles.row, index % 2 === 1 && styles.rowAlt]}>
      <View style={styles.periodBubble}>
        <Text style={styles.periodText}>{item.period}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text variant="h3">{item.name}</Text>
        <Text variant="caption" style={{ marginTop: 2 }}>{item.teacher}</Text>
        <Text variant="caption" color={colors.textMuted} style={{ marginTop: 1 }}>Room TBD</Text>
      </View>
    </View>
  )
}

export default function ClassScheduleScreen(): React.JSX.Element {
  const [courses, setCourses] = useState<CourseWithGrade[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    setIsLoading(true)
    setError(null)
    try {
      const d = await fetchStudentData()
      setCourses([...d.courses].sort((a, b) => a.period - b.period))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load schedule.')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useFocusEffect(useCallback(() => { void load() }, [load]))

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScreenHeader title="Class Schedule" />
      {isLoading ? (
        <LoadingSkeleton />
      ) : error !== null ? (
        <ErrorView message={error} onRetry={() => void load()} />
      ) : (
        <FlatList
          data={courses}
          keyExtractor={item => item.id.toString()}
          renderItem={({ item, index }) => <CourseRow item={item} index={index} />}
          contentContainerStyle={{ paddingBottom: 40 }}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <Text variant="caption" style={{ textAlign: 'center', paddingTop: 40 }}>
              No courses found
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
    gap: 14,
  },
  rowAlt: {
    backgroundColor: colors.surface,
    opacity: 0.8,
  },
  periodBubble: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  periodText: { fontSize: 16, fontWeight: '700' as const, color: colors.background },
})
