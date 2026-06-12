import { apiFetch } from '../utils/api'

export interface RoadmapMilestone {
  grade: number
  label: string
  done: boolean
}

export interface RoadmapData {
  gradeLevel: number
  graduationYear: number | null
  creditsCompleted: number
  creditsRequired: number
  percentComplete: number
  creditsByCategory: Record<string, number>
  milestones: RoadmapMilestone[]
  weightedGpa: number
  unweightedGpa: number
  futureDecision: string | null
}

interface RoadmapApiResponse {
  data: RoadmapData
}

export async function fetchRoadmap(): Promise<RoadmapData> {
  const res = await apiFetch<RoadmapApiResponse>('/roadmap')
  return res.data
}
