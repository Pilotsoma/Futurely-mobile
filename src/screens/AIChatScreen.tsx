import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useFocusEffect } from '@react-navigation/native'
import { Feather } from '@expo/vector-icons'
import AsyncStorage from '@react-native-async-storage/async-storage'

import { useAuth } from '../context/AuthContext'
import { sendChatMessage } from '../api/aiApi'
import * as studentsApi from '../api/studentsApi'
import type { StudentMe } from '../types/student'


interface ChatMessage {
  id: string
  role: 'user' | 'ai'
  text: string
}

interface ChatSession {
  id: string
  title: string
  updatedAt: number
  messages: ChatMessage[]
}

interface PromptOption {
  label: string
  subtitle: string
  prompt: string
  icon: React.ComponentProps<typeof Feather>['name']
  color: string
  background: string
}


const PROMPTS: PromptOption[] = [
  {
    label: 'Raise my GPA',
    subtitle: 'Build a focused improvement plan',
    prompt: 'How can I raise my GPA, and which classes should I focus on first?',
    icon: 'trending-up',
    color: '#2DD4BF',
    background: 'rgba(45,212,191,0.13)',
  },
  {
    label: 'Plan my week',
    subtitle: 'Organize assignments and priorities',
    prompt: 'Help me plan my school week based on my assignments and priorities.',
    icon: 'calendar',
    color: '#60A5FA',
    background: 'rgba(96,165,250,0.13)',
  },
  {
    label: 'Study smarter',
    subtitle: 'Create a better study routine',
    prompt: 'Help me create a focused study plan for an upcoming test.',
    icon: 'book-open',
    color: '#A78BFA',
    background: 'rgba(167,139,250,0.15)',
  },
  {
    label: 'College roadmap',
    subtitle: 'Map out your next application steps',
    prompt: 'Help me build a college application roadmap and tell me what to do next.',
    icon: 'map',
    color: '#F59E0B',
    background: 'rgba(245,158,11,0.14)',
  },

]

const APP_LOGO = require('../../assets/logo.png')
const CHAT_HISTORY_KEY = 'myfuturely.ai.chat-history.v1'
const MAX_SAVED_CHATS = 30

function makeChatTitle(messages: ChatMessage[]): string {
  const firstQuestion = messages.find((message) => message.role === 'user')?.text.trim()
  if (!firstQuestion) return 'New conversation'
  return firstQuestion.length > 44 ? `${firstQuestion.slice(0, 44)}…` : firstQuestion
}

function formatChatDate(timestamp: number): string {
  const date = new Date(timestamp)
  const today = new Date()

  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  }

  return date.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
  })
}

const PROMPT_ROWS: PromptOption[][] = Array.from(
  { length: Math.ceil(PROMPTS.length / 2) },
  (_, index) => PROMPTS.slice(index * 2, index * 2 + 2),
)

export default function AIChatScreen(): React.JSX.Element {
  const { user } = useAuth()
  const [studentData, setStudentData] = useState<StudentMe | null>(null)
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isSending, setIsSending] = useState(false)
  const [showChat, setShowChat] = useState(false)
  const [historyVisible, setHistoryVisible] = useState(false)
  const [history, setHistory] = useState<ChatSession[]>([])
  const [currentChatId, setCurrentChatId] = useState<string | null>(null)
  const listRef = useRef<FlatList<ChatMessage>>(null)

  useEffect(() => {
    let mounted = true

    AsyncStorage.getItem(CHAT_HISTORY_KEY)
      .then((stored) => {
        if (!mounted || !stored) return
        const parsed = JSON.parse(stored) as ChatSession[]
        if (Array.isArray(parsed)) setHistory(parsed)
      })
      .catch(() => undefined)

    return () => {
      mounted = false
    }
  }, [])

  useFocusEffect(
    useCallback(() => {
      let cancelled = false

      studentsApi.getMe()
        .then((result) => {
          if (!cancelled) setStudentData(result)
        })
        .catch(() => undefined)

      return () => {
        cancelled = true
      }
    }, []),
  )

  const firstName = studentData?.name?.split(' ')[0] ?? user?.name?.split(' ')[0] ?? 'Student'
  const canSend = input.trim().length > 0 && !isSending

  const saveSession = useCallback((sessionId: string, nextMessages: ChatMessage[]) => {
    if (nextMessages.length === 0) return

    const session: ChatSession = {
      id: sessionId,
      title: makeChatTitle(nextMessages),
      updatedAt: Date.now(),
      messages: nextMessages,
    }

    setHistory((current) => {
      const next = [
        session,
        ...current.filter((item) => item.id !== sessionId),
      ].slice(0, MAX_SAVED_CHATS)

      void AsyncStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(next))
      return next
    })
  }, [])

  async function handleSend(textOverride?: string): Promise<void> {
    const text = (textOverride ?? input).trim()
    if (!text || isSending) return

    setInput('')
    setShowChat(true)

    const timestamp = Date.now()
    const sessionId = currentChatId ?? `chat-${timestamp}`

    if (!currentChatId) setCurrentChatId(sessionId)

    const userMessage: ChatMessage = {
      id: `${timestamp}-user`,
      role: 'user',
      text,
    }

    setMessages((current) => {
      const next = [...current, userMessage]
      saveSession(sessionId, next)
      return next
    })
    setIsSending(true)

    try {
      const result = await sendChatMessage(text)
      const assistantMessage: ChatMessage = {
        id: `${Date.now()}-ai`,
        role: 'ai',
        text: result.reply,
      }

      setMessages((current) => {
        const next = [...current, assistantMessage]
        saveSession(sessionId, next)
        return next
      })
    } catch {
      const errorMessage: ChatMessage = {
        id: `${Date.now()}-error`,
        role: 'ai',
        text: 'I had trouble connecting just now. Please try sending that again.',
      }

      setMessages((current) => {
        const next = [...current, errorMessage]
        saveSession(sessionId, next)
        return next
      })
    } finally {
      setIsSending(false)
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 120)
    }
  }

  function startNewChat(): void {
    setMessages([])
    setInput('')
    setCurrentChatId(null)
    setShowChat(false)
  }

  function openPastChat(session: ChatSession): void {
    setMessages(session.messages)
    setCurrentChatId(session.id)
    setShowChat(true)
    setHistoryVisible(false)

    setTimeout(() => listRef.current?.scrollToEnd({ animated: false }), 80)
  }


  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        <Header
          showChat={showChat}
          historyCount={history.length}
          onBack={() => setShowChat(false)}
          onOpenHistory={() => setHistoryVisible(true)}
        />

        <PastChatsModal
          visible={historyVisible}
          sessions={history}
          onClose={() => setHistoryVisible(false)}
          onOpenChat={openPastChat}
          onNewChat={() => {
            startNewChat()
            setHistoryVisible(false)
          }}
        />

        {showChat ? (
          <FlatList
            ref={listRef}
            style={styles.chatList}
            data={messages}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => <MessageBubble message={item} />}
            contentContainerStyle={styles.chatContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            ListHeaderComponent={
              <View style={styles.conversationIntro}>
                <View style={styles.conversationIcon}>
                  <Feather name="message-circle" size={18} color="#B9A7FF" />
                </View>
                <Text style={styles.conversationTitle}>Your conversation</Text>
                <Text style={styles.conversationSubtitle}>
                  Ask about grades, studying, planning, or college preparation.
                </Text>
              </View>
            }
            ListFooterComponent={isSending ? <TypingIndicator /> : <View style={styles.chatFooterSpace} />}
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
          />
        ) : (
          <ScrollView
            style={styles.homeScroll}
            contentContainerStyle={styles.homeContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.heroCard}>
              <View style={styles.heroTopRow}>
                <View style={styles.heroBadge}>
                  <Feather name="zap" size={15} color="#D9CFFF" />
                  <Text style={styles.heroBadgeText}>YOUR AI COPILOT</Text>
                </View>
                <View style={styles.secureBadge}>
                  <Feather name="shield" size={13} color="#78E9CE" />
                  <Text style={styles.secureBadgeText}>Student-aware</Text>
                </View>
              </View>

              <Text style={styles.heroTitle}>Hi {firstName}, what can we work on?</Text>
              <Text style={styles.heroDescription}>
                Get personalized support for school, planning, grades, and your path to college.
              </Text>

            </View>

            <View style={styles.sectionHeader}>
              <View>
                <Text style={styles.sectionEyebrow}>QUICK START</Text>
                <Text style={styles.sectionTitle}>What do you need help with?</Text>
              </View>
              <Feather name="star" size={17} color="#8F78FF" />
            </View>

            <View style={styles.promptGrid}>
              {PROMPT_ROWS.map((row, rowIndex) => (
                <View key={`prompt-row-${rowIndex}`} style={styles.promptRow}>
                  {row.map((prompt) => (
                    <View key={prompt.label} style={styles.promptCardShell}>
                      <Pressable
                        onPress={() => void handleSend(prompt.prompt)}
                        style={({ pressed }) => [
                          styles.promptCardPressable,
                          pressed && styles.promptCardPressed,
                        ]}
                        accessibilityRole="button"
                        accessibilityLabel={prompt.label}
                      >
                        <View
                          pointerEvents="none"
                          style={[
                            styles.promptIcon,
                            {
                              backgroundColor: prompt.background,
                              borderColor: `${prompt.color}66`,
                            },
                          ]}
                        >
                          <Feather name={prompt.icon} size={19} color={prompt.color} />
                        </View>

                        <Text
                          pointerEvents="none"
                          style={styles.promptLabel}
                          numberOfLines={2}
                          ellipsizeMode="tail"
                        >
                          {prompt.label}
                        </Text>

                        <View pointerEvents="none" style={styles.promptArrow}>
                          <Feather name="chevron-right" size={16} color="#8FA2BE" />
                        </View>
                      </Pressable>
                    </View>
                  ))}
                </View>
              ))}
            </View>

          </ScrollView>
        )}

        <Composer
          value={input}
          onChangeText={setInput}
          onSend={() => void handleSend()}
          canSend={canSend}
          isSending={isSending}
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

interface HeaderProps {
  showChat: boolean
  historyCount: number
  onBack: () => void
  onOpenHistory: () => void
}

function Header({
  showChat,
  historyCount,
  onBack,
  onOpenHistory,
}: HeaderProps): React.JSX.Element {
  return (
    <View style={styles.header}>
      <View style={styles.headerLeft}>
        {showChat ? (
          <Pressable
            onPress={onBack}
            style={({ pressed }) => [styles.headerIconButton, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Back to AI home"
          >
            <Feather name="arrow-left" size={20} color="#E8ECF7" />
          </Pressable>
        ) : (
          <View style={styles.logoWrap}>
            <Image source={APP_LOGO} style={styles.headerLogo} resizeMode="contain" />
          </View>
        )}

        <View style={styles.headerCopy}>
          <Text style={styles.headerTitle}>myFuturely AI</Text>
          <View style={styles.onlineRow}>
            <View style={styles.onlineDot} />
            <Text style={styles.onlineText}>Online and ready</Text>
          </View>
        </View>
      </View>

      <Pressable
        onPress={onOpenHistory}
        style={({ pressed }) => [styles.historyButton, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel="View past chats"
      >
        <Feather name="clock" size={16} color="#C9BBFF" />
        <Text style={styles.historyButtonText}>Chats</Text>
        {historyCount > 0 ? (
          <View style={styles.historyCount}>
            <Text style={styles.historyCountText}>{Math.min(historyCount, 99)}</Text>
          </View>
        ) : null}
      </Pressable>
    </View>
  )
}

interface PastChatsModalProps {
  visible: boolean
  sessions: ChatSession[]
  onClose: () => void
  onOpenChat: (session: ChatSession) => void
  onNewChat: () => void
}

function PastChatsModal({
  visible,
  sessions,
  onClose,
  onOpenChat,
  onNewChat,
}: PastChatsModalProps): React.JSX.Element {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.modalBackdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />

        <View style={styles.historySheet}>
          <View style={styles.historySheetHeader}>
            <View>
              <Text style={styles.historyEyebrow}>MYFUTURELY AI</Text>
              <Text style={styles.historyTitle}>Past chats</Text>
              <Text style={styles.historySubtitle}>
                Continue a previous conversation.
              </Text>
            </View>

            <Pressable
              onPress={onClose}
              style={({ pressed }) => [
                styles.historyCloseButton,
                pressed && styles.pressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Close past chats"
            >
              <Feather name="x" size={18} color="#DCE4F2" />
            </Pressable>
          </View>

          {sessions.length === 0 ? (
            <View style={styles.historyEmpty}>
              <View style={styles.historyEmptyIcon}>
                <Feather name="message-square" size={22} color="#A996FF" />
              </View>
              <Text style={styles.historyEmptyTitle}>No past chats yet</Text>
              <Text style={styles.historyEmptyText}>
                Your conversations will appear here after you ask a question.
              </Text>
            </View>
          ) : (
            <FlatList
              data={sessions}
              keyExtractor={(item) => item.id}
              style={styles.historyList}
              contentContainerStyle={styles.historyListContent}
              showsVerticalScrollIndicator={false}
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => onOpenChat(item)}
                  style={({ pressed }) => [
                    styles.historyCard,
                    pressed && styles.historyCardPressed,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={`Open chat: ${item.title}`}
                >
                  <View style={styles.historyCardIcon}>
                    <Feather name="message-circle" size={17} color="#B9A7FF" />
                  </View>

                  <View style={styles.historyCardCopy}>
                    <Text style={styles.historyCardTitle} numberOfLines={1}>
                      {item.title}
                    </Text>
                    <Text style={styles.historyCardMeta}>
                      {formatChatDate(item.updatedAt)} · {item.messages.length} messages
                    </Text>
                  </View>

                  <Feather name="chevron-right" size={17} color="#7186A5" />
                </Pressable>
              )}
            />
          )}

          <Pressable
            onPress={onNewChat}
            style={({ pressed }) => [
              styles.historyNewButton,
              pressed && styles.historyNewButtonPressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Start a new chat"
          >
            <Feather name="plus" size={17} color="#FFFFFF" />
            <Text style={styles.historyNewButtonText}>Start new chat</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  )
}

interface ComposerProps {
  value: string
  onChangeText: (value: string) => void
  onSend: () => void
  canSend: boolean
  isSending: boolean
}

function Composer({ value, onChangeText, onSend, canSend, isSending }: ComposerProps): React.JSX.Element {
  return (
    <View style={styles.composerArea}>
      <View style={styles.composer}>
        <View style={styles.composerIcon}>
          <Feather name="message-circle" size={18} color="#B7A5FF" />
        </View>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          style={styles.input}
          placeholder="Ask myFuturely AI anything..."
          placeholderTextColor="#6F809A"
          editable={!isSending}
          multiline
          maxLength={1200}
          returnKeyType="send"
          blurOnSubmit={false}
          accessibilityLabel="Ask myFuturely AI"
        />
        <Pressable
          onPress={onSend}
          disabled={!canSend}
          style={({ pressed }) => [
            styles.sendButton,
            !canSend && styles.sendButtonDisabled,
            pressed && canSend && styles.sendButtonPressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Send message"
        >
          {isSending ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Feather name="send" size={17} color="#FFFFFF" />
          )}
        </Pressable>
      </View>
      <Text style={styles.composerHint}>AI can make mistakes. Check important academic information.</Text>
    </View>
  )
}

function MessageBubble({ message }: { message: ChatMessage }): React.JSX.Element {
  const isUser = message.role === 'user'

  return (
    <View style={[styles.messageRow, isUser ? styles.messageRowUser : styles.messageRowAi]}>
      {!isUser ? (
        <View style={styles.messageAvatar}>
          <Image source={APP_LOGO} style={styles.messageLogo} resizeMode="contain" />
        </View>
      ) : null}

      <View style={[styles.messageBubble, isUser ? styles.userBubble : styles.aiBubble]}>
        {!isUser ? <Text style={styles.messageAuthor}>myFuturely AI</Text> : null}
        <Text style={[styles.messageText, isUser && styles.userMessageText]}>{message.text}</Text>
      </View>
    </View>
  )
}

function TypingIndicator(): React.JSX.Element {
  return (
    <View style={[styles.messageRow, styles.messageRowAi]}>
      <View style={styles.messageAvatar}>
        <Image source={APP_LOGO} style={styles.messageLogo} resizeMode="contain" />
      </View>
      <View style={[styles.messageBubble, styles.aiBubble, styles.typingBubble]}>
        <ActivityIndicator size="small" color="#9B83FF" />
        <Text style={styles.typingText}>Thinking...</Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#05070D',
  },
  keyboardView: {
    flex: 1,
    backgroundColor: '#05070D',
  },
  pressed: {
    opacity: 0.84,
    transform: [{ scale: 0.985 }],
  },
  header: {
    minHeight: 72,
    paddingHorizontal: 16,
    paddingVertical: 11,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(113,132,165,0.14)',
    backgroundColor: '#070A12',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },
  logoWrap: {
    width: 45,
    height: 45,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0E1421',
    borderWidth: 1,
    borderColor: 'rgba(112,152,222,0.34)',
    overflow: 'hidden',
  },
  headerLogo: {
    width: 37,
    height: 37,
  },
  headerIconButton: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#26344C',
  },
  headerCopy: {
    gap: 3,
  },
  headerTitle: {
    color: '#F5F7FF',
    fontSize: 19,
    lineHeight: 23,
    fontWeight: '800',
    letterSpacing: -0.35,
  },
  onlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  onlineDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#27D6A2',
  },
  onlineText: {
    color: '#77DDBF',
    fontSize: 10.5,
    fontWeight: '600',
  },
  historyButton: {
    minHeight: 39,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 12,
    backgroundColor: '#141127',
    borderWidth: 1,
    borderColor: 'rgba(151,119,255,0.30)',
  },
  historyButtonText: {
    color: '#D4C9FF',
    fontSize: 10.5,
    fontWeight: '800',
  },
  historyCount: {
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#6840E8',
  },
  historyCountText: {
    color: '#FFFFFF',
    fontSize: 8.5,
    fontWeight: '800',
  },
  homeScroll: {
    flex: 1,
  },
  homeContent: {
    paddingHorizontal: 15,
    paddingTop: 15,
    paddingBottom: 20,
    gap: 17,
  },
  heroCard: {
    padding: 17,
    borderRadius: 24,
    backgroundColor: '#151238',
    borderWidth: 1,
    borderColor: 'rgba(141,102,255,0.42)',
    overflow: 'hidden',
  },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 16,
  },
  heroBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  heroBadgeText: {
    color: '#BFB0F4',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.15,
  },
  secureBadge: {
    minHeight: 27,
    paddingHorizontal: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 10,
    backgroundColor: 'rgba(20,49,55,0.68)',
    borderWidth: 1,
    borderColor: 'rgba(57,207,170,0.25)',
  },
  secureBadgeText: {
    color: '#81E4C8',
    fontSize: 9.5,
    fontWeight: '700',
  },
  heroTitle: {
    maxWidth: 310,
    color: '#FFFFFF',
    fontSize: 25,
    lineHeight: 31,
    fontWeight: '800',
    letterSpacing: -0.65,
  },
  heroDescription: {
    marginTop: 8,
    color: '#AAA6C9',
    fontSize: 11.5,
    lineHeight: 17,
    maxWidth: 315,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 12,
  },
  sectionEyebrow: {
    color: '#6888B5',
    fontSize: 8.5,
    fontWeight: '800',
    letterSpacing: 1.15,
  },
  sectionTitle: {
    marginTop: 3,
    color: '#F4F6FD',
    fontSize: 16.5,
    lineHeight: 21,
    fontWeight: '800',
    letterSpacing: -0.25,
  },
  promptGrid: {
    width: '100%',
    alignSelf: 'stretch',
    gap: 11,
  },
  promptRow: {
    width: '100%',
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 11,
  },
  promptCardShell: {
    flex: 1,
    flexBasis: 0,
    minWidth: 0,
    height: 88,
    overflow: 'hidden',
    borderRadius: 17,
    backgroundColor: '#16243A',
    borderWidth: 1,
    borderColor: '#2B4262',
  },
  promptCardPressable: {
    position: 'relative',
    flex: 1,
    width: '100%',
    minWidth: 0,
  },
  promptCardPressed: {
    opacity: 0.88,
    backgroundColor: '#1D304B',
  },
  promptIcon: {
    position: 'absolute',
    left: 10,
    top: 22,
    width: 44,
    height: 44,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    zIndex: 2,
  },
  promptLabel: {
    position: 'absolute',
    left: 64,
    right: 40,
    top: 28,
    color: '#F5F7FF',
    fontSize: 11.5,
    lineHeight: 15,
    fontWeight: '800',
    letterSpacing: -0.1,
    zIndex: 3,
  },
  promptArrow: {
    position: 'absolute',
    right: 8,
    top: 28,
    width: 26,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9,
    backgroundColor: '#0D1726',
    borderWidth: 1,
    borderColor: 'rgba(123,151,188,0.25)',
    zIndex: 2,
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.72)',
  },
  historySheet: {
    maxHeight: '78%',
    paddingTop: 18,
    paddingHorizontal: 15,
    paddingBottom: Platform.OS === 'ios' ? 28 : 18,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    backgroundColor: '#0B111C',
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: '#263B58',
  },
  historySheetHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 15,
  },
  historyEyebrow: {
    color: '#7E93B7',
    fontSize: 8.5,
    fontWeight: '800',
    letterSpacing: 1.15,
  },
  historyTitle: {
    marginTop: 3,
    color: '#F6F8FF',
    fontSize: 22,
    lineHeight: 27,
    fontWeight: '800',
    letterSpacing: -0.4,
  },
  historySubtitle: {
    marginTop: 3,
    color: '#7E8EA7',
    fontSize: 10.5,
    lineHeight: 15,
  },
  historyCloseButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: '#121C2C',
    borderWidth: 1,
    borderColor: '#2A3D59',
  },
  historyList: {
    maxHeight: 390,
  },
  historyListContent: {
    gap: 9,
    paddingBottom: 10,
  },
  historyCard: {
    minHeight: 69,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 11,
    borderRadius: 16,
    backgroundColor: '#111D2F',
    borderWidth: 1,
    borderColor: '#263E5D',
  },
  historyCardPressed: {
    opacity: 0.88,
    backgroundColor: '#172740',
  },
  historyCardIcon: {
    width: 39,
    height: 39,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: '#24165A',
  },
  historyCardCopy: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  historyCardTitle: {
    color: '#F1F5FF',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
  },
  historyCardMeta: {
    color: '#7F90A9',
    fontSize: 9,
    lineHeight: 12,
  },
  historyEmpty: {
    alignItems: 'center',
    paddingVertical: 28,
    paddingHorizontal: 18,
    borderRadius: 18,
    backgroundColor: '#101A2A',
    borderWidth: 1,
    borderColor: '#233850',
  },
  historyEmptyIcon: {
    width: 46,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 15,
    backgroundColor: '#211651',
  },
  historyEmptyTitle: {
    marginTop: 11,
    color: '#F3F6FF',
    fontSize: 14,
    fontWeight: '800',
  },
  historyEmptyText: {
    marginTop: 5,
    maxWidth: 250,
    color: '#7E8EA7',
    fontSize: 10.5,
    lineHeight: 15,
    textAlign: 'center',
  },
  historyNewButton: {
    minHeight: 48,
    marginTop: 13,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    borderRadius: 15,
    backgroundColor: '#6840E8',
  },
  historyNewButtonPressed: {
    opacity: 0.86,
    transform: [{ scale: 0.99 }],
  },
  historyNewButtonText: {
    color: '#FFFFFF',
    fontSize: 11.5,
    fontWeight: '800',
  },
  chatList: {
    flex: 1,
  },
  chatContent: {
    flexGrow: 1,
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 14,
  },
  conversationIntro: {
    alignItems: 'center',
    paddingTop: 8,
    paddingBottom: 24,
  },
  conversationIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#17132F',
    borderWidth: 1,
    borderColor: 'rgba(151,119,255,0.28)',
  },
  conversationTitle: {
    marginTop: 10,
    color: '#F4F6FD',
    fontSize: 15,
    fontWeight: '800',
  },
  conversationSubtitle: {
    marginTop: 5,
    maxWidth: 285,
    color: '#7888A0',
    fontSize: 10.5,
    lineHeight: 15,
    textAlign: 'center',
  },
  messageRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginBottom: 12,
  },
  messageRowAi: {
    justifyContent: 'flex-start',
  },
  messageRowUser: {
    justifyContent: 'flex-end',
  },
  messageAvatar: {
    width: 31,
    height: 31,
    marginRight: 7,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#24125C',
    borderWidth: 1,
    borderColor: 'rgba(149,108,255,0.35)',
  },
  messageLogo: {
    width: 25,
    height: 25,
  },
  messageBubble: {
    maxWidth: '82%',
    paddingHorizontal: 13,
    paddingVertical: 10,
  },
  aiBubble: {
    borderRadius: 17,
    borderBottomLeftRadius: 5,
    backgroundColor: '#111A29',
    borderWidth: 1,
    borderColor: '#253752',
  },
  userBubble: {
    borderRadius: 17,
    borderBottomRightRadius: 5,
    backgroundColor: '#6840E8',
    borderWidth: 1,
    borderColor: 'rgba(209,196,255,0.26)',
  },
  messageAuthor: {
    marginBottom: 4,
    color: '#A995F8',
    fontSize: 9.5,
    fontWeight: '800',
  },
  messageText: {
    color: '#E8EDF8',
    fontSize: 12.5,
    lineHeight: 18,
  },
  userMessageText: {
    color: '#FFFFFF',
  },
  typingBubble: {
    minWidth: 105,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  typingText: {
    color: '#8E9CB2',
    fontSize: 10.5,
    fontWeight: '600',
  },
  chatFooterSpace: {
    height: 4,
  },
  composerArea: {
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 6,
    backgroundColor: '#070A12',
    borderTopWidth: 1,
    borderTopColor: 'rgba(98,120,156,0.16)',
  },
  composer: {
    minHeight: 54,
    maxHeight: 108,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    padding: 7,
    borderRadius: 18,
    backgroundColor: '#111C2E',
    borderWidth: 1,
    borderColor: '#2A4368',
  },
  composerIcon: {
    width: 38,
    height: 38,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: '#26165E',
  },
  input: {
    flex: 1,
    minHeight: 38,
    maxHeight: 88,
    paddingHorizontal: 3,
    paddingTop: Platform.OS === 'ios' ? 10 : 8,
    paddingBottom: Platform.OS === 'ios' ? 9 : 7,
    color: '#EEF2FC',
    fontSize: 12.5,
    lineHeight: 18,
    textAlignVertical: 'center',
  },
  sendButton: {
    width: 38,
    height: 38,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: '#7048FF',
  },
  sendButtonDisabled: {
    backgroundColor: '#26334A',
    opacity: 0.7,
  },
  sendButtonPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.96 }],
  },
  composerHint: {
    marginTop: 5,
    color: '#55657C',
    fontSize: 8.5,
    textAlign: 'center',
  },
})