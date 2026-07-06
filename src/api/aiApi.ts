// AI advisor API — wraps /api/ai/* endpoints.
//
// Endpoint shapes confirmed from backend/src/routes/ai.ts.
// Both endpoints call OpenRouter server-side — allow extra time versus a plain CRUD call.

import { apiGet, apiPost } from './client'

export interface ChatResponse {
  reply: string
}

// POST /ai/chat — one-shot chat message; server injects student context
// (GPA, courses, pending assignments, attendance) into the system prompt.
export function chat(message: string, token: string): Promise<ChatResponse> {
  return apiPost<ChatResponse>('/ai/chat', { message }, token, { isScrapingEndpoint: true })
}

export interface StudyPlanSession {
  assignmentId: number
  title: string
  subject: string
  dueDate: string
  minutesToSpend: number
  notes: string
}

export interface StudyPlanDay {
  label: string
  date: string
  sessions: StudyPlanSession[]
}

export interface StudyPlan {
  overview: string
  days: StudyPlanDay[]
}

// GET /ai/study-plan — AI-generated study schedule from pending assignments.
export function getStudyPlan(token: string): Promise<StudyPlan> {
  return apiGet<StudyPlan>('/ai/study-plan', token, { isScrapingEndpoint: true })
}
