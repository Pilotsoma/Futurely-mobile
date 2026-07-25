import { Router, Response } from 'express'
import { prisma } from '../lib/prisma'
import { AuthRequest } from '../middleware/auth'

const router = Router()

/* GET /api/notifications — fetch the current user's notifications, newest first */
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!
    const notifications = await prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        sender: { select: { id: true, name: true, tag: true, tagColor: true } },
      },
    })
    const unreadCount = notifications.filter(n => !n.read).length
    res.json({ data: { notifications, unreadCount } })
  } catch {
    res.status(500).json({ error: 'Failed to fetch notifications' })
  }
})

/* POST /api/notifications/read-all — mark all as read */
router.post('/read-all', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!
    await prisma.notification.updateMany({
      where: { userId, read: false },
      data: { read: true },
    })
    res.json({ data: { ok: true } })
  } catch {
    res.status(500).json({ error: 'Failed to mark notifications read' })
  }
})

/* POST /api/notifications/:id/read — mark single notification as read */
router.post('/:id/read', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!
    const id = parseInt(req.params.id)
    await prisma.notification.updateMany({
      where: { id, userId },
      data: { read: true },
    })
    res.json({ data: { ok: true } })
  } catch {
    res.status(500).json({ error: 'Failed to mark notification read' })
  }
})

export default router
