import { api } from './client'
import type { Roadmap } from '../types/roadmap'

export async function getRoadmap(): Promise<Roadmap> {
  return api.get('/roadmap')
}
