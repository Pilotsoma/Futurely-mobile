import { Router, Request, Response } from 'express'
import { searchSchools } from '../data/schools'

const router = Router()

// GET /schools/search?q=lincoln
// Public — no auth needed, used on teacher registration form
router.get('/search', (req: Request, res: Response): void => {
  const q = String(req.query.q ?? '').trim()
  const results = searchSchools(q)
  res.json({ data: results })
})

export default router
