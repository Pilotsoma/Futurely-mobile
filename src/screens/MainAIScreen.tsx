import React, { useCallback, useRef, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useFocusEffect, useNavigation } from '@react-navigation/native'
import type { CompositeNavigationProp } from '@react-navigation/native'
import type { DrawerNavigationProp } from '@react-navigation/drawer'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import Text from '../components/ui/Text'
import { colors } from '../constants/colors'
import { useAuth } from '../context/AuthContext'
import { sendChatMessage } from '../api/aiApi'
import { fetchStudentData, type StudentData } from '../api/studentApi'
import type { AppParamList } from '../navigation/AppNavigator'

type DrawerParamList = { MainAIHome: undefined }

type NavProp = CompositeNavigationProp<
  DrawerNavigationProp<DrawerParamList, 'MainAIHome'>,
  NativeStackNavigationProp<AppParamList>
>

interface ChatMessage {
  id: string
  role: 'user' | 'ai'
  text: string
}

interface FeatureOption {
  key: keyof AppParamList
  label: string
  subtitle: string
  icon: React.ComponentProps<typeof Ionicons>['name']
  iconColor: string
}

const FEATURE_OPTIONS: FeatureOption[] = [
  {
    key: 'GradePortal',
    label: 'Grade Portal',
    subtitle: 'Grades, schedule, reports & transcript',
    icon: 'school-outline',
    iconColor: colors.info,
  },
  {
    key: 'CollegeHelp',
    label: 'College Help',
    subtitle: 'GPA planning, colleges & roadmap',
    icon: 'ribbon-outline',
    iconColor: colors.primary,
  },
  {
    key: 'Planning',
    label: 'Planning',
    subtitle: 'Smart planner & upcoming due dates',
    icon: 'calendar-outline',
    iconColor: colors.warning,
  },
]

const AI_CHIPS = ['Get Advice', 'Help study', 'College Requirements', 'SAT', 'High School Road-map']

export default function MainAIScreen(): React.JSX.Element {
  const navigation = useNavigation<NavProp>()
  const { user } = useAuth()
  const [aiInput, setAiInput] = useState('')
  const [studentData, setStudentData] = useState<StudentData | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isSending, setIsSending] = useState(false)
  const [showChat, setShowChat] = useState(false)
  const listRef = useRef<FlatList<ChatMessage>>(null)

  useFocusEffect(
    useCallback(() => {
      fetchStudentData().then(setStudentData).catch(() => null)
    }, [])
  )

  const firstName = studentData?.name?.split(' ')[0] ?? user?.name?.split(' ')[0] ?? 'Student'

  async function handleSend(textOverride?: string): Promise<void> {
    const text = (textOverride ?? aiInput).trim()
    if (!text || isSending) return
    setAiInput('')
    setShowChat(true)
    const userMsg: ChatMessage = { id: Date.now().toString(), role: 'user', text }
    setMessages(prev => [...prev, userMsg])
    setIsSending(true)
    try {
      const reply = await sendChatMessage(text)
      setMessages(prev => [...prev, { id: (Date.now() + 1).toString(), role: 'ai', text: reply }])
    } catch {
      setMessages(prev => [...prev, { id: (Date.now() + 1).toString(), role: 'ai', text: 'Sorry, I had trouble connecting. Please try again.' }])
    } finally {
      setIsSending(false)
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100)
    }
  }

  function handleChipTap(chip: string): void {
    setAiInput(chip)
    void handleSend(chip)
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        {/* Top bar */}
        <View style={styles.topBar}>
          {showChat ? (
            <TouchableOpacity
              style={styles.topBtn}
              onPress={() => setShowChat(false)}
              accessibilityRole="button"
              accessibilityLabel="Back to home"
            >
              <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={styles.topBtn}
              onPress={() => navigation.openDrawer()}
              accessibilityRole="button"
              accessibilityLabel="Open menu"
              activeOpacity={0.7}
            >
              <Ionicons name="menu" size={24} color={colors.textPrimary} />
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={styles.topBtn}
            onPress={() => navigation.navigate('Settings')}
            accessibilityRole="button"
            accessibilityLabel="Settings"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="settings-outline" size={20} color={colors.textMuted} />
          </TouchableOpacity>
        </View>

        {showChat ? (
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={m => m.id}
            renderItem={({ item }) => <MessageBubble message={item} />}
            contentContainerStyle={styles.chatContent}
            showsVerticalScrollIndicator={false}
            ListFooterComponent={isSending ? <TypingIndicator /> : null}
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
          />
        ) : (
          <FlatList
            data={FEATURE_OPTIONS}
            keyExtractor={item => item.key}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.optionCard}
                onPress={() => navigation.navigate(item.key as never)}
                activeOpacity={0.75}
                accessibilityRole="button"
                accessibilityLabel={item.label}
              >
                <View style={[styles.optionIcon, { backgroundColor: item.iconColor + '1A' }]}>
                  <Ionicons name={item.icon} size={22} color={item.iconColor} />
                </View>
                <View style={styles.optionText}>
                  <Text variant="h3" style={{ marginBottom: 2 }}>{item.label}</Text>
                  <Text variant="caption" color={colors.textMuted}>{item.subtitle}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
              </TouchableOpacity>
            )}
            ListHeaderComponent={
              <View style={styles.greeting}>
                <Image
                  source={require('../../assets/logo.png')}
                  style={styles.logoImage}
                />
                <Text variant="heading" style={styles.hello}>Hello {firstName},</Text>
                <Text variant="h2" color={colors.textSecondary} style={styles.tagline}>
                  What's your NextStep?
                </Text>
              </View>
            }
            ListFooterComponent={
              <View style={styles.aiSection}>
                <Text variant="label" color={colors.textSecondary} style={{ marginBottom: 8 }}>
                  NextStep AI
                </Text>
                <Text variant="body" color={colors.textSecondary} style={{ marginBottom: 12, fontWeight: '500' }}>
                  What can I help you with?
                </Text>
                <View style={styles.chipRow}>
                  {AI_CHIPS.map(chip => (
                    <TouchableOpacity
                      key={chip}
                      style={styles.chip}
                      activeOpacity={0.7}
                      onPress={() => handleChipTap(chip)}
                    >
                      <Text style={styles.chipText}>{chip}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            }
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          />
        )}

        {/* AI input bar */}
        <View style={styles.inputBar}>
          <TextInput
            style={styles.input}
            value={aiInput}
            onChangeText={setAiInput}
            placeholder="Ask NextStep AI..."
            placeholderTextColor={colors.textMuted}
            returnKeyType="send"
            onSubmitEditing={() => void handleSend()}
            accessibilityLabel="Ask NextStep AI"
            editable={!isSending}
          />
          <TouchableOpacity
            style={[styles.sendBtn, isSending && { opacity: 0.5 }]}
            onPress={() => void handleSend()}
            activeOpacity={0.7}
            disabled={isSending}
            accessibilityRole="button"
            accessibilityLabel="Send message"
          >
            <Ionicons name="send" size={18} color={colors.background} />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

function MessageBubble({ message }: { message: ChatMessage }): React.JSX.Element {
  const isUser = message.role === 'user'
  return (
    <View style={[styles.bubbleWrap, isUser ? styles.bubbleWrapRight : styles.bubbleWrapLeft]}>
      {!isUser && (
        <Image
          source={require('../../assets/logo.png')}
          style={styles.aiBadgeImage}
        />
      )}
      <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleAi]}>
        <Text style={[styles.bubbleText, { color: isUser ? colors.background : colors.textPrimary }]}>
          {message.text}
        </Text>
      </View>
    </View>
  )
}

function TypingIndicator(): React.JSX.Element {
  return (
    <View style={[styles.bubbleWrap, styles.bubbleWrapLeft]}>
      <Image
        source={require('../../assets/logo.png')}
        style={styles.aiBadgeImage}
      />
      <View style={[styles.bubble, styles.bubbleAi, { paddingHorizontal: 16, paddingVertical: 12 }]}>
        <ActivityIndicator size="small" color={colors.primary} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  container: { flex: 1, backgroundColor: colors.background },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 8,
  },
  topBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 24 },
  chatContent: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  greeting: { alignItems: 'center', paddingTop: 16, paddingBottom: 32 },
  logoImage: { width: 80, height: 80, resizeMode: 'contain', marginBottom: 20 },
  hello: { marginBottom: 6, textAlign: 'center' as const },
  tagline: { textAlign: 'center' as const, fontWeight: '400' },
  optionCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface,
    borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 16, gap: 14, marginBottom: 12,
  },
  optionIcon: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  optionText: { flex: 1, gap: 2 },
  aiSection: {
    backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1,
    borderColor: colors.border, padding: 16, marginTop: 8,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    backgroundColor: colors.info + '22', borderRadius: 100, borderWidth: 1,
    borderColor: colors.info + '44', paddingHorizontal: 12, paddingVertical: 6,
  },
  chipText: { fontSize: 12, fontWeight: '500' as const, color: colors.info },
  inputBar: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface,
    borderTopWidth: 1, borderTopColor: colors.border,
    paddingHorizontal: 16, paddingVertical: 10, paddingBottom: 28, gap: 12,
  },
  input: {
    flex: 1, backgroundColor: colors.background, borderRadius: 24, borderWidth: 1,
    borderColor: colors.border, paddingHorizontal: 16, paddingVertical: 10,
    fontSize: 15, color: colors.textPrimary, minHeight: 44,
  },
  sendBtn: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  bubbleWrap: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: 8 },
  bubbleWrapLeft: { justifyContent: 'flex-start' },
  bubbleWrapRight: { justifyContent: 'flex-end' },
  aiBadgeImage: { width: 24, height: 24, resizeMode: 'contain', marginRight: 8, borderRadius: 12 },
  bubble: {
    maxWidth: '80%', paddingHorizontal: 14, paddingVertical: 10,
  },
  bubbleUser: {
    backgroundColor: colors.primary,
    borderRadius: 18,
    borderBottomRightRadius: 4,
  },
  bubbleAi: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  bubbleText: { fontSize: 14, lineHeight: 20 },
})
