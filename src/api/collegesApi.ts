import { api } from './client'
import type { AddCollegeRequest, CollegeInsights, CollegeListItem, CollegeSearchResult } from '../types/colleges'

export async function searchColleges(query: string): Promise<CollegeSearchResult[]> {
  if (!query.trim()) return []
  return api.get('/colleges/search', { q: query })
}

export async function listSavedColleges(): Promise<CollegeListItem[]> {
  return api.get('/colleges')
}

export async function addCollege(payload: AddCollegeRequest): Promise<CollegeListItem> {
  return api.post('/colleges', payload)
}

export async function removeCollege(id: number): Promise<{ deleted: true }> {
  return api.delete(`/colleges/${id}`)
}

export async function getCollegeInsights(id: number): Promise<CollegeInsights> {
  return api.get(`/colleges/${id}/insights`)
}
