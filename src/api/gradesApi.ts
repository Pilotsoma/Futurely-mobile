import { api } from './client'
import type {
  ClassworkResponse,
  CurrentGradeCourse,
  GpaSummary,
  HacLoginRequest,
  PortalLoginResult,
  PortalStatus,
  PowerSchoolLoginRequest,
  RawPortalPayload,
  SystemType,
} from '../types/grades'

export async function hacLogin(payload: HacLoginRequest): Promise<PortalLoginResult> {
  return api.post('/integrations/grades/hac/login', payload)
}

export async function powerSchoolLogin(payload: PowerSchoolLoginRequest): Promise<PortalLoginResult> {
  return api.post('/integrations/grades/powerschool/login', payload)
}

export async function syncProfile(): Promise<{ synced: true; systemType: SystemType }> {
  return api.post('/integrations/grades/sync-profile')
}

export async function getCurrentGrades(): Promise<{ systemType: SystemType; grades: CurrentGradeCourse[] }> {
  return api.get('/integrations/grades/current')
}

export async function getGpa(): Promise<GpaSummary> {
  return api.get('/integrations/grades/gpa')
}

export async function getTranscript(): Promise<{ systemType: SystemType; transcript: RawPortalPayload }> {
  return api.get('/integrations/grades/transcript')
}

// HAC-only — returns error.code 'UNSUPPORTED' for PowerSchool-connected users.
export async function getSchedule(): Promise<{ schedule: RawPortalPayload }> {
  return api.get('/integrations/grades/schedule')
}

export async function getClasswork(period?: string): Promise<ClassworkResponse> {
  return api.get('/integrations/grades/classwork', period ? { period } : undefined)
}

export async function getReportCard(period?: string): Promise<RawPortalPayload> {
  return api.get('/integrations/grades/report-card', period ? { period } : undefined)
}

export async function getProgressReport(date?: string): Promise<RawPortalPayload> {
  return api.get('/integrations/grades/progress-report', date ? { date } : undefined)
}

export async function getAttendance(monthOffset = 0): Promise<RawPortalPayload> {
  return api.get('/integrations/grades/attendance', { monthOffset })
}

export async function getContactTeachers(): Promise<RawPortalPayload> {
  return api.get('/integrations/grades/contact-teachers')
}

export async function getPortalStatus(): Promise<PortalStatus> {
  return api.get('/integrations/grades/status')
}

export async function disconnectPortal(): Promise<{ disconnected: true }> {
  return api.delete('/integrations/grades/session')
}
