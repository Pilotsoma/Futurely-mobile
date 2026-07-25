import app from './app'
import { logger } from './common/logger'
import { WebSocketServer } from 'ws'
import http from 'http'
import jwt from 'jsonwebtoken'
import { clients, userClients, playerSessions, sessionPlayers, sessionAlive, sessionHealth, sessionAmmo, sessionStartTime, registerBattlePlayers, sendToUser, sendToSessionExcept, sendToAllInSession, BATTLE_START_HP, BATTLE_START_AMMO, BATTLE_MAX_AMMO, BATTLE_AMMO_REWARD } from './lib/websocket'
import { prisma } from './lib/prisma'
import { startScheduler, enqueueJobsForToday } from './services/agent/autonomousJobScheduler.service'

const PORT = Number(process.env.PORT ?? '3001')
// app.ts already exits in production when JWT_SECRET is missing or default.
// Read directly — no fallback — so WS auth behaves identically to requireAuth middleware.
const JWT_SECRET = process.env.JWT_SECRET

const server = http.createServer(app)
const wss = new WebSocketServer({ server })

// Minimal cookie-header parser — avoids pulling in a new dependency for one field.
function parseCookieHeader(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!header) return out
  for (const part of header.split(';')) {
    const idx = part.indexOf('=')
    if (idx === -1) continue
    const key = part.slice(0, idx).trim()
    const value = part.slice(idx + 1).trim()
    if (key) out[key] = decodeURIComponent(value)
  }
  return out
}

wss.on('connection', (ws, req) => {
  clients.add(ws)
  let authedUserId: number | null = null
  // Cache the battle code on this WS connection so BATTLE_* messages work
  // even if playerSessions hasn't been populated yet (race with BATTLE_READY).
  let connBattleCode: string | null = null

  // Auth happens once, at the handshake, from the same httpOnly access_token
  // cookie requireAuth uses for regular API calls — the client never sees or
  // transmits the raw JWT for this connection.
  const cookies = parseCookieHeader(req.headers.cookie)
  if (cookies.access_token && JWT_SECRET) {
    try {
      const payload = jwt.verify(cookies.access_token, JWT_SECRET, { algorithms: ['HS256'] }) as { sub?: string | number }
      const userId = typeof payload.sub === 'number' ? payload.sub : parseInt(String(payload.sub ?? ''), 10)
      if (!isNaN(userId)) {
        authedUserId = userId
        if (!userClients.has(userId)) userClients.set(userId, new Set())
        userClients.get(userId)!.add(ws)
        ws.send(JSON.stringify({ event: 'AUTH_OK', data: { userId } }))
      }
    } catch { /* invalid/expired cookie — connection stays unauthenticated */ }
  }

  async function ensureRegistered(code: string) {
    if (playerSessions.has(authedUserId!)) return
    const session = await prisma.gameSession.findUnique({
      where: { joinCode: code },
      include: { participants: { select: { userId: true } } },
    })
    if (session) {
      registerBattlePlayers([session.hostId, ...session.participants.map(p => p.userId)], code)
    }
  }

  ws.on('message', async (raw) => {
    try {
      const msg = JSON.parse(raw.toString()) as Record<string, unknown>

      if (!authedUserId) return

      if (msg.type === 'BATTLE_READY') {
        const code = String(msg.code ?? '').toUpperCase()
        connBattleCode = code
        const session = await prisma.gameSession.findUnique({
          where: { joinCode: code },
          include: { participants: { select: { userId: true } } },
        })
        if (session) {
          const allIds = [session.hostId, ...session.participants.map(p => p.userId)]
          registerBattlePlayers(allIds, code)
        }
        return
      }

      // For BATTLE_* messages, resolve code from playerSessions or the cached connBattleCode
      const resolveCode = () => playerSessions.get(authedUserId!) ?? connBattleCode

      if (msg.type === 'BATTLE_POSITION') {
        const code = resolveCode()
        if (!code) return
        await ensureRegistered(code)
        sendToSessionExcept(code, authedUserId, 'BATTLE_POSITION', {
          userId: authedUserId,
          x: msg.x, y: msg.y, z: msg.z,
          rotY: msg.rotY,
        })
        return
      }

      if (msg.type === 'BATTLE_DAMAGE') {
        const code = resolveCode()
        if (!code) return
        await ensureRegistered(code)
        const targetId = Number(msg.targetUserId)
        const damage = Math.min(50, Math.max(1, Number(msg.damage) || 25))
        const healthMap = sessionHealth.get(code)
        const alive = sessionAlive.get(code)
        if (!healthMap || !alive || !alive.has(targetId)) return
        const currentHp = healthMap.get(targetId) ?? BATTLE_START_HP
        const newHp = Math.max(0, currentHp - damage)
        healthMap.set(targetId, newHp)
        sendToAllInSession(code, 'BATTLE_PLAYER_HEALTH', { userId: targetId, hp: newHp })
        if (newHp === 0) {
          alive.delete(targetId)
          sendToAllInSession(code, 'BATTLE_ELIMINATED', { userId: targetId, eliminatedBy: authedUserId })
          if (alive.size === 1) {
            const winnerId = [...alive][0]
            sendToAllInSession(code, 'BATTLE_WIN', { userId: winnerId })
            sessionPlayers.delete(code); sessionAlive.delete(code)
            sessionHealth.delete(code); sessionAmmo.delete(code); sessionStartTime.delete(code)
          }
        }
        return
      }

      if (msg.type === 'BATTLE_NEED_AMMO') {
        try {
          let code = resolveCode()
          // Fallback: look up the user's active battle session from DB
          if (!code) {
            const part = await prisma.gameParticipant.findFirst({
              where: { userId: authedUserId!, session: { status: 'ACTIVE', type: 'BATTLE' } },
              include: { session: { select: { joinCode: true } } },
              orderBy: { joinedAt: 'desc' },
            })
            if (part) {
              code = part.session.joinCode
              connBattleCode = code
              await ensureRegistered(code)
            }
            // Also check if user is the host
            if (!code) {
              const hosted = await prisma.gameSession.findFirst({
                where: { hostId: authedUserId!, status: 'ACTIVE', type: 'BATTLE' },
                select: { joinCode: true },
                orderBy: { createdAt: 'desc' },
              })
              if (hosted) {
                code = hosted.joinCode
                connBattleCode = code
                await ensureRegistered(code)
              }
            }
          }
          if (!code) { sendToUser(authedUserId!, 'BATTLE_ERROR', { message: 'Not in an active battle' }); return }
          const session = await prisma.gameSession.findUnique({
            where: { joinCode: code },
            include: { set: { select: { questions: { select: { id: true, questionText: true, options: true, correctAnswer: true }, orderBy: { orderIndex: 'asc' } } } } },
          })
          if (!session) { sendToUser(authedUserId!, 'BATTLE_ERROR', { message: 'Session not found' }); return }
          const questions = session.set.questions
          if (!questions.length) { sendToUser(authedUserId!, 'BATTLE_ERROR', { message: 'No questions in this set' }); return }
          const idx = Math.floor(Math.random() * questions.length)
          const q = questions[idx]!
          sendToUser(authedUserId!, 'BATTLE_QUESTION', {
            questionId: q.id,
            questionText: q.questionText,
            options: q.options,
          })
        } catch (err) {
          sendToUser(authedUserId!, 'BATTLE_ERROR', { message: 'Failed to load question' })
        }
        return
      }

      if (msg.type === 'BATTLE_ANSWER') {
        const code = resolveCode()
        if (!code) return
        try {
          const questionId = Number(msg.questionId)
          const answer = String(msg.answer ?? '')
          const q = await prisma.question.findUnique({ where: { id: questionId }, select: { correctAnswer: true } })
          if (!q) return
          const isCorrect = q.correctAnswer === answer
          if (isCorrect) {
            const ammoMap = sessionAmmo.get(code)
            if (!ammoMap) return
            const current = ammoMap.get(authedUserId) ?? BATTLE_START_AMMO
            const newAmmo = Math.min(BATTLE_MAX_AMMO, current + BATTLE_AMMO_REWARD)
            ammoMap.set(authedUserId, newAmmo)
            sendToUser(authedUserId, 'BATTLE_AMMO', { ammo: newAmmo, correct: true })
          } else {
            sendToUser(authedUserId, 'BATTLE_AMMO', { ammo: sessionAmmo.get(code)?.get(authedUserId) ?? 0, correct: false })
          }
        } catch { /* ignore */ }
        return
      }
    } catch {
      // ignore malformed messages
    }
  })

  ws.on('close', () => {
    clients.delete(ws)
    if (authedUserId !== null) {
      const set = userClients.get(authedUserId)
      set?.delete(ws)
      if (set?.size === 0) userClients.delete(authedUserId)
    }
  })
})

server.listen(PORT, '0.0.0.0', () => {
  logger.info('Futurely API started', {
    port: PORT,
    url: `http://0.0.0.0:${PORT}`,
  })

  // Start the autonomous agent scheduler. No-op if AUTONOMOUS_AGENTS_ENABLED
  // is not "true". Runs only in persistent-server deployments (Render) —
  // the setInterval would not survive Vercel invocation boundaries.
  startScheduler()

  // Enqueue today's jobs immediately on startup so users with scheduled jobs
  // don't have to wait until the next midnight/7am window.
  enqueueJobsForToday().catch(err => {
    logger.error('startup_enqueue_error', {
      error: err instanceof Error ? err.message : String(err),
    })
  })
})
