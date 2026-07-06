// AIChatScreen — AI chat interface.
//
// Mirrors app/(app)/ai/page.tsx in RN idioms:
//   - Chat message list (user + AI turns) with FlatList
//   - Text input + send button, calls aiApi.chat()
//   - Quick suggestion chips mirroring web
//   - Loading bubble while AI is responding
//   - Session persistence via AsyncStorage (7-day TTL, same as web)
//   - Empty state when no messages
//   - Error state on load failure (with retry)
//
// Note: the web's chat history sidebar is collapsed into a bottom sheet /
// modal on mobile (no persistent sidebar column on a 375pt screen). A
// "New Chat" button clears the current conversation. History is preserved
// in AsyncStorage and can be accessed via the history modal.

import React, {
  useState,
  useCallback,
  useRef,
  useEffect,
} from 'react'
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Modal,
  ScrollView,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useTheme } from '../theme/ThemeContext'
import { useAuth } from '../context/AuthContext'
import { ApiRequestError } from '../api/client'
import { chat } from '../api/aiApi'

// ── Types ──────────────────────────────────────────────────────────────────────

interface ChatMessage {
  id: string
  role: 'user' | 'ai'
  text: string
}

interface ChatSession {
  id: string
  title: string
  messages: ChatMessage[]
  createdAt: number
  updatedAt: number
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'ns_ai_sessions'
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000

const QUICK_CHIPS: string[] = [
  'What is my GPA?',
  'Upcoming assignments?',
  'College prep advice',
  'Study tips for finals',
  'Weakest subject?',
]

// ── Helpers ────────────────────────────────────────────────────────────────────

function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function formatSessionDate(ts: number): string {
  const toDay = (d: Date): number =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const today = toDay(new Date())
  const day = toDay(new Date(ts))
  const diffDays = Math.round((today - day) / 86400000)
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

async function loadSessionsFromStorage(): Promise<ChatSession[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const all = JSON.parse(raw) as ChatSession[]
    const cutoff = Date.now() - SESSION_TTL_MS
    return all.filter(sess => sess.createdAt >= cutoff)
  } catch {
    return []
  }
}

async function saveSessionsToStorage(sessions: ChatSession[]): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(sessions))
  } catch {
    // Non-fatal — chat still works, just won't persist
  }
}

function extractErrorMessage(err: unknown): string {
  if (err instanceof ApiRequestError) return err.message
  if (err instanceof Error) return err.message
  return 'Something went wrong. Please try again.'
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function AIChatScreen(): React.JSX.Element {
  const { theme } = useTheme()
  const { accessToken } = useAuth()
  const c = theme.colors
  const s = theme.spacing

  // Chat state
  const [messages, setMessages]         = useState<ChatMessage[]>([])
  const [input, setInput]               = useState('')
  const [sending, setSending]           = useState(false)
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)

  // Sessions history
  const [sessions, setSessions]         = useState<ChatSession[]>([])
  const [historyVisible, setHistoryVisible] = useState(false)
  const [storageLoaded, setStorageLoaded] = useState(false)

  const flatListRef = useRef<FlatList<ChatMessage>>(null)

  // ── Load sessions from storage on mount ──────────────────────────────────────

  useEffect(() => {
    loadSessionsFromStorage().then(loaded => {
      setSessions(loaded)
      setStorageLoaded(true)
    }).catch(() => {
      setStorageLoaded(true)
    })
  }, [])

  // ── Persist sessions to storage whenever they change ─────────────────────────

  useEffect(() => {
    if (!storageLoaded) return
    void saveSessionsToStorage(sessions)
  }, [sessions, storageLoaded])

  // ── Scroll to bottom after new messages ──────────────────────────────────────

  const scrollToBottom = useCallback((): void => {
    if (flatListRef.current && messages.length > 0) {
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true })
      }, 80)
    }
  }, [messages.length])

  useEffect(() => {
    scrollToBottom()
  }, [scrollToBottom])

  // ── Persist messages into the sessions list ───────────────────────────────────

  const persistMessages = useCallback((
    msgs: ChatMessage[],
    sessionId: string,
    title: string,
  ): void => {
    setSessions(prev => {
      const exists = prev.some(sess => sess.id === sessionId)
      const now = Date.now()
      const next: ChatSession[] = exists
        ? prev.map(sess =>
            sess.id === sessionId
              ? { ...sess, messages: msgs, updatedAt: now }
              : sess
          )
        : [
            {
              id: sessionId,
              title,
              messages: msgs,
              createdAt: now,
              updatedAt: now,
            },
            ...prev,
          ]
      return next
    })
  }, [])

  // ── Send a message ────────────────────────────────────────────────────────────

  const handleSend = useCallback(async (textOverride?: string): Promise<void> => {
    const rawText = textOverride ?? input
    const msg = rawText.trim()
    if (!msg || sending || !accessToken) return
    setInput('')

    const userMsg: ChatMessage = { id: newId(), role: 'user', text: msg }
    const withUser = [...messages, userMsg]
    setMessages(withUser)
    setSending(true)

    // Determine or create session
    let sessionId = activeSessionId
    let sessionTitle = msg.length > 40 ? msg.slice(0, 40) + '…' : msg
    if (!sessionId) {
      sessionId = newId()
      setActiveSessionId(sessionId)
    } else {
      const existing = sessions.find(sess => sess.id === sessionId)
      if (existing) sessionTitle = existing.title
    }

    try {
      const { reply } = await chat(msg, accessToken)
      const aiMsg: ChatMessage = { id: newId(), role: 'ai', text: reply }
      const finalMsgs = [...withUser, aiMsg]
      setMessages(finalMsgs)
      persistMessages(finalMsgs, sessionId, sessionTitle)
    } catch (err: unknown) {
      const errText = extractErrorMessage(err)
      const errMsg: ChatMessage = { id: newId(), role: 'ai', text: errText }
      const finalMsgs = [...withUser, errMsg]
      setMessages(finalMsgs)
      persistMessages(finalMsgs, sessionId, sessionTitle)
    } finally {
      setSending(false)
    }
  }, [input, sending, accessToken, messages, activeSessionId, sessions, persistMessages])

  // ── Start new chat ────────────────────────────────────────────────────────────

  const startNewChat = useCallback((): void => {
    setActiveSessionId(null)
    setMessages([])
    setInput('')
  }, [])

  // ── Open a history session ────────────────────────────────────────────────────

  const openSession = useCallback((session: ChatSession): void => {
    setActiveSessionId(session.id)
    setMessages(session.messages)
    setInput('')
    setHistoryVisible(false)
  }, [])

  // ── Sorted sessions ───────────────────────────────────────────────────────────

  const sortedSessions = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt)

  // ── Render a message bubble ───────────────────────────────────────────────────

  function renderMessage({ item }: { item: ChatMessage }): React.JSX.Element {
    const isUser = item.role === 'user'
    return (
      <View style={[styles.bubbleWrapper, isUser ? styles.bubbleWrapperUser : styles.bubbleWrapperAi]}>
        <View
          style={[
            styles.bubble,
            isUser
              ? [styles.bubbleUser, { backgroundColor: c.primary }]
              : [styles.bubbleAi, { backgroundColor: c.surface2, borderColor: c.border }],
          ]}
        >
          <Text
            style={[
              styles.bubbleText,
              { color: isUser ? '#FFFFFF' : c.text },
            ]}
          >
            {item.text}
          </Text>
        </View>
      </View>
    )
  }

  // ── Render loading bubble ─────────────────────────────────────────────────────

  function renderLoadingBubble(): React.JSX.Element {
    return (
      <View style={styles.bubbleWrapperAi}>
        <View style={[styles.bubble, styles.bubbleAi, { backgroundColor: c.surface2, borderColor: c.border }]}>
          <View style={styles.loadingDots}>
            <View style={[styles.dot, { backgroundColor: c.textMuted }]} />
            <View style={[styles.dot, { backgroundColor: c.textMuted }]} />
            <View style={[styles.dot, { backgroundColor: c.textMuted }]} />
          </View>
        </View>
      </View>
    )
  }

  // ── Chat header ───────────────────────────────────────────────────────────────

  function renderChatHeader(): React.JSX.Element {
    return (
      <View style={[styles.chatHeader, { borderBottomColor: c.border }]}>
        <View style={[styles.aiAvatar, { backgroundColor: c.primaryDim, borderColor: c.primaryGlow }]}>
          <Text style={[styles.aiAvatarText, { color: c.primary }]}>AI</Text>
        </View>
        <Text style={[styles.aiName, { color: c.text }]}>Futurely AI</Text>
        <View style={styles.chatHeaderActions}>
          <TouchableOpacity
            onPress={() => setHistoryVisible(true)}
            style={[styles.headerBtn, { borderColor: c.border, minHeight: s.touchTarget, minWidth: s.touchTarget }]}
            accessibilityRole="button"
            accessibilityLabel="View chat history"
          >
            <Text style={[styles.headerBtnText, { color: c.textSecondary }]}>History</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={startNewChat}
            style={[styles.headerBtn, { borderColor: c.border, minHeight: s.touchTarget, minWidth: s.touchTarget }]}
            accessibilityRole="button"
            accessibilityLabel="Start new chat"
          >
            <Text style={[styles.headerBtnText, { color: c.primary }]}>+ New</Text>
          </TouchableOpacity>
        </View>
      </View>
    )
  }

  // ── Empty state ───────────────────────────────────────────────────────────────

  function renderEmptyState(): React.JSX.Element {
    return (
      <View style={styles.emptyState}>
        <View style={[styles.emptyLogo, { backgroundColor: c.primaryDim, borderColor: c.primaryGlow }]}>
          <Text style={[styles.emptyLogoText, { color: c.primary }]}>AI</Text>
        </View>
        <Text style={[styles.emptyTitle, { color: c.text }]}>How can I help you today?</Text>
        <Text style={[styles.emptySub, { color: c.textSecondary }]}>
          Ask about your grades, upcoming assignments, or college planning.
        </Text>
        {/* Quick chips */}
        <View style={styles.chipsWrap}>
          {QUICK_CHIPS.map(chip => (
            <TouchableOpacity
              key={chip}
              onPress={() => { void handleSend(chip) }}
              style={[styles.chip, { borderColor: c.border, backgroundColor: c.surface }]}
              accessibilityRole="button"
              accessibilityLabel={chip}
            >
              <Text style={[styles.chipText, { color: c.textSecondary }]}>{chip}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    )
  }

  // ── History modal ─────────────────────────────────────────────────────────────

  function renderHistoryModal(): React.JSX.Element {
    return (
      <Modal
        visible={historyVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setHistoryVisible(false)}
        accessibilityViewIsModal
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.historySheet, { backgroundColor: c.surface, borderColor: c.border }]}>
            <View style={[styles.historyHeader, { borderBottomColor: c.border }]}>
              <Text style={[styles.historyTitle, { color: c.text }]}>Chat History</Text>
              <TouchableOpacity
                onPress={() => setHistoryVisible(false)}
                accessibilityRole="button"
                accessibilityLabel="Close history"
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={[styles.historyClose, { color: c.textMuted }]}>×</Text>
              </TouchableOpacity>
            </View>

            <Text style={[styles.historyNotice, { color: c.textMuted }]}>
              Chats are automatically deleted after 7 days.
            </Text>

            <TouchableOpacity
              onPress={() => { startNewChat(); setHistoryVisible(false) }}
              style={[
                styles.newChatBtn,
                { borderColor: c.border, backgroundColor: c.surface2, minHeight: s.touchTarget },
              ]}
              accessibilityRole="button"
            >
              <Text style={[styles.newChatBtnText, { color: c.text }]}>+ New Chat</Text>
            </TouchableOpacity>

            <ScrollView style={styles.historyList} showsVerticalScrollIndicator={false}>
              {sortedSessions.length === 0 ? (
                <Text style={[styles.historyEmpty, { color: c.textMuted }]}>
                  No conversations yet.
                </Text>
              ) : (
                sortedSessions.map(sess => (
                  <TouchableOpacity
                    key={sess.id}
                    onPress={() => openSession(sess)}
                    style={[
                      styles.historyItem,
                      {
                        backgroundColor: activeSessionId === sess.id ? c.surface2 : 'transparent',
                        borderColor: activeSessionId === sess.id ? c.border : 'transparent',
                      },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={sess.title}
                  >
                    <Text style={[styles.historyItemTitle, { color: c.text }]} numberOfLines={1}>
                      {sess.title}
                    </Text>
                    <Text style={[styles.historyItemDate, { color: c.textMuted }]}>
                      {formatSessionDate(sess.updatedAt)}
                    </Text>
                  </TouchableOpacity>
                ))
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    )
  }

  // ── Main render ───────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: c.bg }]} edges={['left', 'right', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}
      >
        {renderChatHeader()}

        {messages.length === 0 && !sending ? (
          renderEmptyState()
        ) : (
          <FlatList
            ref={flatListRef}
            data={messages}
            keyExtractor={item => item.id}
            renderItem={renderMessage}
            contentContainerStyle={[
              styles.messageList,
              { paddingHorizontal: theme.spacing.screenPaddingH },
            ]}
            showsVerticalScrollIndicator={false}
            onContentSizeChange={() =>
              flatListRef.current?.scrollToEnd({ animated: false })
            }
            ListFooterComponent={sending ? renderLoadingBubble() : undefined}
          />
        )}

        {/* Input bar */}
        <View
          style={[
            styles.inputBar,
            {
              borderTopColor: c.border,
              backgroundColor: c.bg,
              paddingHorizontal: theme.spacing.screenPaddingH,
            },
          ]}
        >
          <TextInput
            style={[
              styles.textInput,
              {
                backgroundColor: c.surface,
                borderColor: c.border,
                color: c.text,
              },
            ]}
            placeholder="Ask anything about your academics..."
            placeholderTextColor={c.textMuted}
            value={input}
            onChangeText={setInput}
            multiline
            maxLength={2000}
            returnKeyType="send"
            blurOnSubmit
            onSubmitEditing={() => { void handleSend() }}
            editable={!sending}
            accessibilityLabel="Message input"
          />
          <TouchableOpacity
            onPress={() => { void handleSend() }}
            disabled={sending || input.trim().length === 0}
            style={[
              styles.sendBtn,
              {
                backgroundColor: c.primary,
                minHeight: s.touchTarget,
                minWidth: s.touchTarget,
                opacity: sending || input.trim().length === 0 ? 0.4 : 1,
              },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Send message"
          >
            {sending ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : (
              <Text style={styles.sendBtnText}>{'>'}</Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      {renderHistoryModal()}
    </SafeAreaView>
  )
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea:      { flex: 1 },
  flex:          { flex: 1 },
  // Header
  chatHeader:    {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    gap: 10,
  },
  aiAvatar:      {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  aiAvatarText:  { fontSize: 12, fontWeight: '700' },
  aiName:        { fontSize: 15, fontWeight: '700', flex: 1 },
  chatHeaderActions: { flexDirection: 'row', gap: 8 },
  headerBtn:     {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerBtnText: { fontSize: 13, fontWeight: '600' },
  // Messages
  messageList:   {
    paddingVertical: 16,
    flexGrow: 1,
  },
  bubbleWrapper: { marginVertical: 4 },
  bubbleWrapperUser: { alignItems: 'flex-end' },
  bubbleWrapperAi:   { alignItems: 'flex-start' },
  bubble:        { maxWidth: '80%', borderRadius: 16, paddingVertical: 10, paddingHorizontal: 14 },
  bubbleUser:    { borderBottomRightRadius: 4 },
  bubbleAi:      { borderWidth: 1, borderBottomLeftRadius: 4 },
  bubbleText:    { fontSize: 14, lineHeight: 20 },
  loadingDots:   { flexDirection: 'row', gap: 5, paddingHorizontal: 4, paddingVertical: 2 },
  dot:           { width: 7, height: 7, borderRadius: 99 },
  // Input bar
  inputBar:      {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingVertical: 10,
    borderTopWidth: 1,
    gap: 10,
  },
  textInput:     {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
  },
  sendBtn:       {
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  sendBtnText:   { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  // Empty state
  emptyState:    {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingBottom: 40,
  },
  emptyLogo:     {
    width: 60,
    height: 60,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyLogoText: { fontSize: 14, fontWeight: '700' },
  emptyTitle:    { fontSize: 18, fontWeight: '700', marginBottom: 8, textAlign: 'center' },
  emptySub:      { fontSize: 13, lineHeight: 19, textAlign: 'center', marginBottom: 20 },
  chipsWrap:     { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' },
  chip:          {
    borderWidth: 1,
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 14,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipText:      { fontSize: 13 },
  // History modal
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  historySheet:  {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    paddingBottom: 32,
    maxHeight: '70%',
  },
  historyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 18,
    borderBottomWidth: 1,
  },
  historyTitle:  { fontSize: 16, fontWeight: '700' },
  historyClose:  { fontSize: 22, padding: 4 },
  historyNotice: { fontSize: 11, fontStyle: 'italic', paddingHorizontal: 18, paddingTop: 10, lineHeight: 16 },
  newChatBtn:    {
    marginHorizontal: 18,
    marginVertical: 12,
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    alignItems: 'flex-start',
  },
  newChatBtnText: { fontSize: 13, fontWeight: '600' },
  historyList:   { paddingHorizontal: 18, paddingBottom: 8 },
  historyEmpty:  { fontSize: 13, fontStyle: 'italic', padding: 8 },
  historyItem:   {
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 9,
    paddingHorizontal: 12,
    marginBottom: 4,
    minHeight: 44,
    justifyContent: 'center',
  },
  historyItemTitle: { fontSize: 13, fontWeight: '500', marginBottom: 2 },
  historyItemDate:  { fontSize: 11 },
})
