import { api } from './client'

// Only the chat endpoint is wrapped — GET /ai/study-plan has no consuming
// screen in this rebuild's scope, so no wrapper is built for it either.
export async function sendChatMessage(message: string): Promise<{ reply: string }> {
  return api.post('/ai/chat', { message })
}
