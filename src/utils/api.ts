import { API_BASE_URL } from '../constants/api'
import { clearToken, getToken } from './auth'

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export async function fetchWithAuth(
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const token = await getToken()

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  }

  if (token !== null) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
  })

  if (response.status === 401) {
    await clearToken()
  }

  return response
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetchWithAuth(path, options)

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      error?: string | { code?: string; message?: string }
    }
    const errorMessage =
      typeof body.error === 'string'
        ? body.error
        : (body.error?.message ?? response.statusText)
    throw new ApiError(response.status, errorMessage)
  }

  return response.json() as Promise<T>
}
