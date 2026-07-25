import { Router, Response } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { requireAuth, AuthRequest } from '../middleware/auth'
import { logger } from '../common/logger'

const router = Router()

const questionSchema = z.object({
  questionText:  z.string().min(1).max(500),
  questionType:  z.enum(['MULTIPLE_CHOICE', 'TRUE_FALSE']).default('MULTIPLE_CHOICE'),
  options:       z.array(z.string().min(1).max(200)).min(2).max(4),
  correctAnswer: z.string().min(1),
  timeLimit:     z.number().int().min(5).max(120).default(20),
})

const setSchema = z.object({
  title:       z.string().min(1).max(120),
  description: z.string().max(400).optional().nullable(),
  subject:     z.string().max(80).optional().nullable(),
  visibility:  z.enum(['PUBLIC', 'PRIVATE']).default('PRIVATE'),
  questions:   z.array(questionSchema).max(50).optional(),
})

// ── GET /sets — browse (public + your own) ──────────────────────────────────
router.get('/', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.userId) { res.status(401).json({ data: null, error: { code: 'UNAUTHORIZED', message: 'Missing authentication' } }); return }
  try {
    const q       = String(req.query.q ?? '').trim()
    const subject = String(req.query.subject ?? '').trim()
    const mine    = req.query.mine === 'true'

    const sets = await prisma.questionSet.findMany({
      where: {
        AND: [
          mine
            ? { creatorId: req.userId }
            : { OR: [{ visibility: 'PUBLIC' }, { creatorId: req.userId }] },
          q ? { title: { contains: q, mode: 'insensitive' } } : {},
          subject ? { subject: { contains: subject, mode: 'insensitive' } } : {},
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        creator: { select: { id: true, name: true } },
        _count:  { select: { questions: true } },
      },
    })
    res.json({ data: sets, error: null })
  } catch (err: unknown) {
    logger.error('sets_list_error', { userId: req.userId, error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch sets' } })
  }
})

// ── POST /sets — create ──────────────────────────────────────────────────────
router.post('/', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.userId) { res.status(401).json({ data: null, error: { code: 'UNAUTHORIZED', message: 'Missing authentication' } }); return }
  const parse = setSchema.safeParse(req.body)
  if (!parse.success) { res.status(400).json({ data: null, error: { code: 'VALIDATION_ERROR', message: parse.error.errors[0]?.message ?? 'Invalid input' } }); return }
  try {
    const { questions, ...setData } = parse.data
    const set = await prisma.questionSet.create({
      data: {
        ...setData,
        creatorId: req.userId,
        questions: questions?.length
          ? { create: questions.map((q, i) => ({ ...q, orderIndex: i, options: q.options })) }
          : undefined,
      },
      include: {
        creator: { select: { id: true, name: true } },
        questions: { orderBy: { orderIndex: 'asc' } },
        _count: { select: { questions: true } },
      },
    })
    res.status(201).json({ data: set, error: null })
  } catch (err: unknown) {
    logger.error('set_create_error', { userId: req.userId, error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to create set' } })
  }
})

// ── GET /sets/:id ────────────────────────────────────────────────────────────
router.get('/:id', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.userId) { res.status(401).json({ data: null, error: { code: 'UNAUTHORIZED', message: 'Missing authentication' } }); return }
  const id = parseInt(req.params.id)
  if (isNaN(id)) { res.status(400).json({ data: null, error: { code: 'VALIDATION_ERROR', message: 'Invalid id' } }); return }
  try {
    const set = await prisma.questionSet.findUnique({
      where: { id },
      include: {
        creator: { select: { id: true, name: true } },
        questions: { orderBy: { orderIndex: 'asc' } },
        _count: { select: { questions: true } },
      },
    })
    if (!set) { res.status(404).json({ data: null, error: { code: 'NOT_FOUND', message: 'Set not found' } }); return }
    if (set.visibility === 'PRIVATE' && set.creatorId !== req.userId) {
      res.status(403).json({ data: null, error: { code: 'FORBIDDEN', message: 'This set is private' } }); return
    }
    res.json({ data: set, error: null })
  } catch (err: unknown) {
    logger.error('set_get_error', { userId: req.userId, id, error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch set' } })
  }
})

// ── PUT /sets/:id ────────────────────────────────────────────────────────────
router.put('/:id', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.userId) { res.status(401).json({ data: null, error: { code: 'UNAUTHORIZED', message: 'Missing authentication' } }); return }
  const id = parseInt(req.params.id)
  if (isNaN(id)) { res.status(400).json({ data: null, error: { code: 'VALIDATION_ERROR', message: 'Invalid id' } }); return }
  const parse = setSchema.partial().safeParse(req.body)
  if (!parse.success) { res.status(400).json({ data: null, error: { code: 'VALIDATION_ERROR', message: parse.error.errors[0]?.message ?? 'Invalid input' } }); return }
  try {
    const existing = await prisma.questionSet.findUnique({ where: { id }, select: { creatorId: true } })
    if (!existing) { res.status(404).json({ data: null, error: { code: 'NOT_FOUND', message: 'Set not found' } }); return }
    if (existing.creatorId !== req.userId) { res.status(403).json({ data: null, error: { code: 'FORBIDDEN', message: 'Not your set' } }); return }
    const { questions: _, ...updateData } = parse.data
    const set = await prisma.questionSet.update({
      where: { id },
      data: updateData,
      include: { creator: { select: { id: true, name: true } }, questions: { orderBy: { orderIndex: 'asc' } }, _count: { select: { questions: true } } },
    })
    res.json({ data: set, error: null })
  } catch (err: unknown) {
    logger.error('set_update_error', { userId: req.userId, id, error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to update set' } })
  }
})

// ── DELETE /sets/:id ─────────────────────────────────────────────────────────
router.delete('/:id', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.userId) { res.status(401).json({ data: null, error: { code: 'UNAUTHORIZED', message: 'Missing authentication' } }); return }
  const id = parseInt(req.params.id)
  if (isNaN(id)) { res.status(400).json({ data: null, error: { code: 'VALIDATION_ERROR', message: 'Invalid id' } }); return }
  try {
    const existing = await prisma.questionSet.findUnique({ where: { id }, select: { creatorId: true } })
    if (!existing) { res.status(404).json({ data: null, error: { code: 'NOT_FOUND', message: 'Set not found' } }); return }
    if (existing.creatorId !== req.userId) { res.status(403).json({ data: null, error: { code: 'FORBIDDEN', message: 'Not your set' } }); return }
    await prisma.questionSet.delete({ where: { id } })
    res.json({ data: { id }, error: null })
  } catch (err: unknown) {
    logger.error('set_delete_error', { userId: req.userId, id, error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to delete set' } })
  }
})

// ── POST /sets/:id/questions ─────────────────────────────────────────────────
router.post('/:id/questions', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.userId) { res.status(401).json({ data: null, error: { code: 'UNAUTHORIZED', message: 'Missing authentication' } }); return }
  const setId = parseInt(req.params.id)
  if (isNaN(setId)) { res.status(400).json({ data: null, error: { code: 'VALIDATION_ERROR', message: 'Invalid id' } }); return }
  const parse = questionSchema.safeParse(req.body)
  if (!parse.success) { res.status(400).json({ data: null, error: { code: 'VALIDATION_ERROR', message: parse.error.errors[0]?.message ?? 'Invalid input' } }); return }
  try {
    const existing = await prisma.questionSet.findUnique({ where: { id: setId }, select: { creatorId: true } })
    if (!existing) { res.status(404).json({ data: null, error: { code: 'NOT_FOUND', message: 'Set not found' } }); return }
    if (existing.creatorId !== req.userId) { res.status(403).json({ data: null, error: { code: 'FORBIDDEN', message: 'Not your set' } }); return }
    const count = await prisma.question.count({ where: { setId } })
    if (count >= 50) { res.status(400).json({ data: null, error: { code: 'LIMIT_EXCEEDED', message: 'Max 50 questions per set' } }); return }
    const question = await prisma.question.create({
      data: { ...parse.data, setId, orderIndex: count },
    })
    await prisma.questionSet.update({ where: { id: setId }, data: { updatedAt: new Date() } })
    res.status(201).json({ data: question, error: null })
  } catch (err: unknown) {
    logger.error('question_create_error', { userId: req.userId, setId, error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to add question' } })
  }
})

// ── PUT /sets/:id/questions/:qid ─────────────────────────────────────────────
router.put('/:id/questions/:qid', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.userId) { res.status(401).json({ data: null, error: { code: 'UNAUTHORIZED', message: 'Missing authentication' } }); return }
  const setId = parseInt(req.params.id)
  const qid   = parseInt(req.params.qid)
  if (isNaN(setId) || isNaN(qid)) { res.status(400).json({ data: null, error: { code: 'VALIDATION_ERROR', message: 'Invalid id' } }); return }
  const parse = questionSchema.partial().safeParse(req.body)
  if (!parse.success) { res.status(400).json({ data: null, error: { code: 'VALIDATION_ERROR', message: parse.error.errors[0]?.message ?? 'Invalid input' } }); return }
  try {
    const set = await prisma.questionSet.findUnique({ where: { id: setId }, select: { creatorId: true } })
    if (!set) { res.status(404).json({ data: null, error: { code: 'NOT_FOUND', message: 'Set not found' } }); return }
    if (set.creatorId !== req.userId) { res.status(403).json({ data: null, error: { code: 'FORBIDDEN', message: 'Not your set' } }); return }
    const question = await prisma.question.update({ where: { id: qid }, data: parse.data })
    res.json({ data: question, error: null })
  } catch (err: unknown) {
    logger.error('question_update_error', { userId: req.userId, qid, error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to update question' } })
  }
})

// ── DELETE /sets/:id/questions/:qid ──────────────────────────────────────────
router.delete('/:id/questions/:qid', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.userId) { res.status(401).json({ data: null, error: { code: 'UNAUTHORIZED', message: 'Missing authentication' } }); return }
  const setId = parseInt(req.params.id)
  const qid   = parseInt(req.params.qid)
  if (isNaN(setId) || isNaN(qid)) { res.status(400).json({ data: null, error: { code: 'VALIDATION_ERROR', message: 'Invalid id' } }); return }
  try {
    const set = await prisma.questionSet.findUnique({ where: { id: setId }, select: { creatorId: true } })
    if (!set) { res.status(404).json({ data: null, error: { code: 'NOT_FOUND', message: 'Set not found' } }); return }
    if (set.creatorId !== req.userId) { res.status(403).json({ data: null, error: { code: 'FORBIDDEN', message: 'Not your set' } }); return }
    await prisma.question.delete({ where: { id: qid } })
    res.json({ data: { id: qid }, error: null })
  } catch (err: unknown) {
    logger.error('question_delete_error', { userId: req.userId, qid, error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to delete question' } })
  }
})

// ── PUT /sets/:id/questions/reorder ──────────────────────────────────────────
router.put('/:id/questions/reorder', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.userId) { res.status(401).json({ data: null, error: { code: 'UNAUTHORIZED', message: 'Missing authentication' } }); return }
  const setId = parseInt(req.params.id)
  if (isNaN(setId)) { res.status(400).json({ data: null, error: { code: 'VALIDATION_ERROR', message: 'Invalid id' } }); return }
  const parse = z.object({ order: z.array(z.number().int()) }).safeParse(req.body)
  if (!parse.success) { res.status(400).json({ data: null, error: { code: 'VALIDATION_ERROR', message: 'order must be array of question ids' } }); return }
  try {
    const set = await prisma.questionSet.findUnique({ where: { id: setId }, select: { creatorId: true } })
    if (!set) { res.status(404).json({ data: null, error: { code: 'NOT_FOUND', message: 'Set not found' } }); return }
    if (set.creatorId !== req.userId) { res.status(403).json({ data: null, error: { code: 'FORBIDDEN', message: 'Not your set' } }); return }
    await prisma.$transaction(
      parse.data.order.map((qid, i) => prisma.question.update({ where: { id: qid }, data: { orderIndex: i } }))
    )
    res.json({ data: { ok: true }, error: null })
  } catch (err: unknown) {
    logger.error('question_reorder_error', { userId: req.userId, setId, error: err instanceof Error ? err.message : String(err) })
    res.status(500).json({ data: null, error: { code: 'INTERNAL_ERROR', message: 'Failed to reorder questions' } })
  }
})

export default router
