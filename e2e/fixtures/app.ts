import { expect, test as base, type Page, type Route } from '@playwright/test'

const todayAtNoon = (): string => {
  const date = new Date()
  date.setHours(12, 0, 0, 0)
  return date.toISOString()
}

const authUser = {
  id: 1,
  email: 'student@example.test',
  name: 'Avery Student',
  role: 'STUDENT',
  emailVerified: true,
  accountStatus: 'ACTIVE',
  bannedUntilDate: null,
  createdAt: '2025-01-01T00:00:00.000Z',
  dobCorrectionAttempts: 0,
  hasSchoolConnection: true,
  hasSchoolRecord: true,
}

const courses = [
  {
    id: 'course-1',
    name: 'AP Biology',
    teacher: 'Dr. Rivera',
    period: '1',
    average: 93.5,
    letterGrade: 'A',
    assignments: [],
    upcomingAssignments: [],
  },
  {
    id: 'course-2',
    name: 'English III',
    teacher: 'Ms. Brooks',
    period: '2',
    average: 88,
    letterGrade: 'B',
    assignments: [],
    upcomingAssignments: [],
  },
]

const assignment = {
  id: 101,
  userId: 1,
  title: 'Biology lab reflection',
  subject: 'AP Biology',
  dueDate: todayAtNoon(),
  dueTime: '15:30',
  estimatedMinutes: 30,
  completed: false,
  completedAt: null,
  source: 'Canvas',
  priority: 'HIGH',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const student = {
  id: 1,
  email: authUser.email,
  name: authUser.name,
  role: authUser.role,
  hasPassword: true,
  profile: {
    id: 1,
    userId: 1,
    gradeLevel: 11,
    graduationYear: 2027,
    weightedGpa: 4.125,
    unweightedGpa: 3.875,
    futureDecision: 'Computer science',
    satScore: 1280,
    actScore: 29,
    counselorName: 'Jordan Lee',
  },
  courses: [],
  assignments: [assignment],
  stats: {
    totalCourses: 2,
    completedAssignments: 4,
    pendingAssignments: 1,
    assignmentsDueToday: 1,
    assignmentsDueThisWeek: 1,
  },
}

export interface MockApi {
  requests: { method: string; path: string; body: unknown }[]
  gpa: {
    gpa: number | null
    unweightedGpa: number | null
    weightedGpa: number | null
    courseCount: number
    systemType: 'HAC'
  }
  failProfileSave: boolean
  aiDelayMs: number
}

type Fixtures = { mockApi: MockApi }

function json(route: Route, data: unknown, status = 200): Promise<void> {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(status >= 400 ? data : { data }),
  })
}

async function installApiMock(page: Page, state: MockApi): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem('futurely.accessToken', 'e2e-access-token')
    window.localStorage.setItem('futurely.refreshToken', 'e2e-refresh-token')
  })

  await page.route('http://localhost:3001/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname
    const method = request.method()
    let body: unknown = null
    try {
      body = request.postDataJSON()
    } catch {
      body = request.postData()
    }
    state.requests.push({ method, path, body })

    if (path === '/auth/me') return json(route, authUser)
    if (path === '/auth/logout' && method === 'POST') {
      return route.fulfill({ status: 204, body: '' })
    }
    if (path === '/integrations/grades/status') {
      return json(route, {
        connected: true,
        systemType: 'HAC',
        districtUrl: 'https://school.example.test',
        lastSynced: '2026-08-01T12:00:00.000Z',
        sessionExpiresIn: 3600,
      })
    }
    if (path === '/students/me' && method === 'GET') return json(route, student)
    if (path === '/students/me/profile' && method === 'PATCH') {
      if (state.failProfileSave) {
        return json(route, { data: null, error: { code: 'SAVE_FAILED', message: 'Profile save rejected by test server.' } }, 500)
      }
      const update = (body ?? {}) as Record<string, unknown>
      Object.assign(student.profile, update)
      return json(route, student.profile)
    }
    if (path === '/integrations/grades/gpa') return json(route, state.gpa)
    if (path === '/integrations/grades/current') {
      return json(route, { systemType: 'HAC', grades: courses })
    }
    if (path === '/integrations/grades/sync-profile' && method === 'POST') {
      state.gpa.unweightedGpa = 3.925
      state.gpa.weightedGpa = 4.175
      state.gpa.gpa = 3.925
      return json(route, { synced: true, systemType: 'HAC' })
    }
    if (path === '/assignments') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [assignment],
          meta: { nextCursor: null, hasNextPage: false, count: 1 },
        }),
      })
    }
    if (path === '/ai/chat' && method === 'POST') {
      if (state.aiDelayMs) await new Promise((resolve) => setTimeout(resolve, state.aiDelayMs))
      const message = (body as { message?: string } | null)?.message ?? ''
      return json(route, { reply: `Test coach reply for: ${message}` })
    }
    if (path === '/integrations/canvas/status') {
      return json(route, {
        connected: false,
        canvasInstanceUrl: null,
        canvasUserName: null,
        lastSynced: null,
        connections: [],
      })
    }
    if (path === '/integrations/grades/classwork') {
      return json(route, { classes: [], availablePeriods: [], currentPeriod: null })
    }
    if (path === '/integrations/grades/transcript') {
      return json(route, { systemType: 'HAC', transcript: {} })
    }
    if (path === '/integrations/grades/schedule') return json(route, { schedule: {} })
    if (path.startsWith('/integrations/grades/')) return json(route, {})
    if (path === '/roadmap') {
      return json(route, {
        gradeLevel: 11,
        graduationYear: 2027,
        creditsCompleted: 18,
        creditsRequired: 24,
        percentComplete: 75,
        creditsByCategory: { English: 4, Math: 4, Science: 3, 'Social Studies': 3, Electives: 4 },
        milestones: [
          { grade: 9, label: 'Build strong foundations', done: true },
          { grade: 10, label: 'Explore academic interests', done: true },
          { grade: 11, label: 'Prepare for college applications', done: false },
          { grade: 12, label: 'Complete graduation requirements', done: false },
        ],
        weightedGpa: state.gpa.weightedGpa,
        unweightedGpa: state.gpa.unweightedGpa,
        futureDecision: null,
      })
    }

    return json(route, { data: null, error: { code: 'E2E_UNHANDLED', message: `Unhandled E2E route: ${method} ${path}` } }, 404)
  })
}

export const test = base.extend<Fixtures>({
  mockApi: [
    async ({ page }, use) => {
      const state: MockApi = {
        requests: [],
        gpa: {
          gpa: 3.875,
          unweightedGpa: 3.875,
          weightedGpa: 4.125,
          courseCount: 2,
          systemType: 'HAC',
        },
        failProfileSave: false,
        aiDelayMs: 0,
      }
      await installApiMock(page, state)
      await use(state)
    },
    { auto: true },
  ],
})

export { expect }
