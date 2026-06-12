/**
 * portalApi.ts
 * Mobile API client for the live school portal integration.
 *
 * This version uses direct fetch instead of apiFetch so we can debug:
 * - exact URL being called
 * - whether auth token exists
 * - backend status code
 * - backend response body
 *
 * SECURITY NOTE:
 * This file never stores portal passwords. Passwords are passed only in the
 * connect request body and are discarded immediately after the request.
 */

import { API_BASE_URL } from '../constants/api'
import { getToken } from '../utils/auth'

// ── Shared types ──────────────────────────────────────────────────────────────

export interface NormalizedAssignment {
  name: string
  category: string
  score: number | null
  totalPoints: number | null
  percentage: string
  dateDue: string
}

export interface NormalizedCourse {
  id: string
  name: string
  teacher: string
  period: string
  average: number | null
  letterGrade: string | null
  assignments: NormalizedAssignment[]
}

export interface PortalStatus {
  connected: boolean
  systemType: 'HAC' | 'PowerSchool' | null
  districtUrl: string | null
  lastSynced: string | null
  sessionExpiresIn: number
}

export interface ConnectResult {
  connected: boolean
  systemType: 'HAC' | 'PowerSchool'
}

export interface PortalGpa {
  gpa: number | null
  courseCount: number
  systemType: 'HAC' | 'PowerSchool'
}

// ── Internal request helper ───────────────────────────────────────────────────

async function portalRequest<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = await getToken()

  const normalizedBaseUrl = API_BASE_URL.endsWith('/')
    ? API_BASE_URL.slice(0, -1)
    : API_BASE_URL

  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  const url = `${normalizedBaseUrl}${normalizedPath}`

  console.log('[PORTAL API] URL:', url)
  console.log('[PORTAL API] METHOD:', options.method ?? 'GET')
  console.log('[PORTAL API] HAS TOKEN:', Boolean(token))

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  }

  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  let response: Response

  try {
    response = await fetch(url, {
      ...options,
      headers,
    })
  } catch (error: unknown) {
    console.log('[PORTAL API] FETCH FAILED:', error)

    throw new Error(
      `Network request failed. The app could not reach the backend. Check API_BASE_URL in src/constants/api.ts. Current URL: ${url}`,
    )
  }

  const text = await response.text()

  console.log('[PORTAL API] STATUS:', response.status)
  console.log('[PORTAL API] RESPONSE TEXT:', text)

  let json: any = {}

  try {
    json = text ? JSON.parse(text) : {}
  } catch {
    json = { raw: text }
  }

  if (!response.ok) {
    const message =
      typeof json.error === 'string'
        ? json.error
        : json.error?.message || json.message || response.statusText

    throw new Error(`${response.status}: ${message}`)
  }

  return json as T
}

// ── Portal connection ─────────────────────────────────────────────────────────

export async function connectHac(
  baseUrl: string,
  username: string,
  password: string,
): Promise<ConnectResult> {
  console.log('[PORTAL API] connectHac called')
  console.log('[PORTAL API] HAC baseUrl:', baseUrl)
  console.log('[PORTAL API] HAC username exists:', Boolean(username))
  console.log('[PORTAL API] HAC password exists:', Boolean(password))

  const res = await portalRequest<{
    data: {
      sessionToken?: string
      systemType?: string
    }
  }>('/integrations/grades/hac/login', {
    method: 'POST',
    body: JSON.stringify({
      baseUrl,
      username,
      password,
    }),
  })

  return {
    connected: Boolean(res.data?.sessionToken),
    systemType: 'HAC',
  }
}

export async function connectPowerSchool(
  baseUrl: string,
  username: string,
  password: string,
): Promise<ConnectResult> {
  console.log('[PORTAL API] connectPowerSchool called')
  console.log('[PORTAL API] PowerSchool baseUrl:', baseUrl)
  console.log('[PORTAL API] PowerSchool username exists:', Boolean(username))
  console.log('[PORTAL API] PowerSchool password exists:', Boolean(password))

  const res = await portalRequest<{
    data: {
      sessionToken?: string
      systemType?: string
    }
  }>('/integrations/grades/powerschool/login', {
    method: 'POST',
    body: JSON.stringify({
      baseUrl,
      username,
      password,
    }),
  })

  return {
    connected: Boolean(res.data?.sessionToken),
    systemType: 'PowerSchool',
  }
}

// ── Status ────────────────────────────────────────────────────────────────────

export async function getPortalStatus(): Promise<PortalStatus> {
  const res = await portalRequest<{ data: PortalStatus }>(
    '/integrations/grades/status',
  )

  return res.data
}

// ── Grade data ────────────────────────────────────────────────────────────────

export async function getCurrentPortalGrades(): Promise<NormalizedCourse[]> {
  const res = await portalRequest<{
    data: {
      systemType: string
      grades: NormalizedCourse[]
    }
  }>('/integrations/grades/current')

  return res.data.grades ?? []
}

export async function getPortalGpa(): Promise<PortalGpa> {
  const res = await portalRequest<{ data: PortalGpa }>(
    '/integrations/grades/gpa',
  )

  return res.data
}

// ── Disconnect ────────────────────────────────────────────────────────────────

export async function disconnectPortal(): Promise<{ disconnected: boolean }> {
  const res = await portalRequest<{ data: { disconnected: boolean } }>(
    '/integrations/grades/session',
    {
      method: 'DELETE',
    },
  )

  return res.data
}