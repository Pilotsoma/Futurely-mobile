import React, { useCallback, useState } from 'react'
import {
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useFocusEffect, useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import Text from '../components/ui/Text'
import BranchHeader from '../components/ui/BranchHeader'
import Skeleton from '../components/ui/Skeleton'
import { colors } from '../constants/colors'
import type { CollegeHelpParamList } from '../navigation/CollegeHelpNavigator'
import { fetchStudentData, type StudentData } from '../api/studentApi'

type NavProp = NativeStackNavigationProp<CollegeHelpParamList>

export default function CollegeHelpScreen(): React.JSX.Element {
  const navigation = useNavigation<NavProp>()
  const [studentData, setStudentData] = useState<StudentData | null>(null)

  useFocusEffect(
    useCallback(() => {
      fetchStudentData().then(setStudentData).catch(() => null)
    }, [])
  )

  const uGpa = studentData?.profile?.unweightedGpa
  const wGpa = studentData?.profile?.weightedGpa

  return (
    <View style={styles.container}>
      <BranchHeader />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Text variant="heading" style={styles.title}>GPA Planner</Text>

        {/* GPA Summary card */}
        <View style={styles.gpaCard}>
          <View style={styles.gpaCol}>
            <Text variant="caption" color={colors.textMuted} style={styles.gpaLabel}>
              Unweighted GPA
            </Text>
            {studentData === null ? (
              <Skeleton width={80} height={36} style={{ borderRadius: 6 }} />
            ) : (
              <Text variant="display">{uGpa !== undefined ? uGpa.toFixed(3) : '—'}</Text>
            )}
          </View>
          <View style={styles.gpaDivider} />
          <View style={styles.gpaCol}>
            <Text variant="caption" color={colors.textMuted} style={styles.gpaLabel}>
              Weighted GPA
            </Text>
            {studentData === null ? (
              <Skeleton width={80} height={36} style={{ borderRadius: 6 }} />
            ) : (
              <Text variant="display" color={colors.primary}>
                {wGpa !== undefined ? wGpa.toFixed(3) : '—'}
              </Text>
            )}
          </View>
        </View>

        {/* Action rows */}
        <View style={styles.actionGroup}>
          <TouchableOpacity
            style={styles.actionRow}
            onPress={() => navigation.navigate('WhatIfCalculator')}
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityLabel="What-If Calculator"
          >
            <View style={[styles.actionIcon, { backgroundColor: colors.primary + '1A' }]}>
              <Ionicons name="calculator-outline" size={20} color={colors.primary} />
            </View>
            <View style={styles.actionText}>
              <Text variant="h3">What If Calculator</Text>
              <Text variant="caption" color={colors.textMuted}>Calculate your GPA with custom grades</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
          </TouchableOpacity>

          <View style={styles.actionDivider} />

          <TouchableOpacity
            style={styles.actionRow}
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityLabel="GPA Editor — coming soon"
          >
            <View style={[styles.actionIcon, { backgroundColor: colors.info + '1A' }]}>
              <Ionicons name="create-outline" size={20} color={colors.info} />
            </View>
            <View style={styles.actionText}>
              <Text variant="h3">GPA Editor</Text>
              <Text variant="caption" color={colors.textMuted}>Configure scales for each class</Text>
            </View>
            <View style={styles.comingSoonBadge}>
              <Text style={styles.comingSoonText}>Soon</Text>
            </View>
          </TouchableOpacity>
        </View>

        {/* Colleges */}
        <TouchableOpacity
          style={styles.expandRow}
          onPress={() => navigation.navigate('Colleges')}
          activeOpacity={0.75}
          accessibilityRole="button"
          accessibilityLabel="Colleges"
        >
          <View style={[styles.actionIcon, { backgroundColor: colors.warning + '1A' }]}>
            <Ionicons name="business-outline" size={20} color={colors.warning} />
          </View>
          <Text variant="h3" style={{ flex: 1 }}>Colleges</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
        </TouchableOpacity>

        {/* Road-map */}
        <TouchableOpacity
          style={styles.expandRow}
          onPress={() => navigation.navigate('Roadmap')}
          activeOpacity={0.75}
          accessibilityRole="button"
          accessibilityLabel="Road-map"
        >
          <View style={[styles.actionIcon, { backgroundColor: colors.success + '1A' }]}>
            <Ionicons name="map-outline" size={20} color={colors.success} />
          </View>
          <Text variant="h3" style={{ flex: 1 }}>Road-map</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
        </TouchableOpacity>
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 40, gap: 14 },
  title: { marginBottom: 4 },
  gpaCard: {
    backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1,
    borderColor: colors.border, flexDirection: 'row', padding: 20,
  },
  gpaCol: { flex: 1, alignItems: 'center' },
  gpaDivider: { width: 1, backgroundColor: colors.border, marginHorizontal: 12 },
  gpaLabel: { marginBottom: 8, textAlign: 'center' },
  actionGroup: {
    backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1,
    borderColor: colors.border, overflow: 'hidden',
  },
  actionRow: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  actionIcon: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  actionText: { flex: 1, gap: 2 },
  actionDivider: { height: 1, backgroundColor: colors.border, marginLeft: 66 },
  expandRow: {
    backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border,
    flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12,
  },
  comingSoonBadge: { backgroundColor: colors.border, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  comingSoonText: { fontSize: 11, fontWeight: '600' as const, color: colors.textMuted },
})
