import React, { useEffect, useRef, useState } from 'react'
import { FlatList, KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as aiApi from '../api/aiApi'
import { ApiRequestError } from '../api/client'
import { Screen } from '../components/ui/Screen'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { colors, elevation, radii, spacing, typography } from '../theme/tokens'

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
          <Text style={styles.title}>AI Chat</Text>
          {messages.length > 0 ? (
            <Button label="Clear" onPress={clearHistory} variant="secondary" style={styles.clearButton} />
          ) : null}
        </View>

        {messages.length === 0 ? (
          <View style={styles.chipsRow}>
            {QUICK_CHIPS.map((chip) => (
              <Button
                key={chip}
                label={chip}
                onPress={() => void handleSend(chip)}
                variant="secondary"
                style={styles.chip}
              />
            ))}
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
          <Button label="Send" onPress={() => void handleSend(input)} loading={sending} style={styles.sendButton} />
        </View>
      </Screen>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
  title: { ...typography.h1, color: colors.text },
  clearButton: { height: 32, paddingHorizontal: spacing.sm },
  chipsRow: { gap: spacing.sm, marginBottom: spacing.md },
  chip: { alignItems: 'flex-start' },
  listContent: { gap: spacing.sm, paddingBottom: spacing.md },
  bubble: { maxWidth: '85%', padding: spacing.md, borderRadius: radii.md },
  userBubble: { backgroundColor: colors.primary, alignSelf: 'flex-end', ...elevation.sm },
  assistantBubble: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignSelf: 'flex-start',
    ...elevation.sm,
  },
  bubbleText: { ...typography.body, color: colors.text },
  userBubbleText: { color: '#FFFFFF' },
  error: { ...typography.caption, color: colors.error, marginVertical: spacing.xs },
  inputRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-end', marginTop: spacing.sm },
  input: { flex: 1 },
  sendButton: { width: 80 },
})
