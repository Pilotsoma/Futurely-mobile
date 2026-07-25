import { AsyncLocalStorage } from 'async_hooks'
import type { Response } from 'express'

// Lets createChatCompletion() know per-request whether the client has asked
// to skip the primary model (because it already saw a fallback happen
// earlier in this browser session), and lets it report back when it used the
// fallback — without threading a flag through every AI service function's
// signature. Scoped to a single request via AsyncLocalStorage.
interface AiRequestStore {
  res: Response
  skipPrimary: boolean
}

const als = new AsyncLocalStorage<AiRequestStore>()

export function runWithAiRequestContext<T>(res: Response, skipPrimary: boolean, fn: () => T): T {
  return als.run({ res, skipPrimary }, fn)
}

export function shouldSkipPrimaryModel(): boolean {
  return als.getStore()?.skipPrimary ?? false
}

export function markFallbackUsed(): void {
  const store = als.getStore()
  if (store && !store.res.headersSent) {
    store.res.setHeader('X-AI-Used-Fallback', '1')
  }
}
