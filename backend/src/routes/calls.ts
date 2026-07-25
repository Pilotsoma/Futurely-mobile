import { Router, Response } from 'express'
import { AccessToken } from 'livekit-server-sdk'
import { z } from 'zod'
import { requireAuth, AuthRequest } from '../middleware/auth'
import { prisma } from '../lib/prisma'

const router = Router()

const TokenBody = z.object({
  targetUserId: z.number().int().positive(),
})

// POST /calls/token
// Caller requests a LiveKit token for a 1:1 room with targetUserId.
// Room name is deterministic so both participants join the same room.
router.post('/token', requireAuth, async (req: AuthRequest, res: Response) => {
  const parsed = TokenBody.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ data: null, error: { code: 'INVALID_INPUT', message: 'targetUserId required' } })
    return
  }

  const callerId = req.userId!
  const { targetUserId } = parsed.data

  if (callerId === targetUserId) {
    res.status(400).json({ data: null, error: { code: 'INVALID_INPUT', message: 'Cannot call yourself' } })
    return
  }

  const apiKey = process.env.LIVEKIT_API_KEY
  const apiSecret = process.env.LIVEKIT_API_SECRET
  if (!apiKey || !apiSecret) {
    res.status(500).json({ data: null, error: { code: 'CONFIG_ERROR', message: 'LiveKit not configured' } })
    return
  }

  // Deterministic room name — lower userId first
  const roomName = `call-${Math.min(callerId, targetUserId)}-${Math.max(callerId, targetUserId)}`

  const caller = await prisma.user.findUnique({ where: { id: callerId }, select: { name: true, hacName: true } })
  const participantName = caller?.name ?? caller?.hacName ?? `User ${callerId}`

  const at = new AccessToken(apiKey, apiSecret, {
    identity: String(callerId),
    name: participantName,
    ttl: 60 * 30, // 30 minutes
  })
  at.addGrant({ roomJoin: true, room: roomName, canPublish: true, canSubscribe: true })

  const token = await at.toJwt()

  res.json({ data: { token, roomName, livekitUrl: process.env.LIVEKIT_URL } })
})

export default router
