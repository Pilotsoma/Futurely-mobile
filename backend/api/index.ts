import app from '../src/app'
import { ensureSchema } from '../src/lib/startup'
import type { Request, Response } from 'express'
import { safeConsole as console } from '../src/common/safeConsole'

// Run schema patches in the background — never block incoming requests.
ensureSchema().catch(err => console.error('[startup]', err))

// Tell the Vercel runtime to allow up to 60 seconds for this function.
// The agent orchestrator runs a multi-step tool-use loop (up to 12 tool calls
// by default, 15 hard cap) with one LLM round-trip per turn plus DB writes —
// this can easily exceed the default 10-second limit on Hobby plans.
// NOTE: this export follows the standard Vercel named-export convention. Whether
// it is honoured by the experimentalServices.backend adapter (vs. Next.js API
// routes, which always respect it) depends on the Vercel runtime version in use.
// If the platform does not pick it up, set maxDuration via vercel.json's
// "functions" key instead. Either way it has no effect on non-Vercel runtimes.
export const maxDuration = 60

export default function handler(req: Request, res: Response): void {
  req.url = (req.url ?? '/').replace(/^\/api/, '') || '/'
  app(req, res)
}
