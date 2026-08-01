/* eslint-disable @typescript-eslint/no-require-imports */
const { createServer } = require('node:http')

const PORT = 3001
const now = new Date()
now.setHours(15, 30, 0, 0)

const user = {
  id: 1,
  email: 'manual.student@example.test',
  name: 'Manual Test Student',
  role: 'STUDENT',
  emailVerified: true,
  accountStatus: 'ACTIVE',
  bannedUntilDate: null,
  createdAt: '2025-01-01T00:00:00.000Z',
  dobCorrectionAttempts: 0,
  hasSchoolConnection: true,
  hasSchoolRecord: true,
}

const assignment = {
  id: 101,
  userId: 1,
  title: 'Biology lab reflection',
  subject: 'AP Biology',
  dueDate: now.toISOString(),
  dueTime: '15:30',
  estimatedMinutes: 30,
  completed: false,
  completedAt: null,
  source: 'Canvas',
  priority: 'HIGH',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const profile = {
  id: 1,
  userId: 1,
  gradeLevel: 11,
  graduationYear: 2027,
  weightedGpa: 4.125,
  unweightedGpa: 3.875,
  futureDecision: 'Computer science',
  satScore: 1280,
  actScore: 29,
  counselorName: 'Test Counselor',
}

const student = {
  id: 1,
  email: user.email,
  name: user.name,
  role: user.role,
  hasPassword: true,
  profile,
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

const courses = [
  {
    id: 'course-1',
    name: 'AP Biology',
    teacher: 'Test Teacher',
    period: '1',
    average: 93.5,
    letterGrade: 'A',
    assignments: [],
    upcomingAssignments: [],
  },
  {
    id: 'course-2',
    name: 'English III',
    teacher: 'Test Teacher',
    period: '2',
    average: 88,
    letterGrade: 'B',
    assignments: [],
    upcomingAssignments: [],
  },
]

const gpa = {
  gpa: 3.875,
  unweightedGpa: 3.875,
  weightedGpa: 4.125,
  courseCount: 2,
  systemType: 'HAC',
}

function send(response, data, status = 200) {
  response.writeHead(status, {
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Client-Platform',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json; charset=utf-8',
  })
  response.end(JSON.stringify(status >= 400 ? data : { data }))
}

async function bodyOf(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  if (chunks.length === 0) return null
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return null
  }
}

const server = createServer(async (request, response) => {
  if (request.method === 'OPTIONS') return send(response, null, 204)

  const url = new URL(request.url ?? '/', `http://127.0.0.1:${PORT}`)
  const path = url.pathname
  const body = await bodyOf(request)
  process.stdout.write(`${request.method} ${path}\n`)

  if (path === '/auth/login' && request.method === 'POST') {
    return send(response, {
      token: 'manual-access-token',
      refreshToken: 'manual-refresh-token',
      user,
    })
  }
  if (path === '/auth/logout' && request.method === 'POST') {
    response.writeHead(204, { 'Access-Control-Allow-Origin': '*' })
    return response.end()
  }
  if (path === '/auth/me') return send(response, user)
  if (path === '/integrations/grades/status') {
    return send(response, {
      connected: true,
      systemType: 'HAC',
      districtUrl: 'https://school.example.test',
      lastSynced: new Date().toISOString(),
      sessionExpiresIn: 3600,
    })
  }
  if (path === '/students/me' && request.method === 'GET') return send(response, student)
  if (path === '/students/me/profile' && request.method === 'PATCH') {
    if (body?.satScore === 1599) {
      return send(response, {
        data: null,
        error: { code: 'MANUAL_SAVE_FAILURE', message: 'Manual verification save failure.' },
      }, 500)
    }
    Object.assign(profile, body ?? {})
    return send(response, profile)
  }
  if (path === '/integrations/grades/gpa') return send(response, gpa)
  if (path === '/integrations/grades/current') {
    return send(response, { systemType: 'HAC', grades: courses })
  }
  if (path === '/integrations/grades/sync-profile' && request.method === 'POST') {
    gpa.gpa = 3.925
    gpa.unweightedGpa = 3.925
    gpa.weightedGpa = 4.175
    return send(response, { synced: true, systemType: 'HAC' })
  }
  if (path === '/assignments') {
    response.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      'Content-Type': 'application/json; charset=utf-8',
    })
    return response.end(JSON.stringify({
      data: [assignment],
      meta: { nextCursor: null, hasNextPage: false, count: 1 },
    }))
  }
  if (path === '/ai/chat' && request.method === 'POST') {
    return send(response, { reply: `Manual test reply for: ${body?.message ?? ''}` })
  }
  if (path === '/integrations/canvas/status') {
    return send(response, {
      connected: false,
      canvasInstanceUrl: null,
      canvasUserName: null,
      lastSynced: null,
      connections: [],
    })
  }
  if (path === '/integrations/grades/classwork') {
    return send(response, { classes: [], availablePeriods: [], currentPeriod: null })
  }
  if (path === '/integrations/grades/transcript') {
    return send(response, { systemType: 'HAC', transcript: {} })
  }
  if (path === '/integrations/grades/schedule') return send(response, { schedule: {} })
  if (path.startsWith('/integrations/grades/')) return send(response, {})
  if (path === '/roadmap') {
    return send(response, {
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
      weightedGpa: gpa.weightedGpa,
      unweightedGpa: gpa.unweightedGpa,
      futureDecision: null,
    })
  }

  return send(response, {
    data: null,
    error: { code: 'MANUAL_UNHANDLED', message: `Unhandled manual route: ${request.method} ${path}` },
  }, 404)
})

server.listen(PORT, '127.0.0.1', () => {
  process.stdout.write(`Manual API available at http://127.0.0.1:${PORT}\n`)
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)))
}
