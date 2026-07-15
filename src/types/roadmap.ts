// Mirrors backend/src/routes/roadmap.ts's GET / response exactly.
export interface RoadmapMilestone {
  grade: number
  label: string
  done: boolean
}

export interface Roadmap {
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
