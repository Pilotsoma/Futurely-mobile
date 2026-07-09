import { api } from './client'
import type { StudentMe, StudentProfile, UpdateProfileRequest } from '../types/student'

export async function getMe(): Promise<StudentMe> {
  return api.get('/students/me')
}

export async function updateProfile(payload: UpdateProfileRequest): Promise<StudentProfile> {
  return api.patch('/students/me/profile', payload)
}
