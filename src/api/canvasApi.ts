import { api } from './client'

export interface CanvasConnection {
  canvasInstanceUrl: string
  canvasUserName: string | null
  lastSynced: string | null
  syncStatus?: string | null
  syncError?: string | null
}

export interface CanvasStatus {
  connected: boolean
  canvasInstanceUrl: string | null
  canvasUserName: string | null
  lastSynced: string | null
  syncStatus?: string | null
  syncError?: string | null
  connections?: CanvasConnection[]
}

export interface CanvasConnectResult {
  connected: boolean
  canvasUserName: string
  canvasInstanceUrl: string
}

export interface CanvasSyncResult {
  syncedCount: number
  assignments: Array<{
    title: string
    subject: string
    dueDate: string
  }>
}

export async function getCanvasStatus(): Promise<CanvasStatus> {
  return api.get('/integrations/canvas/status')
}

export async function connectCanvas(
  canvasInstanceUrl: string,
  accessToken: string,
): Promise<CanvasConnectResult> {
  return api.post('/integrations/canvas/connect', {
    canvasInstanceUrl,
    accessToken,
  })
}

export async function syncCanvas(): Promise<CanvasSyncResult> {
  return api.post('/integrations/canvas/sync')
}

export async function disconnectCanvas(
  canvasInstanceUrl?: string,
): Promise<{
  disconnected: boolean
  deletedAssignmentsCount: number
  canvasInstanceUrl?: string
}> {
  return api.delete(
    '/integrations/canvas/disconnect',
    canvasInstanceUrl ? { canvasInstanceUrl } : undefined,
  )
}