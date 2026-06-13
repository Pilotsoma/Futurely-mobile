import React, { useRef, useState } from 'react'
import {
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native'
import Text from '../components/ui/Text'
import { colors } from '../constants/colors'

interface UserAgreementScreenProps {
  onAgree: () => void
}

const SECTIONS = [
  {
    title: '1. Description of Service',
    body: 'NextStep provides educational tools that allow users to store academic information, including grades, transcripts, attendance records, assignments, and related educational data. The platform may use artificial intelligence to analyze submitted information and provide educational insights, recommendations, study suggestions, and academic planning assistance.',
  },
  {
    title: '2. Eligibility',
    body: 'You must be at least 13 years old to create an account. If you are under 18, you represent that you have permission from a parent or legal guardian to use the Service.',
  },
  {
    title: '3. User Data',
    body: 'You may provide information including academic grades, report cards, transcripts, attendance records, course schedules, assignment information, and educational goals. You represent that you have the right to upload and share any information submitted to the Service.',
  },
  {
    title: '4. Artificial Intelligence Features',
    body: 'The Service may use artificial intelligence to analyze academic performance, identify trends and patterns, recommend study strategies, suggest academic improvements, and predict potential outcomes based on available information. AI-generated recommendations are informational only and should not be considered educational, legal, financial, medical, or professional advice. We do not guarantee any academic outcome, grade improvement, admission decision, scholarship award, or educational result.',
  },
  {
    title: '5. Accuracy of Information',
    body: 'You are responsible for ensuring that information uploaded to the Service is accurate and up to date. Recommendations generated from inaccurate information may be unreliable.',
  },
  {
    title: '6. Privacy',
    body: 'Your use of the Service is governed by our Privacy Policy, which describes how we collect, use, store, and protect your information. We do not sell personal information.',
  },
  {
    title: '7. Data Storage and Processing',
    body: 'By using the Service, you authorize NextStep to store uploaded educational information, process it using automated systems, and use AI models to generate recommendations as described in our Privacy Policy.',
  },
  {
    title: '8. Limitation of Liability',
    body: 'To the maximum extent permitted by law, NextStep shall not be liable for any indirect, incidental, consequential, special, or punitive damages arising from use of the Service.',
  },
  {
    title: '9. Changes to Terms',
    body: 'We may update these Terms from time to time. Continued use of the Service after changes become effective constitutes acceptance of the revised Terms.',
  },
]

export default function UserAgreementScreen({
  onAgree,
}: UserAgreementScreenProps): React.JSX.Element {
  const [canAgree, setCanAgree] = useState(false)

  function handleScroll(e: NativeSyntheticEvent<NativeScrollEvent>): void {
    const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent
    const nearBottom = layoutMeasurement.height + contentOffset.y >= contentSize.height - 80
    if (nearBottom && !canAgree) setCanAgree(true)
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.logo}>
          <Text style={styles.logoText}>N</Text>
        </View>
        <Text variant="heading" style={styles.title}>
          User Agreement
        </Text>
        <Text variant="caption" color={colors.textMuted} style={styles.date}>
          Last Updated: 5/31/26
        </Text>
      </View>

      {/* Scrollable Terms */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        onScroll={handleScroll}
        scrollEventThrottle={32}
        showsVerticalScrollIndicator={false}
      >
        <Text variant="body" color={colors.textSecondary} style={styles.intro}>
          Welcome to NextStep. By creating an account or using our services, you agree to the
          following terms.
        </Text>

        {SECTIONS.map((s) => (
          <View key={s.title} style={styles.section}>
            <Text variant="h3" style={styles.sectionTitle}>
              {s.title}
            </Text>
            <Text variant="body" color={colors.textSecondary} style={styles.sectionBody}>
              {s.body}
            </Text>
          </View>
        ))}

        <View style={styles.scrollHint}>
          <Text variant="caption" color={colors.textMuted} style={{ textAlign: 'center' }}>
            Scroll to the bottom to enable the Agree button
          </Text>
        </View>
      </ScrollView>

      {/* Agree Button */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.agreeBtn, !canAgree && styles.agreeBtnDisabled]}
          onPress={onAgree}
          disabled={!canAgree}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="I agree to the terms"
          accessibilityState={{ disabled: !canAgree }}
        >
          <Text style={[styles.agreeBtnText, !canAgree && { opacity: 0.5 }]}>I Agree</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    alignItems: 'center',
    paddingTop: 60,
    paddingBottom: 20,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  logo: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  logoText: {
    fontSize: 26,
    fontWeight: '800',
    color: colors.background,
    letterSpacing: -0.5,
  },
  title: {
    marginBottom: 4,
  },
  date: {
    marginTop: 2,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
  },
  intro: {
    marginBottom: 24,
    lineHeight: 22,
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    marginBottom: 6,
    color: colors.textPrimary,
  },
  sectionBody: {
    lineHeight: 22,
  },
  scrollHint: {
    paddingVertical: 16,
  },
  footer: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    paddingBottom: 32,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  agreeBtn: {
    backgroundColor: colors.primary,
    borderRadius: 8,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  agreeBtnDisabled: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  agreeBtnText: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: colors.background,
    letterSpacing: 0.3,
  },
})
