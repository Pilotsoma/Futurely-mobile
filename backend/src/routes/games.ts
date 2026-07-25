import { Router, Response } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { requireAuth, AuthRequest } from '../middleware/auth'
import { sendToSession, sendToUser } from '../lib/websocket'
import { logger } from '../common/logger'

const router = Router()

function makeCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)]
  return code
}

async function uniqueCode(): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = makeCode()
    const existing = await prisma.gameSession.findUnique({ where: { joinCode: code }, select: { id: true } })
    if (!existing) return code
  }
  throw new Error('Could not generate unique code')
}

function participantIds(session: { participants: Array<{ userId: number }> }): number[] {
  return session.participants.map(p => p.userId)
}

const sessionInclude = {
  set: {
    select: {
      title: true,
      questions: { select: { id: true, orderIndex: true, questionText: true, questionType: true, options: true, timeLimit: true }, orderBy: { orderIndex: 'asc' as const } },
    },
  },
  host: { select: { id: true, name: true } },
  participants: {
    orderBy: { score: 'desc' as const },
    include: { user: { select: { id: true, name: true, tag: true, tagColor: true, nameColor: true, avatarUrl: true } } },
  },
} as const

// ── POST /games — create session (host) ─────────────────────────────────────
router.post('/', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.userId) { res.status(401).json({ data: null, error: { code: 'UNAUTHORIZED', message: 'Missing authentication' } }); return }
  const parse = z.object({ setId: z.number().int().positive(), type: z.enum(['QUIZ', 'BATTLE']).default('QUIZ') }).safeParse(req.body)
  if (!parse.success) { res.status(400).json({ data: null, error: { code: 'VALIDATION_ERROR', message: 'setId required' } }); return }
  try {
    const set = await prisma.questionSet.findUnique({ where: { id: parse.data.setId }, select: { id: true, creatorId: true, visibility: true, _count: { select: { questions: true } } } })
    if (!set) { res.status(404).json({ data: null, error: { code: 'NOT_FOUND', message: 'Set not found' } }); return }
    if (set.visibility === 'PRIVATE' && set.creatorId !== req.userId) { res.status(403).json({ data: null, error: { code: 'FORBIDDEN', message: 'Cannot host a private set you do not own' } }); return }
    if (set._count.questions === 0) { res.status(400).json({ data: null, error: { code: 'EMPTY_SET', message: 'Add at least one question before hosting' } }); return }
    const joinCode = await uniqueCode()
    const session = await prisma.gameSession.create({
      data: { setId: parse.data.setId, hostId: req.userId, joinCode, type: parse.data.type },
      include: sessionInclude,
    })
    res.status(201).json({ data: session, error: null })
  } catch (err: unknown) {
    logger.error('game_create_error', { userId: req.userId, error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to create game' } })
  }
})

// ── GET /games/:code — get session state ────────────────────────────────────
router.get('/:code', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.userId) { res.status(401).json({ data: null, error: { code: 'UNAUTHORIZED', message: 'Missing authentication' } }); return }
  const code = req.params.code.toUpperCase()
  try {
    const session = await prisma.gameSession.findUnique({ where: { joinCode: code }, include: sessionInclude })
    if (!session) { res.status(404).json({ data: null, error: { code: 'NOT_FOUND', message: 'Game not found' } }); return }
    // Strip correctAnswer from questions (only host sees it)
    const isHost = session.hostId === req.userId
    const questions = session.set.questions.map(q => ({
      ...q,
      correctAnswer: isHost ? (q as unknown as { correctAnswer: string }).correctAnswer : undefined,
    }))
    res.json({ data: { ...session, set: { ...session.set, questions } }, error: null })
  } catch (err: unknown) {
    logger.error('game_get_error', { userId: req.userId, code, error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch game' } })
  }
})

// ── POST /games/:code/join ───────────────────────────────────────────────────
router.post('/:code/join', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.userId) { res.status(401).json({ data: null, error: { code: 'UNAUTHORIZED', message: 'Missing authentication' } }); return }
  const code = req.params.code.toUpperCase()
  try {
    const session = await prisma.gameSession.findUnique({ where: { joinCode: code }, include: sessionInclude })
    if (!session) { res.status(404).json({ data: null, error: { code: 'NOT_FOUND', message: 'Game not found' } }); return }
    if (session.status === 'FINISHED') { res.status(400).json({ data: null, error: { code: 'GAME_FINISHED', message: 'This game has ended' } }); return }
    if (session.status === 'ACTIVE') { res.status(400).json({ data: null, error: { code: 'GAME_STARTED', message: 'This game has already started' } }); return }
    const existing = session.participants.find(p => p.userId === req.userId)
    if (existing) { res.json({ data: session, error: null }); return }
    if (session.hostId === req.userId) { res.json({ data: session, error: null }); return }
    const updated = await prisma.gameSession.update({
      where: { joinCode: code },
      data: { participants: { create: { userId: req.userId } } },
      include: sessionInclude,
    })
    sendToUser(session.hostId, 'GAME_PLAYER_JOINED', {
      sessionId: session.id,
      participants: updated.participants,
    })
    res.json({ data: updated, error: null })
  } catch (err: unknown) {
    logger.error('game_join_error', { userId: req.userId, code, error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to join game' } })
  }
})

// ── POST /games/:code/start ──────────────────────────────────────────────────
router.post('/:code/start', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.userId) { res.status(401).json({ data: null, error: { code: 'UNAUTHORIZED', message: 'Missing authentication' } }); return }
  const code = req.params.code.toUpperCase()
  try {
    const session = await prisma.gameSession.findUnique({ where: { joinCode: code }, include: sessionInclude })
    if (!session) { res.status(404).json({ data: null, error: { code: 'NOT_FOUND', message: 'Game not found' } }); return }
    if (session.hostId !== req.userId) { res.status(403).json({ data: null, error: { code: 'FORBIDDEN', message: 'Only the host can start the game' } }); return }
    if (session.status !== 'WAITING') { res.status(400).json({ data: null, error: { code: 'ALREADY_STARTED', message: 'Game already started' } }); return }
    if (session.participants.length === 0) { res.status(400).json({ data: null, error: { code: 'NO_PLAYERS', message: 'At least one player must join before starting' } }); return }
    const updated = await prisma.gameSession.update({ where: { joinCode: code }, data: { status: 'ACTIVE', currentQuestion: 0 }, include: sessionInclude })
    const questions = session.set.questions as Array<{ id: number; questionText: string; questionType: string; options: unknown; timeLimit: number; correctAnswer?: string }>
    const firstQ = questions[0]
    const allUserIds = [session.hostId, ...participantIds(session)]
    sendToSession(allUserIds, 'GAME_STARTED', {
      sessionId: session.id,
      questionIndex: 0,
      totalQuestions: questions.length,
      question: {
        id: firstQ?.id,
        questionText: firstQ?.questionText,
        questionType: firstQ?.questionType,
        options: firstQ?.options,
        timeLimit: firstQ?.timeLimit,
      },
    })
    res.json({ data: updated, error: null })
  } catch (err: unknown) {
    logger.error('game_start_error', { userId: req.userId, code, error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to start game' } })
  }
})

// ── POST /games/:code/answer ─────────────────────────────────────────────────
router.post('/:code/answer', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.userId) { res.status(401).json({ data: null, error: { code: 'UNAUTHORIZED', message: 'Missing authentication' } }); return }
  const code = req.params.code.toUpperCase()
  const parse = z.object({ questionId: z.number().int(), answer: z.string().min(1), timeMs: z.number().int().min(0).default(0) }).safeParse(req.body)
  if (!parse.success) { res.status(400).json({ data: null, error: { code: 'VALIDATION_ERROR', message: parse.error.errors[0]?.message ?? 'Invalid input' } }); return }
  try {
    const session = await prisma.gameSession.findUnique({ where: { joinCode: code }, include: { participants: true, set: { select: { questions: true } } } })
    if (!session) { res.status(404).json({ data: null, error: { code: 'NOT_FOUND', message: 'Game not found' } }); return }
    if (session.status !== 'ACTIVE') { res.status(400).json({ data: null, error: { code: 'NOT_ACTIVE', message: 'Game is not active' } }); return }
    const participant = session.participants.find(p => p.userId === req.userId)
    if (!participant) { res.status(403).json({ data: null, error: { code: 'NOT_PARTICIPANT', message: 'You are not in this game' } }); return }
    const question = (session.set.questions as Array<{ id: number; correctAnswer: string; timeLimit: number }>).find(q => q.id === parse.data.questionId)
    if (!question) { res.status(404).json({ data: null, error: { code: 'NOT_FOUND', message: 'Question not found' } }); return }
    const isCorrect = parse.data.answer === question.correctAnswer
    const pointsEarned = isCorrect ? Math.round(1000 * Math.max(0.5, 1 - parse.data.timeMs / (question.timeLimit * 1000))) : 0
    await prisma.gameAnswer.upsert({
      where: { participantId_questionId: { participantId: participant.id, questionId: parse.data.questionId } },
      create: { sessionId: session.id, participantId: participant.id, questionId: parse.data.questionId, answer: parse.data.answer, isCorrect, timeMs: parse.data.timeMs },
      update: { answer: parse.data.answer, isCorrect, timeMs: parse.data.timeMs },
    })
    if (isCorrect) {
      await prisma.gameParticipant.update({ where: { id: participant.id }, data: { score: { increment: pointsEarned } } })
    }
    const answerCount = await prisma.gameAnswer.count({ where: { sessionId: session.id, questionId: parse.data.questionId } })
    sendToUser(session.hostId, 'GAME_ANSWER_RECEIVED', {
      sessionId: session.id,
      questionId: parse.data.questionId,
      answerCount,
      totalPlayers: session.participants.length,
    })
    res.json({ data: { isCorrect, pointsEarned }, error: null })
  } catch (err: unknown) {
    logger.error('game_answer_error', { userId: req.userId, code, error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to submit answer' } })
  }
})

// ── POST /games/:code/reveal — host reveals results for current question ─────
router.post('/:code/reveal', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.userId) { res.status(401).json({ data: null, error: { code: 'UNAUTHORIZED', message: 'Missing authentication' } }); return }
  const code = req.params.code.toUpperCase()
  try {
    const session = await prisma.gameSession.findUnique({ where: { joinCode: code }, include: sessionInclude })
    if (!session) { res.status(404).json({ data: null, error: { code: 'NOT_FOUND', message: 'Game not found' } }); return }
    if (session.hostId !== req.userId) { res.status(403).json({ data: null, error: { code: 'FORBIDDEN', message: 'Only the host can reveal results' } }); return }
    if (session.status !== 'ACTIVE') { res.status(400).json({ data: null, error: { code: 'NOT_ACTIVE', message: 'Game is not active' } }); return }
    const questions = session.set.questions as Array<{ id: number; correctAnswer?: string; questionText: string; questionType: string; options: unknown; timeLimit: number }>
    const currentQ = questions[session.currentQuestion]
    if (!currentQ) { res.status(400).json({ data: null, error: { code: 'BAD_STATE', message: 'No current question' } }); return }
    const fullQ = await prisma.question.findUnique({ where: { id: currentQ.id }, select: { correctAnswer: true } })
    const updatedSession = await prisma.gameSession.findUnique({ where: { joinCode: code }, include: { participants: { orderBy: { score: 'desc' }, include: { user: { select: { id: true, name: true } } } } } })
    const allUserIds = [session.hostId, ...participantIds(session)]
    sendToSession(allUserIds, 'GAME_RESULTS', {
      sessionId: session.id,
      questionId: currentQ.id,
      correctAnswer: fullQ?.correctAnswer,
      leaderboard: updatedSession?.participants.map((p, rank) => ({ rank: rank + 1, userId: p.userId, name: p.user.name, score: p.score })) ?? [],
    })
    res.json({ data: { ok: true }, error: null })
  } catch (err: unknown) {
    logger.error('game_reveal_error', { userId: req.userId, code, error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to reveal results' } })
  }
})

// ── POST /games/:code/next — host advances to next question or ends game ──────
router.post('/:code/next', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.userId) { res.status(401).json({ data: null, error: { code: 'UNAUTHORIZED', message: 'Missing authentication' } }); return }
  const code = req.params.code.toUpperCase()
  try {
    const session = await prisma.gameSession.findUnique({ where: { joinCode: code }, include: sessionInclude })
    if (!session) { res.status(404).json({ data: null, error: { code: 'NOT_FOUND', message: 'Game not found' } }); return }
    if (session.hostId !== req.userId) { res.status(403).json({ data: null, error: { code: 'FORBIDDEN', message: 'Only the host can advance the game' } }); return }
    if (session.status !== 'ACTIVE') { res.status(400).json({ data: null, error: { code: 'NOT_ACTIVE', message: 'Game is not active' } }); return }
    const questions = session.set.questions as Array<{ id: number; questionText: string; questionType: string; options: unknown; timeLimit: number }>
    const nextIndex = session.currentQuestion + 1
    const allUserIds = [session.hostId, ...participantIds(session)]
    if (nextIndex >= questions.length) {
      const updated = await prisma.gameSession.update({ where: { joinCode: code }, data: { status: 'FINISHED' }, include: { participants: { orderBy: { score: 'desc' }, include: { user: { select: { id: true, name: true, tag: true, tagColor: true, nameColor: true, avatarUrl: true } } } } } })
      sendToSession(allUserIds, 'GAME_ENDED', {
        sessionId: session.id,
        leaderboard: updated.participants.map((p, rank) => ({ rank: rank + 1, userId: p.userId, name: p.user.name, score: p.score, tag: p.user.tag, tagColor: p.user.tagColor, nameColor: p.user.nameColor })),
      })
      res.json({ data: { status: 'FINISHED' }, error: null })
    } else {
      await prisma.gameSession.update({ where: { joinCode: code }, data: { currentQuestion: nextIndex } })
      const nextQ = questions[nextIndex]
      sendToSession(allUserIds, 'GAME_QUESTION', {
        sessionId: session.id,
        questionIndex: nextIndex,
        totalQuestions: questions.length,
        question: { id: nextQ?.id, questionText: nextQ?.questionText, questionType: nextQ?.questionType, options: nextQ?.options, timeLimit: nextQ?.timeLimit },
      })
      res.json({ data: { status: 'ACTIVE', questionIndex: nextIndex }, error: null })
    }
  } catch (err: unknown) {
    logger.error('game_next_error', { userId: req.userId, code, error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to advance game' } })
  }
})

export default router
