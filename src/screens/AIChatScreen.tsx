import React, { useEffect, useRef, useState } from 'react'
import { FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons'
import Svg, { Defs, LinearGradient, Stop, Rect } from 'react-native-svg'
import * as aiApi from '../api/aiApi'
import { ApiRequestError } from '../api/client'
import { Screen } from '../components/ui/Screen'
import { Input } from '../components/ui/Input'
import { colors, gradients, radii, spacing, typography } from '../theme/tokens'

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  createdAt: number
}

const HISTORY_KEY = 'futurely.aiChatHistory'
const HISTORY_TTL_MS = 7 * 24 * 60 * 60 * 1000

const QUICK_CHIPS = [
  'How can I raise my GPA?',
  'What should I focus on this week?',
  'Help me plan for college applications',
]

export default function AIChatScreen(): React.JSX.Element {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const listRef = useRef<FlatList<ChatMessage>>(null)

  useEffect(() => {
    void (async () => {
      const raw = await AsyncStorage.getItem(HISTORY_KEY)
      if (!raw) return
      try {
        const parsed = JSON.parse(raw) as ChatMessage[]
        const cutoff = Date.now() - HISTORY_TTL_MS
        setMessages(parsed.filter((m) => m.createdAt >= cutoff))
      } catch {
        // Corrupt/old-format history — start fresh rather than crash.
      }
    })()
  }, [])

  async function handleSend(text: string): Promise<void> {
    const trimmed = text.trim()
    if (!trimmed || sending) return
    setError(null)
    const userMessage: ChatMessage = { id: `u-${Date.now()}`, role: 'user', text: trimmed, createdAt: Date.now() }
    const withUser = [...messages, userMessage]
    setMessages(withUser)
    setInput('')
    setSending(true)
    try {
      const result = await aiApi.sendChatMessage(trimmed)
      const assistantMessage: ChatMessage = {
        id: `a-${Date.now()}`,
        role: 'assistant',
        text: result.reply,
        createdAt: Date.now(),
      }
      const withReply = [...withUser, assistantMessage]
      setMessages(withReply)
      await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(withReply))
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not reach the AI assistant.')
    } finally {
      setSending(false)
    }
  }

  function clearHistory(): void {
    setMessages([])
    void AsyncStorage.removeItem(HISTORY_KEY)
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen>
        <View style={styles.headerRow}>
          <View style={styles.headerLeft}>
            <View style={styles.brainAvatar}>
              <MaterialCommunityIcons name="brain" size={20} color="#FFFFFF" />
            </View>
            <View>
              <Text style={styles.title}>Futurely AI</Text>
              <View style={styles.statusRow}>
                <View style={styles.statusDot} />
                <Text style={styles.statusText}>Online</Text>
              </View>
            </View>
          </View>
          {messages.length > 0 ? (
            <Pressable onPress={clearHistory} hitSlop={8} accessibilityRole="button" accessibilityLabel="Clear chat">
              <Feather name="refresh-ccw" size={18} color={colors.textMuted} />
            </Pressable>
          ) : null}
        </View>

        {messages.length === 0 ? (
          <View style={styles.chipsWrap}>
            <Text style={styles.chipsLabel}>Try asking</Text>
            <View style={styles.chipsRow}>
              {QUICK_CHIPS.map((chip) => (
                <Pressable
                  key={chip}
                  onPress={() => void handleSend(chip)}
                  style={({ pressed }) => [styles.chip, pressed && styles.chipPressed]}
                >
                  <Text style={styles.chipText}>{chip}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m.id}
          contentContainerStyle={styles.listContent}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
          renderItem={({ item }) => (
            <View style={[styles.bubble, item.role === 'user' ? styles.userBubble : styles.assistantBubble]}>
              <Text style={[styles.bubbleText, item.role === 'user' && styles.userBubbleText]}>{item.text}</Text>
            </View>
          )}
        />

        {sending ? (
          <View style={[styles.bubble, styles.assistantBubble]}>
            <Text style={styles.bubbleText}>Thinking…</Text>
          </View>
        ) : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <View style={styles.inputRow}>
          <Input
            value={input}
            onChangeText={setInput}
            placeholder="Ask about grades, planning, college..."
            style={styles.input}
          />
          <Pressable
            onPress={() => void handleSend(input)}
            disabled={sending}
            style={({ pressed }) => [styles.sendButton, pressed && styles.sendButtonPressed]}
            accessibilityRole="button"
            accessibilityLabel="Send message"
          >
            <Svg style={StyleSheet.absoluteFillObject} pointerEvents="none">
              <Defs>
                <LinearGradient id="sendGradient" x1="0" y1="0" x2="1" y2="1">
                  <Stop offset="0" stopColor={gradients.accent[0]} stopOpacity={1} />
                  <Stop offset="1" stopColor={gradients.accent[1]} stopOpacity={1} />
                </LinearGradient>
              </Defs>
              <Rect x="0" y="0" width="100%" height="100%" fill="url(#sendGradient)" />
            </Svg>
            <Feather name="send" size={18} color="#FFFFFF" />
          </Pressable>
        </View>
      </Screen>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  brainAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { ...typography.h2, color: colors.text },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  statusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.success },
  statusText: { ...typography.caption, color: colors.success },
  chipsWrap: { gap: spacing.sm, marginBottom: spacing.md },
  chipsLabel: { ...typography.label, color: colors.textSecondary },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    width: '47%',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.ms,
    paddingVertical: spacing.sm,
  },
  chipPressed: { backgroundColor: colors.surface2 },
  chipText: { ...typography.caption, color: colors.text },
  listContent: { gap: spacing.sm, paddingBottom: spacing.md },
  bubble: { maxWidth: '85%', padding: spacing.md, borderRadius: radii.md },
  userBubble: { backgroundColor: colors.primary, alignSelf: 'flex-end' },
  assistantBubble: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.border,
    alignSelf: 'flex-start',
  },
  bubbleText: { ...typography.body, color: colors.text },
  userBubbleText: { color: '#FFFFFF' },
  error: { ...typography.caption, color: colors.error, marginVertical: spacing.xs },
  inputRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-end', marginTop: spacing.sm },
  input: { flex: 1 },
  sendButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonPressed: { opacity: 0.85 },
})
