import { apiFetch } from '../utils/api'

export interface StudySession {
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
  sessions: StudySession[]
}

export interface AiStudyPlan {
  overview: string
  days: StudyPlanDay[]
}

interface ChatResponse {
  data: { reply: string }
}

interface StudyPlanResponse {
  data: AiStudyPlan
}

export async function sendChatMessage(message: string): Promise<string> {
  const res = await apiFetch<ChatResponse>('/ai/chat', {
    method: 'POST',
    body: JSON.stringify({ message }),
  })
  return res.data.reply
}

export async function fetchStudyPlan(): Promise<AiStudyPlan> {
  const res = await apiFetch<StudyPlanResponse>('/ai/study-plan')
  return res.data
}
