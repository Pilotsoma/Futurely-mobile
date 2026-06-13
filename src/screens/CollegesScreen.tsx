import React, { useCallback, useState } from 'react'
import {
  ScrollView,
  StyleSheet,
  View,
} from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import { Ionicons } from '@expo/vector-icons'
import Text from '../components/ui/Text'
import Skeleton from '../components/ui/Skeleton'
import ScreenHeader from '../components/ui/ScreenHeader'
import { colors } from '../constants/colors'
import { fetchStudentData, type StudentData } from '../api/studentApi'

interface SampleCollege {
  name: string
  location: string
  acceptance: string
}

const SAMPLE_COLLEGES: SampleCollege[] = [
  { name: 'University of Texas at Austin', location: 'Austin, TX', acceptance: '31%' },
  { name: 'Texas A&M University', location: 'College Station, TX', acceptance: '57%' },
  { name: 'University of Houston', location: 'Houston, TX', acceptance: '62%' },
]

function CollegeCard({ college }: { college: SampleCollege }): React.JSX.Element {
  return (
    <View style={styles.collegeCard}>
      <View style={styles.collegeLocked}>
        <Ionicons name="lock-closed" size={18} color={colors.textMuted} />
        <Text variant="caption" style={{ marginLeft: 6, marginTop: 2 }}>Phase 2 feature</Text>
      </View>
      <View style={{ opacity: 0.4 }}>
        <Text variant="h3">{college.name}</Text>
        <Text variant="caption" style={{ marginTop: 4 }}>{college.location}</Text>
        <Text variant="caption" style={{ marginTop: 2 }}>Acceptance: {college.acceptance}</Text>
      </View>
    </View>
  )
}

export default function CollegesScreen(): React.JSX.Element {
  const [data, setData] = useState<StudentData | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const load = useCallback(async (): Promise<void> => {
    setIsLoading(true)
    try {
      setData(await fetchStudentData())
    } catch {
      // silently fail — show placeholder anyway
    } finally {
      setIsLoading(false)
    }
  }, [])

  useFocusEffect(useCallback(() => { void load() }, [load]))

  const uGpa = (data?.profile?.unweightedGpa ?? 0).toFixed(2)
  const futureDecision = data?.profile?.futureDecision ?? null

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScreenHeader title="Colleges" />
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <Text variant="heading" style={{ marginBottom: 16 }}>Colleges</Text>

        {/* Context card */}
        <View style={styles.card}>
          <Text variant="label" color={colors.textSecondary} style={{ marginBottom: 8 }}>
            Your Profile
          </Text>
          {isLoading ? (
            <>
              <Skeleton width="60%" height={15} style={{ marginBottom: 8 }} />
              <Skeleton width="80%" height={11} />
            </>
          ) : (
            <>
              <Text variant="body">GPA: <Text style={{ color: colors.primary, fontWeight: '700' }}>{uGpa}</Text></Text>
              {futureDecision && (
                <Text variant="caption" style={{ marginTop: 4 }}>Goal: {futureDecision}</Text>
              )}
            </>
          )}
        </View>

        {/* College cards */}
        <View style={[styles.card, { marginTop: 12 }]}>
          <Text variant="h3" style={{ marginBottom: 12 }}>College Matches</Text>
          {SAMPLE_COLLEGES.map(c => <CollegeCard key={c.name} college={c} />)}
        </View>

        {/* Encourage message */}
        <View style={[styles.card, { marginTop: 12, marginBottom: 40 }]}>
          <Ionicons name="school-outline" size={32} color={colors.primary} style={{ marginBottom: 8 }} />
          <Text variant="body" style={{ lineHeight: 22 }}>
            Based on your <Text style={{ color: colors.primary, fontWeight: '700' }}>{uGpa}</Text> GPA,
            we'll match you with the best-fit schools when this feature launches in Phase 2.
          </Text>
        </View>
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  scrollContent: { paddingHorizontal: 20, paddingTop: 8 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
  },
  collegeCard: {
    backgroundColor: colors.background,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    marginBottom: 8,
  },
  collegeLocked: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    marginBottom: 8,
  },
})
