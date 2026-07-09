import { api, requestEnvelope } from './client'
import type {
  Assignment,
  CreateAssignmentRequest,
  ListAssignmentsMeta,
  ListAssignmentsParams,
} from '../types/assignments'

export interface ListAssignmentsResult {
  data: Assignment[]
  meta: ListAssignmentsMeta
}

export async function listAssignments(params: ListAssignmentsParams = {}): Promise<ListAssignmentsResult> {
  const query: Record<string, string | number> = {}
  if (params.status) query.status = params.status
  if (params.cursor !== undefined) query.cursor = params.cursor
  if (params.limit !== undefined) query.limit = params.limit

  const { data, meta } = await requestEnvelope<Assignment[], ListAssignmentsMeta>('/assignments', {
    method: 'GET',
    query,
  })
  return { data, meta: meta ?? { nextCursor: null, hasNextPage: false, count: data.length } }
}

export async function createAssignment(payload: CreateAssignmentRequest): Promise<Assignment> {
  return api.post('/assignments', payload)
}

export async function completeAssignment(id: number, completed: boolean): Promise<Assignment> {
  return api.patch(`/assignments/${id}/complete`, { completed })
}

export async function deleteAssignment(id: number): Promise<{ deleted: true }> {
  return api.delete(`/assignments/${id}`)
}
