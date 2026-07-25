// Shared helpers for pulling a student's real academic context (courses,
// grades, class rank, attendance) out of the HAC/PowerSchool portal cache.
// Used by both the AI chat's personalized handler and the college insights
// generator, so both features draw on the same real data instead of the
// chat alone having "deep" context.

import { prisma } from './prisma'

export interface PortalData {
  weightedGpa: number | null
  unweightedGpa: number | null
  classRank: string | null
  courseList: string[]
  transcriptSummary: string
  attendanceSummary: string
}

// Read all available portal data from the HAC/PowerSchool cache
export async function getPortalData(userId: number): Promise<PortalData | null> {
  try {
    const conn = await prisma.schoolConnection.findUnique({
      where: { userId },
      select: { hacDataCache: true, systemType: true },
    })
    if (!conn?.hacDataCache) return null

    const cache = conn.hacDataCache as Record<string, { data: unknown; cachedAt: number }>

    // GPA + transcript history
    let weightedGpa: number | null = null
    let unweightedGpa: number | null = null
    let classRank: string | null = null
    let transcriptSummary = ''

    const transcript = cache['transcript']?.data as {
      weightedGPA?: string; unweightedGPA?: string; classRank?: string; quartile?: string; cumulativeGPA?: string
      semesters?: Array<{ year: string; semester: string; courses: Array<{ name: string; grade: string; credits: string }> }>
    } | undefined
    if (transcript) {
      const w = parseFloat(transcript.weightedGPA ?? '')
      const u = parseFloat(transcript.unweightedGPA ?? '')
      if (!isNaN(w)) weightedGpa = Math.round(w * 1000) / 1000
      if (!isNaN(u)) unweightedGpa = Math.round(u * 1000) / 1000
      if (transcript.classRank) classRank = `${transcript.classRank}${transcript.quartile ? ` (${transcript.quartile} quartile)` : ''}`
      // Only include the most recent semester from transcript to avoid overwhelming the model
      if (transcript.semesters?.length) {
        const recent = transcript.semesters[transcript.semesters.length - 1]
        transcriptSummary = `Most recent semester (${recent.year} ${recent.semester}): ${recent.courses.map(c => `${c.name} ${c.grade}`).join(', ')}`
      }
    }

    // Current course grades
    let courseList: string[] = []
    const classworkKey = Object.keys(cache).find(k => k.startsWith('classwork:'))
    if (classworkKey) {
      const classwork = cache[classworkKey].data as {
        classes?: Array<{ name?: string; average?: string | null; letterGrade?: string | null }>
      } | undefined
      if (classwork?.classes) {
        courseList = classwork.classes
          .filter(c => c.name && (c.average != null || c.letterGrade != null))
          .map(c => {
            const grade = c.letterGrade ? `${c.letterGrade} (${c.average ?? '?'}%)` : `${c.average}%`
            return `${c.name}: ${grade}`
          })
      }
    }

    // Attendance summary (month 0 = current month)
    let attendanceSummary = ''
    const attendance = cache['attendance:0']?.data as {
      month?: string; year?: number
      summary?: { absences: number; excused: number; tardies: number }
    } | undefined
    if (attendance?.summary) {
      const s = attendance.summary
      const month = attendance.month && attendance.year ? `${attendance.month} ${attendance.year}` : 'This month'
      attendanceSummary = `${month}: ${s.absences} absence(s), ${s.excused} excused, ${s.tardies} tardy(ies)`
    }

    return { weightedGpa, unweightedGpa, classRank, courseList, transcriptSummary, attendanceSummary }
  } catch { return null }
}

export function deriveGradeLevel(graduationYear: number | null, stored: number | null): number | null {
  if (graduationYear) {
    const now = new Date()
    const effectiveYear = now.getMonth() >= 7 ? now.getFullYear() + 1 : now.getFullYear()
    const derived = 12 - (graduationYear - effectiveYear)
    if (derived >= 9 && derived <= 12) return derived
  }
  return stored ?? null
}

// Rough proxy for course rigor when no dedicated "AP/Honors/IB" flag exists
// in the data model — counts course names that self-identify as advanced.
const RIGOR_MARKERS = /\b(ap|ib|ap\/ib|honors|ap-|dual\s?enrollment|college\s?credit)\b/i

export function countRigorousCourses(courseList: string[]): number {
  return courseList.filter(c => RIGOR_MARKERS.test(c)).length
}
