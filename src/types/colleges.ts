export interface CollegeSearchResult {
  unitId: string
  name: string
  city: string | null
  state: string | null
  admissionRate: number | null
  sat25th: number | null
  sat75th: number | null
  score: number | null
  label: string | null
}

export interface CollegeListItem {
  id: number
  name: string
  scorecardUnitId: string | null
  createdAt: string
  unitId: string | null
  city: string | null
  state: string | null
  admissionRate: number | null
  sat25th: number | null
  sat75th: number | null
  score: number | null
  label: string | null
}

export interface AddCollegeRequest {
  name: string
  scorecardUnitId?: string
}

export interface CollegeInsights {
  collegeListItemId: number
  collegeName: string
  score: number | null
  label: string | null
  narrativeSummary: string
  actionableSteps: string[]
  generatedAt: string
  cached: boolean
}
